<?php
declare(strict_types=1);

namespace PhpMyFlow;

use PDO;

/**
 * Database tools (phase C): maintenance, server-wide text search, bulk
 * table editor, test data. Every operation works on one table per request,
 * so the browser shows progress and can cancel between tables.
 */
final class Tools
{
    public function __construct(private PDO $pdo)
    {
    }

    public static function forSession(): self
    {
        return new self(Db::pdo());
    }

    private function mariadb(): bool
    {
        return stripos((string) $this->pdo->getAttribute(PDO::ATTR_SERVER_VERSION), 'mariadb') !== false;
    }

    private function t(string $db, string $table): string
    {
        return Db::ident($db) . '.' . Db::ident($table);
    }

    // ------------------------------------------------------------------
    // Maintenance
    // ------------------------------------------------------------------

    /** OPTIMIZE / ANALYZE / CHECK / REPAIR / CHECKSUM on one table; the server's result rows. */
    public function maintenance(string $db, string $table, string $op, ?string $option): array
    {
        $ddl = new Ddl($this->pdo);
        if ($ddl->tableType($db, $table) !== 'BASE TABLE') {
            throw new ApiError('not_a_table', 'Only tables', 400);
        }
        $op = strtoupper($op);
        $opt = strtoupper((string) $option);
        $st = $this->pdo->prepare('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?');
        $st->execute([$db, $table]);
        $engine = (string) $st->fetchColumn();
        $sql = match ($op) {
            'OPTIMIZE' => 'OPTIMIZE TABLE ' . $this->t($db, $table),
            'ANALYZE' => 'ANALYZE TABLE ' . $this->t($db, $table),
            'CHECK' => 'CHECK TABLE ' . $this->t($db, $table) . (in_array($opt, ['QUICK', 'FAST', 'MEDIUM', 'EXTENDED', 'CHANGED'], true) ? " $opt" : ''),
            'REPAIR' => in_array(strtolower($engine), ['myisam', 'aria', 'archive', 'csv'], true)
                ? 'REPAIR TABLE ' . $this->t($db, $table) . ($opt === 'QUICK' || $opt === 'EXTENDED' ? " $opt" : '')
                : throw new ApiError('repair_engine', "REPAIR only works on MyISAM, Aria, ARCHIVE and CSV ($engine)", 400, ['engine' => $engine]),
            'CHECKSUM' => 'CHECKSUM TABLE ' . $this->t($db, $table) . ($opt === 'QUICK' || $opt === 'EXTENDED' ? " $opt" : ''),
            default => throw new ApiError('bad_option', "Unknown operation: $op", 400),
        };
        $started = microtime(true);
        $rows = $this->pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
        $ms = round((microtime(true) - $started) * 1000);
        if ($op === 'CHECKSUM') {
            $v = $rows[0]['Checksum'] ?? null;
            return ['status' => $v === null ? 'warning' : 'ok', 'messages' => [$v === null ? 'NULL' : (string) $v], 'ms' => $ms, 'engine' => $engine];
        }
        // Msg_type: status, error, info, note, warning.
        $level = 'ok';
        $msgs = [];
        foreach ($rows as $r) {
            $type = strtolower((string) ($r['Msg_type'] ?? ''));
            $text = (string) ($r['Msg_text'] ?? '');
            if ($type === 'error') {
                $level = 'error';
            } elseif ($type === 'warning' && $level !== 'error') {
                $level = 'warning';
            }
            $msgs[] = ($type && $type !== 'status' ? "$type: " : '') . $text;
        }
        return ['status' => $level, 'messages' => $msgs, 'ms' => $ms, 'engine' => $engine];
    }

    // ------------------------------------------------------------------
    // Search
    // ------------------------------------------------------------------

