<?php
declare(strict_types=1);

use PhpMyFlow\ApiError;
use PhpMyFlow\DataGen;
use PhpMyFlow\Tools;

$cols = static fn () => [
    ['name' => 'id', 'dataType' => 'int', 'columnType' => 'int(10) unsigned', 'nullable' => false, 'auto' => true],
    ['name' => 'email', 'dataType' => 'varchar', 'columnType' => 'varchar(60)', 'length' => 60, 'nullable' => false, 'unique' => true],
    ['name' => 'name', 'dataType' => 'varchar', 'columnType' => 'varchar(20)', 'length' => 20, 'nullable' => false],
    ['name' => 'age', 'dataType' => 'tinyint', 'columnType' => 'tinyint(3) unsigned', 'nullable' => true, 'unsigned' => true],
    ['name' => 'status', 'dataType' => 'enum', 'columnType' => "enum('new','paid','shipped')", 'nullable' => false, 'values' => ['new', 'paid', 'shipped']],
    ['name' => 'customer_id', 'dataType' => 'int', 'columnType' => 'int(10) unsigned', 'nullable' => false, 'fk' => ['table' => 'customers', 'column' => 'id']],
    ['name' => 'code', 'dataType' => 'varchar', 'columnType' => 'varchar(12)', 'length' => 12, 'nullable' => false, 'unique' => true],
    ['name' => 'total', 'dataType' => 'decimal', 'columnType' => 'decimal(8,2)', 'nullable' => false, 'precision' => 8, 'scale' => 2],
    ['name' => 'created_at', 'dataType' => 'datetime', 'columnType' => 'datetime', 'nullable' => false],
    ['name' => 'ordered_on', 'dataType' => 'date', 'columnType' => 'date', 'nullable' => true, 'options' => ['from' => '2026-01-01', 'to' => '2026-01-31']],
];

