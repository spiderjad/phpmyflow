<?php
declare(strict_types=1);

use PhpMyFlow\Db;

require_once __DIR__ . '/../php/support.php';

/*
 * "check" (the editor's live validation), the assistant's EXPLAIN and the
 * Monitor's EXPLAIN of a query sample never run the statement: SQL with an
 * executable comment (it can turn EXPLAIN into EXPLAIN ANALYZE) is not
 * explained, and EXPLAIN runs in a transaction that is always rolled back.
 * pmf_t_sec_explain.f() writes a row each time it runs.
 */

function explainDb(): ?array
{
    if (!($db = testDb())) {
        echo "       (skipped: no test database)\n";
        return null;
    }
    [$host, $port, $user, $pass] = $db;
    $pdo = Db::connect($host, $port, $user, $pass);
    $pdo->exec('DROP DATABASE IF EXISTS pmf_t_sec_explain');
    $pdo->exec('CREATE DATABASE pmf_t_sec_explain');
    $pdo->exec('USE pmf_t_sec_explain');
    $pdo->exec('CREATE TABLE log (id INT AUTO_INCREMENT PRIMARY KEY)');
    $pdo->exec('CREATE FUNCTION f() RETURNS INT DETERMINISTIC MODIFIES SQL DATA BEGIN INSERT INTO log VALUES (NULL); RETURN 1; END');
    return [$pdo, $db];
}

function explainRuns(PDO $pdo): int
{
    return (int) $pdo->query('SELECT COUNT(*) FROM pmf_t_sec_explain.log')->fetchColumn();
}

return [
    '"check" does not explain SQL with executable comments, and runs nothing' => static function (): void {
        if (!($e = explainDb())) {
            return;
        }
        [$pdo, [$host, $port, $user, $pass]] = $e;
        $srv = new TestServer();
        $c = new TestClient($srv->url);
        $c->login($host, $port, $user, $pass);
        foreach (['/*!80018 ANALYZE */ SELECT f()', '/*M!100000 ANALYZE */ SELECT f()', "SELECT 1 /*! , f() */"] as $sql) {
            $r = $c->json('POST', 'a=check', ['db' => 'pmf_t_sec_explain', 'sql' => $sql]);
            eq(['ok' => true, 'skipped' => true], $r, $sql);
        }
        eq(['ok' => true], $c->json('POST', 'a=check', ['db' => 'pmf_t_sec_explain', 'sql' => 'SELECT f()']), 'plain SQL is still checked');
        eq(0, explainRuns($pdo), 'the function never ran');
    },

    'Db::explain refuses executable comments; EXPLAIN of writes still works' => static function (): void {
        if (!($e = explainDb())) {
            return;
        }
        [$pdo] = $e;
        eq(null, Db::explain($pdo, '/*!80018 ANALYZE */ SELECT f()', static fn ($st) => $st->fetchAll()));
        $rows = Db::explain($pdo, 'SELECT f()', static fn ($st) => $st->fetchAll());
        ok(is_array($rows) && $rows !== [], 'plain EXPLAIN returns its rows');
        foreach (['UPDATE log SET id = id', 'INSERT INTO log VALUES (NULL)', 'DELETE FROM log'] as $w) {
            ok(Db::explain($pdo, $w, static fn ($st) => $st->fetchAll()) !== null, "EXPLAIN $w");
        }
        eq(0, explainRuns($pdo));
        // The transaction is closed afterwards: the next write is not refused.
        $pdo->exec('INSERT INTO pmf_t_sec_explain.log VALUES (NULL)');
        eq(1, explainRuns($pdo));
        $pdo->exec('DROP DATABASE pmf_t_sec_explain');
    },
];