    /**
     * Operator and parameter for a search mode. The text is always literal:
     * LIKE wildcards are escaped; regex is passed with an inline case flag.
     *
     * @return array{0:string,1:string}
     */
    public static function matchFor(string $mode, string $q, bool $caseSensitive = false): array
    {
        if ($q === '' || strlen($q) > 500) {
            throw new ApiError('bad_search', 'Search text must be 1 to 500 characters', 400);
        }
        $like = addcslashes($q, '%_\\');
        return match ($mode) {
            'contains' => ['LIKE', "%$like%"],
            'starts' => ['LIKE', "$like%"],
            'exact' => ['=', $q],
            'regex' => ['REGEXP', ($caseSensitive ? '(?-i)' : '(?i)') . $q],
            default => throw new ApiError('bad_search', "Unknown mode: $mode", 400),
        };
    }

    /**
     * WHERE condition for one column. Case-sensitive LIKE/= compares bytes;
     * with "all columns", non-text columns are compared as text.
     */
    public static function condition(string $ident, string $op, bool $caseSensitive, bool $cast): string
    {
        $col = $cast ? "CAST($ident AS CHAR)" : $ident;
        if ($op === 'REGEXP') {
            return "$col REGEXP ?";
        }
        if ($caseSensitive) {
            $col = "CAST($ident AS BINARY)";
            return $op === 'LIKE' ? "$col LIKE CAST(? AS BINARY) ESCAPE '\\\\'" : "$col = CAST(? AS BINARY)";
        }
        return $op === 'LIKE' ? "$col LIKE ? ESCAPE '\\\\'" : "$col = ?";
    }

