<?php
declare(strict_types=1);

use PhpMyFlow\ApiError;
use PhpMyFlow\Objects;

$type = static fn (array $d) => strtoupper((string) $d['type']) . (isset($d['length']) ? "({$d['length']})" : '') . (!empty($d['unsigned']) ? ' UNSIGNED' : '');

function throwsCode(string $code, callable $fn): void
{
    try {
        $fn();
    } catch (ApiError $e) {
        eq($code, $e->errorCode);
        return;
    }
    throw new RuntimeException("expected ApiError $code");
}

return [
    'view: options and check option' => static function (): void {
        eq('CREATE OR REPLACE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW `v_paid` AS SELECT id FROM orders WHERE status = \'paid\' WITH CASCADED CHECK OPTION',
            Objects::viewSql(['name' => 'v_paid', 'algorithm' => 'MERGE', 'security' => 'INVOKER', 'checkOption' => 'CASCADED', 'body' => "SELECT id FROM orders WHERE status = 'paid';", 'orReplace' => true]));
        eq('CREATE VIEW `v` AS SELECT 1', Objects::viewSql(['name' => 'v', 'body' => 'SELECT 1']));
        throwsCode('bad_option', static fn () => Objects::viewSql(['name' => 'v', 'algorithm' => 'FAST', 'body' => 'SELECT 1']));
        throwsCode('view_body', static fn () => Objects::viewSql(['name' => 'v', 'body' => 'DELETE FROM t']));
    },
    'procedure: parameters, characteristics, body as written' => static function () use ($type): void {
        $sql = Objects::routineSql([
            'kind' => 'PROCEDURE', 'name' => 'close_order',
            'params' => [
                ['mode' => 'IN', 'name' => 'p_id', 'type' => ['type' => 'int', 'unsigned' => true]],
                ['mode' => 'OUT', 'name' => 'p_total', 'type' => ['type' => 'decimal']],
                ['mode' => 'INOUT', 'name' => 'p_note', 'type' => ['type' => 'varchar', 'length' => 200]],
            ],
            'deterministic' => false, 'dataAccess' => 'MODIFIES SQL DATA', 'security' => 'DEFINER', 'comment' => "Closes it's order",
            'body' => "BEGIN\n  UPDATE orders SET status = 'paid' WHERE id = p_id;\n  SELECT 1;\nEND",
        ], $type, static fn ($s) => "'" . str_replace("'", "''", $s) . "'");
        eq("CREATE PROCEDURE `close_order`(IN `p_id` INT UNSIGNED, OUT `p_total` DECIMAL, INOUT `p_note` VARCHAR(200))\n  COMMENT 'Closes it''s order'\n  NOT DETERMINISTIC\n  MODIFIES SQL DATA\n  SQL SECURITY DEFINER\nBEGIN\n  UPDATE orders SET status = 'paid' WHERE id = p_id;\n  SELECT 1;\nEND", $sql);
    },
    'function: RETURNS, no parameter modes, definer' => static function () use ($type): void {
        $sql = Objects::routineSql([
            'kind' => 'FUNCTION', 'name' => 'vat', 'params' => [['mode' => 'IN', 'name' => 'amount', 'type' => ['type' => 'decimal']]],
            'returns' => ['type' => 'decimal'], 'deterministic' => true, 'dataAccess' => 'NO SQL', 'security' => 'INVOKER',
            'definer' => "'app'@'%'", 'body' => 'RETURN amount * 1.21',
        ], $type, static fn ($s) => "'$s'");
        eq("CREATE DEFINER='app'@'%' FUNCTION `vat`(`amount` DECIMAL) RETURNS DECIMAL\n  DETERMINISTIC\n  NO SQL\n  SQL SECURITY INVOKER\nRETURN amount * 1.21", $sql);
        throwsCode('bad_option', static fn () => Objects::routineSql(['kind' => 'FUNCTION', 'name' => 'f', 'params' => [['mode' => 'OUT', 'name' => 'x', 'type' => ['type' => 'int']]], 'returns' => ['type' => 'int'], 'body' => 'RETURN 1'], $type, 'strval'));
        throwsCode('bad_definer', static fn () => Objects::routineSql(['kind' => 'PROCEDURE', 'name' => 'p', 'definer' => "x'; DROP", 'body' => 'SELECT 1'], $type, 'strval'));
    },
    'DELIMITER lines and custom delimiters are removed from bodies' => static function (): void {
        eq("BEGIN\n  SELECT 1;\nEND", Objects::cleanBody("DELIMITER \$\$\nBEGIN\n  SELECT 1;\nEND\$\$\nDELIMITER ;\n"));
        eq("BEGIN SELECT 1; END", Objects::cleanBody("BEGIN SELECT 1; END;"));
        eq("BEGIN SELECT 1; END", Objects::cleanBody("  BEGIN SELECT 1; END //  "));
    },
    'trigger: timing, event, order' => static function (): void {
        eq("CREATE TRIGGER `trg_orders_touch` BEFORE UPDATE ON `orders` FOR EACH ROW FOLLOWS `trg_other`\nSET NEW.updated_at = NOW()",
            Objects::triggerSql(['name' => 'trg_orders_touch', 'table' => 'orders', 'timing' => 'BEFORE', 'event' => 'UPDATE', 'order' => ['kind' => 'FOLLOWS', 'other' => 'trg_other'], 'body' => 'SET NEW.updated_at = NOW();']));
        throwsCode('bad_option', static fn () => Objects::triggerSql(['name' => 't', 'table' => 'x', 'timing' => 'INSTEAD OF', 'event' => 'INSERT', 'body' => 'SET @a = 1']));
    },
    'event: once and recurring schedules' => static function (): void {
        $q = static fn ($s) => "'" . str_replace("'", "''", $s) . "'";
        eq("CREATE EVENT `ev_once` ON SCHEDULE AT '2026-12-01 03:00:00' ON COMPLETION NOT PRESERVE ENABLE DO DELETE FROM logs",
            Objects::eventSql(['name' => 'ev_once', 'schedule' => ['type' => 'once', 'at' => '2026-12-01 03:00:00'], 'preserve' => false, 'enabled' => true, 'body' => 'DELETE FROM logs'], $q));
        eq("CREATE EVENT `ev_daily` ON SCHEDULE EVERY 1 DAY STARTS '2026-12-01 03:00:00' ENDS '2027-12-01 00:00:00' ON COMPLETION PRESERVE DISABLE COMMENT 'Nightly' DO BEGIN DELETE FROM logs; END",
            Objects::eventSql(['name' => 'ev_daily', 'schedule' => ['type' => 'every', 'value' => 1, 'unit' => 'DAY', 'starts' => '2026-12-01 03:00:00', 'ends' => '2027-12-01 00:00:00'], 'preserve' => true, 'enabled' => false, 'comment' => 'Nightly', 'body' => 'BEGIN DELETE FROM logs; END'], $q));
        eq("ALTER EVENT `ev_daily` ON SCHEDULE EVERY 2 HOUR ON COMPLETION PRESERVE ENABLE RENAME TO `ev_2h` DO SELECT 1",
            Objects::eventSql(['name' => 'ev_2h', 'schedule' => ['type' => 'every', 'value' => 2, 'unit' => 'HOUR'], 'preserve' => true, 'enabled' => true, 'body' => 'SELECT 1'], $q, 'ev_daily'));
        throwsCode('bad_option', static fn () => Objects::eventSql(['name' => 'e', 'schedule' => ['type' => 'every', 'value' => 1, 'unit' => 'FORTNIGHT'], 'body' => 'SELECT 1'], $q));
        throwsCode('bad_date', static fn () => Objects::eventSql(['name' => 'e', 'schedule' => ['type' => 'once', 'at' => "2026-01-01'; DROP"], 'body' => 'SELECT 1'], $q));
    },
];
