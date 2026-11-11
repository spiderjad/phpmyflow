<?php
declare(strict_types=1);

namespace PhpMyFlow;

use PDO;

/**
 * Database-level DDL from structured specs (never SQL from the client):
 * databases, new tables, rename, copy (structure, rows in batches, FKs),
 * truncate and drop, plus the impact shown before destructive actions.
 * Names are validated (new ones) or checked against information_schema
 * (existing ones) before being quoted with Db::ident().
 */
final class Ddl
{
    public const SYSTEM_DBS = ['information_schema', 'mysql', 'performance_schema', 'sys'];

    public function __construct(private PDO $pdo)
    {
    }

    public static function forSession(): self
    {
        return new self(Db::pdo());
    }

    // ------------------------------------------------------------------
    // Lookups and validation
    // ------------------------------------------------------------------

    /** Character sets with their collations (for the create/edit database forms). */
    public function charsets(): array
    {
        $rows = $this->pdo->query('SELECT c.CHARACTER_SET_NAME AS cs, c.DEFAULT_COLLATE_NAME AS def, c.DESCRIPTION AS descr, co.COLLATION_NAME AS coll
                                   FROM information_schema.CHARACTER_SETS c JOIN information_schema.COLLATIONS co ON co.CHARACTER_SET_NAME = c.CHARACTER_SET_NAME
                                   ORDER BY c.CHARACTER_SET_NAME, co.COLLATION_NAME')->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $out[$r['cs']] ??= ['name' => $r['cs'], 'description' => $r['descr'], 'default' => $r['def'], 'collations' => []];
            $out[$r['cs']]['collations'][] = $r['coll'];
        }
        $st = $this->pdo->query('SELECT @@character_set_server AS cs, @@collation_server AS coll')->fetch();
        return ['charsets' => array_values($out), 'serverCharset' => $st['cs'], 'serverCollation' => $st['coll']];
    }

    /** @return array{0:string,1:string} charset and collation, both from information_schema */
    private function charsetCollation(?string $charset, ?string $collation): array
    {
        if ($collation) {
            $st = $this->pdo->prepare('SELECT CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLLATIONS WHERE COLLATION_NAME = ?');
            $st->execute([$collation]);
            $r = $st->fetch(PDO::FETCH_NUM);
            if (!$r || ($charset && strcasecmp($charset, $r[0]) !== 0)) {
                throw new ApiError('bad_collation', "Unknown collation: $collation", 400, ['name' => $collation]);
            }
            return [$r[0], $r[1]];
        }
        $st = $this->pdo->prepare('SELECT CHARACTER_SET_NAME, DEFAULT_COLLATE_NAME FROM information_schema.CHARACTER_SETS WHERE CHARACTER_SET_NAME = ?');
        $st->execute([(string) $charset]);
        $r = $st->fetch(PDO::FETCH_NUM);
        if (!$r) {
            throw new ApiError('bad_charset', "Unknown character set: $charset", 400, ['name' => (string) $charset]);
        }
        return [$r[0], $r[1]];
    }

    public function databaseExists(string $db): bool
    {
        $st = $this->pdo->prepare('SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?');
        $st->execute([$db]);
        return (bool) $st->fetchColumn();
    }

    /** Existing table or view, exact name from information_schema. */
    public function tableType(string $db, string $table): string
    {
        $st = $this->pdo->prepare('SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?');
        $st->execute([$db, $table]);
        $t = $st->fetchColumn();
        if (!$t) {
            throw new ApiError('unknown_table', "Unknown table: $table", 404, ['name' => $table]);
        }
        return (string) $t;
    }

    private function assertNewTable(string $db, string $name): void
    {
        TableEditor::validName($name);
        $st = $this->pdo->prepare('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?');
        $st->execute([$db, $name]);
        if ($st->fetchColumn()) {
            throw new ApiError('table_exists', "Table already exists: $name", 409, ['name' => $name]);
        }
    }

    private function assertUserDb(string $db): void
    {
        Schema::assertDatabaseExists($db);
        if (in_array(strtolower($db), self::SYSTEM_DBS, true)) {
            throw new ApiError('system_database', 'System databases cannot be changed here', 403, ['name' => $db]);
        }
    }

    private function t(string $db, string $table): string
    {
        return Db::ident($db) . '.' . Db::ident($table);
    }

