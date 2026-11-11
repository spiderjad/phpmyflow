<?php
declare(strict_types=1);

namespace PhpMyFlow;

use PDO;

/**
 * One collection run (cron every minute, or the "pseudo-cron" on panel
 * visits): store per-minute rates, hourly aggregates, hourly database
 * sizes, peak snapshots and alerts. Keeps the previous raw counters in the
 * store so deltas survive between runs.
 */
final class Collector
{
    /** "host:port" key, with localhost normalized. */
    public static function serverKey(string $host, int $port): string
    {
        $host = in_array(strtolower($host), ['localhost', '::1'], true) ? '127.0.0.1' : strtolower($host);
        return "$host:$port";
    }

    /** Key of the server the logged-in user is connected to. */
    public static function sessionKey(): string
    {
        $c = Auth::credentials();
        return self::serverKey($c['host'], (int) $c['port']);
    }

    /** Key of the server in config 'monitor'. */
    public static function configKey(): ?string
    {
        $m = pmf_config()['monitor'] ?? null;
        return is_array($m) && !empty($m['user']) ? self::serverKey((string) ($m['host'] ?? '127.0.0.1'), (int) ($m['port'] ?? 3306)) : null;
    }

    /**
     * Run once. Returns what happened, for the CLI output.
     *
     * @return array{sampled:bool, peaks:int, aggregated:int, sizes:bool, alerts:int}
     */
    public static function run(PDO $pdo, string $server, MetricsStore $store, ?int $now = null): array
    {
        $now ??= time();
        $minute = $now - ($now % 60);
        $monitor = new Monitor($pdo);
        $raw = $monitor->rawStatus()['status'];
        $prev = $store->getState("raw:$server");
        $store->setState("raw:$server", $raw);
        $result = ['sampled' => false, 'peaks' => 0, 'aggregated' => 0, 'sizes' => false, 'alerts' => 0];

        $rates = is_array($prev) ? Metrics::rates($prev, $raw) : null;
        if ($rates !== null) {
            $store->addSample($server, $minute, $rates);
            $result['sampled'] = true;

            $history = array_column($store->samples($server, $minute - 3600, $minute - 60), 'm');
            $fixed = pmf_config()['monitor_peaks'] ?? [];
            $peaks = Metrics::detectPeaks($rates, $history, is_array($fixed) ? $fixed : []);
            if ($peaks) {
                $store->addPeak($server, $minute, $peaks, self::snapshot($monitor, $rates));
                $result['peaks'] = count($peaks);
            }
            $result['alerts'] = self::alerts($store, $server, $rates, $now);
        }

        // Hourly aggregates for every complete hour not yet aggregated.
        $thisHour = Metrics::hourOf($now);
        $last = (int) ($store->getState("agg:$server") ?? 0);
        $start = $last > 0 ? $last + 3600 : $thisHour - 3600;
        for ($h = max($start, $thisHour - 90 * 86400); $h < $thisHour; $h += 3600) {
            $rows = array_column($store->samples($server, $h, $h + 3599), 'm');
            if ($rows) {
                $store->addHourly($server, $h, Metrics::aggregate($rows));
                $result['aggregated']++;
            }
            $store->setState("agg:$server", $h);
        }

        // Database sizes and retention cleanup, once per hour.
        if ((int) ($store->getState("sizes:$server") ?? 0) < $thisHour) {
            foreach ($pdo->query("SELECT TABLE_SCHEMA AS db, SUM(DATA_LENGTH + INDEX_LENGTH) AS bytes FROM information_schema.TABLES GROUP BY TABLE_SCHEMA")->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $store->addSize($server, $thisHour, (string) $r['db'], (int) $r['bytes']);
            }
            $store->setState("sizes:$server", $thisHour);
            $store->prune($now);
            $result['sizes'] = true;
        }

        $store->setState("last_run:$server", $now);
        return $result;
    }

