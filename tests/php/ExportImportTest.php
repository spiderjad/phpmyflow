<?php
declare(strict_types=1);

use PhpMyFlow\Db;
use PhpMyFlow\Export;
use PhpMyFlow\ExportJob;
use PhpMyFlow\SqlSplitter;

/*
 * Integration: export a database with the export job (short steps, like the
 * browser drives it), import the result into another
 * database with the streaming splitter, and compare every table.
 *
 * Needs a MySQL/MariaDB server: PMF_TEST_DB=host:port:user:password
 * (default 127.0.0.1:3307:root:root, the docker sample). Skipped without one.
 */

function testPdo(): ?PDO
{
    [$host, $port, $user, $pass] = explode(':', getenv('PMF_TEST_DB') ?: '127.0.0.1:3307:root:root') + [null, 3306, 'root', ''];
    try {
        return Db::connect($host, (int) $port, $user, $pass);
    } catch (PDOException) {
        return null;
    }
}

return [
    'SQL export job imports back identically (composite PK, no PK, blobs, bit, generated, unicode, NULL, FK, view)' => static function (): void {
        $pdo = testPdo();
        if (!$pdo) {
            echo "       (skipped: no test database)\n";
            return;
        }
        foreach (['pmf_t_src', 'pmf_t_dst'] as $d) {
            $pdo->exec("DROP DATABASE IF EXISTS `$d`");
            $pdo->exec("CREATE DATABASE `$d` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        }
        $pdo->exec('USE pmf_t_src');
        $pdo->exec('CREATE TABLE parent (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) NOT NULL, flags BIT(3) NULL, data BLOB NULL,
                    upper_name VARCHAR(50) AS (UPPER(name)) VIRTUAL, created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
        $pdo->exec('CREATE TABLE child (parent_id INT UNSIGNED NOT NULL, seq INT NOT NULL, note TEXT NULL, PRIMARY KEY (parent_id, seq),
                    CONSTRAINT fk_child_parent FOREIGN KEY (parent_id) REFERENCES parent (id)) ENGINE=InnoDB');
        $pdo->exec('CREATE TABLE nopk (a INT NULL, b VARCHAR(10) NULL) ENGINE=InnoDB');
        $ins = $pdo->prepare('INSERT INTO parent (name, flags, data) VALUES (?, ?, ?)');
        for ($i = 1; $i <= 7; $i++) {
            $ins->bindValue(1, ["Ana ñ 'q'", 'semi;colon', "new\nline", 'back\\slash', '日本', 'emoji 🎉', '-- not a comment'][$i - 1]);
            $ins->bindValue(2, $i % 2 ? null : $i % 8, $i % 2 ? PDO::PARAM_NULL : PDO::PARAM_INT);
            $ins->bindValue(3, $i === 3 ? random_bytes(64) . "\x00;'" : null, $i === 3 ? PDO::PARAM_LOB : PDO::PARAM_NULL);
            $ins->execute();
        }
        $pdo->exec("INSERT INTO child VALUES (1,1,'a'),(1,2,NULL),(2,1,'b;c'),(3,1,''),(3,2,'x')");
        $pdo->exec("INSERT INTO nopk VALUES (1,'x'),(NULL,NULL),(2,'')");
        $pdo->exec("CREATE PROCEDURE p_kids(IN p INT) READS SQL DATA BEGIN SELECT COUNT(*) FROM child WHERE parent_id = p; SELECT 'a;b'; END");
        $pdo->exec('CREATE TRIGGER trg_parent_name BEFORE INSERT ON parent FOR EACH ROW SET NEW.name = TRIM(NEW.name)');
        $pdo->exec("CREATE EVENT ev_noop ON SCHEDULE EVERY 1 DAY DISABLE DO DELETE FROM nopk WHERE a = -1");
        $pdo->exec('CREATE VIEW v_parent AS SELECT p.id, p.name, COUNT(c.seq) AS kids FROM parent p LEFT JOIN child c ON c.parent_id = p.id GROUP BY p.id, p.name');

        // The export job, one unit per step (tiny budget): every step resumes from saved state.
        $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'pmf-test-jobs-' . bin2hex(random_bytes(4));
        mkdir($dir);
        $pdo->exec('USE pmf_t_src');
        $st = ExportJob::start($pdo, $dir, ['db' => 'pmf_t_src', 'format' => 'sql', 'options' => ['dropTable' => true, 'noFkChecks' => true, 'routines' => true, 'triggers' => true, 'events' => true, 'insertRows' => 2]]);
        $steps = 0;
        do {
            $st = ExportJob::load($pdo, $dir, $st['id'])->step(0.0001);
            $steps++;
        } while ($st['status'] === 'running' && $steps < 500);
        eq('done', $st['status'], json_encode($st['error']));
        ok($steps > 8, "several steps: $steps");
        $sql = (string) file_get_contents($dir . DIRECTORY_SEPARATOR . $st['id'] . '.export.out');
        ExportJob::cancel($dir, $st['id']);
        rmdir($dir);
        ok(str_contains($sql, 'DELIMITER ;;') && !str_contains($sql, 'DEFINER='), 'routines block without DEFINER');

        $pdo->exec('USE pmf_t_dst');
        $fh = fopen('php://memory', 'w+b');
        fwrite($fh, $sql);
        rewind($fh);
        $split = new SqlSplitter($fh, 0, ';', 1, 4096);
        $n = 0;
        while (($st = $split->next()) !== null) {
            $pdo->exec($st['sql']);
            $n++;
        }
        ok($n > 10, "statements executed: $n");
        foreach (['parent', 'child', 'nopk', 'v_parent'] as $t) {
            $a = $pdo->query("SELECT * FROM pmf_t_src.`$t` ORDER BY 1, 2")->fetchAll(PDO::FETCH_NUM);
            $b = $pdo->query("SELECT * FROM pmf_t_dst.`$t` ORDER BY 1, 2")->fetchAll(PDO::FETCH_NUM);
            eq(array_map('bin2hex', array_map('serialize', $a)), array_map('bin2hex', array_map('serialize', $b)), "table $t");
        }
        foreach (['ROUTINES' => 'ROUTINE_SCHEMA', 'TRIGGERS' => 'TRIGGER_SCHEMA', 'EVENTS' => 'EVENT_SCHEMA'] as $t => $col) {
            eq(1, (int) $pdo->query("SELECT COUNT(*) FROM information_schema.$t WHERE $col = 'pmf_t_dst'")->fetchColumn(), "$t restored");
        }
        $fk = $pdo->query("SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pmf_t_dst'")->fetchColumn();
        eq(1, (int) $fk, 'foreign key restored');
        foreach (['pmf_t_src', 'pmf_t_dst'] as $d) {
            $pdo->exec("DROP DATABASE `$d`");
        }
    },
    'view DDL loses DEFINER and the source database qualifier' => static function (): void {
        $create = 'CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v` AS select `shop`.`orders`.`id` AS `id` from `shop`.`orders`';
        eq('CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v` AS select `orders`.`id` AS `id` from `orders`;', Export::viewSql($create, 'shop'));
    },
];
