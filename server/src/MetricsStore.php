<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * Storage for the monitor history. SQLite (pdo_sqlite) when available,
 * otherwise JSON Lines files rotated per day. Same API either way.
 *
 * Retention: minute samples 7 days, hourly aggregates and peaks 90 days.
 * `server` keys rows by "host:port" so one data dir can hold several servers.
 */
abstract class MetricsStore
{
    public const MINUTE_RETENTION = 7 * 86400;
    public const HOUR_RETENTION = 90 * 86400;

    abstract public function addSample(string $server, int $ts, array $metrics): void;

    /** @return list<array{ts:int, m:array}> */
    abstract public function samples(string $server, int $from, int $to): array;

    abstract public function addHourly(string $server, int $hour, array $agg): void;

    /** @return list<array{ts:int, a:array}> */
    abstract public function hourly(string $server, int $from, int $to): array;

    /** @return string peak id */
    abstract public function addPeak(string $server, int $ts, array $peaks, array $snapshot): string;

    /** @return list<array{id:string, ts:int, peaks:array}> (no snapshot) */
    abstract public function peaks(string $server, int $from, int $to): array;

    abstract public function peak(string $server, string $id): ?array;

    abstract public function addSize(string $server, int $ts, string $db, int $bytes): void;

    /** @return list<array{ts:int, db:string, bytes:int}> */
    abstract public function sizes(string $server, int $from, int $to): array;

    abstract public function getState(string $key): mixed;

    abstract public function setState(string $key, mixed $value): void;

    /** Delete rows past retention. */
    abstract public function prune(int $now): void;

    abstract public function kind(): string;

    /** Open the configured store, creating and protecting the data dir. */
    public static function open(?string $dir = null, bool $forceJson = false): self
    {
        $dir = rtrim($dir ?? self::defaultDir(), '/\\');
        self::prepareDir($dir);
        if (!$forceJson && extension_loaded('pdo_sqlite') && in_array('sqlite', \PDO::getAvailableDrivers(), true)) {
            return new SqliteMetricsStore($dir . '/metrics.sqlite');
        }
        return new JsonlMetricsStore($dir);
    }

    public static function defaultDir(): string
    {
        $configured = pmf_config()['monitor_data_dir'] ?? '';
        return $configured !== '' ? (string) $configured : dirname(__DIR__) . '/data';
    }

    /** Create the directory and block web access to it (Apache, IIS, plus an index). */
    public static function prepareDir(string $dir): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new ApiError('monitor_storage', 'Cannot create the metrics directory', 500, ['path' => $dir]);
        }
        $files = [
            '.htaccess' => "Require all denied\n<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n",
            'web.config' => "<?xml version=\"1.0\"?>\n<configuration><system.webServer><authorization><deny users=\"*\" /></authorization></system.webServer></configuration>\n",
            'index.html' => '',
        ];
        foreach ($files as $name => $content) {
            if (!is_file("$dir/$name")) {
                @file_put_contents("$dir/$name", $content);
            }
        }
    }
}

final class SqliteMetricsStore extends MetricsStore
{
    private \PDO $db;

