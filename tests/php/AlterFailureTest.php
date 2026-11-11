<?php
declare(strict_types=1);

use PhpMyFlow\TableEditor;

$changes = [
    'columns' => [
        ['op' => 'modify', 'name' => 'price', 'def' => ['name' => 'price', 'type' => 'decimal', 'nullable' => false]],
        ['op' => 'add', 'def' => ['name' => 'code', 'type' => 'varchar', 'nullable' => true]],
    ],
    'indexes' => [['op' => 'add', 'name' => 'uq_code', 'kind' => 'UNIQUE', 'columns' => ['code']]],
    'foreignKeys' => [['op' => 'add', 'name' => 'fk_alerts_items_id', 'columns' => ['items_id'], 'refTable' => 'glpi_apiclients', 'refColumns' => ['id']]],
    'checks' => [['op' => 'add', 'name' => 'chk_price', 'expr' => 'price >= 0']],
    'table' => ['comment' => 'Alerts'],
];

return [
    '1452 (MariaDB, during ALTER) points to the FK that failed' => static function () use ($changes): void {
        $msg = 'Cannot add or update a child row: a foreign key constraint fails (`glpi`.`#sql-alter-1-2a`, CONSTRAINT `fk_alerts_items_id` FOREIGN KEY (`items_id`) REFERENCES `glpi_apiclients` (`id`) ON UPDATE CASCADE)';
        eq(['kind' => 'fk', 'name' => 'fk_alerts_items_id'], TableEditor::failedChange(1452, $msg, $changes));
    },
    '1452 (MySQL 8) points to the FK that failed' => static function () use ($changes): void {
        $msg = 'Cannot add or update a child row: a foreign key constraint fails (`glpi`.`#sql-1_9`, CONSTRAINT `fk_alerts_items_id` FOREIGN KEY (`items_id`) REFERENCES `glpi_apiclients` (`id`))';
        eq(['kind' => 'fk', 'name' => 'fk_alerts_items_id'], TableEditor::failedChange(1452, $msg, $changes));
    },
    '1822 and 3780 name the FK' => static function () use ($changes): void {
        eq(['kind' => 'fk', 'name' => 'fk_alerts_items_id'], TableEditor::failedChange(1822, "Failed to add the foreign key constraint. Missing index for constraint 'fk_alerts_items_id' in the referenced table 'glpi_apiclients'", $changes));
        eq(['kind' => 'fk', 'name' => 'fk_alerts_items_id'], TableEditor::failedChange(3780, "Referencing column 'items_id' and referenced column 'id' in foreign key constraint 'fk_alerts_items_id' are incompatible.", $changes));
    },
    '1062 on a new unique index' => static function () use ($changes): void {
        eq(['kind' => 'index', 'name' => 'uq_code'], TableEditor::failedChange(1062, "Duplicate entry 'A1' for key 'uq_code'", $changes));
        eq(['kind' => 'index', 'name' => 'uq_code'], TableEditor::failedChange(1062, "Duplicate entry 'A1' for key 'glpi_alerts.uq_code'", $changes));
    },
    'CHECK violated (MySQL 3819, MariaDB 4025)' => static function () use ($changes): void {
        eq(['kind' => 'check', 'name' => 'chk_price'], TableEditor::failedChange(3819, "Check constraint 'chk_price' is violated.", $changes));
        eq(['kind' => 'check', 'name' => 'chk_price'], TableEditor::failedChange(4025, 'CONSTRAINT `chk_price` failed for `shop`.`products`', $changes));
    },
    'data errors point to the column' => static function () use ($changes): void {
        eq(['kind' => 'column', 'name' => 'price'], TableEditor::failedChange(1265, "Data truncated for column 'price' at row 3", $changes));
        eq(['kind' => 'column', 'name' => 'price'], TableEditor::failedChange(1138, 'Invalid use of NULL value', $changes));
    },
    'unknown cause: no change singled out' => static function () use ($changes): void {
        eq(null, TableEditor::failedChange(1205, 'Lock wait timeout exceeded; try restarting transaction', $changes));
        eq(null, TableEditor::failedChange(1452, 'Cannot add or update a child row: a foreign key constraint fails (CONSTRAINT `other_fk` ...)', $changes));
    },
];
