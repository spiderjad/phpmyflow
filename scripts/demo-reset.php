<?php
declare(strict_types=1);

/*
 * Resets the public demo database to the sample data (docker/demo.sql):
 * drops every table and view in it, then loads the file again. Run it from
 * cron (daily) so whatever happens in the demo never lasts. CLI only.
 *
 *   php demo-reset.php [path/to/demo-reset.config.php]
 *
 * The config file (keep it OUTSIDE the web root, it holds the password):
 *
 *   <?php return [
 *       'host' => 'localhost', 'port' => 3306,
 *       'user' => 'u123456789_demo', 'password' => '…',
 *       'database' => 'u123456789_demo',
 *       'sql' => __DIR__ . '/demo.sql',
 *   ];
 *
 * Setup and cron line: docs/demo-setup.md.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

/**
 * Statements of demo.sql: it is plain DDL + INSERTs (no DELIMITER, no ';'
 * inside values), so splitting at ';' at the end of a line is enough.
 * tests/php/DemoTest.php checks that it stays that way.
 *
 * @return list<string>
 */
function demoStatements(string $sql): array
{
    $sql = preg_replace('~^\s*--.*$~m', '', $sql) ?? '';
    $out = [];
    foreach (preg_split('~;\s*$~m', $sql) ?: [] as $s) {
        $s = trim($s);
        if ($s !== '') {
            $out[] = $s;
        }
    }
    return $out;
}

if (getenv('PMF_DEMO_RESET_NO_RUN') === '1') {
    return; // loaded by the tests for demoStatements()
}

$configFile = $argv[1] ?? __DIR__ . '/demo-reset.config.php';
if (!is_file($configFile)) {
    fwrite(STDERR, "Config not found: $configFile\n");
    exit(2);
}
$c = require $configFile;
foreach (['host', 'user', 'password', 'database', 'sql'] as $k) {
    if (!isset($c[$k])) {
        fwrite(STDERR, "Config is missing '$k'\n");
        exit(2);
    }
}
if (!is_file($c['sql'])) {
    fwrite(STDERR, "SQL file not found: {$c['sql']}\n");
    exit(2);
}

$start = microtime(true);
try {
    $pdo = new PDO(
        sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], (int) ($c['port'] ?? 3306), $c['database']),
        $c['user'],
        $c['password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::MYSQL_ATTR_MULTI_STATEMENTS => false],
    );
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
    $q = $pdo->prepare('SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?');
    $q->execute([$c['database']]);
    $dropped = 0;
    foreach ($q->fetchAll(PDO::FETCH_NUM) as [$name, $type]) {
        $ident = '`' . str_replace('`', '``', (string) $name) . '`';
        $pdo->exec(($type === 'VIEW' ? 'DROP VIEW IF EXISTS ' : 'DROP TABLE IF EXISTS ') . $ident);
        $dropped++;
    }
    $statements = demoStatements((string) file_get_contents($c['sql']));
    foreach ($statements as $s) {
        $pdo->exec($s);
    }
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
} catch (PDOException $e) {
    fwrite(STDERR, date('c') . ' demo reset failed: ' . $e->getMessage() . "\n");
    exit(1);
}
printf("%s demo reset: %d objects dropped, %d statements run in %.1f s\n", date('c'), $dropped, count($statements), microtime(true) - $start);