    /** What was going on at the peak: processes (literals hidden) and the top digests. */
    private static function snapshot(Monitor $monitor, array $rates): array
    {
        $snap = ['rates' => $rates, 'processes' => [], 'digests' => []];
        try {
            $snap['processes'] = array_values(array_filter(
                $monitor->processlist(true)['rows'],
                static fn ($p) => $p['command'] !== 'Sleep' && !$p['self']
            ));
            $snap['processes'] = array_slice($snap['processes'], 0, 100);
        } catch (\Throwable) {
        }
        try {
            $top = $monitor->topQueries('total', 10);
            if ($top['available'] ?? false) {
                $snap['digests'] = array_map(static fn ($d) => array_intersect_key($d, array_flip(['digest', 'db', 'text', 'count', 'total', 'avg', 'examined'])), $top['rows']);
            }
        } catch (\Throwable) {
        }
        return $snap;
    }

    /**
     * Webhook alerts (Slack, Teams or generic JSON) for critical
     * thresholds, at most one per metric every 15 minutes.
     */
    private static function alerts(MetricsStore $store, string $server, array $rates, int $now): int
    {
        $cfg = pmf_config()['monitor_alerts'] ?? [];
        $url = is_array($cfg) ? (string) ($cfg['webhook'] ?? '') : '';
        if ($url === '' || !preg_match('~^https?://~i', $url)) {
            return 0;
        }
        $t = Monitor::thresholds();
        $checks = [
            'connections_pct' => $rates['max_connections'] ? $rates['threads_connected'] / $rates['max_connections'] : null,
            'threads_running' => $rates['threads_running'],
            'slow_per_min' => $rates['slow_per_min'],
            'tmp_disk' => $rates['tmp_disk'],
            'row_lock_waits' => $rates['row_lock_waits'],
            'bp_hit' => $rates['bp_hit'],
        ];
        $sent = 0;
        $last = $store->getState("alerts:$server") ?? [];
        foreach ($checks as $metric => $value) {
            if ($value === null || !isset($t[$metric]['crit'])) {
                continue;
            }
            $crit = (float) $t[$metric]['crit'];
            $over = $metric === 'bp_hit' ? $value < $crit : $value > $crit;
            if (!$over || ($now - (int) ($last[$metric] ?? 0)) < 900) {
                continue;
            }
            $text = sprintf('phpMyFlow %s: %s = %s (threshold %s)', $server, $metric, round((float) $value, 3), $crit);
            $format = (string) ($cfg['format'] ?? 'generic');
            $payload = match ($format) {
                'slack', 'teams' => ['text' => $text],
                default => ['server' => $server, 'metric' => $metric, 'value' => $value, 'threshold' => $crit, 'time' => gmdate('c', $now)],
            };
            $ctx = stream_context_create(['http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => json_encode($payload),
                'timeout' => 5,
                'ignore_errors' => true,
            ]]);
            @file_get_contents($url, false, $ctx);
            $last[$metric] = $now;
            $sent++;
        }
        if ($sent) {
            $store->setState("alerts:$server", $last);
        }
        return $sent;
    }

    /** Pseudo-cron: run if the last sample is a minute old, without blocking a concurrent run. */
    public static function maybeRun(PDO $pdo, string $server): void
    {
        $store = MetricsStore::open();
        if (time() - (int) ($store->getState("last_run:$server") ?? 0) < 60) {
            return;
        }
        $lock = fopen(MetricsStore::defaultDir() . '/collect.lock', 'c');
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
            return;
        }
        try {
            self::run($pdo, $server, $store);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** What the history panel needs to show "how to enable" or "last sample". */
    public static function status(): array
    {
        $cfg = pmf_config();
        $collect = realpath(dirname(__DIR__) . '/collect.php') ?: dirname(__DIR__) . '/collect.php';
        $php = PHP_BINARY !== '' && !str_contains(strtolower(PHP_BINARY), 'php-cgi') && !str_contains(strtolower(PHP_BINARY), 'fpm') ? PHP_BINARY : 'php';
        $out = [
            'monitorUser' => self::configKey() !== null,
            'monitorServer' => self::configKey(),
            'pseudoCron' => !empty($cfg['monitor_pseudo_cron']),
            'sqlite' => extension_loaded('pdo_sqlite'),
            'cron' => '* * * * * ' . $php . ' ' . $collect . ' >/dev/null 2>&1',
            'lastRun' => null,
            'server' => null,
        ];
        try {
            $key = self::sessionKey();
            $out['server'] = $key;
            $store = MetricsStore::open();
            $out['storage'] = $store->kind();
            $out['lastRun'] = $store->getState("last_run:$key");
        } catch (\Throwable) {
        }
        return $out;
    }
}
