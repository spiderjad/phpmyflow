<?php
declare(strict_types=1);

namespace PhpMyFlow;

use PDO;

/**
 * Views, stored procedures and functions, triggers and events.
 *
 * The DDL is built here from structured specs (names validated, options from
 * whitelists, types through TableEditor::typeSql). The one free part is the
 * body the user writes (SELECT of a view, routine/trigger/event body): it is
 * shown in the review and executed as written, as one statement.
 *
 * Replacing an object never leaves it missing on a failure: MariaDB uses
 * CREATE OR REPLACE; on MySQL the new definition is first created under a
 * temporary name (validates it), then the old one is swapped, and if the
 * final CREATE fails the original definition is restored.
 */
final class Objects
{
    public const KINDS = ['VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT'];
    private const DATA_ACCESS = ['CONTAINS SQL', 'NO SQL', 'READS SQL DATA', 'MODIFIES SQL DATA'];
    private const UNITS = ['SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'MINUTE_SECOND', 'HOUR_MINUTE', 'DAY_HOUR', 'YEAR_MONTH'];

    public function __construct(private PDO $pdo, private string $db)
    {
    }

    public static function forSession(string $db): self
    {
        Db::useDatabase($db);
        return new self(Db::pdo(), $db);
    }

    private function mariadb(): bool
    {
        return stripos((string) $this->pdo->getAttribute(PDO::ATTR_SERVER_VERSION), 'mariadb') !== false;
    }

    // ------------------------------------------------------------------
    // DDL builders (pure, tested in tests/php/ObjectsDdlTest.php)
    // ------------------------------------------------------------------

    private static function pick(mixed $v, array $allowed, string $default): string
    {
        $v = strtoupper(trim((string) ($v ?? $default)));
        if (!in_array($v, $allowed, true)) {
            throw new ApiError('bad_option', "Invalid option: $v", 400, ['name' => $v]);
        }
        return $v;
    }

    /** Body as the user wrote it, without DELIMITER lines or a trailing delimiter. */
    public static function cleanBody(string $body): string
    {
        $delims = [';'];
        $lines = [];
        foreach (preg_split('~\R~', $body) as $line) {
            if (preg_match('~^\s*delimiter\s+(\S+)\s*$~i', $line, $m)) {
                $delims[] = $m[1];
                continue;
            }
            $lines[] = $line;
        }
        $b = trim(implode("\n", $lines));
        foreach (array_unique([...array_reverse($delims), '//', '$$', ';;']) as $d) {
            if ($d !== '' && str_ends_with($b, $d)) {
                $b = rtrim(substr($b, 0, -strlen($d)));
                break;
            }
        }
        if ($b === '') {
            throw new ApiError('empty_body', 'The body is empty', 400);
        }
        return $b;
    }

    public static function viewSql(array $s): string
    {
        $name = Db::ident(TableEditor::validName($s['name'] ?? ''));
        $body = self::cleanBody((string) ($s['body'] ?? ''));
        if (!preg_match('~^\s*(\(\s*)*(SELECT|WITH|VALUES|TABLE)\b~i', $body)) {
            throw new ApiError('view_body', 'A view is a SELECT', 400);
        }
        $sql = 'CREATE ' . (!empty($s['orReplace']) ? 'OR REPLACE ' : '');
        if (!empty($s['algorithm'])) {
            $sql .= 'ALGORITHM=' . self::pick($s['algorithm'], ['UNDEFINED', 'MERGE', 'TEMPTABLE'], 'UNDEFINED') . ' ';
        }
        if (!empty($s['security'])) {
            $sql .= 'SQL SECURITY ' . self::pick($s['security'], ['DEFINER', 'INVOKER'], 'DEFINER') . ' ';
        }
        $sql .= "VIEW $name AS $body";
        $check = self::pick($s['checkOption'] ?? 'NONE', ['NONE', 'CASCADED', 'LOCAL'], 'NONE');
        if ($check !== 'NONE') {
            $sql .= " WITH $check CHECK OPTION";
        }
        return $sql;
    }

    /** 'user'@'host' (quoted the MySQL way) or an ApiError. */
    private static function definer(string $d): string
    {
        if (!preg_match("~^[`']?([^`'@\\s]{1,80})[`']?@[`']?([^`'@\\s]{1,255})[`']?$~", trim($d), $m)) {
            throw new ApiError('bad_definer', 'Invalid DEFINER', 400);
        }
        return "'{$m[1]}'@'{$m[2]}'";
    }

    /**
     * @param callable(array):string $type renders a parameter / return type
     * @param callable(string):string $quote quotes a string literal
     */
    public static function routineSql(array $s, callable $type, callable $quote): string
    {
        $kind = self::pick($s['kind'] ?? '', ['PROCEDURE', 'FUNCTION'], 'PROCEDURE');
        $name = Db::ident(TableEditor::validName($s['name'] ?? ''));
        $params = [];
        $seen = [];
        foreach ((array) ($s['params'] ?? []) as $p) {
            $pn = TableEditor::validName($p['name'] ?? '');
            if (isset($seen[strtolower($pn)])) {
                throw new ApiError('duplicate_param', "Duplicate parameter: $pn", 400, ['name' => $pn]);
            }
            $seen[strtolower($pn)] = true;
            $mode = self::pick($p['mode'] ?? 'IN', ['IN', 'OUT', 'INOUT'], 'IN');
            if ($kind === 'FUNCTION' && $mode !== 'IN') {
                throw new ApiError('bad_option', 'Function parameters are IN only', 400, ['name' => $mode]);
            }
            $params[] = ($kind === 'PROCEDURE' ? "$mode " : '') . Db::ident($pn) . ' ' . $type((array) ($p['type'] ?? []));
        }
        $sql = 'CREATE ' . (!empty($s['orReplace']) ? 'OR REPLACE ' : '') . (!empty($s['definer']) ? 'DEFINER=' . self::definer((string) $s['definer']) . ' ' : '');
        $sql .= "$kind $name(" . implode(', ', $params) . ')';
        if ($kind === 'FUNCTION') {
            if (!is_array($s['returns'] ?? null)) {
                throw new ApiError('no_returns', 'A function needs a return type', 400);
            }
            $sql .= ' RETURNS ' . $type($s['returns']);
        }
        if (!empty($s['comment'])) {
            $sql .= "\n  COMMENT " . $quote(\pmf_substr((string) $s['comment'], 1024));
        }
        $sql .= "\n  " . (!empty($s['deterministic']) ? 'DETERMINISTIC' : 'NOT DETERMINISTIC');
        $sql .= "\n  " . self::pick($s['dataAccess'] ?? 'CONTAINS SQL', self::DATA_ACCESS, 'CONTAINS SQL');
        $sql .= "\n  SQL SECURITY " . self::pick($s['security'] ?? 'DEFINER', ['DEFINER', 'INVOKER'], 'DEFINER');
        return $sql . "\n" . self::cleanBody((string) ($s['body'] ?? ''));
    }

    public static function triggerSql(array $s): string
    {
        $name = Db::ident(TableEditor::validName($s['name'] ?? ''));
        $table = Db::ident(TableEditor::validName($s['table'] ?? ''));
        $timing = self::pick($s['timing'] ?? '', ['BEFORE', 'AFTER'], 'BEFORE');
        $event = self::pick($s['event'] ?? '', ['INSERT', 'UPDATE', 'DELETE'], 'INSERT');
        $sql = 'CREATE ' . (!empty($s['orReplace']) ? 'OR REPLACE ' : '') . (!empty($s['definer']) ? 'DEFINER=' . self::definer((string) $s['definer']) . ' ' : '');
        $sql .= "TRIGGER $name $timing $event ON $table FOR EACH ROW";
        $order = $s['order'] ?? null;
        if (is_array($order) && !empty($order['other'])) {
            $sql .= ' ' . self::pick($order['kind'] ?? '', ['FOLLOWS', 'PRECEDES'], 'FOLLOWS') . ' ' . Db::ident(TableEditor::validName($order['other']));
        }
        return $sql . "\n" . self::cleanBody((string) ($s['body'] ?? ''));
    }

    private static function stamp(mixed $v): string
    {
        $v = trim((string) $v);
        if (!preg_match('~^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$~', $v) || !strtotime($v)) {
            throw new ApiError('bad_date', "Invalid date: $v", 400, ['name' => $v]);
        }
        return strlen($v) === 16 ? "$v:00" : (strlen($v) === 10 ? "$v 00:00:00" : $v);
    }

    /**
     * CREATE EVENT, or ALTER EVENT when $original is given (atomic, can rename).
     *
     * @param callable(string):string $quote
     */
    public static function eventSql(array $s, callable $quote, ?string $original = null): string
    {
        $name = TableEditor::validName($s['name'] ?? '');
        $sch = (array) ($s['schedule'] ?? []);
        if (($sch['type'] ?? '') === 'once') {
            $when = 'AT ' . $quote(self::stamp($sch['at'] ?? ''));
        } else {
            $n = (int) ($sch['value'] ?? 0);
            if ($n < 1 || $n > 1000000) {
                throw new ApiError('bad_option', 'Interval must be 1 or more', 400, ['name' => (string) $n]);
            }
            $when = "EVERY $n " . self::pick($sch['unit'] ?? '', self::UNITS, 'DAY');
            if (!empty($sch['starts'])) {
                $when .= ' STARTS ' . $quote(self::stamp($sch['starts']));
            }
            if (!empty($sch['ends'])) {
                $when .= ' ENDS ' . $quote(self::stamp($sch['ends']));
            }
        }
        $tail = ' ON COMPLETION ' . (!empty($s['preserve']) ? 'PRESERVE' : 'NOT PRESERVE') . ' ' . (array_key_exists('enabled', $s) && !$s['enabled'] ? 'DISABLE' : 'ENABLE');
        if (!empty($s['comment'])) {
            $tail .= ' COMMENT ' . $quote(\pmf_substr((string) $s['comment'], 64));
        }
        $body = ' DO ' . self::cleanBody((string) ($s['body'] ?? ''));
        if ($original !== null) {
            $rename = $original !== $name ? ' RENAME TO ' . Db::ident($name) : '';
            return 'ALTER EVENT ' . Db::ident(TableEditor::validName($original)) . " ON SCHEDULE $when$tail$rename$body";
        }
        return 'CREATE ' . (!empty($s['definer']) ? 'DEFINER=' . self::definer((string) $s['definer']) . ' ' : '') . 'EVENT ' . Db::ident($name) . " ON SCHEDULE $when$tail$body";
    }

    // ------------------------------------------------------------------
    // Read
    // ------------------------------------------------------------------

    /** Everything that is not a table, for the sidebar groups. */
    public function list(): array
    {
        $q = function (string $sql): array {
            try {
                $st = $this->pdo->prepare($sql);
                $st->execute([$this->db]);
                return $st->fetchAll();
            } catch (\PDOException) {
                return [];
            }
        };
        return [
            'procedures' => $q("SELECT ROUTINE_NAME AS name, ROUTINE_COMMENT AS comment, LAST_ALTERED AS updated FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME"),
            'functions' => $q("SELECT ROUTINE_NAME AS name, ROUTINE_COMMENT AS comment, DTD_IDENTIFIER AS returns FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION' ORDER BY ROUTINE_NAME"),
            'triggers' => $q('SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS `table`, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME'),
            'events' => $q('SELECT EVENT_NAME AS name, STATUS AS status, EVENT_TYPE AS type FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME'),
            'scheduler' => (string) $this->pdo->query('SELECT @@event_scheduler')->fetchColumn(),
            'supportsOrder' => $this->supportsTriggerOrder(),
            'mariadb' => $this->mariadb(),
        ];
    }

    private function supportsTriggerOrder(): bool
    {
        $v = (string) $this->pdo->getAttribute(PDO::ATTR_SERVER_VERSION);
        preg_match('~^(\d+\.\d+\.\d+)~', $v, $m);
        return version_compare($m[1] ?? '0.0.0', $this->mariadb() ? '10.2.3' : '5.7.2', '>=');
    }

    private function one(string $sql, array $params): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        $r = $st->fetch();
        if (!$r) {
            throw new ApiError('unknown_object', 'Unknown object', 404, ['name' => (string) end($params)]);
        }
        return $r;
    }