    public function __construct(string $file)
    {
        $this->db = new \PDO('sqlite:' . $file, null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC]);
        $this->db->exec('PRAGMA journal_mode = WAL');
        $this->db->exec('CREATE TABLE IF NOT EXISTS samples (server TEXT NOT NULL, ts INTEGER NOT NULL, m TEXT NOT NULL, PRIMARY KEY (server, ts))');
        $this->db->exec('CREATE TABLE IF NOT EXISTS hourly (server TEXT NOT NULL, ts INTEGER NOT NULL, a TEXT NOT NULL, PRIMARY KEY (server, ts))');
        $this->db->exec('CREATE TABLE IF NOT EXISTS peaks (id TEXT PRIMARY KEY, server TEXT NOT NULL, ts INTEGER NOT NULL, peaks TEXT NOT NULL, snapshot TEXT NOT NULL)');
        $this->db->exec('CREATE INDEX IF NOT EXISTS peaks_ts ON peaks (server, ts)');
        $this->db->exec('CREATE TABLE IF NOT EXISTS sizes (server TEXT NOT NULL, ts INTEGER NOT NULL, db TEXT NOT NULL, bytes INTEGER NOT NULL)');
        $this->db->exec('CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    }

    public function kind(): string
    {
        return 'sqlite';
    }

    public function addSample(string $server, int $ts, array $metrics): void
    {
        $this->db->prepare('INSERT OR REPLACE INTO samples VALUES (?, ?, ?)')->execute([$server, $ts, json_encode($metrics)]);
    }

    public function samples(string $server, int $from, int $to): array
    {
        $st = $this->db->prepare('SELECT ts, m FROM samples WHERE server = ? AND ts BETWEEN ? AND ? ORDER BY ts');
        $st->execute([$server, $from, $to]);
        return array_map(static fn ($r) => ['ts' => (int) $r['ts'], 'm' => json_decode($r['m'], true)], $st->fetchAll());
    }

    public function addHourly(string $server, int $hour, array $agg): void
    {
        $this->db->prepare('INSERT OR REPLACE INTO hourly VALUES (?, ?, ?)')->execute([$server, $hour, json_encode($agg)]);
    }

    public function hourly(string $server, int $from, int $to): array
    {
        $st = $this->db->prepare('SELECT ts, a FROM hourly WHERE server = ? AND ts BETWEEN ? AND ? ORDER BY ts');
        $st->execute([$server, $from, $to]);
        return array_map(static fn ($r) => ['ts' => (int) $r['ts'], 'a' => json_decode($r['a'], true)], $st->fetchAll());
    }

    public function addPeak(string $server, int $ts, array $peaks, array $snapshot): string
    {
        $id = $ts . '-' . substr(md5($server), 0, 6);
        $this->db->prepare('INSERT OR REPLACE INTO peaks VALUES (?, ?, ?, ?, ?)')->execute([$id, $server, $ts, json_encode($peaks), json_encode($snapshot)]);
        return $id;
    }

    public function peaks(string $server, int $from, int $to): array
    {
        $st = $this->db->prepare('SELECT id, ts, peaks FROM peaks WHERE server = ? AND ts BETWEEN ? AND ? ORDER BY ts');
        $st->execute([$server, $from, $to]);
        return array_map(static fn ($r) => ['id' => $r['id'], 'ts' => (int) $r['ts'], 'peaks' => json_decode($r['peaks'], true)], $st->fetchAll());
    }

    public function peak(string $server, string $id): ?array
    {
        $st = $this->db->prepare('SELECT id, ts, peaks, snapshot FROM peaks WHERE server = ? AND id = ?');
        $st->execute([$server, $id]);
        $r = $st->fetch();
        return $r ? ['id' => $r['id'], 'ts' => (int) $r['ts'], 'peaks' => json_decode($r['peaks'], true), 'snapshot' => json_decode($r['snapshot'], true)] : null;
    }

    public function addSize(string $server, int $ts, string $db, int $bytes): void
    {
        $this->db->prepare('INSERT INTO sizes VALUES (?, ?, ?, ?)')->execute([$server, $ts, $db, $bytes]);
    }

    public function sizes(string $server, int $from, int $to): array
    {
        $st = $this->db->prepare('SELECT ts, db, bytes FROM sizes WHERE server = ? AND ts BETWEEN ? AND ? ORDER BY ts');
        $st->execute([$server, $from, $to]);
        return array_map(static fn ($r) => ['ts' => (int) $r['ts'], 'db' => $r['db'], 'bytes' => (int) $r['bytes']], $st->fetchAll());
    }

    public function getState(string $key): mixed
    {
        $st = $this->db->prepare('SELECT v FROM state WHERE k = ?');
        $st->execute([$key]);
        $v = $st->fetchColumn();
        return $v === false ? null : json_decode((string) $v, true);
    }

    public function setState(string $key, mixed $value): void
    {
        $this->db->prepare('INSERT OR REPLACE INTO state VALUES (?, ?)')->execute([$key, json_encode($value)]);
    }

    public function prune(int $now): void
    {
        $this->db->prepare('DELETE FROM samples WHERE ts < ?')->execute([$now - self::MINUTE_RETENTION]);
        $this->db->prepare('DELETE FROM hourly WHERE ts < ?')->execute([$now - self::HOUR_RETENTION]);
        $this->db->prepare('DELETE FROM peaks WHERE ts < ?')->execute([$now - self::HOUR_RETENTION]);
        $this->db->prepare('DELETE FROM sizes WHERE ts < ?')->execute([$now - self::HOUR_RETENTION]);
    }
}

/**
 * Fallback without pdo_sqlite: one JSON object per line, files per day
 * (samples, peaks) or per month (hourly, sizes). Old files are deleted.
 */
final class JsonlMetricsStore extends MetricsStore
{
    public function __construct(private string $dir)
    {
    }

    public function kind(): string
    {
        return 'jsonl';
    }

    private function file(string $kind, int $ts): string
    {
        $suffix = in_array($kind, ['hourly', 'sizes'], true) ? gmdate('Ym', $ts) : gmdate('Ymd', $ts);
        return "{$this->dir}/{$kind}-{$suffix}.jsonl";
    }

    private function append(string $kind, int $ts, array $row): void
    {
        file_put_contents($this->file($kind, $ts), json_encode($row) . "\n", FILE_APPEND | LOCK_EX);
    }

