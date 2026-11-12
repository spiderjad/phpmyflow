<?php
declare(strict_types=1);

use PhpMyFlow\Db;
use PhpMyFlow\Export;
use PhpMyFlow\ExportJob;
use PhpMyFlow\SqlSplitter;

require_once __DIR__ . '/../php/support.php';

/*
 * A SQL dump must contain exactly the statements phpMyFlow wrote, whatever the
 * names, view and routine bodies, and row values in the exported database
 * (they may come from a less privileged user). Every check splits the dump
 * with the importer's splitter and looks for a statement that should not be
 * there.
 */

/** Statements of a dump as the importer sees them (leading comments dropped). */
function dumpStatements(string $sql): array
{
    $fh = fopen('php://memory', 'w+b');
    fwrite($fh, $sql);
    $sp = new SqlSplitter($fh);
    $out = [];
    while (($st = $sp->next()) !== null) {
        $out[] = ltrim((string) preg_replace('~^(?:\s+|--[^\n]*\n)*~', '', $st['sql']));
    }
    fclose($fh);
    return $out;
}

function assertNoInjected(string $dump, string $marker): void
{
    foreach (dumpStatements($dump) as $st) {
        ok(!preg_match('~^(DROP|CREATE)\s+TABLE\s+' . $marker . '~i', $st), "the dump runs an injected statement:\n" . substr($st, 0, 300));
    }
}

/** Runs a whole SQL export of $db in this process and returns the dump. */
function exportDump(PDO $pdo, string $db, array $options): string
{
    $dir = sys_get_temp_dir() . '/pmf_sec_dump_' . bin2hex(random_bytes(4));
    mkdir($dir);
    $start = ExportJob::start($pdo, $dir, ['db' => $db, 'format' => 'sql', 'options' => $options]);
    for ($i = 0; $i < 1000; $i++) {
        $r = ExportJob::load($pdo, $dir, $start['id'])->step(5);
        if ($r['status'] !== 'running') {
            break;
        }
    }
    eq('done', $r['status'], json_encode($r));
    $sql = (string) file_get_contents($dir . '/' . $start['id'] . '.export.out');
    array_map('unlink', glob($dir . '/*'));
    rmdir($dir);
    return $sql;
}

function dumpTestDb(): ?PDO
{
    if (!($db = testDb())) {
        echo "       (skipped: no test database)\n";
        return null;
    }
    [$host, $port, $user, $pass] = $db;
    $pdo = Db::connect($host, $port, $user, $pass);
    $pdo->exec('DROP DATABASE IF EXISTS pmf_t_sec_dump');
    $pdo->exec('CREATE DATABASE pmf_t_sec_dump');
    $pdo->exec('USE pmf_t_sec_dump');
    return $pdo;
}

return [
    'a view body with "DEFINER=" inside a string keeps its strings' => static function (): void {
        $create = "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v` AS select 'a DEFINER=x@y' AS `c1`,'; DROP TABLE pmf_victim; -- ' AS `c2`";
        $sql = Export::viewSql($create);
        eq("CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v` AS select 'a DEFINER=x@y' AS `c1`,'; DROP TABLE pmf_victim; -- ' AS `c2`;", $sql);
        assertNoInjected($sql, 'pmf_victim');
    },

    'DEFINER is removed from the header only, also with quoted users' => static function (): void {
        eq('CREATE SQL SECURITY INVOKER VIEW `v` AS select 1 AS `1`;', Export::viewSql("CREATE DEFINER=`we``ird`@`%` SQL SECURITY INVOKER VIEW `v` AS select 1 AS `1`"));
        eq('CREATE ALGORITHM=MERGE VIEW `v` AS select 1 AS `1`;', Export::viewSql("CREATE ALGORITHM=MERGE DEFINER='a b'@'h' VIEW `v` AS select 1 AS `1`"));
        eq('CREATE VIEW `v` AS select 1 AS `1`;', Export::viewSql('CREATE VIEW `v` AS select 1 AS `1`'));
    },

    'table, view and routine names with a newline stay inside their comment' => static function (): void {
        if (!($pdo = dumpTestDb())) {
            return;
        }
        // A name can't end with a space, so "#" comments out the rest of the line.
        $t = "t\nCREATE TABLE pmf_injected_t (i INT);\n#";
        $v = "v\nCREATE TABLE pmf_injected_v (i INT);\n#";
        $p = "p\nCREATE TABLE pmf_injected_p (i INT);;\n#";
        $pdo->exec('CREATE TABLE ' . Db::ident($t) . ' (id INT PRIMARY KEY)');
        $pdo->exec('CREATE VIEW ' . Db::ident($v) . ' AS SELECT 1 AS one');
        $pdo->exec('CREATE PROCEDURE ' . Db::ident($p) . '() SELECT 1');
        $dump = exportDump($pdo, 'pmf_t_sec_dump', ['routines' => true]);
        assertNoInjected($dump, 'pmf_injected');
    },

    'routine and trigger bodies with "DEFINER=" inside a string keep their strings' => static function (): void {
        if (!($pdo = dumpTestDb())) {
            return;
        }
        $pdo->exec('CREATE TABLE t (id INT PRIMARY KEY)');
        $pdo->exec("CREATE PROCEDURE p() BEGIN SELECT 'a DEFINER=x@y'; SELECT ';; DROP TABLE pmf_victim_p;; -- '; END");
        $pdo->exec("CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW BEGIN SET @a = 'a DEFINER=x@y'; SET @b = ';; DROP TABLE pmf_victim_t;; -- '; END");
        $dump = exportDump($pdo, 'pmf_t_sec_dump', ['routines' => true, 'triggers' => true]);
        assertNoInjected($dump, 'pmf_victim');
        ok(str_contains($dump, "SELECT 'a DEFINER=x@y'"), 'the procedure body is unchanged');
    },

    'row values are escaped for the dump header, whatever the session sql_mode' => static function (): void {
        if (!($pdo = dumpTestDb())) {
            return;
        }
        $value = "a\'; DROP TABLE pmf_victim_v; -- ";
        $pdo->exec('CREATE TABLE t (id INT PRIMARY KEY, s VARCHAR(100))');
        $pdo->prepare('INSERT INTO t VALUES (1, ?)')->execute([$value]);
        $pdo->exec("SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'");
        $dump = exportDump($pdo, 'pmf_t_sec_dump', []);
        assertNoInjected($dump, 'pmf_victim');
        // And the value survives a round trip with the dump's own settings.
        $pdo->exec("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'");
        $pdo->exec('DROP TABLE t');
        foreach (dumpStatements($dump) as $st) {
            if ($st !== '' && !preg_match('~^SET\s+(time_zone|NAMES|FOREIGN_KEY_CHECKS)~i', $st)) {
                $pdo->exec($st);
            }
        }
        eq($value, $pdo->query('SELECT s FROM t')->fetchColumn());
        $pdo->exec('DROP DATABASE pmf_t_sec_dump');
    },
];