return [
    'LIKE patterns escape % _ and \\ (search is literal)' => static function (): void {
        eq(['LIKE', '%50\\% off\\_now\\\\%'], Tools::matchFor('contains', '50% off_now\\'));
        eq(['LIKE', 'abc%'], Tools::matchFor('starts', 'abc'));
        eq(['=', 'Rossi'], Tools::matchFor('exact', 'Rossi'));
        eq(['REGEXP', '(?i)^ros+i$'], Tools::matchFor('regex', '^ros+i$'));
        eq(['REGEXP', '(?-i)^Ros'], Tools::matchFor('regex', '^Ros', true));
    },
    'search condition: case-sensitive compares bytes; numbers only with "all columns"' => static function (): void {
        eq('`name` LIKE ? ESCAPE \'\\\\\'', Tools::condition('`name`', 'LIKE', false, false));
        eq('CAST(`name` AS BINARY) LIKE CAST(? AS BINARY) ESCAPE \'\\\\\'', Tools::condition('`name`', 'LIKE', true, false));
        eq('CAST(`price` AS CHAR) = ?', Tools::condition('`price`', '=', false, true));
        try {
            Tools::matchFor('regex', str_repeat('a', 600));
            throw new RuntimeException('expected ApiError');
        } catch (ApiError $e) {
            eq('bad_search', $e->errorCode);
        }
    },
    'bulk editor: one ALTER per table (engine, convert or default charset, comment) and a RENAME to move it' => static function (): void {
        $q = static fn ($s) => "'" . str_replace("'", "''", $s) . "'";
        eq(["ALTER TABLE `shop`.`orders` ENGINE=InnoDB, CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci, COMMENT='It''s'", 'RENAME TABLE `shop`.`orders` TO `archive`.`orders`'],
            Tools::bulkStatements('shop', 'orders', ['engine' => 'InnoDB', 'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci', 'convert' => true, 'comment' => "It's", 'moveTo' => 'archive'], $q));
        eq(['ALTER TABLE `shop`.`orders` DEFAULT CHARACTER SET latin1 COLLATE latin1_swedish_ci'], Tools::bulkStatements('shop', 'orders', ['charset' => 'latin1', 'collation' => 'latin1_swedish_ci', 'convert' => false], $q));
        eq([], Tools::bulkStatements('shop', 'orders', ['moveTo' => 'shop', 'comment' => null], $q));
    },
    'generated data: types, lengths, NOT NULL, enum values, FK from the pool' => static function () use ($cols): void {
        $g = new DataGen(42, 'tk');
        $spec = DataGen::plan($cols());
        $rows = $g->rows($spec, 300, 0, ['customers.id' => [3, 7, 11]]);
        eq(300, count($rows));
        $names = array_column($spec, 'name');
        eq(false, in_array('id', $names, true)); // AUTO_INCREMENT is left to the server
        foreach ($rows as $r) {
            $row = array_combine($names, $r);
            ok(filter_var($row['email'], FILTER_VALIDATE_EMAIL) !== false && strlen($row['email']) <= 60, 'email: ' . $row['email']);
            ok($row['name'] !== null && strlen($row['name']) <= 20, 'name length: ' . $row['name']);
            ok($row['age'] === null || ($row['age'] >= 0 && $row['age'] <= 255), 'tinyint unsigned: ' . $row['age']);
            ok(in_array($row['status'], ['new', 'paid', 'shipped'], true), 'enum: ' . $row['status']);
            ok(in_array($row['customer_id'], [3, 7, 11], true), 'fk: ' . $row['customer_id']);
            ok(strlen($row['code']) <= 12, 'code length: ' . $row['code']);
            ok(preg_match('~^\d{1,6}\.\d{2}$~', (string) $row['total']) === 1, 'decimal(8,2): ' . $row['total']);
            ok(preg_match('~^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$~', $row['created_at']) === 1, 'datetime');
            ok($row['ordered_on'] === null || ($row['ordered_on'] >= '2026-01-01' && $row['ordered_on'] <= '2026-01-31'), 'date range: ' . $row['ordered_on']);
        }
        $email = array_column(array_map(static fn ($r) => array_combine($names, $r), $rows), 'email');
        $code = array_column(array_map(static fn ($r) => array_combine($names, $r), $rows), 'code');
        eq(count($email), count(array_unique(array_map('strtolower', $email))), 'unique emails');
        eq(count($code), count(array_unique($code)), 'unique codes');
    },
    'batches continue the sequence: no duplicates across requests, same seed = same preview' => static function () use ($cols): void {
        $spec = DataGen::plan($cols());
        $a = (new DataGen(7, 'tk'))->rows($spec, 200, 0, ['customers.id' => [1]]);
        $b = (new DataGen(7, 'tk'))->rows($spec, 200, 200, ['customers.id' => [1]]);
        $i = array_search('email', array_column($spec, 'name'), true);
        eq(400, count(array_unique(array_merge(array_column($a, $i), array_column($b, $i)))));
        eq((new DataGen(9, 'x'))->rows($spec, 5, 0, ['customers.id' => [1]]), (new DataGen(9, 'x'))->rows($spec, 5, 0, ['customers.id' => [1]]));
    },
    'a required FK with an empty target table is an error, an optional one is NULL' => static function () use ($cols): void {
        $spec = DataGen::plan($cols());
        try {
            (new DataGen(1, 't'))->rows($spec, 1, 0, ['customers.id' => []]);
            throw new RuntimeException('expected ApiError');
        } catch (ApiError $e) {
            eq('gen_empty_fk', $e->errorCode);
        }
        $opt = DataGen::plan([['name' => 'parent_id', 'dataType' => 'int', 'columnType' => 'int', 'nullable' => true, 'fk' => ['table' => 'p', 'column' => 'id']]]);
        eq([[null]], (new DataGen(1, 't'))->rows($opt, 1, 0, ['p.id' => []]));
    },
    'simple CHECK constraints become ranges' => static function (): void {
        eq(['rating' => ['min' => 1, 'max' => 5]], Tools::checkRanges('`rating` between 1 and 5'));
        eq(['price' => ['min' => 0], 'qty' => ['min' => 1, 'max' => 100]], Tools::checkRanges('`price` >= 0 and `qty` > 0 and `qty` <= 100'));
        eq([], Tools::checkRanges("status in ('a','b')"));
    },
    'name heuristics pick a strategy' => static function (): void {
        $s = static fn (string $n, string $t = 'varchar') => DataGen::plan([['name' => $n, 'dataType' => $t, 'columnType' => $t, 'nullable' => false]])[0]['strategy'];
        eq('email', $s('contact_email'));
        eq('phone', $s('telefono'));
        eq('first_name', $s('first_name'));
        eq('last_name', $s('apellido'));
        eq('city', $s('ciudad'));
        eq('sentence', $s('description', 'text'));
        eq('amount', $s('price', 'decimal'));
        eq('int', $s('quantity', 'int'));
        eq('bool', $s('is_active', 'tinyint'));
        eq('uuid', $s('uuid', 'char'));
    },
];