    /** One object as the editor needs it. */
    public function info(string $kind, string $name): array
    {
        $kind = self::pick($kind, self::KINDS, 'VIEW');
        $info = match ($kind) {
            'VIEW' => $this->viewInfo($name),
            'PROCEDURE', 'FUNCTION' => $this->routineInfo($kind, $name),
            'TRIGGER' => $this->triggerInfo($name),
            'EVENT' => $this->eventInfo($name),
        };
        return $info + ['kind' => $kind, 'create' => $this->createCode($kind, $name)];
    }

    private function viewInfo(string $name): array
    {
        $r = $this->one('SELECT TABLE_NAME AS name, CHECK_OPTION AS checkOption, SECURITY_TYPE AS security, DEFINER AS definer FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [$this->db, $name]);
        $create = (string) $this->pdo->query('SHOW CREATE VIEW ' . Db::ident($name))->fetch(PDO::FETCH_NUM)[1];
        preg_match('~ALGORITHM=(\w+)~', $create, $a);
        // The body as the server stores it: after "VIEW `name` AS ".
        $body = preg_replace('~^.*?\sVIEW\s+`(?:[^`]|``)+`\s+AS\s+~s', '', $create);
        $body = preg_replace('~\s+WITH\s+(CASCADED|LOCAL)\s+CHECK\s+OPTION\s*$~i', '', (string) $body);
        $body = str_replace(Db::ident($this->db) . '.', '', (string) $body);
        return ['name' => $r['name'], 'algorithm' => $a[1] ?? 'UNDEFINED', 'security' => $r['security'], 'checkOption' => $r['checkOption'] === 'NONE' ? 'NONE' : $r['checkOption'], 'definer' => $r['definer'], 'body' => $body];
    }

    private function routineInfo(string $kind, string $name): array
    {
        $r = $this->one('SELECT ROUTINE_NAME AS name, DTD_IDENTIFIER AS returns, ROUTINE_DEFINITION AS body, IS_DETERMINISTIC AS det, SQL_DATA_ACCESS AS dataAccess,
                                SECURITY_TYPE AS security, ROUTINE_COMMENT AS comment, DEFINER AS definer
                         FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = ? AND ROUTINE_NAME = ?', [$this->db, $kind, $name]);
        $st = $this->pdo->prepare('SELECT PARAMETER_MODE AS mode, PARAMETER_NAME AS name, DTD_IDENTIFIER AS type FROM information_schema.PARAMETERS
                                   WHERE SPECIFIC_SCHEMA = ? AND SPECIFIC_NAME = ? AND ROUTINE_TYPE = ? AND ORDINAL_POSITION > 0 ORDER BY ORDINAL_POSITION');
        $st->execute([$this->db, $name, $kind]);
        $body = $r['body'];
        if ($body === null) {
            // ROUTINE_DEFINITION is NULL without privileges on the routine: try SHOW CREATE.
            try {
                $create = (string) ($this->pdo->query("SHOW CREATE $kind " . Db::ident($name))->fetch(PDO::FETCH_NUM)[2] ?? '');
                $body = $create;
            } catch (\PDOException) {
                $body = '';
            }
        }
        return [
            'name' => $r['name'], 'params' => $st->fetchAll(), 'returns' => $kind === 'FUNCTION' ? $r['returns'] : null,
            'deterministic' => $r['det'] === 'YES', 'dataAccess' => $r['dataAccess'], 'security' => $r['security'],
            'comment' => $r['comment'], 'definer' => $r['definer'], 'body' => (string) $body,
        ];
    }

    private function triggerInfo(string $name): array
    {
        $r = $this->one('SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS `table`, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event,
                                ACTION_STATEMENT AS body, ACTION_ORDER AS actionOrder, DEFINER AS definer
                         FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND TRIGGER_NAME = ?', [$this->db, $name]);
        return $r + ['order' => null];
    }

    private function eventInfo(string $name): array
    {
        $r = $this->one('SELECT EVENT_NAME AS name, EVENT_TYPE AS type, EXECUTE_AT AS at, INTERVAL_VALUE AS value, INTERVAL_FIELD AS unit, STARTS AS starts, ENDS AS ends,
                                ON_COMPLETION AS completion, STATUS AS status, EVENT_DEFINITION AS body, EVENT_COMMENT AS comment, DEFINER AS definer, LAST_EXECUTED AS lastRun
                         FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? AND EVENT_NAME = ?', [$this->db, $name]);
        return [
            'name' => $r['name'],
            'schedule' => $r['type'] === 'ONE TIME' ? ['type' => 'once', 'at' => $r['at']] : ['type' => 'every', 'value' => (int) $r['value'], 'unit' => $r['unit'], 'starts' => $r['starts'], 'ends' => $r['ends']],
            'preserve' => $r['completion'] === 'PRESERVE', 'enabled' => $r['status'] === 'ENABLED', 'comment' => $r['comment'], 'body' => $r['body'],
            'definer' => $r['definer'], 'lastRun' => $r['lastRun'],
        ];
    }

    /** SHOW CREATE for any object, with a trailing ";". */
    public function createCode(string $kind, string $name): string
    {
        $kind = self::pick($kind, self::KINDS, 'VIEW');
        $col = ['VIEW' => 1, 'PROCEDURE' => 2, 'FUNCTION' => 2, 'TRIGGER' => 2, 'EVENT' => 3][$kind];
        try {
            $row = $this->pdo->query("SHOW CREATE $kind " . Db::ident($name))->fetch(PDO::FETCH_NUM);
        } catch (\PDOException $e) {
            if ((int) ($e->errorInfo[1] ?? 0) === 1305 || (int) ($e->errorInfo[1] ?? 0) === 1146 || (int) ($e->errorInfo[1] ?? 0) === 1539 || (int) ($e->errorInfo[1] ?? 0) === 1360) {
                throw new ApiError('unknown_object', 'Unknown object', 404, ['name' => $name]);
            }
            throw $e;
        }
        return rtrim((string) ($row[$col] ?? ''), "; \n") . ';';
    }

    // ------------------------------------------------------------------
    // Save
    // ------------------------------------------------------------------

    /**
     * The statements that create or replace an object. $original is the
     * current name when editing (null: new object).
     *
     * @return list<string>
     */
    public function plan(string $kind, array $spec, ?string $original): array
    {
        $kind = self::pick($kind, self::KINDS, 'VIEW');
        $editor = new TableEditor($this->pdo, $this->db);
        $type = static fn (array $d) => $editor->typeSql($d);
        $quote = fn (string $s) => $this->pdo->quote($s);
        $name = TableEditor::validName($spec['name'] ?? '');
        if ($original !== null) {
            $this->info($kind, $original); // must exist
        }
        $renamed = $original !== null && $original !== $name;
        if (!empty($spec['definer']) && !$this->canSetDefiner()) {
            throw new ApiError('definer_privilege', 'Setting DEFINER needs SET_USER_ID or SUPER', 403);
        }
        if ($kind === 'TRIGGER') {
            (new Ddl($this->pdo))->tableType($this->db, (string) ($spec['table'] ?? ''));
        }
        $tmp = substr('__pmf_tmp_' . bin2hex(random_bytes(3)) . '_' . $name, 0, 64);
        $drop = static fn (string $k, string $n) => "DROP $k " . Db::ident($n);
        switch ($kind) {
            case 'EVENT':
                return [self::eventSql($spec, $quote, $original)];
            case 'VIEW':
                $create = self::viewSql($spec + ['orReplace' => $original !== null && !$renamed]);
                return $renamed ? [$create, $drop('VIEW', $original)] : [$create];
            default:
                $build = $kind === 'TRIGGER'
                    ? static fn (array $s) => self::triggerSql($s)
                    : static fn (array $s) => self::routineSql($s + ['kind' => $kind], $type, $quote);
                if ($original === null) {
                    return [$build($spec)];
                }
                if ($this->mariadb()) {
                    return $renamed ? [$build($spec), $drop($kind, $original)] : [$build(['orReplace' => true] + $spec)];
                }
                // MySQL: validate under a temporary name, then swap.
                return [$build(['name' => $tmp] + $spec), $drop($kind, $tmp), $drop($kind, $original), $build($spec)];
        }
    }

    /** Run the plan; if a step after dropping the original fails, put the original back. */
    public function save(string $kind, array $spec, ?string $original): array
    {
        $kind = self::pick($kind, self::KINDS, 'VIEW');
        $steps = $this->plan($kind, $spec, $original);
        $backup = $original !== null ? $this->createCode($kind, $original) : null;
        $droppedOriginal = false;
        $started = microtime(true);
        foreach ($steps as $i => $sql) {
            try {
                $this->pdo->exec($sql);
                if ($original !== null && $sql === "DROP $kind " . Db::ident($original)) {
                    $droppedOriginal = true;
                }
            } catch (\PDOException $e) {
                if ($droppedOriginal && $backup) {
                    try {
                        $this->pdo->exec(rtrim($backup, ';'));
                    } catch (\PDOException) {
                        // Reported below: the original could not be restored.
                    }
                }
                if ($i === 0 && str_contains($sql, '__pmf_tmp_')) {
                    // The validation step failed: nothing changed.
                    $sql = $steps[count($steps) - 1];
                }
                $err = Sql::errorFromPdo($e);
                throw new ApiError($err->errorCode, $err->getMessage(), 400, $err->details + ['statement' => \pmf_substr($sql, 2000), 'restored' => $droppedOriginal]);
            }
        }
        return ['ok' => true, 'sql' => implode(";\n", $steps) . ';', 'timeMs' => round((microtime(true) - $started) * 1000)];
    }

    private function canSetDefiner(): bool
    {
        $p = Privileges::current();
        return $p->has('SUPER', null) === true || $p->has('SET_USER_ID', null) === true;
    }

    // ------------------------------------------------------------------
    // Drop, impact
    // ------------------------------------------------------------------

    /** Other objects whose code mentions this name (they may break). */
    public function impact(string $kind, string $name): array
    {
        $kind = self::pick($kind, self::KINDS, 'VIEW');
        $this->info($kind, $name);
        $like = '%' . addcslashes($name, '%_\\') . '%';
        $out = [];
        $q = function (string $type, string $sql) use (&$out, $like, $name): void {
            try {
                $st = $this->pdo->prepare($sql);
                $st->execute([$this->db, $like, $name]);
                foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $n) {
                    $out[] = ['kind' => $type, 'name' => $n];
                }
            } catch (\PDOException) {
            }
        };
        $q('VIEW', 'SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? AND VIEW_DEFINITION LIKE ? AND TABLE_NAME <> ?');
        $q('ROUTINE', 'SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_DEFINITION LIKE ? AND ROUTINE_NAME <> ?');
        $q('TRIGGER', 'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND ACTION_STATEMENT LIKE ? AND TRIGGER_NAME <> ?');
        $q('EVENT', 'SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? AND EVENT_DEFINITION LIKE ? AND EVENT_NAME <> ?');
        return ['usedBy' => $out];
    }

    public function drop(string $kind, string $name): array
    {
        $kind = self::pick($kind, self::KINDS, 'VIEW');
        $this->info($kind, $name);
        $sql = "DROP $kind " . Db::ident($name);
        $this->pdo->exec($sql);
        return ['ok' => true, 'sql' => $sql . ';'];
    }

    // ------------------------------------------------------------------
    // Execute
    // ------------------------------------------------------------------

    /**
     * CALL a procedure or SELECT a function with the given arguments
     * (prepared). OUT/INOUT go through session variables read back after.
     *
     * @param list<array{value:?string}> $args
     */
    public function execute(string $kind, string $name, array $args, int $maxRows): array
    {
        $kind = self::pick($kind, ['PROCEDURE', 'FUNCTION'], 'PROCEDURE');
        $info = $this->routineInfo($kind, $name);
        $params = $info['params'];
        $marks = [];
        $values = [];
        $outs = [];
        foreach ($params as $i => $p) {
            $v = $args[$i]['value'] ?? null;
            $v = $v === null ? null : (string) $v;
            $mode = strtoupper((string) ($p['mode'] ?? 'IN'));
            if ($kind === 'FUNCTION' || $mode === 'IN') {
                $marks[] = '?';
                $values[] = $v;
            } else {
                $var = '@pmf_p' . $i;
                if ($mode === 'INOUT') {
                    $st = $this->pdo->prepare("SET $var = ?");
                    $st->execute([$v]);
                } else {
                    $this->pdo->exec("SET $var = NULL");
                }
                $marks[] = $var;
                $outs[$p['name']] = $var;
            }
        }
        $call = $kind === 'FUNCTION'
            ? 'SELECT ' . Db::ident($name) . '(' . implode(', ', $marks) . ') AS ' . Db::ident($name)
            : 'CALL ' . Db::ident($name) . '(' . implode(', ', $marks) . ')';
        $started = microtime(true);
        $st = $this->pdo->prepare($call);
        $st->execute($values);
        $sets = [];
        do {
            $n = $st->columnCount();
            if ($n > 0) {
                $cols = [];
                for ($c = 0; $c < $n; $c++) {
                    $meta = $st->getColumnMeta($c);
                    $cols[] = is_array($meta) && isset($meta['name']) ? (string) $meta['name'] : null;
                }
                if (!array_filter($cols, 'is_string')) {
                    continue; // CALL status packet, not a result set
                }
                $cols = array_map(static fn ($c, $i) => $c ?? "col$i", $cols, array_keys($cols));
                $rows = [];
                $truncated = false;
                while (($r = $st->fetch(PDO::FETCH_NUM)) !== false) {
                    if (count($rows) >= $maxRows) {
                        $truncated = true;
                        continue;
                    }
                    $rows[] = array_map(static fn ($x) => $x === null ? null : (is_string($x) && !\pmf_is_utf8($x) ? '0x' . bin2hex($x) : $x), $r);
                }
                $sets[] = ['columns' => $cols, 'rows' => $rows, 'truncated' => $truncated];
            }
        } while ($st->nextRowset());
        $st->closeCursor();
        $outValues = [];
        if ($outs) {
            $row = $this->pdo->query('SELECT ' . implode(', ', array_map(static fn ($v, $k) => "$v AS " . Db::ident((string) $k), $outs, array_keys($outs))))->fetch();
            $outValues = $row ?: [];
        }
        return ['resultSets' => $sets, 'out' => $outValues, 'affected' => $st->rowCount(), 'timeMs' => round((microtime(true) - $started) * 1000, 1)];
    }

    // ------------------------------------------------------------------
    // Export
    // ------------------------------------------------------------------

    /**
     * Routines, triggers and events for a SQL dump, without DEFINER, wrapped
     * in DELIMITER ;; so the file imports in the mysql client and here.
     */
    public function exportSql(bool $routines, bool $triggers, bool $events, bool $drop): string
    {
        $out = '';
        $l = $this->list();
        $add = function (string $kind, string $name) use (&$out, $drop): void {
            $create = (string) preg_replace('~\sDEFINER=(`[^`]*`|\S+)@(`[^`]*`|\S+)~', '', $this->createCode($kind, $name));
            $out .= "\n-- $kind " . Db::ident($name) . "\n" . ($drop ? "DROP $kind IF EXISTS " . Db::ident($name) . ";;\n" : '') . rtrim($create, ';') . ";;\n";
        };
        if ($routines) {
            foreach ($l['procedures'] as $r) {
                $add('PROCEDURE', $r['name']);
            }
            foreach ($l['functions'] as $r) {
                $add('FUNCTION', $r['name']);
            }
        }
        if ($triggers) {
            foreach ($l['triggers'] as $r) {
                $add('TRIGGER', $r['name']);
            }
        }
        if ($events) {
            foreach ($l['events'] as $r) {
                $add('EVENT', $r['name']);
            }
        }
        return $out === '' ? '' : "\nDELIMITER ;;\n$out\nDELIMITER ;\n";
    }
}
