<?php
declare(strict_types=1);

namespace PhpMyFlow;

use PDO;

/**
 * Structure editor backend. The browser sends structured changes, never
 * SQL: names are validated, types come from a whitelist, values are quoted
 * by PDO, and the server builds a single ALTER TABLE statement (one
 * statement per request). Preview returns the SQL plus data warnings
 * (rows that would be truncated, NULLs, duplicates) without running it.
 */
final class TableEditor
{
    /** Base types the editor offers, with what they accept. */
    public const TYPES = [
        'tinyint' => 'int', 'smallint' => 'int', 'mediumint' => 'int', 'int' => 'int', 'bigint' => 'int',
        'decimal' => 'decimal', 'float' => 'float', 'double' => 'float', 'bit' => 'bit',
        'char' => 'char', 'varchar' => 'char', 'binary' => 'char', 'varbinary' => 'char',
        'tinytext' => 'text', 'text' => 'text', 'mediumtext' => 'text', 'longtext' => 'text',
        'tinyblob' => 'blob', 'blob' => 'blob', 'mediumblob' => 'blob', 'longblob' => 'blob',
        'date' => 'date', 'datetime' => 'time', 'timestamp' => 'time', 'time' => 'time', 'year' => 'date',
        'enum' => 'enum', 'set' => 'enum', 'json' => 'json', 'uuid' => 'plain', 'inet4' => 'plain', 'inet6' => 'plain',
        'geometry' => 'plain', 'point' => 'plain',
    ];

    public function __construct(private PDO $pdo, private string $db)
    {
    }

    public static function forSession(string $db): self
    {
        Db::useDatabase($db);
        return new self(Db::pdo(), $db);
    }

    // ------------------------------------------------------------------
    // Read
    // ------------------------------------------------------------------