    private const TEXT_TYPES = ['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set', 'json'];
    private const OTHER_TYPES = ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'float', 'double', 'date', 'datetime', 'timestamp', 'time', 'year', 'bit'];

    /** Tables to search: databases (null = every non-system one) and optionally some tables. */
    public function searchPlan(?array $dbs, ?array $tables): array
    {
        if ($dbs === null) {
            $dbs = array_values(array_filter(array_column(Schema::databases(), 'name'), static fn ($d) => !in_array(strtolower($d), Ddl::SYSTEM_DBS, true)));
        }
        $out = [];
        foreach ($dbs as $db) {
            Schema::assertDatabaseExists((string) $db);
            $st = $this->pdo->prepare("SELECT t.TABLE_NAME AS name, t.TABLE_ROWS AS approxRows,
                                              SUM(c.DATA_TYPE IN ('char','varchar','tinytext','text','mediumtext','longtext','enum','set','json')) AS textCols
                                       FROM information_schema.TABLES t JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
                                       WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE' GROUP BY t.TABLE_NAME, t.TABLE_ROWS ORDER BY t.TABLE_NAME");
            $st->execute([$db]);
            foreach ($st->fetchAll() as $r) {
                if ($tables !== null && !in_array($r['name'], $tables, true)) {
                    continue;
                }
                $out[] = ['db' => (string) $db, 'table' => $r['name'], 'approxRows' => (int) $r['approxRows'], 'textCols' => (int) $r['textCols']];
            }
        }
        return ['tables' => $out];
    }

    /** Matches per column in one table, one scan, with a time limit. */
    public function searchTable(string $db, string $table, string $q, string $mode, bool $caseSensitive, bool $allColumns, int $timeoutMs): array
    {
        (new Ddl($this->pdo))->tableType($db, $table);
        [$op, $param] = self::matchFor($mode, $q, $caseSensitive);
        $st = $this->pdo->prepare('SELECT COLUMN_NAME AS name, DATA_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION');
        $st->execute([$db, $table]);
        $cols = [];
        foreach ($st->fetchAll() as $c) {
            $t = strtolower($c['type']);
            if (in_array($t, self::TEXT_TYPES, true)) {
                $cols[] = ['name' => $c['name'], 'cast' => in_array($t, ['enum', 'set', 'json'], true)];
            } elseif ($allColumns && in_array($t, self::OTHER_TYPES, true)) {
                $cols[] = ['name' => $c['name'], 'cast' => true];
            }
        }
        if (!$cols) {
            return ['matches' => [], 'timedOut' => false, 'ms' => 0, 'skipped' => true];
        }
        $sums = [];
        $params = [];
        foreach ($cols as $i => $c) {
            $sums[] = 'SUM(' . self::condition(Db::ident($c['name']), $op, $caseSensitive, $c['cast']) . ") AS c$i";
            $params[] = $param;
        }
        $timeoutMs = max(500, min(120000, $timeoutMs));
        $select = 'SELECT ' . implode(', ', $sums) . ' FROM ' . $this->t($db, $table);
        $sql = $this->mariadb()
            ? 'SET STATEMENT max_statement_time=' . round($timeoutMs / 1000, 3) . ' FOR ' . $select
            : 'SELECT /*+ MAX_EXECUTION_TIME(' . $timeoutMs . ') */ ' . substr($select, 7);
        $started = microtime(true);
        try {
            $st = $this->pdo->prepare($sql);
            $st->execute($params);
            $row = $st->fetch(PDO::FETCH_NUM) ?: [];
        } catch (\PDOException $e) {
            $code = (int) ($e->errorInfo[1] ?? 0);
            if (in_array($code, [3024, 1969, 1028], true)) {
                return ['matches' => [], 'timedOut' => true, 'ms' => round((microtime(true) - $started) * 1000)];
            }
            if ($op === 'REGEXP' && in_array($code, [3685, 3686, 3692, 3693, 3695, 3696, 1139], true)) {
                throw new ApiError('bad_regex', (string) ($e->errorInfo[2] ?? 'Invalid regular expression'), 400);
            }
            throw $e;
        }
        $matches = [];
        foreach ($cols as $i => $c) {
            $n = (int) ($row[$i] ?? 0);
            if ($n > 0) {
                $matches[] = ['column' => $c['name'], 'count' => $n];
            }
        }
        return ['matches' => $matches, 'timedOut' => false, 'ms' => round((microtime(true) - $started) * 1000)];
    }

    // ------------------------------------------------------------------
    // Bulk table editor
    // ------------------------------------------------------------------

    /**
     * Statements for one table: one ALTER (engine, charset/collation with or
     * without converting the data, comment) and a RENAME to move it.
     *
     * @param array{engine?:?string, collation?:?string, charset?:?string, convert?:bool, comment?:?string, moveTo?:?string} $c
     * @return list<string>
     */
    public static function bulkStatements(string $db, string $table, array $c, callable $quote): array
    {
        $parts = [];
        if (!empty($c['engine'])) {
            $parts[] = 'ENGINE=' . $c['engine'];
        }
        if (!empty($c['collation'])) {
            $parts[] = (!empty($c['convert']) ? 'CONVERT TO CHARACTER SET ' : 'DEFAULT CHARACTER SET ') . $c['charset'] . ' COLLATE ' . $c['collation'];
        }
        if (array_key_exists('comment', $c) && $c['comment'] !== null) {
            $parts[] = 'COMMENT=' . $quote(\pmf_substr((string) $c['comment'], 2048));
        }
        $out = [];
        $name = Db::ident($db) . '.' . Db::ident($table);
        if ($parts) {
            $out[] = "ALTER TABLE $name " . implode(', ', $parts);
        }
        if (!empty($c['moveTo']) && $c['moveTo'] !== $db) {
            $out[] = "RENAME TABLE $name TO " . Db::ident((string) $c['moveTo']) . '.' . Db::ident($table);
        }
        return $out;
    }

    /** Validate the changes against information_schema (engine, collation, target database). */
    private function bulkChanges(string $db, array $c): array
    {
        $out = ['convert' => !empty($c['convert'])];
        if (!empty($c['engine'])) {
            $st = $this->pdo->prepare("SELECT ENGINE FROM information_schema.ENGINES WHERE ENGINE = ? AND SUPPORT IN ('YES','DEFAULT')");
            $st->execute([(string) $c['engine']]);
            $out['engine'] = $st->fetchColumn() ?: throw new ApiError('bad_engine', 'Unknown engine', 400);
        }
        if (!empty($c['collation'])) {
            $st = $this->pdo->prepare('SELECT CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLLATIONS WHERE COLLATION_NAME = ?');
            $st->execute([(string) $c['collation']]);
            $r = $st->fetch(PDO::FETCH_NUM) ?: throw new ApiError('bad_collation', 'Unknown collation', 400);
            [$out['charset'], $out['collation']] = $r;
        }
        if (array_key_exists('comment', $c) && $c['comment'] !== null) {
            $out['comment'] = (string) $c['comment'];
        }
        if (!empty($c['moveTo']) && $c['moveTo'] !== $db) {
            Schema::assertDatabaseExists((string) $c['moveTo']);
            if (in_array(strtolower((string) $c['moveTo']), Ddl::SYSTEM_DBS, true)) {
                throw new ApiError('system_database', 'System databases cannot be changed here', 403);
            }
            $out['moveTo'] = (string) $c['moveTo'];
        }
        return $out;
    }

    /** Per table: statements, size and a rough time (a rebuild copies the table). */
    public function bulkPlan(string $db, array $tables, array $changes): array
    {
        $c = $this->bulkChanges($db, $changes);
        $rebuild = !empty($c['engine']) || (!empty($c['collation']) && $c['convert']);
        $out = [];
        foreach ($tables as $table) {
            $table = (string) $table;
            if ((new Ddl($this->pdo))->tableType($db, $table) !== 'BASE TABLE') {
                continue;
            }
            $st = $this->pdo->prepare('SELECT DATA_LENGTH + INDEX_LENGTH, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?');
            $st->execute([$db, $table]);
            [$bytes, $engine, $coll] = $st->fetch(PDO::FETCH_NUM);
            if (!empty($c['moveTo'])) {
                $ex = $this->pdo->prepare('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?');
                $ex->execute([$c['moveTo'], $table]);
                if ($ex->fetchColumn()) {
                    throw new ApiError('table_exists', "$table already exists in {$c['moveTo']}", 409, ['name' => $table]);
                }
            }
            $out[] = [
                'table' => $table, 'engine' => $engine, 'collation' => $coll, 'bytes' => (int) $bytes,
                'statements' => self::bulkStatements($db, $table, $c, fn ($s) => $this->pdo->quote($s)),
                // ~25 MB/s for a table copy is a cautious figure for shared hosting.
                'seconds' => $rebuild ? (int) ceil(((int) $bytes) / (25 * 1048576)) : 0,
            ];
        }
        return ['tables' => $out, 'rebuild' => $rebuild];
    }

    public function bulkApply(string $db, string $table, array $changes): array
    {
        $c = $this->bulkChanges($db, $changes);
        (new Ddl($this->pdo))->tableType($db, $table);
        $started = microtime(true);
        $done = [];
        foreach (self::bulkStatements($db, $table, $c, fn ($s) => $this->pdo->quote($s)) as $sql) {
            $this->pdo->exec($sql);
            $done[] = $sql;
        }
        return ['ok' => true, 'sql' => $done, 'ms' => round((microtime(true) - $started) * 1000)];
    }

    // ------------------------------------------------------------------
    // Test data
    // ------------------------------------------------------------------

    /** Columns with a guessed strategy, foreign keys (declared and inferred) and UNIQUE flags. */
    /**
     * min/max per column from a CHECK expression: "`rating` between 1 and 5",
     * "price >= 0", "qty > 0 and qty <= 100". Anything else is ignored.
     *
     * @return array<string, array{min?:float|int, max?:float|int}>
     */
    public static function checkRanges(string $expr): array
    {
        $out = [];
        $col = '`?(\w+)`?';
        $num = '(-?\d+(?:\.\d+)?)';
        if (preg_match_all("~$col\s+between\s+$num\s+and\s+$num~i", $expr, $m, PREG_SET_ORDER)) {
            foreach ($m as $x) {
                $out[$x[1]] = ['min' => $x[2] + 0, 'max' => $x[3] + 0];
            }
        }
        if (preg_match_all("~$col\s*(>=|>|<=|<)\s*$num~", $expr, $m, PREG_SET_ORDER)) {
            foreach ($m as $x) {
                $v = $x[3] + 0;
                $step = is_int($v) ? 1 : 0.01;
                match ($x[2]) {
                    '>=' => $out[$x[1]]['min'] = $v,
                    '>' => $out[$x[1]]['min'] = $v + $step,
                    '<=' => $out[$x[1]]['max'] = $v,
                    '<' => $out[$x[1]]['max'] = $v - $step,
                };
            }
        }
        return $out;
    }

    public function genPlan(string $db, string $table): array
    {
        if ((new Ddl($this->pdo))->tableType($db, $table) !== 'BASE TABLE') {
            throw new ApiError('not_a_table', 'Only tables', 400);
        }
        $editor = TableEditor::forSession($db);
        $managed = $editor->managedBy();
        $st = $this->pdo->prepare('SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE = "YES" AS nullable, EXTRA AS extra,
                                          CHARACTER_MAXIMUM_LENGTH AS length, NUMERIC_PRECISION AS `precision`, NUMERIC_SCALE AS scale, COLUMN_DEFAULT AS def
                                   FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION');
        $st->execute([$db, $table]);
        $cols = $st->fetchAll();
        $st = $this->pdo->prepare('SELECT DISTINCT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND NON_UNIQUE = 0');
        $st->execute([$db, $table]);
        $unique = array_flip($st->fetchAll(PDO::FETCH_COLUMN));
        $fks = [];
        $st = $this->pdo->prepare('SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
                                   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL AND REFERENCED_TABLE_SCHEMA = ?');
        $st->execute([$db, $table, $db]);
        foreach ($st->fetchAll(PDO::FETCH_NUM) as [$c, $rt, $rc]) {
            $fks[$c] = ['table' => $rt, 'column' => $rc, 'kind' => 'declared'];
        }
        try {
            foreach (Schema::inferRelations(Schema::full($db)) as $r) {
                if ($r['from'] === $table && !isset($fks[$r['column']])) {
                    $fks[$r['column']] = ['table' => $r['to'], 'column' => $r['toColumn'], 'kind' => 'inferred'];
                }
            }
        } catch (\Throwable) {
            // inference is a bonus
        }
        $plan = [];
        foreach ($cols as $c) {
            $values = [];
            if (preg_match('~^(enum|set)\((.*)\)$~is', (string) $c['columnType'], $m)) {
                preg_match_all("~'((?:[^']|'')*)'~", $m[2], $vv);
                $values = array_map(static fn ($v) => str_replace("''", "'", $v), $vv[1]);
            }
            $plan[] = [
                'name' => $c['name'], 'dataType' => strtolower($c['dataType']), 'columnType' => $c['columnType'], 'nullable' => (bool) $c['nullable'],
                'auto' => stripos((string) $c['extra'], 'auto_increment') !== false, 'generated' => Schema::isGenerated($c['extra']),
                'unique' => isset($unique[$c['name']]), 'length' => $c['length'] !== null ? (int) min(65535, (int) $c['length']) : null,
                'precision' => $c['precision'] !== null ? (int) $c['precision'] : null, 'scale' => $c['scale'] !== null ? (int) $c['scale'] : null,
                'unsigned' => stripos((string) $c['columnType'], 'unsigned') !== false, 'values' => $values, 'fk' => $fks[$c['name']] ?? null,
            ];
        }
        // Simple CHECK constraints become ranges (rating BETWEEN 1 AND 5, price >= 0...).
        $ranges = [];
        foreach ($editor->checks($table) as $chk) {
            foreach (self::checkRanges((string) $chk['expr']) as $col => $r) {
                $ranges[$col] = ($ranges[$col] ?? []) + $r;
            }
        }
        foreach ($plan as &$p) {
            if (isset($ranges[$p['name']])) {
                $p['options'] = ($p['options'] ?? []) + $ranges[$p['name']];
            }
        }
        unset($p);
        $plan = DataGen::plan($plan);
        $rows = (int) ($this->pdo->query('SELECT TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ' . $this->pdo->quote($db) . ' AND TABLE_NAME = ' . $this->pdo->quote($table))->fetchColumn());
        return ['columns' => $plan, 'managedBy' => $managed, 'approxRows' => $rows];
    }

    /**
     * Generate rows (preview) or insert them (one batch). The client sends
     * the plan back with its strategy choices; names and FKs are validated
     * again here.
     */
    public function generate(string $db, string $table, array $columns, int $count, int $start, int $seed, string $token, bool $insert): array
    {
        $fresh = $this->genPlan($db, $table);
        if ($insert && $fresh['managedBy']) {
            throw new ApiError('managed_app', 'Test data is not generated in databases managed by an app', 403, ['app' => $fresh['managedBy']]);
        }
        $known = array_column($fresh['columns'], null, 'name');
        $strategies = ['fk', 'enum', 'set', 'bool', 'int', 'amount', 'date', 'datetime', 'time', 'year', 'uuid', 'json', 'email', 'phone', 'url', 'first_name', 'last_name', 'name', 'city', 'country', 'address', 'company', 'code', 'title', 'sentence', 'word', 'null'];
        $plan = [];
        foreach ($columns as $c) {
            $name = (string) ($c['name'] ?? '');
            if (!isset($known[$name]) || !empty($c['skip'])) {
                continue;
            }
            $p = $known[$name];
            $s = (string) ($c['strategy'] ?? $p['strategy']);
            if (!in_array($s, $strategies, true) || ($s === 'fk' && empty($p['fk']))) {
                throw new ApiError('bad_option', "Unknown generator for $name", 400, ['name' => $name]);
            }
            $p['strategy'] = $s;
            $p['options'] = array_intersect_key((array) ($c['options'] ?? []), array_flip(['min', 'max', 'from', 'to', 'nullPct', 'truePct']));
            if ($s === 'int' && $p['unique']) {
                $max = $this->pdo->query('SELECT MAX(' . Db::ident($name) . ') FROM ' . $this->t($db, $table))->fetchColumn();
                $p['options']['startAt'] = ((int) $max) + 1;
            }
            $plan[] = $p;
        }
        if (!$plan) {
            throw new ApiError('gen_no_columns', 'No columns to fill', 400);
        }
        // Existing ids for foreign keys (random when the table is not huge).
        $pools = [];
        foreach ($plan as $p) {
            if ($p['strategy'] !== 'fk' || empty($p['fk'])) {
                continue;
            }
            $key = $p['fk']['table'] . '.' . $p['fk']['column'];
            if (isset($pools[$key])) {
                continue;
            }
            (new Ddl($this->pdo))->tableType($db, $p['fk']['table']);
            $col = Db::ident($p['fk']['column']);
            $rows = (int) $this->pdo->query('SELECT TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ' . $this->pdo->quote($db) . ' AND TABLE_NAME = ' . $this->pdo->quote($p['fk']['table']))->fetchColumn();
            $pools[$key] = $this->pdo->query("SELECT $col FROM " . $this->t($db, $p['fk']['table']) . " WHERE $col IS NOT NULL" . ($rows < 200000 ? ' ORDER BY RAND()' : '') . ' LIMIT 2000')->fetchAll(PDO::FETCH_COLUMN);
        }
        $count = max(1, min($insert ? 2000 : 20, $count));
        $gen = new DataGen($seed, preg_replace('~[^a-z0-9]~', '', strtolower($token)) ?: 'x');
        $rows = $gen->rows($plan, $count, $start, $pools);
        $names = array_column($plan, 'name');
        if (!$insert) {
            return ['columns' => $names, 'rows' => $rows];
        }
        // Prepared multi-row INSERT, under the placeholder limit.
        $per = max(1, min($count, intdiv(60000, count($names))));
        $list = implode(', ', array_map([Db::class, 'ident'], $names));
        $one = '(' . implode(', ', array_fill(0, count($names), '?')) . ')';
        $inserted = 0;
        $this->pdo->beginTransaction();
        try {
            foreach (array_chunk($rows, $per) as $chunk) {
                $st = $this->pdo->prepare('INSERT INTO ' . $this->t($db, $table) . " ($list) VALUES " . implode(', ', array_fill(0, count($chunk), $one)));
                $st->execute(array_merge(...$chunk));
                $inserted += $st->rowCount();
            }
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
        return ['inserted' => $inserted];
    }
}
