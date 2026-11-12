<?php
declare(strict_types=1);

require_once __DIR__ . '/support.php';

/*
 * Public demo: docker/demo.sql stays in sync with docker/sample.sql,
 * scripts/demo-reset.php reloads it, and a read-only installation refuses
 * every write (also at the MySQL session), KILL and statistics resets,
 * stops long statements and only then offers the demo credentials.
 * DB parts need PMF_TEST_DB (default docker sample on 3307).
 */

const DEMO_SKIP = ['CREATE DATABASE', 'USE ', 'CREATE USER', 'GRANT '];

/** sample.sql without what a hosting account can't run (and its comments). */
function demoExpected(): string
{
    $out = [];
    foreach (explode("\n", str_replace("\r", '', (string) file_get_contents(__DIR__ . '/../../docker/sample.sql'))) as $line) {
        foreach (DEMO_SKIP as $p) {
            if (str_starts_with($line, $p)) {
                continue 2;
            }
        }
        $out[] = $line;
    }
    return implode("\n", $out);
}

function loadDemoReset(): void
{
    if (!function_exists('demoStatements')) {
        putenv('PMF_DEMO_RESET_NO_RUN=1'); // the script defines demoStatements() and returns
        require_once __DIR__ . '/../../scripts/demo-reset.php';
        putenv('PMF_DEMO_RESET_NO_RUN');
    }
}

function demoReadOnlyServer(): array
{
    static $srv = null;
    $srv ??= new TestServer([], ['PMF_READ_ONLY' => '1', 'PMF_QUERY_TIMEOUT' => '1', 'PMF_DEMO_USER' => 'demo', 'PMF_DEMO_PASSWORD' => 'demo']);
    return [$srv, new TestClient($srv->url)];
}

return [
    'docker/demo.sql = sample.sql without CREATE DATABASE, USE, CREATE USER and GRANT' => static function (): void {
        $demo = str_replace("\r", '', (string) file_get_contents(__DIR__ . '/../../docker/demo.sql'));
        foreach (explode("\n", $demo) as $line) {
            foreach (DEMO_SKIP as $p) {
                ok(!str_starts_with($line, $p), "demo.sql must not contain: $line");
            }
        }
        $strip = static fn (string $s): string => trim((string) preg_replace('~^--.*\n~m', '', $s));
        eq($strip(demoExpected()), $strip($demo), 'demo.sql is out of sync with sample.sql: regenerate it');
    },

    'demo-reset splits demo.sql into whole statements' => static function (): void {
        loadDemoReset();
        $st = demoStatements((string) file_get_contents(__DIR__ . '/../../docker/demo.sql'));
        ok(count($st) >= 20, 'statements: ' . count($st)); // 21 today: SET + 10 CREATE TABLE + 10 INSERT
        foreach ($st as $s) {
            ok((bool) preg_match('~^(SET|CREATE TABLE|INSERT INTO)\b~', $s), 'unexpected statement: ' . substr($s, 0, 60));
        }
    },

    'demo-reset loads the demo, and a second run resets what changed' => static function (): void {
        if (!($db = testDb())) {
            echo "       (skipped: no test database)\n";
            return;
        }
        [$host, $port, $user, $pass] = $db;
        $pdo = new PDO("mysql:host=$host;port=$port", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec('DROP DATABASE IF EXISTS pmf_t_demo');
        $pdo->exec('CREATE DATABASE pmf_t_demo');
        $cfg = tempnam(sys_get_temp_dir(), 'pmf-demo') . '.php';
        file_put_contents($cfg, '<?php return ' . var_export([
            'host' => $host, 'port' => $port, 'user' => $user, 'password' => $pass,
            'database' => 'pmf_t_demo', 'sql' => realpath(__DIR__ . '/../../docker/demo.sql'),
        ], true) . ';');
        $run = static function () use ($cfg): array {
            exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(realpath(__DIR__ . '/../../scripts/demo-reset.php')) . ' ' . escapeshellarg($cfg) . ' 2>&1', $out, $code);
            return [$code, implode("\n", $out)];
        };
        [$code, $out] = $run();
        eq(0, $code, $out);
        eq(5, (int) $pdo->query('SELECT COUNT(*) FROM pmf_t_demo.customers')->fetchColumn());
        $pdo->exec("UPDATE pmf_t_demo.customers SET name = 'vandal'");
        $pdo->exec('CREATE TABLE pmf_t_demo.extra (id INT)');
        [$code, $out] = $run();
        eq(0, $code, $out);
        eq(0, (int) $pdo->query("SELECT COUNT(*) FROM pmf_t_demo.customers WHERE name = 'vandal'")->fetchColumn());
        eq(0, (int) $pdo->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pmf_t_demo' AND TABLE_NAME = 'extra'")->fetchColumn());
        $pdo->exec('DROP DATABASE pmf_t_demo');
        unlink($cfg);
    },

    'demo credentials are only offered by a read-only installation' => static function (): void {
        [, $c] = demoReadOnlyServer();
        $s = $c->json('GET', 'a=session');
        eq(true, $s['readOnly']);
        eq(['user' => 'demo', 'password' => 'demo'], $s['demoLogin']);
        $rw = new TestServer([], ['PMF_DEMO_USER' => 'demo', 'PMF_DEMO_PASSWORD' => 'demo']);
        eq(null, (new TestClient($rw->url))->json('GET', 'a=session')['demoLogin']);
        $rw->stop();
    },

    'read-only: the MySQL session is read-only, KILL and digest reset are refused, long statements stop' => static function (): void {
        if (!($db = testDb())) {
            echo "       (skipped: no test database)\n";
            return;
        }
        [$host, $port, $user, $pass] = $db;
        [, $c] = demoReadOnlyServer();
        $c->login($host, $port, $user, $pass);
        // The session itself: even a write the app let through would fail in MySQL.
        $r = $c->json('POST', 'a=query', ['sql' => 'SELECT @@session.transaction_read_only AS ro']);
        if (isset($r['error'])) {
            $r = $c->json('POST', 'a=query', ['sql' => 'SELECT @@session.tx_read_only AS ro']);
        }
        eq('1', (string) ($r['rows'][0][0] ?? ''), json_encode($r));
        // Writes through the app are refused before reaching MySQL.
        eq('read_only', $c->json('POST', 'a=query', ['sql' => 'CREATE DATABASE pmf_t_never', 'confirm' => true])['error']['code'] ?? null);
        eq('read_only', $c->json('POST', 'a=monitor_kill', ['id' => 999999, 'queryOnly' => true])['error']['code'] ?? null);
        eq('read_only', $c->json('POST', 'a=monitor_reset_digests', [])['error']['code'] ?? null);
        // query_timeout_seconds = 1: SLEEP(5) stops after ~1 s (an error on MariaDB, 1 on MySQL).
        $t = microtime(true);
        $c->json('POST', 'a=query', ['sql' => 'SELECT SLEEP(5)']);
        ok(microtime(true) - $t < 4, sprintf('SLEEP(5) took %.1f s', microtime(true) - $t));
    },
];