    public function info(string $table): array
    {
        $t = $this->pdo->prepare('SELECT TABLE_TYPE AS type, ENGINE AS engine, TABLE_COLLATION AS collation, AUTO_INCREMENT AS autoIncrement,
                                         TABLE_ROWS AS approxRows, DATA_LENGTH + INDEX_LENGTH AS bytes, TABLE_COMMENT AS comment, ROW_FORMAT AS rowFormat
                                  FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?');
        $t->execute([$this->db, $table]);
        $tbl = $t->fetch(PDO::FETCH_ASSOC);
        if (!$tbl) {
            throw new ApiError('unknown_table', "Unknown table: $table", 404, ['name' => $table]);
        }
        $c = $this->pdo->prepare('SELECT COLUMN_NAME AS name, COLUMN_TYPE AS columnType, DATA_TYPE AS dataType,
                                         CHARACTER_MAXIMUM_LENGTH AS charLength, NUMERIC_PRECISION AS numPrecision, NUMERIC_SCALE AS numScale,
                                         IS_NULLABLE = "YES" AS nullable, COLUMN_DEFAULT AS `default`, EXTRA AS extra, COLUMN_KEY AS `key`,
                                         COLLATION_NAME AS collation, COLUMN_COMMENT AS comment, GENERATION_EXPRESSION AS generation
                                  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION');
        $c->execute([$this->db, $table]);
        $columns = $c->fetchAll(PDO::FETCH_ASSOC);
        foreach ($columns as &$col) {
            $col['nullable'] = (bool) $col['nullable'];
        }
        unset($col);

        // SELECT *: IS_VISIBLE (MySQL 8) and IGNORED (MariaDB 10.6) only exist on newer servers.
        $s = $this->pdo->prepare('SELECT * FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX');
        $s->execute([$this->db, $table]);
        $indexes = [];
        foreach ($s->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $r = array_change_key_case($r, CASE_UPPER);
            $name = $r['INDEX_NAME'];
            $type = strtoupper((string) $r['INDEX_TYPE']);
            $indexes[$name] ??= [
                'name' => $name,
                'kind' => $name === 'PRIMARY' ? 'PRIMARY' : ($type === 'FULLTEXT' ? 'FULLTEXT' : ($type === 'SPATIAL' ? 'SPATIAL' : ((int) $r['NON_UNIQUE'] === 0 ? 'UNIQUE' : 'INDEX'))),
                'columns' => [],
                'invisible' => (isset($r['IS_VISIBLE']) && strtoupper((string) $r['IS_VISIBLE']) === 'NO') || (isset($r['IGNORED']) && strtoupper((string) $r['IGNORED']) === 'YES'),
            ];
            // MySQL reports SUB_PART 32 on SPATIAL keys: not a real prefix.
            $indexes[$name]['columns'][] = $r['COLUMN_NAME'] . ($r['SUB_PART'] && $type !== 'SPATIAL' ? '(' . (int) $r['SUB_PART'] . ')' : '') . (($r['COLLATION'] ?? 'A') === 'D' ? ' DESC' : '');
        }

        $f = $this->pdo->prepare('SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS col, k.REFERENCED_TABLE_NAME AS refTable, k.REFERENCED_COLUMN_NAME AS refCol,
                                         r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete
                                  FROM information_schema.KEY_COLUMN_USAGE k
                                  JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
                                  WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
                                  ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION');
        $f->execute([$this->db, $table]);
        $fks = [];
        foreach ($f->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $fks[$r['name']] ??= ['name' => $r['name'], 'columns' => [], 'refTable' => $r['refTable'], 'refColumns' => [], 'onUpdate' => $r['onUpdate'], 'onDelete' => $r['onDelete']];
            $fks[$r['name']]['columns'][] = $r['col'];
            $fks[$r['name']]['refColumns'][] = $r['refCol'];
        }

        $create = '';
        try {
            $create = (string) ($this->pdo->query('SHOW CREATE TABLE ' . Db::ident($table))->fetch(PDO::FETCH_NUM)[1] ?? '');
        } catch (\PDOException) {
        }

        return [
            'table' => [
                'name' => $table,
                'type' => $tbl['type'],
                'engine' => $tbl['engine'],
                'collation' => $tbl['collation'],
                'autoIncrement' => $tbl['autoIncrement'] === null ? null : (int) $tbl['autoIncrement'],
                'approxRows' => (int) $tbl['approxRows'],
                'bytes' => (int) $tbl['bytes'],
                'comment' => $tbl['comment'],
            ],
            'columns' => $columns,
            'indexes' => array_values($indexes),
            'indexSupport' => $this->indexSupport((string) $tbl['engine']),
            'foreignKeys' => array_values($fks),
            'create' => $create,
            'managedBy' => $this->managedBy(),
            'checkSupport' => $this->checkSupport(),
            'checks' => $this->checks($table),
            'constraintNames' => array_column($this->pdo->query('SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ' . $this->q($this->db) . " AND CONSTRAINT_TYPE = 'FOREIGN KEY'")->fetchAll(PDO::FETCH_ASSOC), 'CONSTRAINT_NAME'),
            'canAlter' => $tbl['type'] === 'BASE TABLE' && !pmf_config()['read_only'] && $this->hasAlter($table),
            'reason' => $tbl['type'] !== 'BASE TABLE' ? 'view' : (pmf_config()['read_only'] ? 'read_only' : ($this->hasAlter($table) ? null : 'no_alter')),
            'engines' => array_column($this->pdo->query("SELECT ENGINE FROM information_schema.ENGINES WHERE SUPPORT IN ('YES','DEFAULT') ORDER BY ENGINE")->fetchAll(PDO::FETCH_ASSOC), 'ENGINE'),
            'collations' => array_column($this->pdo->query("SELECT COLLATION_NAME FROM information_schema.COLLATIONS WHERE CHARACTER_SET_NAME IN ('utf8mb4','utf8mb3','utf8','latin1','ascii','binary') ORDER BY COLLATION_NAME")->fetchAll(PDO::FETCH_ASSOC), 'COLLATION_NAME'),
        ];
    }

    /**
     * Applications that manage their own schema: changing it (FKs, columns)
     * can break their upgrades. GLPI: glpi_configs with context 'core';
     * WordPress: an *_options table with the siteurl option.
     */
    public function managedBy(): ?string
    {
        $tables = array_column($this->pdo->query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ' . $this->q($this->db))->fetchAll(PDO::FETCH_ASSOC), 'TABLE_NAME');
        return self::detectManaged($tables, function (string $sql): ?bool {
            try {
                return (bool) $this->pdo->query($sql)->fetchColumn();
            } catch (\PDOException) {
                return null; // no SELECT privilege, missing column...
            }
        });
    }

    /**
     * Which app owns this schema. `$probe` runs a read-only query and returns
     * true/false, or null when it fails. GLPI: glpi_configs has context
     * 'core'; WordPress: <prefix>options has siteurl. When the data can't be
     * read (privileges) or the table isn't there, every table sharing a known
     * prefix (glpi_, wp_) is enough.
     *
     * @param list<string> $tables
     * @param callable(string): ?bool $probe
     */
    public static function detectManaged(array $tables, callable $probe): ?string
    {
        $unknown = false;
        foreach ($tables as $t) {
            if (strcasecmp($t, 'glpi_configs') === 0) {
                $r = $probe('SELECT 1 FROM ' . Db::ident($t) . " WHERE context = 'core' LIMIT 1");
                if ($r === true) {
                    return 'glpi';
                }
                $unknown = $unknown || $r === null;
            }
        }
        foreach ($tables as $t) {
            if (preg_match('~^([a-z0-9_]*)options$~i', $t, $m) && in_array($m[1] . 'posts', $tables, true)) {
                $r = $probe('SELECT 1 FROM ' . Db::ident($t) . " WHERE option_name = 'siteurl' LIMIT 1");
                if ($r === true) {
                    return 'wordpress';
                }
                $unknown = $unknown || $r === null;
            }
        }
        $hasConfig = (bool) array_filter($tables, static fn ($t) => strcasecmp($t, 'glpi_configs') === 0 || preg_match('~options$~i', $t));
        if ($tables && ($unknown || !$hasConfig)) {
            foreach (['glpi_' => 'glpi', 'wp_' => 'wordpress'] as $prefix => $app) {
                if (count(array_filter($tables, static fn ($t) => stripos($t, $prefix) === 0)) === count($tables)) {
                    return $app;
                }
            }
        }
        return null;
    }

    /** CHECK constraints are enforced from MySQL 8.0.16 and MariaDB 10.2.1. */
    public function checkSupport(): array
    {
        $v = (string) $this->pdo->query('SELECT VERSION()')->fetchColumn();
        $mariadb = stripos($v, 'mariadb') !== false;
        preg_match('~^(\d+)\.(\d+)\.(\d+)~', $v, $m);
        $num = isset($m[1]) ? sprintf('%d.%d.%d', $m[1], $m[2], $m[3]) : '0.0.0';
        $min = $mariadb ? '10.2.1' : '8.0.16';
        return ['supported' => version_compare($num, $min, '>='), 'flavor' => $mariadb ? 'mariadb' : 'mysql', 'version' => $num, 'min' => $min];
    }

    /** Table-level CHECK constraints (MariaDB column-level ones belong to their column). */
    public function checks(string $table): array
    {
        if (!$this->checkSupport()['supported']) {
            return [];
        }
        try {
            if ($this->checkSupport()['flavor'] === 'mariadb') {
                $st = $this->pdo->prepare("SELECT CONSTRAINT_NAME AS name, CHECK_CLAUSE AS expr FROM information_schema.CHECK_CONSTRAINTS
                                           WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? AND (LEVEL IS NULL OR LEVEL = 'Table') ORDER BY CONSTRAINT_NAME");
            } else {
                $st = $this->pdo->prepare("SELECT cc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS expr FROM information_schema.CHECK_CONSTRAINTS cc
                                           JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
                                           WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'CHECK' ORDER BY cc.CONSTRAINT_NAME");
            }
            $st->execute([$this->db, $table]);
            return $st->fetchAll(PDO::FETCH_ASSOC);
        } catch (\PDOException) {
            return [];
        }
    }

    /** Rows that break each CHECK expression (capped), for live validation and the review. */
    public function checkViolations(string $table, array $checks): array
    {
        $out = [];
        foreach ($checks as $c) {
            $id = (string) ($c['id'] ?? '');
            $expr = (string) ($c['expr'] ?? '');
            try {
                self::safeExpression($expr);
                $n = (int) $this->pdo->query('SELECT COUNT(*) FROM (SELECT 1 FROM ' . Db::ident($table) . ' WHERE NOT (' . $expr . ') LIMIT 10001) x')->fetchColumn();
                $out[$id] = ['ok' => true, 'count' => min($n, 10000), 'more' => $n > 10000];
            } catch (ApiError $e) {
                $out[$id] = ['ok' => false, 'error' => $e->errorCode];
            } catch (\PDOException $e) {
                // Usually a column that only exists after the pending changes, or a typo.
                $out[$id] = ['ok' => false, 'error' => 'sql', 'message' => \pmf_substr((string) ($e->errorInfo[2] ?? $e->getMessage()), 300)];
            }
        }
        return $out;
    }

    /** ALTER on this table at global, schema or table level. */
    private function hasAlter(string $table): bool
    {
        $cu = (string) $this->pdo->query('SELECT CURRENT_USER()')->fetchColumn();
        $at = strrpos($cu, '@');
        $grantee = "'" . substr($cu, 0, (int) $at) . "'@'" . substr($cu, (int) $at + 1) . "'";
        foreach ([
            ['SELECT 1 FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ? AND PRIVILEGE_TYPE = "ALTER"', [$grantee]],
            ['SELECT 1 FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = ? AND PRIVILEGE_TYPE = "ALTER"', [$grantee, $this->db]],
            ['SELECT 1 FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = ? AND TABLE_NAME = ? AND PRIVILEGE_TYPE = "ALTER"', [$grantee, $this->db, $table]],
        ] as [$sql, $params]) {
            $st = $this->pdo->prepare($sql);
            $st->execute($params);
            if ($st->fetchColumn()) {
                return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------------------
    // Validation helpers
    // ------------------------------------------------------------------

    /** Column of an index entry: "email(191) DESC" -> "email". */
    public static function idxCol(string $spec): string
    {
        return (string) preg_replace('~(\(\d+\))?(\s+(ASC|DESC))?$~i', '', trim($spec));
    }

    /** What this server supports for indexes. */
    public function indexSupport(string $engine): array
    {
        $v = (string) $this->pdo->getAttribute(PDO::ATTR_SERVER_VERSION);
        $maria = stripos($v, 'mariadb') !== false;
        preg_match('~^(\d+\.\d+\.\d+)~', $v, $m);
        $ver = $m[1] ?? '0.0.0';
        $ge = static fn (string $x) => version_compare($ver, $x, '>=');
        $innodb = strcasecmp($engine, 'InnoDB') === 0;
        $myisam = in_array(strtolower($engine), ['myisam', 'aria'], true);
        return [
            'desc' => $maria ? $ge('10.8.0') : $ge('8.0.0'),
            'invisible' => $maria ? ($ge('10.6.0') ? 'ignored' : null) : ($ge('8.0.0') ? 'invisible' : null),
            'fulltext' => $myisam || ($innodb && ($maria ? $ge('10.0.5') : $ge('5.6.0'))),
            'spatial' => $myisam || ($innodb && ($maria ? $ge('10.2.2') : $ge('5.7.5'))),
        ];
    }

    public static function validName(mixed $name): string
    {
        if (!is_string($name) || $name === '' || strlen($name) > 64 || $name !== rtrim($name) || preg_match('~[\x00/\\\\.]~', $name) || !pmf_is_utf8($name)) {
            throw new ApiError('bad_name', 'Invalid name', 400, ['name' => is_string($name) ? $name : '']);
        }
        return $name;
    }

    private function q(string $v): string
    {
        return $this->pdo->quote($v);
    }

    /** Balanced parentheses, no statement separator: a generated-column expression can't break out of its clause. */
    public static function safeExpression(string $expr): string
    {
        $depth = 0;
        $quote = null;
        $len = strlen($expr);
        for ($i = 0; $i < $len; $i++) {
            $ch = $expr[$i];
            if ($quote !== null) {
                if ($ch === '\\') {
                    $i++;
                } elseif ($ch === $quote) {
                    $quote = null;
                }
                continue;
            }
            if ($ch === "'" || $ch === '"' || $ch === '`') {
                $quote = $ch;
            } elseif ($ch === '(') {
                $depth++;
            } elseif ($ch === ')') {
                if (--$depth < 0) {
                    throw new ApiError('bad_expression', 'Unbalanced parentheses', 400);
                }
            } elseif ($ch === ';' || ($ch === '-' && ($expr[$i + 1] ?? '') === '-') || $ch === '#' || ($ch === '/' && ($expr[$i + 1] ?? '') === '*')) {
                throw new ApiError('bad_expression', 'Comments and ";" are not allowed in expressions', 400);
            }
        }
        if ($depth !== 0 || $quote !== null || trim($expr) === '') {
            throw new ApiError('bad_expression', 'Incomplete expression', 400);
        }
        return $expr;
    }

    /** base type, length/scale, unsigned from COLUMN_TYPE ("int(10) unsigned", "varchar(50)"). */
    public static function parseType(string $columnType): array
    {
        $t = strtolower(trim($columnType));
        preg_match('~^([a-z0-9]+)\s*(?:\(([^)]*)\))?\s*(.*)$~s', $t, $m);
        $base = $m[1] ?? $t;
        $args = array_map('trim', explode(',', $m[2] ?? ''));
        return [
            'base' => $base,
            'len' => isset($args[0]) && is_numeric($args[0]) ? (int) $args[0] : null,
            'scale' => isset($args[1]) && is_numeric($args[1]) ? (int) $args[1] : null,
            'unsigned' => str_contains($m[3] ?? '', 'unsigned'),
        ];
    }

    /** The type part of a structured definition, as COLUMN_TYPE would show it. */
    public static function typeOf(array $d): string
    {
        $type = strtolower((string) ($d['type'] ?? ''));
        $fam = self::TYPES[$type] ?? '';
        $s = $type;
        if ($fam === 'char' && !empty($d['length'])) {
            $s .= '(' . (int) $d['length'] . ')';
        } elseif ($fam === 'decimal') {
            $s .= '(' . (int) ($d['length'] ?? 10) . ',' . (int) ($d['scale'] ?? 0) . ')';
        }
        return $s . (!empty($d['unsigned']) ? ' unsigned' : '');
    }

    /**
     * Why two columns can't be linked by a foreign key, or null when they
     * can. MySQL/InnoDB wants the same integer type and sign, the same
     * DECIMAL precision, and the same charset and collation for strings.
     */
    public static function fkTypeIssue(string $localType, ?string $localCollation, string $refType, ?string $refCollation): ?array
    {
        $a = self::parseType($localType);
        $b = self::parseType($refType);
        $fa = self::TYPES[$a['base']] ?? $a['base'];
        $fb = self::TYPES[$b['base']] ?? $b['base'];
        $show = static fn (array $x) => $x['base'] . ($x['unsigned'] ? ' unsigned' : '');
        if ($fa !== $fb) {
            return ['code' => 'type', 'local' => $localType, 'ref' => $refType];
        }
        if ($fa === 'int' && ($a['base'] !== $b['base'] || $a['unsigned'] !== $b['unsigned'])) {
            return ['code' => 'type', 'local' => $show($a), 'ref' => $show($b)];
        }
        if ($fa === 'decimal' && ($a['len'] !== $b['len'] || $a['scale'] !== $b['scale'] || $a['unsigned'] !== $b['unsigned'])) {
            return ['code' => 'type', 'local' => $localType, 'ref' => $refType];
        }
        if (in_array($fa, ['char', 'text', 'enum'], true) && $localCollation !== null && $refCollation !== null && strtolower($localCollation) !== strtolower($refCollation)) {
            return ['code' => 'collation', 'local' => $localCollation, 'ref' => $refCollation];
        }
        if (in_array($fa, ['date', 'time'], true) && $a['base'] !== $b['base']) {
            return ['code' => 'type', 'local' => $localType, 'ref' => $refType];
        }
        return null;
    }

    /** Index whose leading columns are exactly $cols (any order of the rest). */
    private static function covered(array $indexCols, array $cols): bool
    {
        foreach ($indexCols as $ic) {
            if (array_slice($ic, 0, count($cols)) === $cols) {
                return true;
            }
        }
        return false;
    }

    /**
     * Live checks for foreign keys being added (ddl_checks): engines,
     * compatible types (with a fix: the referenced column type), index on
     * the referenced columns, index on the local ones (created
     * automatically), SET NULL on NOT NULL columns, and orphan rows.
     *
     * @param list<array{id:string, columns:list<string>, origColumns:list<?string>, refTable:string, refColumns:list<string>, onDelete:string, onUpdate:string}> $fks
     * @param array<string, array> $localDefs draft definition per local column name (pending changes included)
     */
    /**
     * Rows whose FK value has no match in the referenced table (read-only):
     * count capped at 10,000 and up to 5 distinct sample values.
     *
     * @return array{count:int, more:bool, samples:list<string>, column:string, refColumn:string}
     */
    public function orphans(string $table, array $local, string $refTable, array $remote): array
    {
        $local = array_values($local);
        $on = [];
        $notNull = [];
        foreach ($local as $i => $lc) {
            $on[] = 'r.' . Db::ident($remote[$i]) . ' = l.' . Db::ident($lc);
            $notNull[] = 'l.' . Db::ident($lc) . ' IS NOT NULL';
        }
        $from = Db::ident($table) . ' l LEFT JOIN ' . Db::ident($refTable) . ' r ON ' . implode(' AND ', $on)
            . ' WHERE ' . implode(' AND ', $notNull) . ' AND r.' . Db::ident($remote[0]) . ' IS NULL';
        $n = (int) $this->pdo->query("SELECT COUNT(*) FROM (SELECT 1 FROM $from LIMIT 10001) x")->fetchColumn();
        $samples = [];
        if ($n > 0) {
            $sel = implode(', ', array_map(static fn ($c) => 'l.' . Db::ident($c), $local));
            foreach ($this->pdo->query("SELECT DISTINCT $sel FROM $from ORDER BY 1 LIMIT 5")->fetchAll(PDO::FETCH_NUM) as $row) {
                $v = implode(', ', array_map(static fn ($x) => \pmf_substr((string) $x, 40), $row));
                $samples[] = count($row) > 1 ? "($v)" : $v;
            }
        }
        return ['count' => min($n, 10000), 'more' => $n > 10000, 'samples' => $samples, 'column' => implode(', ', $local), 'refColumn' => implode(', ', $remote)];
    }

    /**
     * Which pending change made an ALTER fail, from the server message, so the
     * UI can offer "remove this change and retry". Null when it can't tell.
     *
     * @return array{kind:string, name:string}|null
     */
    public static function failedChange(int $errno, string $message, array $changes): ?array
    {
        $find = static function (string $group, string $kind, string $name) use ($changes): ?array {
            foreach ((array) ($changes[$group] ?? []) as $c) {
                if (($c['op'] ?? '') === 'add' && strcasecmp((string) ($c['name'] ?? ''), $name) === 0) {
                    return ['kind' => $kind, 'name' => (string) $c['name']];
                }
            }
            return null;
        };
        switch ($errno) {
            case 1452: case 1822: case 3780: case 1005: case 1215: case 1216: case 6125:
                if (preg_match('~CONSTRAINT `([^`]+)`~', $message, $m) || preg_match("~constraint '([^']+)'~i", $message, $m)) {
                    return $find('foreignKeys', 'fk', $m[1]);
                }
                return null;
            case 1062:
                if (preg_match("~for key '(?:[^']*\\.)?([^'.]+)'~", $message, $m)) {
                    return $find('indexes', 'index', $m[1]);
                }
                return null;
            case 3819: case 4025:
                if (preg_match("~Check constraint '([^']+)'~", $message, $m) || preg_match('~CONSTRAINT `([^`]+)`~', $message, $m)) {
                    return $find('checks', 'check', $m[1]);
                }
                return null;
            case 1138:
                // "Invalid use of NULL value": a column that became NOT NULL.
                foreach ((array) ($changes['columns'] ?? []) as $c) {
                    if (($c['op'] ?? '') === 'modify' && empty($c['def']['nullable'])) {
                        return ['kind' => 'column', 'name' => (string) $c['name']];
                    }
                }
                return null;
            case 1265: case 1264: case 1366: case 1406: case 1292:
                if (!preg_match("~column '([^']+)'~i", $message, $m)) {
                    return null;
                }
                foreach ((array) ($changes['columns'] ?? []) as $c) {
                    $op = (string) ($c['op'] ?? '');
                    $names = [(string) ($c['def']['name'] ?? ''), (string) ($c['name'] ?? '')];
                    if ($op !== 'drop' && in_array(strtolower($m[1]), array_map('strtolower', $names), true)) {
                        return ['kind' => 'column', 'name' => $op === 'add' ? $names[0] : $names[1]];
                    }
                }
                return null;
            default:
                return null;
        }
    }

    /**
     * Rows that would break a new UNIQUE index: duplicate groups (capped)
     * among rows where no column is NULL (NULLs never collide).
     *
     * @param list<array{id:string, columns:list<string>}> $uniques
     */
    public function uniqueChecks(string $table, array $uniques): array
    {
        $cols = array_column($this->info($table)['columns'], null, 'name');
        $out = [];
        foreach ($uniques as $u) {
            $id = (string) ($u['id'] ?? '');
            $names = [];
            foreach ((array) ($u['columns'] ?? []) as $spec) {
                $n = self::idxCol((string) $spec);
                if (!isset($cols[$n])) {
                    continue 2; // a column that doesn't exist yet: checked in the review
                }
                $len = preg_match('~\((\d+)\)~', (string) $spec, $m) ? (int) $m[1] : 0;
                $names[] = $len ? 'LEFT(' . Db::ident($n) . ", $len)" : Db::ident($n);
            }
            if (!$names) {
                continue;
            }
            $list = implode(', ', $names);
            $notNull = implode(' AND ', array_map(static fn ($x) => "$x IS NOT NULL", $names));
            try {
                $st = $this->pdo->query('SELECT COUNT(*), COALESCE(SUM(n), 0) FROM (SELECT COUNT(*) AS n FROM ' . Db::ident($table) . " WHERE $notNull GROUP BY $list HAVING COUNT(*) > 1 LIMIT 10001) x");
                [$groups, $rows] = $st->fetch(PDO::FETCH_NUM);
                $out[$id] = ['groups' => min((int) $groups, 10000), 'rows' => (int) $rows, 'more' => (int) $groups > 10000];
            } catch (\PDOException $e) {
                $out[$id] = ['error' => (string) ($e->errorInfo[2] ?? $e->getMessage())];
            }
        }
        return $out;
    }

    public function fkChecks(string $table, array $fks, array $localDefs): array
    {
        $info = $this->info($table);
        $byName = array_column($info['columns'], null, 'name');
        $out = [];
        foreach ($fks as $fk) {
            $id = (string) ($fk['id'] ?? '');
            $issues = [];
            $refTable = (string) ($fk['refTable'] ?? '');
            $local = array_values(array_filter((array) ($fk['columns'] ?? []), 'is_string'));
            $remote = array_values(array_filter((array) ($fk['refColumns'] ?? []), 'is_string'));
            if (!$local || !$refTable || !$remote) {
                $out[$id] = [['level' => 'error', 'code' => 'incomplete']];
                continue;
            }
            try {
                $ref = $this->info(self::validName($refTable));
            } catch (ApiError) {
                $out[$id] = [['level' => 'error', 'code' => 'unknown_table', 'params' => ['table' => $refTable]]];
                continue;
            }
            if (count($local) !== count($remote)) {
                $issues[] = ['level' => 'error', 'code' => 'count'];
            }
            foreach ([[$info['table'], $table], [$ref['table'], $refTable]] as [$t, $n]) {
                if (strcasecmp((string) $t['engine'], 'InnoDB') !== 0) {
                    $issues[] = ['level' => 'error', 'code' => 'engine', 'params' => ['table' => $n, 'engine' => (string) $t['engine']]];
                }
            }
            $refCols = array_column($ref['columns'], null, 'name');
            $refIndexCols = array_map(static fn ($i) => array_map(static fn ($c) => self::idxCol($c), $i['columns']), $ref['indexes']);
            if (!self::covered($refIndexCols, $remote)) {
                $issues[] = ['level' => 'error', 'code' => 'ref_index', 'params' => ['table' => $refTable, 'columns' => implode(', ', $remote)]];
            }
            foreach ($local as $i => $lc) {
                $rc = $remote[$i] ?? null;
                if ($rc === null || !isset($refCols[$rc])) {
                    $issues[] = ['level' => 'error', 'code' => 'unknown_column', 'params' => ['column' => "$refTable.$rc"]];
                    continue;
                }
                $def = $localDefs[$lc] ?? null;
                $orig = $byName[(string) ($fk['origColumns'][$i] ?? $lc)] ?? null;
                $lType = is_array($def) ? self::typeOf($def) : (string) ($orig['columnType'] ?? '');
                $lColl = is_array($def) ? ($def['collation'] ?? $orig['collation'] ?? $info['table']['collation']) : ($orig['collation'] ?? null);
                $nullable = is_array($def) ? !empty($def['nullable']) : (bool) ($orig['nullable'] ?? false);
                if ($lType === '') {
                    $issues[] = ['level' => 'error', 'code' => 'unknown_column', 'params' => ['column' => $lc]];
                    continue;
                }
                $t = self::fkTypeIssue($lType, $lColl, (string) $refCols[$rc]['columnType'], $refCols[$rc]['collation']);
                if ($t) {
                    $issues[] = ['level' => 'error', 'code' => 'type_' . $t['code'], 'params' => ['column' => $lc, 'local' => $t['local'], 'ref' => $t['ref'], 'refColumn' => "$refTable.$rc"],
                        'fix' => ['column' => $lc, 'columnType' => $refCols[$rc]['columnType'], 'collation' => $refCols[$rc]['collation']]];
                }
                foreach (['onDelete', 'onUpdate'] as $rule) {
                    if (strtoupper((string) ($fk[$rule] ?? '')) === 'SET NULL' && !$nullable) {
                        $issues[] = ['level' => 'error', 'code' => 'set_null', 'params' => ['column' => $lc, 'rule' => $rule === 'onDelete' ? 'ON DELETE' : 'ON UPDATE']];
                    }
                }
            }
            $localIndexCols = array_map(static fn ($i) => array_map(static fn ($c) => self::idxCol($c), $i['columns']), $info['indexes']);
            $origLocal = array_map(static fn ($x, $i) => $x ?? $local[$i], (array) ($fk['origColumns'] ?? []), array_keys((array) ($fk['origColumns'] ?? [])));
            if (!self::covered($localIndexCols, $origLocal ?: $local)) {
                $issues[] = ['level' => 'info', 'code' => 'auto_index', 'params' => ['columns' => implode(', ', $local)]];
            }
            // Orphans: only for columns that already exist with data.
            $existing = array_values(array_filter((array) ($fk['origColumns'] ?? []), static fn ($x) => is_string($x) && isset($byName[$x])));
            if (!array_filter($issues, static fn ($x) => $x['level'] === 'error') && count($existing) === count($local)) {
                $o = $this->orphans($table, $existing, $refTable, $remote);
                if ($o['count'] > 0) {
                    $issues[] = ['level' => 'warn', 'code' => 'orphans', 'params' => $o + ['table' => $table, 'refTable' => $refTable,
                        'nullable' => (bool) array_product(array_map(static fn ($c) => (int) ($byName[$c]['nullable'] ?? 0), $existing))]];
                }
            }
            $out[$id] = $issues;
        }
        return ['results' => $out];
    }

    /** Rows of other tables pointing here (declared + inferred), counted (capped) on demand. */
    public function incomingCounts(string $table): array
    {
        $full = Schema::full($this->db);
        $out = [];
        foreach (Schema::relations($full) as $r) {
            if ($r['to'] !== $table || $r['from'] === $table || count($out) >= 40) {
                continue;
            }
            $n = (int) $this->pdo->query('SELECT COUNT(*) FROM (SELECT 1 FROM ' . Db::ident($r['from']) . ' WHERE ' . Db::ident($r['column']) . ' IS NOT NULL LIMIT 100001) x')->fetchColumn();
            $out[] = $r + ['count' => min($n, 100000), 'more' => $n > 100000];
        }
        return ['incoming' => $out];
    }

    /** Column definition SQL from the structured form (without the name). */
    public function columnSql(array $d): string
    {
        $sql = $this->typeSql($d);
        $type = strtolower((string) ($d['type'] ?? ''));
        $family = self::TYPES[$type];
        return $sql . $this->columnRest($d, $type, $family);
    }

    /**
     * Just the data type (with length, UNSIGNED, charset/collation): also
     * used for routine parameters and return types.
     */
    public function typeSql(array $d): string
    {
        $type = strtolower((string) ($d['type'] ?? ''));
        if (!isset(self::TYPES[$type])) {
            throw new ApiError('bad_type', "Unsupported type: $type", 400, ['name' => $type]);
        }
        $family = self::TYPES[$type];
        $sql = strtoupper($type);
        $len = isset($d['length']) && $d['length'] !== null && $d['length'] !== '' ? (int) $d['length'] : null;
        $scale = isset($d['scale']) && $d['scale'] !== null && $d['scale'] !== '' ? (int) $d['scale'] : null;
        if ($family === 'enum') {
            $values = array_values(array_filter((array) ($d['values'] ?? []), 'is_string'));
            if (!$values) {
                throw new ApiError('bad_type', 'ENUM/SET needs at least one value', 400);
            }
            $sql .= '(' . implode(',', array_map(fn ($v) => $this->q($v), $values)) . ')';
        } elseif ($family === 'char') {
            if ($len === null || $len < 1 || $len > 65535) {
                throw new ApiError('bad_type', "Length required for $type", 400);
            }
            $sql .= "($len)";
        } elseif ($family === 'decimal') {
            $p = max(1, min(65, $len ?? 10));
            $s = max(0, min(30, min($p, $scale ?? 0)));
            $sql .= "($p,$s)";
        } elseif (in_array($family, ['int', 'bit'], true) && $len !== null && $len > 0 && $len <= 255) {
            $sql .= "($len)";
        } elseif ($family === 'time' && $len !== null && $len >= 0 && $len <= 6) {
            $sql .= "($len)";
        } elseif ($family === 'float' && $len !== null && $scale !== null) {
            $sql .= '(' . max(1, min(255, $len)) . ',' . max(0, min(30, $scale)) . ')';
        }
        if (in_array($family, ['int', 'decimal', 'float'], true)) {
            if (!empty($d['unsigned'])) {
                $sql .= ' UNSIGNED';
            }
            if (!empty($d['zerofill'])) {
                $sql .= ' ZEROFILL';
            }
        }
        if (!empty($d['collation']) && in_array($family, ['char', 'text', 'enum'], true)) {
            $coll = (string) $d['collation'];
            $st = $this->pdo->prepare('SELECT CHARACTER_SET_NAME FROM information_schema.COLLATIONS WHERE COLLATION_NAME = ?');
            $st->execute([$coll]);
            $cs = $st->fetchColumn();
            if (!$cs) {
                throw new ApiError('bad_collation', "Unknown collation: $coll", 400, ['name' => $coll]);
            }
            $sql .= ' CHARACTER SET ' . $cs . ' COLLATE ' . $coll; // both from information_schema
        }
        return $sql;
    }

    private function columnRest(array $d, string $type, string $family): string
    {
        $sql = '';
        $generated = $d['generated'] ?? null;
        if (is_array($generated) && trim((string) ($generated['expr'] ?? '')) !== '') {
            $sql .= ' GENERATED ALWAYS AS (' . self::safeExpression((string) $generated['expr']) . ') ' . (!empty($generated['stored']) ? 'STORED' : 'VIRTUAL');
        } else {
            $sql .= !empty($d['nullable']) ? ' NULL' : ' NOT NULL';
            $def = $d['default'] ?? ['kind' => 'none'];
            $kind = is_array($def) ? (string) ($def['kind'] ?? 'none') : 'none';
            if ($kind === 'null') {
                $sql .= ' DEFAULT NULL';
            } elseif ($kind === 'now') {
                if ($family !== 'time' && $type !== 'date') {
                    throw new ApiError('bad_default', 'CURRENT_TIMESTAMP only applies to date/time columns', 400);
                }
                $sql .= $type === 'date' ? ' DEFAULT (CURRENT_DATE)' : ' DEFAULT CURRENT_TIMESTAMP';
            } elseif ($kind === 'value') {
                $v = (string) ($def['value'] ?? '');
                $sql .= ' DEFAULT ' . (in_array($family, ['int', 'decimal', 'float'], true) && is_numeric($v) ? $v + 0 : $this->q($v));
            }
            if (!empty($d['onUpdateNow'])) {
                if (!in_array($type, ['timestamp', 'datetime'], true)) {
                    throw new ApiError('bad_default', 'ON UPDATE CURRENT_TIMESTAMP only applies to TIMESTAMP/DATETIME', 400);
                }
                $sql .= ' ON UPDATE CURRENT_TIMESTAMP';
            }
            if (!empty($d['autoIncrement'])) {
                if ($family !== 'int') {
                    throw new ApiError('bad_type', 'AUTO_INCREMENT needs an integer column', 400);
                }
                $sql .= ' AUTO_INCREMENT';
            }
        }
        if (isset($d['comment']) && (string) $d['comment'] !== '') {
            $sql .= ' COMMENT ' . $this->q(\pmf_substr((string) $d['comment'], 1024));
        }
        return $sql;
    }

    // ------------------------------------------------------------------
    // Build
    // ------------------------------------------------------------------

    /**
     * ALTER TABLE from structured changes.
     *
     * @return array{sql:string, clauses:list<string>}
     */
    public function build(string $table, array $changes): array
    {
        $info = $this->info($table);
        if (!$info['canAlter']) {
            throw new ApiError('cannot_alter', 'This table cannot be altered', 403, ['reason' => $info['reason']]);
        }
        $cols = array_column($info['columns'], null, 'name');
        $idx = array_column($info['indexes'], null, 'name');
        $fks = array_column($info['foreignKeys'], null, 'name');
        $clauses = [];

        // Foreign keys and indexes are dropped first so columns can change.
        foreach ((array) ($changes['foreignKeys'] ?? []) as $c) {
            if (($c['op'] ?? '') === 'drop') {
                $name = (string) ($c['name'] ?? '');
                if (!isset($fks[$name])) {
                    throw new ApiError('unknown_key', "Unknown foreign key: $name", 404, ['name' => $name]);
                }
                $clauses[] = 'DROP FOREIGN KEY ' . Db::ident($name);
            }
        }
        $checkSupport = $this->checkSupport();
        $existingChecks = array_column($info['checks'], null, 'name');
        foreach ((array) ($changes['checks'] ?? []) as $c) {
            if (($c['op'] ?? '') === 'drop') {
                $name = (string) ($c['name'] ?? '');
                if (!isset($existingChecks[$name])) {
                    throw new ApiError('unknown_constraint', "Unknown CHECK: $name", 404, ['name' => $name]);
                }
                $clauses[] = ($checkSupport['flavor'] === 'mariadb' ? 'DROP CONSTRAINT ' : 'DROP CHECK ') . Db::ident($name);
            }
        }
        foreach ((array) ($changes['indexes'] ?? []) as $c) {
            if (($c['op'] ?? '') === 'drop') {
                $name = (string) ($c['name'] ?? '');
                if (!isset($idx[$name])) {
                    throw new ApiError('unknown_index', "Unknown index: $name", 404, ['name' => $name]);
                }
                $clauses[] = $name === 'PRIMARY' ? 'DROP PRIMARY KEY' : 'DROP INDEX ' . Db::ident($name);
            }
        }

        $known = array_keys($cols);
        // Index columns after this ALTER (original minus dropped, renames followed), to know
        // whether a new FK needs an index created for it.
        $droppedIdx = array_map(static fn ($c) => (string) ($c['name'] ?? ''), array_filter((array) ($changes['indexes'] ?? []), static fn ($c) => ($c['op'] ?? '') === 'drop'));
        $renames = [];
        foreach ((array) ($changes['columns'] ?? []) as $c) {
            if (($c['op'] ?? '') === 'modify' && isset($c['def']['name'], $c['name']) && $c['def']['name'] !== $c['name']) {
                $renames[(string) $c['name']] = (string) $c['def']['name'];
            }
        }
        $finalIdx = [];
        foreach ($info['indexes'] as $i) {
            if (!in_array($i['name'], $droppedIdx, true)) {
                $finalIdx[] = array_map(static fn ($c) => $renames[self::idxCol($c)] ?? self::idxCol($c), $i['columns']);
            }
        }
        foreach ((array) ($changes['columns'] ?? []) as $c) {
            $op = (string) ($c['op'] ?? '');
            if ($op === 'drop') {
                $name = (string) ($c['name'] ?? '');
                if (!isset($cols[$name])) {
                    throw new ApiError('unknown_column', "Unknown column: $name", 404, ['name' => $name]);
                }
                $clauses[] = 'DROP COLUMN ' . Db::ident($name);
                continue;
            }
            $def = (array) ($c['def'] ?? []);
            $newName = self::validName($def['name'] ?? '');
            $position = '';
            if (array_key_exists('after', $c)) {
                if ($c['after'] === null) {
                    $position = ' FIRST';
                } elseif (is_string($c['after'])) {
                    $after = self::validName($c['after']);
                    $position = ' AFTER ' . Db::ident($after);
                }
            }
            if ($op === 'add') {
                $clauses[] = 'ADD COLUMN ' . Db::ident($newName) . ' ' . $this->columnSql($def) . $position;
                $known[] = $newName;
            } elseif ($op === 'modify') {
                $name = (string) ($c['name'] ?? '');
                if (!isset($cols[$name])) {
                    throw new ApiError('unknown_column', "Unknown column: $name", 404, ['name' => $name]);
                }
                $clauses[] = ($newName !== $name ? 'CHANGE COLUMN ' . Db::ident($name) . ' ' . Db::ident($newName) : 'MODIFY COLUMN ' . Db::ident($name)) . ' ' . $this->columnSql($def) . $position;
                $known[] = $newName;
            } else {
                throw new ApiError('bad_change', "Unknown column change: $op", 400);
            }
        }

        foreach ((array) ($changes['indexes'] ?? []) as $c) {
            if (($c['op'] ?? '') !== 'add') {
                continue;
            }
            $kind = strtoupper((string) ($c['kind'] ?? 'INDEX'));
            if (!in_array($kind, ['INDEX', 'UNIQUE', 'PRIMARY', 'FULLTEXT', 'SPATIAL'], true)) {
                throw new ApiError('bad_index', "Unknown index kind: $kind", 400);
            }
            $parts = [];
            foreach ((array) ($c['columns'] ?? []) as $colSpec) {
                if (!is_string($colSpec) || !preg_match('~^(.+?)(?:\((\d{1,4})\))?(?:\s+(ASC|DESC))?$~i', $colSpec, $m)) {
                    throw new ApiError('bad_index', 'Bad index column', 400);
                }
                $colName = self::validName($m[1]);
                if (!in_array($colName, $known, true)) {
                    throw new ApiError('unknown_column', "Unknown column: $colName", 404, ['name' => $colName]);
                }
                $desc = strtoupper($m[3] ?? '') === 'DESC';
                if ($desc && in_array($kind, ['FULLTEXT', 'SPATIAL'], true)) {
                    throw new ApiError('bad_index', 'FULLTEXT and SPATIAL indexes have no order', 400);
                }
                $parts[] = Db::ident($colName) . (isset($m[2]) && $m[2] !== '' ? '(' . (int) $m[2] . ')' : '') . ($desc ? ' DESC' : '');
            }
            if (!$parts) {
                throw new ApiError('bad_index', 'An index needs columns', 400);
            }
            $cols_sql = '(' . implode(', ', $parts) . ')';
            $finalIdx[] = array_map(static fn ($x) => self::idxCol((string) $x), (array) $c['columns']);
            if ($kind === 'PRIMARY') {
                $clauses[] = 'ADD PRIMARY KEY ' . $cols_sql;
            } else {
                $iname = self::validName($c['name'] ?? '');
                $hidden = '';
                if (!empty($c['invisible'])) {
                    $mode = $this->indexSupport((string) $info['table']['engine'])['invisible'];
                    if ($mode === null) {
                        throw new ApiError('invisible_unsupported', 'This server has no invisible indexes', 400);
                    }
                    $hidden = $mode === 'ignored' ? ' IGNORED' : ' INVISIBLE';
                }
                $clauses[] = 'ADD ' . ($kind === 'INDEX' ? 'INDEX' : $kind . ' INDEX') . ' ' . Db::ident($iname) . ' ' . $cols_sql . $hidden;
            }
        }
        // Visible / invisible (MySQL 8 INVISIBLE, MariaDB 10.6 IGNORED) without rebuilding the index.
        foreach ((array) ($changes['indexes'] ?? []) as $c) {
            if (($c['op'] ?? '') !== 'visibility') {
                continue;
            }
            $name = (string) ($c['name'] ?? '');
            if (!isset($idx[$name]) || $name === 'PRIMARY') {
                throw new ApiError('unknown_index', "Unknown index: $name", 404, ['name' => $name]);
            }
            $mode = $this->indexSupport((string) $info['table']['engine'])['invisible'];
            if ($mode === null) {
                throw new ApiError('invisible_unsupported', 'This server has no invisible indexes', 400);
            }
            $hide = !empty($c['invisible']);
            $clauses[] = 'ALTER INDEX ' . Db::ident($name) . ($mode === 'ignored' ? ($hide ? ' IGNORED' : ' NOT IGNORED') : ($hide ? ' INVISIBLE' : ' VISIBLE'));
        }

        foreach ((array) ($changes['foreignKeys'] ?? []) as $c) {
            if (($c['op'] ?? '') !== 'add') {
                continue;
            }
            $name = self::validName($c['name'] ?? '');
            $refTable = self::validName($c['refTable'] ?? '');
            $st = $this->pdo->prepare('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?');
            $st->execute([$this->db, $refTable]);
            if (!$st->fetchColumn()) {
                throw new ApiError('unknown_table', "Unknown table: $refTable", 404, ['name' => $refTable]);
            }
            $refCols = array_column((new self($this->pdo, $this->db))->info($refTable)['columns'], 'name');
            $local = array_map(static fn ($x) => self::validName($x), (array) ($c['columns'] ?? []));
            $remote = array_map(static fn ($x) => self::validName($x), (array) ($c['refColumns'] ?? []));
            foreach ($local as $l) {
                if (!in_array($l, $known, true)) {
                    throw new ApiError('unknown_column', "Unknown column: $l", 404, ['name' => $l]);
                }
            }
            foreach ($remote as $r) {
                if (!in_array($r, $refCols, true)) {
                    throw new ApiError('unknown_column', "Unknown column: $refTable.$r", 404, ['name' => "$refTable.$r"]);
                }
            }
            if (!$local || count($local) !== count($remote)) {
                throw new ApiError('bad_key', 'Foreign key columns do not match', 400);
            }
            $rule = static function (mixed $v): string {
                $v = strtoupper((string) $v);
                return in_array($v, ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'], true) ? $v : 'RESTRICT';
            };
            if (in_array($name, $info['constraintNames'], true) && !in_array($name, array_map(static fn ($c) => (string) ($c['name'] ?? ''), array_filter((array) ($changes['foreignKeys'] ?? []), static fn ($c) => ($c['op'] ?? '') === 'drop')), true)) {
                throw new ApiError('duplicate_constraint', "A constraint named $name already exists in this database", 400, ['name' => $name]);
            }
            // The FK needs an index on its columns: create it in the same ALTER, before the constraint.
            if (!self::covered($finalIdx, $local)) {
                $clauses[] = 'ADD INDEX ' . Db::ident(substr('idx_' . $name, 0, 64)) . ' (' . implode(', ', array_map([Db::class, 'ident'], $local)) . ')';
                $finalIdx[] = $local;
            }
            $clauses[] = 'ADD CONSTRAINT ' . Db::ident($name) . ' FOREIGN KEY (' . implode(', ', array_map([Db::class, 'ident'], $local)) . ') REFERENCES '
                . Db::ident($refTable) . ' (' . implode(', ', array_map([Db::class, 'ident'], $remote)) . ') ON DELETE ' . $rule($c['onDelete'] ?? '') . ' ON UPDATE ' . $rule($c['onUpdate'] ?? '');
        }

        foreach ((array) ($changes['checks'] ?? []) as $c) {
            if (($c['op'] ?? '') !== 'add') {
                continue;
            }
            if (!$checkSupport['supported']) {
                throw new ApiError('check_unsupported', 'This server does not enforce CHECK constraints', 400, $checkSupport);
            }
            $clauses[] = 'ADD CONSTRAINT ' . Db::ident(self::validName($c['name'] ?? '')) . ' CHECK (' . self::safeExpression((string) ($c['expr'] ?? '')) . ')';
        }

        $opts = (array) ($changes['table'] ?? []);
        if (array_key_exists('comment', $opts)) {
            $clauses[] = 'COMMENT = ' . $this->q(\pmf_substr((string) $opts['comment'], 2048));
        }
        if (!empty($opts['engine'])) {
            $engine = (string) $opts['engine'];
            if (!in_array($engine, $info['engines'], true)) {
                throw new ApiError('bad_engine', "Unknown engine: $engine", 400, ['name' => $engine]);
            }
            $clauses[] = 'ENGINE = ' . $engine;
        }
        if (!empty($opts['collation'])) {
            $coll = (string) $opts['collation'];
            $st = $this->pdo->prepare('SELECT CHARACTER_SET_NAME FROM information_schema.COLLATIONS WHERE COLLATION_NAME = ?');
            $st->execute([$coll]);
            $cs = $st->fetchColumn();
            if (!$cs) {
                throw new ApiError('bad_collation', "Unknown collation: $coll", 400, ['name' => $coll]);
            }
            $clauses[] = 'DEFAULT CHARACTER SET ' . $cs . ' COLLATE ' . $coll;
        }
        if (isset($opts['autoIncrement']) && $opts['autoIncrement'] !== null && $opts['autoIncrement'] !== '') {
            $clauses[] = 'AUTO_INCREMENT = ' . max(1, (int) $opts['autoIncrement']);
        }
        if (!empty($opts['rename']) && $opts['rename'] !== $table) {
            $clauses[] = 'RENAME TO ' . Db::ident(self::validName($opts['rename']));
        }

        if (!$clauses) {
            throw new ApiError('no_changes', 'Nothing to change', 400);
        }
        return [
            'sql' => 'ALTER TABLE ' . Db::ident($table) . "\n  " . implode(",\n  ", $clauses) . ';',
            'clauses' => $clauses,
        ];
    }

    /**
     * Data checks for risky changes. Each count stops at 10 000 rows so a
     * preview stays quick on big tables.
     *
     * @return list<array{code:string, column?:string, count:int, more:bool, params?:array}>
     */
    public function warnings(string $table, array $changes): array
    {
        $info = $this->info($table);
        $cols = array_column($info['columns'], null, 'name');
        $out = [];
        $count = function (string $where, array $params = []) use ($table): array {
            $st = $this->pdo->prepare('SELECT COUNT(*) FROM (SELECT 1 FROM ' . Db::ident($table) . " WHERE $where LIMIT 10001) x");
            $st->execute($params);
            $n = (int) $st->fetchColumn();
            return [min($n, 10000), $n > 10000];
        };
        foreach ((array) ($changes['columns'] ?? []) as $c) {
            $op = (string) ($c['op'] ?? '');
            $name = (string) ($c['name'] ?? '');
            if ($op === 'drop' && isset($cols[$name])) {
                [$n, $more] = $count(Db::ident($name) . ' IS NOT NULL');
                if ($n > 0) {
                    $out[] = ['code' => 'drop_data', 'column' => $name, 'count' => $n, 'more' => $more];
                }
            }
            if ($op !== 'modify' || !isset($cols[$name])) {
                continue;
            }
            $old = $cols[$name];
            $def = (array) ($c['def'] ?? []);
            $type = strtolower((string) ($def['type'] ?? ''));
            $family = self::TYPES[$type] ?? '';
            $oldFamily = self::TYPES[strtolower((string) $old['dataType'])] ?? '';
            if ($family === 'char' && isset($def['length']) && $old['charLength'] !== null && (int) $def['length'] < (int) $old['charLength']) {
                [$n, $more] = $count('CHAR_LENGTH(' . Db::ident($name) . ') > ?', [(int) $def['length']]);
                if ($n > 0) {
                    $out[] = ['code' => 'truncate', 'column' => $name, 'count' => $n, 'more' => $more, 'params' => ['length' => (int) $def['length']]];
                }
            }
            if (empty($def['nullable']) && $old['nullable'] && empty($def['generated']['expr'])) {
                [$n, $more] = $count(Db::ident($name) . ' IS NULL');
                if ($n > 0) {
                    $out[] = ['code' => 'nulls', 'column' => $name, 'count' => $n, 'more' => $more];
                }
            }
            if ($family !== '' && $oldFamily !== '' && $family !== $oldFamily && !($family === 'text' && $oldFamily === 'char')) {
                [$n, $more] = $count(Db::ident($name) . ' IS NOT NULL');
                if ($n > 0) {
                    $out[] = ['code' => 'convert', 'column' => $name, 'count' => $n, 'more' => $more, 'params' => ['from' => $old['columnType'], 'to' => $type]];
                }
            }
        }
        foreach ((array) ($changes['indexes'] ?? []) as $c) {
            if (($c['op'] ?? '') !== 'add' || !in_array(strtoupper((string) ($c['kind'] ?? '')), ['UNIQUE', 'PRIMARY'], true)) {
                continue;
            }
            $names = [];
            foreach ((array) ($c['columns'] ?? []) as $spec) {
                $n = self::idxCol((string) $spec);
                if (isset($cols[$n])) {
                    $names[] = Db::ident($n);
                }
            }
            if ($names) {
                $st = $this->pdo->query('SELECT COUNT(*) FROM (SELECT 1 FROM ' . Db::ident($table) . ' GROUP BY ' . implode(', ', $names) . ' HAVING COUNT(*) > 1 LIMIT 10001) x');
                $n = (int) $st->fetchColumn();
                if ($n > 0) {
                    $out[] = ['code' => 'duplicates', 'count' => min($n, 10000), 'more' => $n > 10000, 'params' => ['columns' => implode(', ', (array) $c['columns'])]];
                }
            }
        }
        return $out;
    }

    public function preview(string $table, array $changes): array
    {
        $built = $this->build($table, $changes);
        $warnings = $this->warnings($table, $changes);
        $adds = array_values(array_filter((array) ($changes['checks'] ?? []), static fn ($c) => ($c['op'] ?? '') === 'add'));
        foreach ($this->checkViolations($table, array_map(static fn ($c) => ['id' => (string) ($c['name'] ?? ''), 'expr' => (string) ($c['expr'] ?? '')], $adds)) as $name => $r) {
            if (!empty($r['ok']) && $r['count'] > 0) {
                $warnings[] = ['code' => 'check_violations', 'column' => $name, 'count' => $r['count'], 'more' => $r['more'], 'params' => ['name' => $name]];
            }
        }
        // FK checks always run here, so the review shows them whatever the section did.
        $defs = [];
        foreach ((array) ($changes['columns'] ?? []) as $c) {
            if (in_array($c['op'] ?? '', ['add', 'modify'], true) && is_array($c['def'] ?? null) && isset($c['def']['name'])) {
                $defs[(string) $c['def']['name']] = $c['def'];
            }
        }
        $fkAdds = array_values(array_filter((array) ($changes['foreignKeys'] ?? []), static fn ($c) => ($c['op'] ?? '') === 'add'));
        if ($fkAdds) {
            $res = $this->fkChecks($table, array_map(static fn ($c) => ['id' => (string) ($c['name'] ?? '')] + $c, $fkAdds), $defs)['results'];
            foreach ($fkAdds as $c) {
                $name = (string) ($c['name'] ?? '');
                $fix = (string) ($c['fix'] ?? '');
                foreach ($res[$name] ?? [] as $i) {
                    if ($i['level'] === 'error') {
                        $warnings[] = ['code' => 'fk_issue', 'column' => $name, 'issue' => $i['code'], 'params' => ($i['params'] ?? []) + ['fk' => $name], 'blocking' => true];
                    } elseif ($i['code'] === 'orphans') {
                        $warnings[] = ['code' => 'fk_orphans', 'column' => $name, 'count' => $i['params']['count'], 'more' => $i['params']['more'],
                            'params' => $i['params'] + ['fk' => $name], 'fix' => $fix ?: null, 'blocking' => $fix === ''];
                    }
                }
            }
        }
        return ['sql' => $built['sql'], 'warnings' => $warnings];
    }

    public function apply(string $table, array $changes): array
    {
        $built = $this->build($table, $changes);
        $started = microtime(true);
        $noCheck = false;
        $nullified = 0;
        $info = $this->info($table);
        $byName = array_column($info['columns'], null, 'name');
        foreach ((array) ($changes['foreignKeys'] ?? []) as $c) {
            if (($c['op'] ?? '') !== 'add') {
                continue;
            }
            $fix = (string) ($c['fix'] ?? '');
            if ($fix === 'nocheck') {
                $noCheck = true;
            } elseif ($fix === 'nullify') {
                // "Set NULL on those rows": only existing, nullable columns; one UPDATE per FK.
                $local = array_map(static fn ($x) => self::validName($x), (array) ($c['origColumns'] ?? []));
                $remote = array_map(static fn ($x) => self::validName($x), (array) ($c['refColumns'] ?? []));
                $refTable = self::validName($c['refTable'] ?? '');
                $on = [];
                foreach ($local as $i => $lc) {
                    if (!isset($byName[$lc]) || !$byName[$lc]['nullable'] || !isset($remote[$i])) {
                        throw new ApiError('bad_fix', "Column $lc can't be set to NULL", 400, ['name' => $lc]);
                    }
                    $on[] = 'r.' . Db::ident($remote[$i]) . ' = l.' . Db::ident($lc);
                }
                $set = implode(', ', array_map(static fn ($lc) => 'l.' . Db::ident($lc) . ' = NULL', $local));
                $nullified += (int) $this->pdo->exec('UPDATE ' . Db::ident($table) . ' l LEFT JOIN ' . Db::ident($refTable) . ' r ON ' . implode(' AND ', $on)
                    . ' SET ' . $set . ' WHERE l.' . Db::ident($local[0]) . ' IS NOT NULL AND r.' . Db::ident($remote[0]) . ' IS NULL');
            }
        }
        try {
            if ($noCheck) {
                $this->pdo->exec('SET SESSION foreign_key_checks = 0');
            }
            $this->pdo->exec(rtrim($built['sql'], ';'));
        } catch (\PDOException $e) {
            throw $this->explainFailure($table, $changes, $e, $nullified);
        } finally {
            if ($noCheck) {
                $this->pdo->exec('SET SESSION foreign_key_checks = 1');
            }
        }
        return ['ok' => true, 'sql' => $built['sql'], 'timeMs' => round((microtime(true) - $started) * 1000)];
    }

    /**
     * A failed ALTER changes nothing (MySQL applies it as a whole or not at
     * all). Say which change failed and why, with data read afterwards.
     */
    private function explainFailure(string $table, array $changes, \PDOException $e, int $nullified): ApiError
    {
        $base = Sql::errorFromPdo($e);
        $d = $base->details;
        $errno = (int) ($d['mysqlCode'] ?? 0);
        $change = self::failedChange($errno, (string) ($d['serverMessage'] ?? ''), $changes);
        $cause = null;
        $params = [];
        try {
            if ($change && $change['kind'] === 'fk' && $errno === 1452) {
                foreach ((array) ($changes['foreignKeys'] ?? []) as $c) {
                    if (($c['op'] ?? '') === 'add' && strcasecmp((string) $c['name'], $change['name']) === 0) {
                        $cols = (array) ($c['columns'] ?? []);
                        $local = [];
                        foreach ($cols as $i => $col) {
                            $local[] = self::validName((string) ($c['origColumns'][$i] ?? $col));
                        }
                        $refTable = self::validName($c['refTable'] ?? '');
                        $remote = array_map(static fn ($x) => self::validName($x), (array) ($c['refColumns'] ?? []));
                        $cause = 'fk_orphans';
                        $params = $this->orphans($table, $local, $refTable, $remote) + ['table' => $table, 'refTable' => $refTable, 'fk' => $change['name']];
                    }
                }
            } elseif ($change && $change['kind'] === 'check') {
                foreach ((array) ($changes['checks'] ?? []) as $c) {
                    if (($c['op'] ?? '') === 'add' && strcasecmp((string) $c['name'], $change['name']) === 0) {
                        $r = $this->checkViolations($table, [['id' => 'x', 'expr' => (string) ($c['expr'] ?? '')]])['x'] ?? [];
                        if (!empty($r['ok'])) {
                            $cause = 'check_violations';
                            $params = ['count' => $r['count'], 'more' => $r['more'], 'name' => $change['name']];
                        }
                    }
                }
            }
        } catch (\Throwable) {
            // Best effort: the server message is still there.
        }
        return new ApiError('alter_failed', $base->getMessage(), 400, $d + [
            'change' => $change,
            'cause' => $cause,
            'params' => $params,
            'nullified' => $nullified,
        ]);
    }
}
