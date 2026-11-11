<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * Everything read from information_schema. Also the single source of
 * truth for validating identifiers coming from the client.
 */
final class Schema
{
    private const SYSTEM_DBS = ['information_schema', 'performance_schema', 'mysql', 'sys'];

    public static function databases(): array
    {
        $rows = Db::all('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME');
        // Size per database (data + indexes) from table statistics: no table is read.
        $sizes = [];
        foreach (Db::all('SELECT TABLE_SCHEMA AS db, SUM(DATA_LENGTH + INDEX_LENGTH) AS bytes, COUNT(*) AS tables
                          FROM information_schema.TABLES GROUP BY TABLE_SCHEMA') as $s) {
            $sizes[$s['db']] = $s;
        }
        return array_map(static fn ($r) => [
            'name' => $r['name'],
            'system' => in_array(strtolower($r['name']), self::SYSTEM_DBS, true),
            'bytes' => isset($sizes[$r['name']]['bytes']) ? (int) $sizes[$r['name']]['bytes'] : 0,
            'tables' => isset($sizes[$r['name']]) ? (int) $sizes[$r['name']]['tables'] : 0,
        ], $rows);
    }

    public static function assertDatabaseExists(string $db): void
    {
        $found = Db::all('SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [$db]);
        if (!$found) {
            throw new ApiError('unknown_database', "Unknown database: $db", 404, ['name' => $db]);
        }
    }

    public static function tables(string $db): array
    {
        return Db::all(
            'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS approxRows,
                    DATA_LENGTH + INDEX_LENGTH AS bytes, DATA_LENGTH AS dataBytes, INDEX_LENGTH AS indexBytes,
                    DATA_FREE AS freeBytes, ENGINE AS engine, TABLE_COMMENT AS comment
             FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
            [$db]
        );
    }

    /** Columns of one table, validated to exist. */
    public static function columns(string $db, string $table): array
    {
        $cols = Db::all(
            'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, DATA_TYPE AS dataType,
                    IS_NULLABLE = "YES" AS nullable, COLUMN_KEY AS `key`, COLUMN_DEFAULT AS `default`,
                    EXTRA AS extra, COLUMN_COMMENT AS comment
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
             ORDER BY ORDINAL_POSITION',
            [$db, $table]
        );
        if (!$cols) {
            throw new ApiError('unknown_table', "Unknown table: $table", 404, ['name' => $table]);
        }
        foreach ($cols as &$c) {
            $c['nullable'] = (bool) $c['nullable'];
        }
        return $cols;
    }

    public static function primaryKey(string $db, string $table): array
    {
        $rows = Db::all(
            'SELECT COLUMN_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = "PRIMARY"
             ORDER BY ORDINAL_POSITION',
            [$db, $table]
        );
        return array_column($rows, 'name');
    }

    /**
     * Compact full schema of a database: feeds editor autocompletion,
     * the linter and the AI assistant.
     */
    public static function full(string $db): array
    {
        self::assertDatabaseExists($db);
        $tables = [];
        foreach (self::tables($db) as $t) {
            $tables[$t['name']] = ['type' => $t['type'], 'comment' => $t['comment'], 'columns' => [], 'foreignKeys' => []];
        }
        $cols = Db::all(
            'SELECT TABLE_NAME AS t, COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_KEY AS `key`,
                    IS_NULLABLE = "YES" AS nullable, COLUMN_COMMENT AS comment
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION',
            [$db]
        );
        foreach ($cols as $c) {
            if (isset($tables[$c['t']])) {
                $tables[$c['t']]['columns'][] = [
                    'name' => $c['name'], 'type' => $c['type'], 'key' => $c['key'],
                    'nullable' => (bool) $c['nullable'], 'comment' => $c['comment'],
                ];
            }
        }
        $fks = Db::all(
            'SELECT TABLE_NAME AS t, COLUMN_NAME AS col, REFERENCED_TABLE_NAME AS refTable, REFERENCED_COLUMN_NAME AS refCol
             FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL',
            [$db, $db]
        );
        foreach ($fks as $fk) {
            if (isset($tables[$fk['t']])) {
                $tables[$fk['t']]['foreignKeys'][] = ['column' => $fk['col'], 'references' => $fk['refTable'] . '.' . $fk['refCol']];
            }
        }
        // Relations by naming convention (GLPI, WordPress, old Laravel apps...).
        foreach ($tables as $name => $info) {
            $tables[$name]['inferredKeys'] = [];
        }
        foreach (self::inferRelations($tables) as $rel) {
            $tables[$rel['from']]['inferredKeys'][] = ['column' => $rel['column'], 'references' => $rel['to'] . '.' . $rel['toColumn']];
        }
        return $tables;
    }

    /**
     * A generated (computed) column, from information_schema EXTRA:
     * "VIRTUAL GENERATED", "STORED GENERATED" (MySQL), "PERSISTENT GENERATED"
     * (MariaDB). Not MySQL 8's "DEFAULT_GENERATED", which is only a column
     * with an expression default (CURRENT_TIMESTAMP...).
     */
    public static function isGenerated(?string $extra): bool
    {
        return (bool) preg_match('~\b(VIRTUAL|STORED|PERSISTENT)\s+GENERATED\b~i', (string) $extra);
    }

    /** Flat list of declared and inferred relations of a `full()` schema. */
    public static function relations(array $tables): array
    {
        $out = [];
        foreach ($tables as $name => $info) {
            foreach ($info['foreignKeys'] as $fk) {
                [$to, $toCol] = explode('.', $fk['references'], 2);
                $out[] = ['from' => $name, 'column' => $fk['column'], 'to' => $to, 'toColumn' => $toCol, 'kind' => 'declared'];
            }
            foreach ($info['inferredKeys'] ?? [] as $fk) {
                [$to, $toCol] = explode('.', $fk['references'], 2);
                $out[] = ['from' => $name, 'column' => $fk['column'], 'to' => $to, 'toColumn' => $toCol, 'kind' => 'inferred'];
            }
        }
        return $out;
    }

    /** Prefix shared by most tables ("glpi_", "wp_"): 3+ tables and 60%+ of them. */
    public static function commonPrefix(array $names): string
    {
        if (count($names) < 3) {
            return '';
        }
        $counts = [];
        foreach ($names as $n) {
            $n = (string) $n;
            $cut = strpos($n, '_');
            if ($cut !== false && $cut > 0 && $cut < strlen($n) - 1) {
                $p = substr($n, 0, $cut + 1);
                $counts[$p] = ($counts[$p] ?? 0) + 1;
            }
        }
        if (!$counts) {
            return '';
        }
        arsort($counts);
        $best = (string) array_key_first($counts);
        return $counts[$best] >= 3 && $counts[$best] / count($names) >= 0.6 ? $best : '';
    }

    /** Integer types join with each other, text types with each other. */
    private static function typeFamily(string $columnType): string
    {
        $base = strtolower((string) preg_replace('~[\s(].*$~', '', $columnType));
        if (in_array($base, ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint'], true)) {
            return 'int';
        }
        if (in_array($base, ['char', 'varchar', 'binary', 'varbinary'], true)) {
            return 'str';
        }
        return $base;
    }

    /** English plural/singular candidates for a column stem: user -> users, category -> categories. */
    private static function nameCandidates(string $stem): array
    {
        $c = [$stem, $stem . 's'];
        // English -es (box -> boxes) and Spanish plurals of words ending in a
        // consonant (material -> materiales, region -> regiones, actor -> actores).
        if (preg_match('~(s|x|z|ch|sh|[lrndj])$~', $stem)) {
            $c[] = $stem . 'es';
        }
        if (preg_match('~z$~', $stem)) {
            $c[] = substr($stem, 0, -1) . 'ces'; // luz -> luces
        }
        if (preg_match('~[^aeiou]y$~', $stem)) {
            $c[] = substr($stem, 0, -1) . 'ies';
        }
        if (preg_match('~ies$~', $stem)) {
            $c[] = substr($stem, 0, -3) . 'y';
        }
        if (substr($stem, -1) === 's') {
            $c[] = substr($stem, 0, -1);
        }
        return array_values(array_unique($c));
    }

    /**
     * Polymorphic pairs: a string type column next to an integer id column
     * that together point to "any table" (GLPI itemtype + items_id,
     * mainitemtype + mainitems_id, itemtype_1 + items_id_1; Rails/Laravel
     * commentable_type + commentable_id). They are never a FK to one table.
     *
     * @return list<array{table:string, typeColumn:string, idColumn:string}>
     */
    public static function polymorphic(array $tables): array
    {
        $out = [];
        foreach ($tables as $name => $info) {
            $byLower = [];
            foreach ($info['columns'] as $c) {
                $byLower[strtolower($c['name'])] = $c;
            }
            foreach ($info['columns'] as $c) {
                $low = strtolower($c['name']);
                if (self::typeFamily($c['type']) !== 'str' && self::typeFamily($c['type']) !== 'enum') {
                    continue;
                }
                $ids = [];
                if (str_contains($low, 'itemtype')) {
                    $ids[] = str_replace('itemtype', 'items_id', $low);
                }
                if (preg_match('~^(.+)_type$~', $low, $m)) {
                    $ids[] = $m[1] . '_id';
                    $ids[] = $m[1] . 's_id';
                }
                foreach ($ids as $idName) {
                    $id = $byLower[$idName] ?? null;
                    if ($id && self::typeFamily($id['type']) === 'int') {
                        $out[] = ['table' => (string) $name, 'typeColumn' => $c['name'], 'idColumn' => $id['name']];
                        break;
                    }
                }
            }
        }
        usort($out, static fn ($a, $b) => [$a['table'], $a['typeColumn']] <=> [$b['table'], $b['typeColumn']]);
        return $out;
    }

    /**
     * Relations by convention: a column `xxx_id`, `xxxs_id` or `xxx_id_suffix`
     * (GLPI: users_id_recipient) points to `<prefix>xxxs` / `<prefix>xxx`
     * when that table exists, has a single-column primary key and both sides
     * are integers. Columns with a declared FK are skipped, and so are
     * polymorphic id columns and generic `items_id` (they point to any table).
     *
     * @param array<string, array{type:string, columns:array, foreignKeys:array}> $tables
     * @return list<array{from:string, column:string, to:string, toColumn:string}>
     */
    public static function inferRelations(array $tables): array
    {
        $prefix = self::commonPrefix(array_keys($tables));
        $lower = [];
        $pk = [];
        foreach ($tables as $name => $info) {
            $name = (string) $name;
            $lower[strtolower($name)] = $name;
            $pks = array_values(array_filter($info['columns'], static fn ($c) => $c['key'] === 'PRI'));
            if (count($pks) === 1 && ($info['type'] ?? '') !== 'VIEW') {
                $pk[$name] = $pks[0];
            }
        }
        $poly = [];
        foreach (self::polymorphic($tables) as $p) {
            $poly[$p['table'] . '.' . $p['idColumn']] = true;
        }
        $out = [];
        foreach ($tables as $name => $info) {
            $name = (string) $name;
            $declared = array_column($info['foreignKeys'], 'column');
            foreach ($info['columns'] as $col) {
                if (in_array($col['name'], $declared, true) || isset($poly[$name . '.' . $col['name']])
                    || preg_match('~items_id(_[a-z0-9]+)?$~i', $col['name']) || self::typeFamily($col['type']) !== 'int') {
                    continue;
                }
                // xxx_id / xxxs_id / xxx_id_suffix (users_id_recipient), or the prefix style id_xxx (id_planta).
                if (preg_match('~^([a-z][a-z0-9_]*?)_id(?:_[a-z0-9]+)?$~i', $col['name'], $m)) {
                    $stem = strtolower($m[1]);
                } elseif (preg_match('~^id_?([a-z][a-z0-9_]*)$~i', $col['name'], $m) && strtolower($col['name']) !== 'id') {
                    $stem = strtolower($m[1]);
                } else {
                    continue;
                }
                $target = null;
                foreach (self::nameCandidates($stem) as $cand) {
                    foreach ([$prefix . $cand, $cand] as $tryName) {
                        if ($tryName !== '' && isset($lower[$tryName], $pk[$lower[$tryName]])) {
                            $target = $lower[$tryName];
                            break 2;
                        }
                    }
                }
                if ($target === null) {
                    continue;
                }
                $targetPk = $pk[$target];
                // A table's own PK never points elsewhere.
                if ($target === $name && $col['name'] === $targetPk['name']) {
                    continue;
                }
                if (self::typeFamily($targetPk['type']) !== 'int') {
                    continue;
                }
                $out[] = ['from' => $name, 'column' => $col['name'], 'to' => $target, 'toColumn' => $targetPk['name']];
            }
        }
        return $out;
    }
}
