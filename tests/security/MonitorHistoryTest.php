<?php
declare(strict_types=1);

use PhpMyFlow\Collector;
use PhpMyFlow\MetricsStore;

require_once __DIR__ . '/../php/support.php';

/*
 * Monitor history is collected with a privileged account (config 'monitor' or
 * whoever triggers the pseudo-cron) and stored per server. Reading it shows
 * only what the reader's own account could see live: other users' processes
 * need PROCESS, query digests need performance_schema, database sizes only for
 * databases the reader can see.
 */

return [
    'a user without PROCESS or performance_schema sees only its own share of history' => static function (): void {
        if (!($db = testDb())) {
            echo "       (skipped: no test database)\n";
            return;
        }
        [$host, $port, $user, $pass] = $db;
        $root = new PDO("mysql:host=$host;port=$port", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $root->exec('DROP DATABASE IF EXISTS pmf_t_sec_mine');
        $root->exec('CREATE DATABASE pmf_t_sec_mine');
        $root->exec("DROP USER IF EXISTS 'pmf_t_sec_low'@'%'");
        $root->exec("CREATE USER 'pmf_t_sec_low'@'%' IDENTIFIED BY 'low-pass-1'");
        $root->exec("GRANT SELECT ON pmf_t_sec_mine.* TO 'pmf_t_sec_low'@'%'");

        // History as a privileged collector stored it.
        $dir = sys_get_temp_dir() . '/pmf_sec_hist_' . bin2hex(random_bytes(4));
        $store = MetricsStore::open($dir);
        $server = Collector::serverKey($host, $port);
        $ts = time() - 600;
        $proc = static fn (int $id, string $u) => ['id' => $id, 'user' => $u, 'host' => 'h', 'db' => null, 'command' => 'Query', 'time' => 9, 'state' => '', 'info' => 'SELECT ?', 'self' => false];
        $peakId = $store->addPeak($server, $ts, ['threads_running' => 50], [
            'rates' => [],
            'processes' => [$proc(1, 'pmf_t_sec_admin'), $proc(2, 'pmf_t_sec_low')],
            'digests' => [['digest' => 'abc', 'db' => 'pmf_t_secret', 'text' => 'SELECT * FROM salaries', 'count' => 1, 'total' => 1, 'avg' => 1, 'examined' => 1]],
        ]);
        $store->addSize($server, $ts, 'pmf_t_sec_mine', 100);
        $store->addSize($server, $ts, 'pmf_t_secret', 200);

        $srv = new TestServer([], ['PMF_MONITOR_DATA_DIR' => $dir]);
        // After the server's own shutdown function, so it runs (also on failure) once the server is gone.
        register_shutdown_function(static function () use ($dir): void {
            foreach (array_diff(scandir($dir) ?: [], ['.', '..']) as $f) {
                @unlink("$dir/$f");
            }
            @rmdir($dir);
        });
        $c = new TestClient($srv->url);
        $c->login($host, $port, 'pmf_t_sec_low', 'low-pass-1');

        $peak = $c->json('GET', 'a=monitor_peak&id=' . urlencode($peakId));
        ok(isset($peak['snapshot']), json_encode($peak));
        eq(['pmf_t_sec_low'], array_column($peak['snapshot']['processes'], 'user'), 'only its own processes');
        eq([], $peak['snapshot']['digests'], 'no digests without performance_schema');

        $h = $c->json('GET', 'a=monitor_history&from=' . ($ts - 60) . '&to=' . ($ts + 60));
        ok(isset($h['sizes']), json_encode($h));
        eq(['pmf_t_sec_mine'], array_values(array_unique(array_column($h['sizes'], 'db'))), 'sizes only for databases it can see');
        eq(1, count($h['peaks']), 'the peak itself (server-wide rates) is still listed');

        // The privileged account still sees everything.
        $admin = new TestClient($srv->url);
        $admin->login($host, $port, $user, $pass);
        $all = $admin->json('GET', 'a=monitor_peak&id=' . urlencode($peakId));
        eq(2, count($all['snapshot']['processes']));
        eq(1, count($all['snapshot']['digests']));

        $root->exec("DROP USER 'pmf_t_sec_low'@'%'");
        $root->exec('DROP DATABASE pmf_t_sec_mine');
    },
];