    // ------------------------------------------------------------------
    // Databases
    // ------------------------------------------------------------------

    public function createDatabase(string $name, ?string $charset, ?string $collation): array
    {
        TableEditor::validName($name);
        if ($this->databaseExists($name)) {
            throw new ApiError('database_exists', "Database already exists: $name", 409, ['name' => $name]);
        }
        [$cs, $coll] = $this->charsetCollation($charset, $collation);
        $sql = 'CREATE DATABASE ' . Db::ident($name) . " CHARACTER SET $cs COLLATE $coll";
        $this->pdo->exec($sql);
        return ['ok' => true, 'sql' => $sql . ';'];
    }

    public function alterDatabase(string $db, ?string $charset, ?string $collation): array
    {
        $this->assertUserDb($db);
        [$cs, $coll] = $this->charsetCollation($charset, $collation);
        $sql = 'ALTER DATABASE ' . Db::ident($db) . " CHARACTER SET $cs COLLATE $coll";
        $this->pdo->exec($sql);
        return ['ok' => true, 'sql' => $sql . ';'];
    }

    public function dropDatabase(string $db): array
    {
        $this->assertUserDb($db);
        $sql = 'DROP DATABASE ' . Db::ident($db);
        $this->pdo->exec($sql);
        return ['ok' => true, 'sql' => $sql . ';'];
    }

    /** What a database drop takes with it, and which other databases point into it. */
    public function databaseImpact(string $db): array
    {
        Schema::assertDatabaseExists($db);
        $st = $this->pdo->prepare("SELECT SUM(TABLE_TYPE = 'BASE TABLE') AS tables, SUM(TABLE_TYPE = 'VIEW') AS views,
                                          COALESCE(SUM(TABLE_ROWS), 0) AS rows, COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH), 0) AS bytes
                                   FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?");
        $st->execute([$db]);
        $r = $st->fetch();
        $st = $this->pdo->prepare('SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?');
        $st->execute([$db]);
        $routines = (int) $st->fetchColumn();
        $st = $this->pdo->prepare('SELECT DISTINCT TABLE_SCHEMA AS db, TABLE_NAME AS `table`, REFERENCED_TABLE_NAME AS ref FROM information_schema.KEY_COLUMN_USAGE
                                   WHERE REFERENCED_TABLE_SCHEMA = ? AND TABLE_SCHEMA <> ? ORDER BY 1, 2 LIMIT 50');
        $st->execute([$db, $db]);
        return [
            'tables' => (int) $r['tables'], 'views' => (int) $r['views'], 'rows' => (int) $r['rows'], 'bytes' => (int) $r['bytes'],
            'routines' => $routines, 'referencedFrom' => $st->fetchAll(),
        ];
    }