    /** Rows of `$kind` for `$server` in [from, to], read file by file. */
    private function read(string $kind, string $server, int $from, int $to): array
    {
        $monthly = in_array($kind, ['hourly', 'sizes'], true);
        $out = [];
        $seen = [];
        $step = $monthly ? 86400 * 28 : 86400;
        for ($t = $from - ($monthly ? 86400 * 31 : 0); $t <= $to + $step; $t += $step) {
            $f = $this->file($kind, $t);
            if (isset($seen[$f]) || !is_file($f)) {
                $seen[$f] = true;
                continue;
            }
            $seen[$f] = true;
            $h = fopen($f, 'r');
            if (!$h) {
                continue;
            }
            while (($line = fgets($h)) !== false) {
                $row = json_decode($line, true);
                if (is_array($row) && ($row['server'] ?? '') === $server && $row['ts'] >= $from && $row['ts'] <= $to) {
                    $out[] = $row;
                }
            }
            fclose($h);
        }
        usort($out, static fn ($a, $b) => $a['ts'] <=> $b['ts']);
        return $out;
    }

    public function addSample(string $server, int $ts, array $metrics): void
    {
        $this->append('samples', $ts, ['server' => $server, 'ts' => $ts, 'm' => $metrics]);
    }

    public function samples(string $server, int $from, int $to): array
    {
        // Later rows for the same minute win (re-runs).
        $byTs = [];
        foreach ($this->read('samples', $server, $from, $to) as $r) {
            $byTs[$r['ts']] = ['ts' => $r['ts'], 'm' => $r['m']];
        }
        return array_values($byTs);
    }

    public function addHourly(string $server, int $hour, array $agg): void
    {
        $this->append('hourly', $hour, ['server' => $server, 'ts' => $hour, 'a' => $agg]);
    }

    public function hourly(string $server, int $from, int $to): array
    {
        $byTs = [];
        foreach ($this->read('hourly', $server, $from, $to) as $r) {
            $byTs[$r['ts']] = ['ts' => $r['ts'], 'a' => $r['a']];
        }
        return array_values($byTs);
    }

    public function addPeak(string $server, int $ts, array $peaks, array $snapshot): string
    {
        $id = $ts . '-' . substr(md5($server), 0, 6);
        $this->append('peaks', $ts, ['server' => $server, 'ts' => $ts, 'id' => $id, 'peaks' => $peaks, 'snapshot' => $snapshot]);
        return $id;
    }

    public function peaks(string $server, int $from, int $to): array
    {
        return array_map(static fn ($r) => ['id' => $r['id'], 'ts' => $r['ts'], 'peaks' => $r['peaks']], $this->read('peaks', $server, $from, $to));
    }

    public function peak(string $server, string $id): ?array
    {
        if (!preg_match('~^(\d{9,11})-[0-9a-f]{6}$~', $id, $m)) {
            return null;
        }
        $ts = (int) $m[1];
        foreach ($this->read('peaks', $server, $ts, $ts) as $r) {
            if ($r['id'] === $id) {
                return ['id' => $r['id'], 'ts' => $r['ts'], 'peaks' => $r['peaks'], 'snapshot' => $r['snapshot']];
            }
        }
        return null;
    }

    public function addSize(string $server, int $ts, string $db, int $bytes): void
    {
        $this->append('sizes', $ts, ['server' => $server, 'ts' => $ts, 'db' => $db, 'bytes' => $bytes]);
    }

    public function sizes(string $server, int $from, int $to): array
    {
        return array_map(static fn ($r) => ['ts' => $r['ts'], 'db' => $r['db'], 'bytes' => $r['bytes']], $this->read('sizes', $server, $from, $to));
    }

    private function stateFile(): string
    {
        return "{$this->dir}/state.json";
    }

    private function loadState(): array
    {
        $raw = is_file($this->stateFile()) ? file_get_contents($this->stateFile()) : '';
        $data = $raw ? json_decode($raw, true) : [];
        return is_array($data) ? $data : [];
    }

    public function getState(string $key): mixed
    {
        return $this->loadState()[$key] ?? null;
    }

    public function setState(string $key, mixed $value): void
    {
        $data = $this->loadState();
        $data[$key] = $value;
        file_put_contents($this->stateFile(), json_encode($data), LOCK_EX);
    }

    public function prune(int $now): void
    {
        foreach (glob($this->dir . '/*.jsonl') ?: [] as $f) {
            if (!preg_match('~/(samples|peaks|hourly|sizes)-(\d{6,8})\.jsonl$~', str_replace('\\', '/', $f), $m)) {
                continue;
            }
            $date = strlen($m[2]) === 8 ? gmmktime(0, 0, 0, (int) substr($m[2], 4, 2), (int) substr($m[2], 6, 2) + 1, (int) substr($m[2], 0, 4))
                : gmmktime(0, 0, 0, (int) substr($m[2], 4, 2) + 1, 1, (int) substr($m[2], 0, 4));
            $keep = $m[1] === 'samples' ? self::MINUTE_RETENTION : self::HOUR_RETENTION;
            if ($date < $now - $keep) {
                @unlink($f);
            }
        }
    }
}
