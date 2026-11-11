<?php
declare(strict_types=1);

use PhpMyFlow\SqlSplitter;

/** All statements of a SQL text, read through a stream with a tiny buffer. */
function splitAll(string $sql, int $chunk = 7): array
{
    $fh = fopen('php://memory', 'w+b');
    fwrite($fh, $sql);
    rewind($fh);
    $s = new SqlSplitter($fh, 0, ';', 1, $chunk);
    $out = [];
    while (($st = $s->next()) !== null) {
        $out[] = $st;
    }
    return $out;
}

$sqls = static fn (array $list) => array_map(static fn ($x) => $x['sql'], $list);

return [
    'simple statements, whitespace and a trailing one without delimiter' => static function () use ($sqls): void {
        eq(['SELECT 1', 'SELECT 2', 'SELECT 3'], $sqls(splitAll("SELECT 1;\n\n  SELECT 2 ;SELECT 3\n")));
    },
    'semicolons inside strings, identifiers and escapes' => static function () use ($sqls): void {
        $sql = "INSERT INTO t VALUES ('a;b', \"c;d\", 'it''s; ok', 'back\\'slash;');\nSELECT `we;ird` FROM t;";
        eq(["INSERT INTO t VALUES ('a;b', \"c;d\", 'it''s; ok', 'back\\'slash;')", 'SELECT `we;ird` FROM t'], $sqls(splitAll($sql)));
    },
    'comments: --, #, /* */ are skipped between statements and kept inside them' => static function () use ($sqls): void {
        $sql = "-- header; not a statement\n# also; not\n/* block; comment */\nSELECT 1 /* inline; */ + 1; -- tail;\nSELECT 2;\n--\n/* end */\n";
        eq(['SELECT 1 /* inline; */ + 1', 'SELECT 2'], $sqls(splitAll($sql)));
    },
    'executable comments are statements (mysqldump headers)' => static function () use ($sqls): void {
        eq(['/*!40101 SET NAMES utf8mb4 */', '/*!40014 SET FOREIGN_KEY_CHECKS=0 */'], $sqls(splitAll("/*!40101 SET NAMES utf8mb4 */;\n/*!40014 SET FOREIGN_KEY_CHECKS=0 */;\n")));
    },
    '"--" without a space is not a comment (a minus a minus)' => static function () use ($sqls): void {
        eq(['SELECT 5--2', 'SELECT 1'], $sqls(splitAll("SELECT 5--2;\nSELECT 1;")));
    },
    'DELIMITER changes the end of statement and is not executed' => static function () use ($sqls): void {
        $sql = "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 'x;y'; END$$\nDELIMITER ;\nCALL p();\ndelimiter //\nCREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW BEGIN SET NEW.a = 1; END //\n";
        eq([
            "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 'x;y'; END",
            'CALL p()',
            'CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW BEGIN SET NEW.a = 1; END',
        ], $sqls(splitAll($sql)));
    },
    'start lines are reported (for error messages)' => static function (): void {
        $list = splitAll("SELECT 1;\n\n/* two\nlines */\nSELECT\n 2;\nSELECT 'a\nb';SELECT 4;");
        eq([1, 5, 7, 8], array_map(static fn ($x) => $x['line'], $list));
    },
    'a huge statement across many buffer refills' => static function (): void {
        $values = implode(',', array_fill(0, 20000, "(1,'abc;def')"));
        $list = splitAll("INSERT INTO t VALUES $values;SELECT 1;", 4096);
        eq(2, count($list));
        eq(strlen("INSERT INTO t VALUES $values"), strlen($list[0]['sql']));
    },
    'resume from the offset and delimiter of a previous run' => static function () use ($sqls): void {
        $sql = "SELECT 1;\nDELIMITER $$\nSELECT 2$$\nSELECT 3$$\nDELIMITER ;\nSELECT 4;";
        $fh = fopen('php://memory', 'w+b');
        fwrite($fh, $sql);
        rewind($fh);
        $a = new SqlSplitter($fh, 0, ';', 1, 5);
        $a->next();
        $a->next(); // SELECT 2, delimiter is now $$
        $b = new SqlSplitter($fh, $a->offset(), $a->delimiter(), $a->line(), 5);
        $rest = [];
        while (($st = $b->next()) !== null) {
            $rest[] = $st;
        }
        eq(['SELECT 3', 'SELECT 4'], $sqls($rest));
        eq(4, $rest[0]['line']);
    },
    'CRLF files' => static function () use ($sqls): void {
        eq(['SELECT 1', "SELECT\r\n2"], $sqls(splitAll("-- x\r\nSELECT 1;\r\nSELECT\r\n2;\r\n")));
    },
];