    /** The database overview (HeidiSQL's right panel): summary plus every table. */
    public function overview(string $db): array
    {
        Schema::assertDatabaseExists($db);
        $st = $this->pdo->prepare('SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?');
        $st->execute([$db]);
        $schema = $st->fetch();
        $st = $this->pdo->prepare('SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_ROWS AS approxRows,
                                          DATA_LENGTH AS dataBytes, INDEX_LENGTH AS indexBytes, DATA_FREE AS freeBytes,
                                          TABLE_COLLATION AS collation, CREATE_TIME AS created, UPDATE_TIME AS updated, TABLE_COMMENT AS comment
                                   FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME');
        $st->execute([$db]);
        $tables = $st->fetchAll();
        foreach ($tables as &$t) {
            foreach (['approxRows', 'dataBytes', 'indexBytes', 'freeBytes'] as $k) {
                $t[$k] = $t[$k] === null ? null : (int) $t[$k];
            }
        }
        unset($t);
        $count = function (string $sql) use ($db): int {
            try {
                $st = $this->pdo->prepare($sql);
                $st->execute([$db]);
                return (int) $st->fetchColumn();
            } catch (\PDOException) {
                return 0;
            }
        };
        return [
            'db' => $db,
            'charset' => $schema['charset'] ?? null,
            'collation' => $schema['collation'] ?? null,
            'tables' => $tables,
            'counts' => [
                'tables' => count(array_filter($tables, static fn ($t) => $t['type'] === 'BASE TABLE')),
                'views' => count(array_filter($tables, static fn ($t) => $t['type'] === 'VIEW')),
                'procedures' => $count("SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'"),
                'functions' => $count("SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION'"),
                'triggers' => $count('SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?'),
                'events' => $count('SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?'),
            ],
            'bytes' => array_sum(array_map(static fn ($t) => (int) $t['dataBytes'] + (int) $t['indexBytes'], $tables)),
        ];
    }

    // ------------------------------------------------------------------
    // Tables
    // ------------------------------------------------------------------

    /**
     * CREATE TABLE from a structured spec (columns as the structure editor
     * sends them, primary key, indexes, foreign keys, options).
     */
    public function createTable(string $db, array $spec): array
    {
        $this->assertUserDb($db);
        $name = (string) ($spec['name'] ?? '');
        $this->assertNewTable($db, $name);
        $editor = TableEditor::forSession($db);
        $cols = array_values(array_filter((array) ($spec['columns'] ?? []), 'is_array'));
        if (!$cols) {
            throw new ApiError('no_columns', 'A table needs at least one column', 400);
        }
        $names = [];
        $lines = [];
        foreach ($cols as $c) {
            $cn = TableEditor::validName($c['name'] ?? '');
            if (isset($names[strtolower($cn)])) {
                throw new ApiError('duplicate_column', "Duplicate column: $cn", 400, ['name' => $cn]);
            }
            $names[strtolower($cn)] = $cn;
            $lines[] = '  ' . Db::ident($cn) . ' ' . $editor->columnSql($c);
        }
        $colList = static function (array $list) use ($names): string {
            $out = [];
            foreach ($list as $c) {
                $key = strtolower((string) $c);
                if (!isset($names[$key])) {
                    throw new ApiError('unknown_column', "Unknown column: $c", 400, ['name' => (string) $c]);
                }
                $out[] = Db::ident($names[$key]);
            }
            if (!$out) {
                throw new ApiError('bad_index', 'An index needs columns', 400);
            }
            return implode(', ', $out);
        };
        $primary = array_values(array_filter((array) ($spec['primary'] ?? []), 'is_string'));
        if ($primary) {
            $lines[] = '  PRIMARY KEY (' . $colList($primary) . ')';
        }
        foreach ((array) ($spec['indexes'] ?? []) as $i) {
            $kind = strtoupper((string) ($i['kind'] ?? 'INDEX'));
            $kw = ['INDEX' => 'KEY', 'UNIQUE' => 'UNIQUE KEY', 'FULLTEXT' => 'FULLTEXT KEY'][$kind] ?? null;
            if ($kw === null) {
                throw new ApiError('bad_index', "Unknown index type: $kind", 400);
            }
            $lines[] = "  $kw " . Db::ident(TableEditor::validName($i['name'] ?? '')) . ' (' . $colList((array) ($i['columns'] ?? [])) . ')';
        }
        foreach ((array) ($spec['foreignKeys'] ?? []) as $f) {
            $ref = (string) ($f['refTable'] ?? '');
            if ($ref !== $name) {
                $this->tableType($db, $ref);
            }
            $refCols = array_map(static fn ($c) => Db::ident(TableEditor::validName($c)), (array) ($f['refColumns'] ?? []));
            $rules = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'];
            $onDelete = strtoupper((string) ($f['onDelete'] ?? 'RESTRICT'));
            $onUpdate = strtoupper((string) ($f['onUpdate'] ?? 'CASCADE'));
            if (!in_array($onDelete, $rules, true) || !in_array($onUpdate, $rules, true) || !$refCols) {
                throw new ApiError('bad_fk', 'Invalid foreign key', 400);
            }
            $lines[] = '  CONSTRAINT ' . Db::ident(TableEditor::validName($f['name'] ?? '')) . ' FOREIGN KEY (' . $colList((array) ($f['columns'] ?? [])) . ') REFERENCES '
                . Db::ident($ref) . ' (' . implode(', ', $refCols) . ") ON DELETE $onDelete ON UPDATE $onUpdate";
        }
        $opts = [];
        $engine = (string) ($spec['engine'] ?? 'InnoDB');
        $st = $this->pdo->prepare("SELECT ENGINE FROM information_schema.ENGINES WHERE ENGINE = ? AND SUPPORT IN ('YES','DEFAULT')");
        $st->execute([$engine]);
        if (!($engine = $st->fetchColumn())) {
            throw new ApiError('bad_engine', 'Unknown engine', 400);
        }
        $opts[] = "ENGINE=$engine";
        if (!empty($spec['collation'])) {
            [$cs, $coll] = $this->charsetCollation(null, (string) $spec['collation']);
            $opts[] = "DEFAULT CHARSET=$cs COLLATE=$coll";
        }
        if (!empty($spec['comment'])) {
            $opts[] = 'COMMENT=' . $this->pdo->quote(\pmf_substr((string) $spec['comment'], 2048));
        }
        $sql = 'CREATE TABLE ' . Db::ident($name) . " (\n" . implode(",\n", $lines) . "\n) " . implode(' ', $opts);
        if (!empty($spec['dryRun'])) {
            return ['sql' => $sql . ';'];
        }
        Db::useDatabase($db);
        $this->pdo->exec($sql);
        return ['ok' => true, 'sql' => $sql . ';'];
    }

    public function renameTable(string $db, string $from, string $to): array
    {
        $this->assertUserDb($db);
        $this->tableType($db, $from);
        $this->assertNewTable($db, $to);
        $sql = 'RENAME TABLE ' . $this->t($db, $from) . ' TO ' . $this->t($db, $to);
        $this->pdo->exec($sql);
        return ['ok' => true, 'sql' => $sql . ';'];
    }

    /** Rows, size and incoming references of each table (before truncate or drop). */
    public function tablesImpact(string $db, array $tables): array
    {
        Schema::assertDatabaseExists($db);
        $out = [];
        foreach ($tables as $table) {
            $table = (string) $table;
            $type = $this->tableType($db, $table);
            $st = $this->pdo->prepare('SELECT TABLE_ROWS, DATA_LENGTH + INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?');
            $st->execute([$db, $table]);
            [$rows, $bytes] = $st->fetch(PDO::FETCH_NUM);
            $exact = null;
            if ($type === 'BASE TABLE' && (int) $rows < 500000) {
                $exact = (int) $this->pdo->query('SELECT COUNT(*) FROM ' . $this->t($db, $table))->fetchColumn();
            }
            $st = $this->pdo->prepare('SELECT DISTINCT TABLE_SCHEMA AS db, TABLE_NAME AS `table`, CONSTRAINT_NAME AS fk FROM information_schema.KEY_COLUMN_USAGE
                                       WHERE REFERENCED_TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME = ? AND NOT (TABLE_SCHEMA = ? AND TABLE_NAME = ?)');
            $st->execute([$db, $table, $db, $table]);
            $refs = array_values(array_filter($st->fetchAll(), static fn ($r) => !($r['db'] === $db && in_array($r['table'], $tables, true))));
            $out[] = ['table' => $table, 'type' => $type, 'rows' => $exact ?? (int) $rows, 'exact' => $exact !== null, 'bytes' => (int) $bytes, 'referencedBy' => $refs];
        }
        return ['tables' => $out];
    }

    /**
     * TRUNCATE or DROP several tables. Tables referenced by FKs from outside
     * the selection need $ignoreFks (their rows would point to nothing).
     */
    public function emptyOrDrop(string $db, array $tables, bool $drop, bool $ignoreFks): array
    {
        $this->assertUserDb($db);
        $impact = $this->tablesImpact($db, $tables)['tables'];
        $blocked = array_values(array_filter($impact, static fn ($t) => $t['referencedBy']));
        if ($blocked && !$ignoreFks) {
            throw new ApiError('referenced', 'Other tables reference these tables', 409, ['tables' => array_column($blocked, 'table')]);
        }
        $done = [];
        $this->pdo->exec('SET SESSION foreign_key_checks = 0');
        try {
            foreach ($impact as $t) {
                if ($drop) {
                    $this->pdo->exec(($t['type'] === 'VIEW' ? 'DROP VIEW ' : 'DROP TABLE ') . $this->t($db, $t['table']));
                } else {
                    if ($t['type'] === 'VIEW') {
                        continue;
                    }
                    $this->pdo->exec('TRUNCATE TABLE ' . $this->t($db, $t['table']));
                }
                $done[] = $t['table'];
            }
        } catch (\PDOException $e) {
            $err = Sql::errorFromPdo($e);
            throw new ApiError($err->errorCode, $err->getMessage(), 400, $err->details + ['done' => $done]);
        } finally {
            $this->pdo->exec('SET SESSION foreign_key_checks = 1');
        }
        return ['ok' => true, 'done' => $done];
    }

    /** SHOW CREATE for a table or a view. */
    public function createCode(string $db, string $table): string
    {
        $type = $this->tableType($db, $table);
        $row = $this->pdo->query(($type === 'VIEW' ? 'SHOW CREATE VIEW ' : 'SHOW CREATE TABLE ') . $this->t($db, $table))->fetch(PDO::FETCH_NUM);
        return (string) $row[1] . ';';
    }

    // ------------------------------------------------------------------
    // Copy table: structure, then rows in batches (progress), then FKs
    // ------------------------------------------------------------------

    /** Primary key columns in order (empty when there is none). */
    public function primaryKey(string $db, string $table): array
    {
        $st = $this->pdo->prepare("SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION");
        $st->execute([$db, $table]);
        return $st->fetchAll(PDO::FETCH_COLUMN);
    }

    /** Columns that can be written (generated columns are computed). */
    public function writableColumns(string $db, string $table): array
    {
        $st = $this->pdo->prepare('SELECT COLUMN_NAME AS name, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION');
        $st->execute([$db, $table]);
        return array_values(array_map(static fn ($c) => $c['name'], array_filter($st->fetchAll(), static fn ($c) => !Schema::isGenerated($c['extra']))));
    }

    public function copyStructure(string $db, string $table, string $targetDb, string $newName, bool $indexes): array
    {
        if ($this->tableType($db, $table) !== 'BASE TABLE') {
            throw new ApiError('not_a_table', 'Only tables can be copied', 400);
        }
        $this->assertUserDb($targetDb);
        $this->assertNewTable($targetDb, $newName);
        $sql = ['CREATE TABLE ' . $this->t($targetDb, $newName) . ' LIKE ' . $this->t($db, $table)];
        $this->pdo->exec($sql[0]);
        if (!$indexes) {
            $st = $this->pdo->prepare("SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY'");
            $st->execute([$targetDb, $newName]);
            $drops = array_map(static fn ($i) => 'DROP INDEX ' . Db::ident($i), $st->fetchAll(PDO::FETCH_COLUMN));
            if ($drops) {
                $sql[] = 'ALTER TABLE ' . $this->t($targetDb, $newName) . ' ' . implode(', ', $drops);
                $this->pdo->exec(end($sql));
            }
        }
        $st = $this->pdo->prepare('SELECT TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?');
        $st->execute([$db, $table]);
        return ['ok' => true, 'sql' => implode(";\n", $sql) . ';', 'pk' => $this->primaryKey($db, $table), 'approxRows' => (int) $st->fetchColumn()];
    }

    /**
     * Copy up to $batch rows after $after (primary key values), in key order.
     * Tables without a primary key are copied in one statement.
     */
    public function copyRows(string $db, string $table, string $targetDb, string $newName, ?array $after, int $batch): array
    {
        $this->tableType($db, $table);
        $this->tableType($targetDb, $newName);
        $cols = $this->writableColumns($db, $table);
        $target = array_flip($this->writableColumns($targetDb, $newName));
        $cols = array_values(array_filter($cols, static fn ($c) => isset($target[$c])));
        $list = implode(', ', array_map([Db::class, 'ident'], $cols));
        $pk = $this->primaryKey($db, $table);
        $insert = 'INSERT INTO ' . $this->t($targetDb, $newName) . " ($list) SELECT $list FROM " . $this->t($db, $table);
        if (!$pk) {
            $n = $this->pdo->exec($insert);
            return ['copied' => (int) $n, 'next' => null, 'done' => true];
        }
        $batch = max(100, min(50000, $batch));
        $pkList = implode(', ', array_map([Db::class, 'ident'], $pk));
        $tuple = count($pk) > 1 ? "($pkList)" : $pkList;
        $marks = count($pk) > 1 ? '(' . implode(', ', array_fill(0, count($pk), '?')) . ')' : '?';
        $where = [];
        $params = [];
        if ($after !== null) {
            if (count($after) !== count($pk)) {
                throw new ApiError('bad_cursor', 'Bad cursor', 400);
            }
            $where[] = "$tuple > $marks";
            $params = array_values($after);
        }
        // Upper bound of this batch: the key of its last row.
        $st = $this->pdo->prepare("SELECT $pkList FROM " . $this->t($db, $table) . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . " ORDER BY $pkList LIMIT 1 OFFSET " . ($batch - 1));
        $st->execute($params);
        $upto = $st->fetch(PDO::FETCH_NUM) ?: null;
        if ($upto) {
            $where[] = "$tuple <= $marks";
            $params = array_merge($params, $upto);
        }
        $st = $this->pdo->prepare($insert . ($where ? ' WHERE ' . implode(' AND ', $where) : ''));
        $st->execute($params);
        return ['copied' => $st->rowCount(), 'next' => $upto, 'done' => $upto === null];
    }

    /**
     * Recreate the source table's foreign keys on the copy. With $remap,
     * references into the source database point to $targetDb instead
     * (copying a whole database).
     */
    public function copyForeignKeys(string $db, string $table, string $targetDb, string $newName, bool $remap): array
    {
        $this->tableType($db, $table);
        $this->tableType($targetDb, $newName);
        $st = $this->pdo->prepare('SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS col, k.REFERENCED_TABLE_SCHEMA AS refDb, k.REFERENCED_TABLE_NAME AS refTable,
                                          k.REFERENCED_COLUMN_NAME AS refCol, r.DELETE_RULE AS onDelete, r.UPDATE_RULE AS onUpdate
                                   FROM information_schema.KEY_COLUMN_USAGE k
                                   JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
                                   WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION');
        $st->execute([$db, $table]);
        $fks = [];
        foreach ($st->fetchAll() as $r) {
            $fks[$r['name']] ??= $r + ['cols' => [], 'refCols' => []];
            $fks[$r['name']]['cols'][] = $r['col'];
            $fks[$r['name']]['refCols'][] = $r['refCol'];
        }
        if (!$fks) {
            return ['ok' => true, 'sql' => ''];
        }
        // Constraint names are unique per database: keep them when copying to another
        // database, otherwise derive new ones from the new table name.
        $used = array_flip($this->pdo->query('SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ' . $this->pdo->quote($targetDb))->fetchAll(PDO::FETCH_COLUMN));
        $clauses = [];
        foreach ($fks as $name => $f) {
            $new = $name;
            if (isset($used[$new])) {
                $base = substr('fk_' . $newName . '_' . implode('_', $f['cols']), 0, 60);
                $new = $base;
                for ($i = 2; isset($used[$new]); $i++) {
                    $new = substr($base, 0, 60 - strlen((string) $i)) . '_' . $i;
                }
            }
            $used[$new] = true;
            $refDb = $remap && $f['refDb'] === $db ? $targetDb : $f['refDb'];
            $refTable = $remap && $f['refDb'] === $db && $f['refTable'] === $table ? $newName : $f['refTable'];
            $clauses[] = 'ADD CONSTRAINT ' . Db::ident($new) . ' FOREIGN KEY (' . implode(', ', array_map([Db::class, 'ident'], $f['cols'])) . ') REFERENCES '
                . $this->t($refDb, $refTable) . ' (' . implode(', ', array_map([Db::class, 'ident'], $f['refCols'])) . ') ON DELETE ' . $f['onDelete'] . ' ON UPDATE ' . $f['onUpdate'];
        }
        $sql = 'ALTER TABLE ' . $this->t($targetDb, $newName) . "\n  " . implode(",\n  ", $clauses);
        $this->pdo->exec($sql);
        return ['ok' => true, 'sql' => $sql . ';'];
    }

    /** View copy (copy database): its CREATE without DEFINER, in the target database. */
    public function copyView(string $db, string $view, string $targetDb): array
    {
        if ($this->tableType($db, $view) !== 'VIEW') {
            throw new ApiError('not_a_view', 'Not a view', 400);
        }
        $this->assertUserDb($targetDb);
        $create = Export::viewSql($this->createCode($db, $view));
        Db::useDatabase($targetDb);
        $this->pdo->exec(rtrim($create, ';'));
        return ['ok' => true];
    }
}
