<?php
declare(strict_types=1);

namespace PhpMyFlow;

use PDO;

/**
 * Server monitor: live status, processes, heavy queries, storage, advisor
 * and the last deadlock. Every query here is light (status, variables,
 * information_schema / performance_schema summaries) and each panel
 * reports a missing privilege with the exact GRANT instead of failing.
 */
final class Monitor
{
    /** Minimum time between live polls served from the database (ms). */
    public const MIN_INTERVAL_MS = 900;

    public function __construct(private PDO $pdo)
    {
    }

    /** Monitor for the logged-in user's connection. */
    public static function forSession(): self
    {
        return new self(Db::pdo());
    }

    /** Connection from config 'monitor' (collector). Null when not configured. */
    public static function configConnection(): ?PDO
    {
        $m = pmf_config()['monitor'] ?? null;
        if (!is_array($m) || empty($m['user'])) {
            return null;
        }
        return Db::connect((string) ($m['host'] ?? '127.0.0.1'), (int) ($m['port'] ?? 3306), (string) $m['user'], (string) ($m['password'] ?? ''));
    }

    // ------------------------------------------------------------------
    // Privileges
    // ------------------------------------------------------------------

    /** "'user'@'host'" for GRANT statements. */
    public function grantee(): string
    {
        $cu = (string) $this->pdo->query('SELECT CURRENT_USER()')->fetchColumn();
        $at = strrpos($cu, '@');
        $user = $at === false ? $cu : substr($cu, 0, $at);
        $host = $at === false ? '%' : substr($cu, $at + 1);
        return "'" . str_replace("'", "''", $user) . "'@'" . str_replace("'", "''", $host) . "'";
    }

    /** Missing privilege error that the UI shows with a copyable GRANT. */
    public function missing(string $privilege, string $on = '*.*'): array
    {
        return [
            'code' => 'missing_privilege',
            'privilege' => $privilege,
            'grant' => "GRANT $privilege ON $on TO " . $this->grantee() . ';',
        ];
    }

    /** Map an access-denied PDOException to a missing-privilege payload, or rethrow. */
    private function denied(\PDOException $e, string $privilege, string $on = '*.*'): array
    {
        $code = (int) ($e->errorInfo[1] ?? 0);
        if (in_array($code, [1044, 1045, 1142, 1143, 1227, 1370], true)) {
            return $this->missing($privilege, $on);
        }
        throw $e;
    }

    /** Global privileges of the current user (USAGE only = none). */
    public function globalPrivileges(): array
    {
        $grantee = $this->grantee();
        $rows = $this->pdo->prepare('SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ?');
        $rows->execute([$grantee]);
        return array_column($rows->fetchAll(PDO::FETCH_ASSOC), 'PRIVILEGE_TYPE');
    }

    public function capabilities(): array
    {
        $version = (string) $this->pdo->query('SELECT VERSION()')->fetchColumn();
        $mariadb = stripos($version, 'mariadb') !== false;
        $ps = (int) $this->pdo->query('SELECT @@performance_schema')->fetchColumn() === 1;
        $privs = $this->globalPrivileges();
        $psReadable = false;
        if ($ps) {
            try {
                $this->pdo->query('SELECT 1 FROM performance_schema.events_statements_summary_by_digest LIMIT 1')->fetchAll();
                $psReadable = true;
            } catch (\PDOException) {
                $psReadable = false;
            }
        }
        $cfg = pmf_config();
        return [
            'flavor' => $mariadb ? 'mariadb' : 'mysql',
            'version' => $version,
            'performanceSchema' => $ps,
            'performanceSchemaReadable' => $psReadable,
            'privileges' => $privs,
            'hasProcess' => in_array('PROCESS', $privs, true),
            'grantee' => $this->grantee(),
            'grants' => [
                'process' => 'GRANT PROCESS ON *.* TO ' . $this->grantee() . ';',
                'replication' => 'GRANT REPLICATION CLIENT ON *.* TO ' . $this->grantee() . ';',
                'performanceSchema' => 'GRANT SELECT ON performance_schema.* TO ' . $this->grantee() . ';',
            ],
            'connectionId' => (int) $this->pdo->query('SELECT CONNECTION_ID()')->fetchColumn(),
            'collector' => Collector::status(),
            'thresholds' => self::thresholds(),
            'readOnly' => (bool) $cfg['read_only'],
        ];
    }

    /** Alert thresholds (config 'monitor_alerts' overrides the defaults). */
    public static function thresholds(): array
    {
        $defaults = [
            'connections_pct' => ['warn' => 0.8, 'crit' => 0.95],
            'threads_running' => ['warn' => 10, 'crit' => 30],
            'slow_per_min' => ['warn' => 5, 'crit' => 30],
            'bp_hit' => ['warn' => 0.95, 'crit' => 0.9],
            'tmp_disk' => ['warn' => 5, 'crit' => 20],
            'row_lock_waits' => ['warn' => 1, 'crit' => 10],
        ];
        $cfg = pmf_config()['monitor_alerts']['thresholds'] ?? [];
        return array_replace_recursive($defaults, is_array($cfg) ? $cfg : []);
    }

    // ------------------------------------------------------------------
    // Live
    // ------------------------------------------------------------------

    /** Raw status + selected variables, with '_t' = unix time (float). */
    public function rawStatus(): array
    {
        $status = [];
        $wanted = array_flip(array_merge(Metrics::COUNTERS, Metrics::GAUGES));
        foreach ($this->pdo->query('SHOW GLOBAL STATUS')->fetchAll(PDO::FETCH_NUM) as [$k, $v]) {
            if (isset($wanted[$k])) {
                $status[$k] = is_numeric($v) ? $v + 0 : $v;
            }
        }
        $vars = $this->variables();
        $status['max_connections'] = (int) ($vars['max_connections'] ?? 0);
        $status['_t'] = microtime(true);
        return ['status' => $status, 'variables' => $vars];
    }

    public function variables(): array
    {
        $in = implode(',', array_fill(0, count(Metrics::VARIABLES), '?'));
        $st = $this->pdo->prepare("SHOW GLOBAL VARIABLES WHERE Variable_name IN ($in)");
        $st->execute(Metrics::VARIABLES);
        $out = [];
        foreach ($st->fetchAll(PDO::FETCH_NUM) as [$k, $v]) {
            $out[$k] = $v;
        }
        return $out;
    }

    /**
     * Live poll. The backend enforces the minimum interval: a poll that
     * comes too soon gets the previous answer back (cached: true).
     */
    public static function live(): array
    {
        $now = microtime(true);
        $last = $_SESSION['monitor_live'] ?? null;
        if (is_array($last) && ($now - $last['at']) * 1000 < self::MIN_INTERVAL_MS) {
            return $last['data'] + ['cached' => true];
        }
        $started = microtime(true);
        $m = self::forSession();
        $raw = $m->rawStatus();
        $data = [
            'status' => $raw['status'],
            'variables' => $raw['variables'],
            'ms' => round((microtime(true) - $started) * 1000, 1),
            'system' => self::system(),
        ];
        $_SESSION['monitor_live'] = ['at' => $now, 'data' => $data];
        // Pseudo-cron: hosts without cron sample on panel visits (max 1/min).
        if (!empty(pmf_config()['monitor_pseudo_cron'])) {
            try {
                $cfgPdo = Monitor::configConnection();
                Collector::maybeRun($cfgPdo ?? Db::pdo(), $cfgPdo ? (string) Collector::configKey() : Collector::sessionKey());
            } catch (\Throwable $e) {
                error_log('[phpMyFlow] pseudo-cron: ' . $e->getMessage());
            }
        }
        return $data;
    }

    /**
     * CPU / RAM / disk of the machine running PHP (the web server), only
     * when readable. `sameHost` tells the UI whether it is also the DB host.
     */
    public static function system(): array
    {
        $out = ['sameHost' => false];
        try {
            $c = Auth::credentials();
            $out['sameHost'] = in_array($c['host'], ['127.0.0.1', 'localhost', '::1'], true);
        } catch (\Throwable) {
        }
        if (function_exists('sys_getloadavg')) {
            $load = @sys_getloadavg();
            if (is_array($load)) {
                $out['load'] = array_map(static fn ($x) => round((float) $x, 2), $load);
            }
        }
        if (@is_readable('/proc/meminfo')) {
            $mem = [];
            foreach (file('/proc/meminfo') ?: [] as $line) {
                if (preg_match('~^(MemTotal|MemAvailable):\s+(\d+) kB~', $line, $m)) {
                    $mem[$m[1]] = (int) $m[2] * 1024;
                }
            }
            if (isset($mem['MemTotal'], $mem['MemAvailable'])) {
                $out['memTotal'] = $mem['MemTotal'];
                $out['memAvailable'] = $mem['MemAvailable'];
            }
        }
        $free = @disk_free_space(__DIR__);
        $total = @disk_total_space(__DIR__);
        if ($free !== false && $total !== false) {
            $out['diskFree'] = (int) $free;
            $out['diskTotal'] = (int) $total;
        }
        return $out;
    }

    // ------------------------------------------------------------------
    // Processes
    // ------------------------------------------------------------------

    public function processlist(bool $hideLiterals): array
    {
        $rows = $this->pdo->query(
            'SELECT ID AS id, USER AS user, HOST AS host, DB AS db, COMMAND AS command, TIME AS time, STATE AS state, INFO AS info
             FROM information_schema.PROCESSLIST ORDER BY TIME DESC LIMIT 500'
        )->fetchAll(PDO::FETCH_ASSOC);
        $self = (int) $this->pdo->query('SELECT CONNECTION_ID()')->fetchColumn();
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['time'] = (int) $r['time'];
            $r['self'] = $r['id'] === $self;
            $info = $r['info'] === null ? null : (string) $r['info'];
            if ($info !== null) {
                $info = \pmf_substr($hideLiterals ? Sql::maskLiterals($info) : $info, 4000);
            }
            $r['info'] = $info;
        }
        unset($r);
        $privs = $this->globalPrivileges();
        return [
            'rows' => $rows,
            'selfId' => $self,
            // Without PROCESS the list only shows your own connections.
            'limited' => !in_array('PROCESS', $privs, true) ? $this->missing('PROCESS') : null,
        ];
    }

    /** KILL [QUERY] id. Never the monitor's own connection. */
    public function kill(int $id, bool $queryOnly, int $clientSelfId): array
    {
        $self = (int) $this->pdo->query('SELECT CONNECTION_ID()')->fetchColumn();
        if ($id <= 0 || $id === $self || $id === $clientSelfId) {
            throw new ApiError('kill_self', 'You cannot kill the monitor connection', 400);
        }
        $st = $this->pdo->prepare('SELECT ID FROM information_schema.PROCESSLIST WHERE ID = ?');
        $st->execute([$id]);
        if (!$st->fetchColumn()) {
            throw new ApiError('no_such_thread', 'That connection no longer exists', 404);
        }
        try {
            $this->pdo->exec(($queryOnly ? 'KILL QUERY ' : 'KILL ') . $id); // $id is an int
        } catch (\PDOException $e) {
            $p = $this->denied($e, $this->isMariaDb() ? 'SUPER' : 'CONNECTION_ADMIN');
            throw new ApiError('missing_privilege', 'Missing privilege', 403, $p);
        }
        return ['ok' => true];
    }

    /** EXPLAIN of what a connection is running (MySQL: EXPLAIN FOR CONNECTION, MariaDB: SHOW EXPLAIN FOR). */
    public function explainThread(int $id): array
    {
        try {
            $sql = $this->isMariaDb() ? 'SHOW EXPLAIN FOR ' . $id : 'EXPLAIN FOR CONNECTION ' . $id;
            $st = $this->pdo->query($sql);
            return self::resultset($st);
        } catch (\PDOException $e) {
            $code = (int) ($e->errorInfo[1] ?? 0);
            if (in_array($code, [1227, 1044, 1142], true)) {
                throw new ApiError('missing_privilege', 'Missing privilege', 403, $this->missing('PROCESS'));
            }
            throw new ApiError('explain_unavailable', 'The connection is not running an explainable statement right now', 409, ['serverMessage' => $e->getMessage()]);
        }
    }

    private static function resultset(\PDOStatement $st): array
    {
        $cols = [];
        for ($i = 0; $i < $st->columnCount(); $i++) {
            $meta = $st->getColumnMeta($i) ?: [];
            $cols[] = ['name' => $meta['name'] ?? "col$i", 'type' => strtolower((string) ($meta['native_type'] ?? 'var_string'))];
        }
        return ['columns' => $cols, 'rows' => $st->fetchAll(PDO::FETCH_NUM)];
    }

    public function isMariaDb(): bool
    {
        return stripos((string) $this->pdo->getAttribute(PDO::ATTR_SERVER_VERSION), 'mariadb') !== false
            || stripos((string) $this->pdo->query('SELECT VERSION()')->fetchColumn(), 'mariadb') !== false;
    }

    // ------------------------------------------------------------------
    // Heavy queries
    // ------------------------------------------------------------------

    private const DIGEST_SORT = [
        'total' => 'SUM_TIMER_WAIT',
        'avg' => 'AVG_TIMER_WAIT',
        'count' => 'COUNT_STAR',
        'examined' => 'SUM_ROWS_EXAMINED',
        'ratio' => '(SUM_ROWS_EXAMINED / GREATEST(SUM_ROWS_SENT, 1))',
        'noindex' => '(SUM_NO_INDEX_USED + SUM_NO_GOOD_INDEX_USED)',
        'tmpdisk' => 'SUM_CREATED_TMP_DISK_TABLES',
    ];

    public function topQueries(string $sort, int $limit = 50): array
    {
        if (!(int) $this->pdo->query('SELECT @@performance_schema')->fetchColumn()) {
            return ['available' => false, 'reason' => 'performance_schema_off', 'slowLog' => $this->slowLog()];
        }
        $order = self::DIGEST_SORT[$sort] ?? self::DIGEST_SORT['total'];
        $limit = max(1, min(100, $limit));
        $cols = $this->digestColumns();
        $p95 = isset($cols['QUANTILE_95']) ? 'QUANTILE_95' : 'NULL';
        try {
            $rows = $this->pdo->query(
                "SELECT DIGEST AS digest, SCHEMA_NAME AS db, DIGEST_TEXT AS text, COUNT_STAR AS count,
                        SUM_TIMER_WAIT AS total, AVG_TIMER_WAIT AS avg, MAX_TIMER_WAIT AS max, $p95 AS p95,
                        SUM_ROWS_EXAMINED AS examined, SUM_ROWS_SENT AS sent,
                        SUM_NO_INDEX_USED AS noIndex, SUM_NO_GOOD_INDEX_USED AS noGoodIndex,
                        SUM_CREATED_TMP_DISK_TABLES AS tmpDisk, LAST_SEEN AS lastSeen
                 FROM performance_schema.events_statements_summary_by_digest
                 WHERE DIGEST_TEXT IS NOT NULL
                 ORDER BY $order DESC LIMIT $limit"
            )->fetchAll(PDO::FETCH_ASSOC);
        } catch (\PDOException $e) {
            return ['available' => false, 'reason' => 'missing_privilege', 'missing' => $this->denied($e, 'SELECT', 'performance_schema.*'), 'slowLog' => $this->slowLog()];
        }
        // Timers are in picoseconds: send milliseconds.
        foreach ($rows as &$r) {
            foreach (['total', 'avg', 'max', 'p95'] as $k) {
                $r[$k] = $r[$k] === null ? null : round((float) $r[$k] / 1e9, 3);
            }
            foreach (['count', 'examined', 'sent', 'noIndex', 'noGoodIndex', 'tmpDisk'] as $k) {
                $r[$k] = (int) $r[$k];
            }
            $r['text'] = \pmf_substr((string) $r['text'], 4000);
            $r['hasSample'] = isset($cols['QUERY_SAMPLE_TEXT']);
        }
        unset($r);
        return ['available' => true, 'rows' => $rows, 'canReset' => $this->canTruncatePs(), 'slowLog' => $this->slowLog()];
    }

    /** Columns of the digest summary (they vary between MySQL and MariaDB versions). */
    private function digestColumns(): array
    {
        $st = $this->pdo->query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'performance_schema' AND TABLE_NAME = 'events_statements_summary_by_digest'");
        return array_flip(array_column($st->fetchAll(PDO::FETCH_ASSOC), 'COLUMN_NAME'));
    }

    private function canTruncatePs(): bool
    {
        // TRUNCATE on performance_schema needs DROP on it.
        try {
            $st = $this->pdo->prepare("SELECT 1 FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = 'performance_schema' AND PRIVILEGE_TYPE = 'DROP'");
            $st->execute([$this->grantee()]);
            return (bool) $st->fetchColumn() || in_array('DROP', $this->globalPrivileges(), true);
        } catch (\PDOException) {
            return false;
        }
    }

    public function resetDigests(): array
    {
        try {
            $this->pdo->exec('TRUNCATE TABLE performance_schema.events_statements_summary_by_digest');
        } catch (\PDOException $e) {
            throw new ApiError('missing_privilege', 'Missing privilege', 403, $this->denied($e, 'DROP', 'performance_schema.events_statements_summary_by_digest'));
        }
        return ['ok' => true];
    }

    /** Digest text plus EXPLAIN of its sample (MySQL 8 keeps QUERY_SAMPLE_TEXT). */
    public function digestDetail(string $digest): array
    {
        if (!preg_match('~^[0-9a-fA-F]{16,64}$~', $digest)) {
            throw new ApiError('bad_value', 'Bad digest', 400);
        }
        $cols = $this->digestColumns();
        $sample = isset($cols['QUERY_SAMPLE_TEXT']) ? 'QUERY_SAMPLE_TEXT' : 'NULL';
        $st = $this->pdo->prepare("SELECT DIGEST_TEXT AS text, SCHEMA_NAME AS db, $sample AS sample FROM performance_schema.events_statements_summary_by_digest WHERE DIGEST = ? LIMIT 1");
        $st->execute([$digest]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new ApiError('not_found', 'Digest not found (statistics were reset?)', 404);
        }
        $explain = null;
        $sampleText = (string) ($row['sample'] ?? '');
        if ($sampleText !== '' && preg_match('~^\s*(SELECT|WITH|UPDATE|DELETE|INSERT|REPLACE)\b~i', $sampleText) && !str_contains($sampleText, '...')) {
            try {
                if ($row['db']) {
                    $this->pdo->exec('USE ' . Db::ident((string) $row['db']));
                }
                // The sample is SQL some other user ran: explained, never executed.
                $explain = Db::explain($this->pdo, $sampleText, static fn (\PDOStatement $st) => self::resultset($st));
            } catch (\PDOException) {
                $explain = null;
            }
        }
        return ['text' => $row['text'], 'db' => $row['db'], 'explain' => $explain];
    }

    public function slowLog(): array
    {
        $v = $this->variables();
        return [
            'enabled' => in_array(strtoupper((string) ($v['slow_query_log'] ?? 'OFF')), ['ON', '1'], true),
            'longQueryTime' => (float) ($v['long_query_time'] ?? 10),
            'file' => (string) ($v['slow_query_log_file'] ?? ''),
            'output' => (string) ($v['log_output'] ?? ''),
        ];
    }

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------

    public function storage(): array
    {
        $dbs = $this->pdo->query(
            "SELECT TABLE_SCHEMA AS db, SUM(DATA_LENGTH) AS data, SUM(INDEX_LENGTH) AS idx, SUM(DATA_FREE) AS free, COUNT(*) AS tables
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA NOT IN ('information_schema','performance_schema','mysql','sys')
             GROUP BY TABLE_SCHEMA ORDER BY SUM(DATA_LENGTH + INDEX_LENGTH) DESC"
        )->fetchAll(PDO::FETCH_ASSOC);
        $tables = $this->pdo->query(
            "SELECT TABLE_SCHEMA AS db, TABLE_NAME AS name, ENGINE AS engine, TABLE_ROWS AS approxRows,
                    DATA_LENGTH AS data, INDEX_LENGTH AS idx, DATA_FREE AS free
             FROM information_schema.TABLES
             WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA NOT IN ('information_schema','performance_schema','mysql','sys')
             ORDER BY DATA_LENGTH + INDEX_LENGTH DESC LIMIT 500"
        )->fetchAll(PDO::FETCH_ASSOC);
        $int = static function (array $rows, array $keys): array {
            foreach ($rows as &$r) {
                foreach ($keys as $k) {
                    $r[$k] = (int) ($r[$k] ?? 0);
                }
            }
            return $rows;
        };
        $tables = $int($tables, ['approxRows', 'data', 'idx', 'free']);
        // "A lot of free space": 10 MB+ and 20%+ of the table.
        $fragmented = array_values(array_filter($tables, static fn ($t) => $t['free'] >= 10 * 1048576 && $t['free'] >= 0.2 * ($t['data'] + $t['idx'])));
        return [
            'databases' => $int($dbs, ['data', 'idx', 'free', 'tables']),
            'tables' => $tables,
            'fragmented' => $fragmented,
        ];
    }

    public function optimize(string $db, string $table): array
    {
        Schema::assertDatabaseExists($db);
        $st = $this->pdo->prepare("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'");
        $st->execute([$db, $table]);
        if (!$st->fetchColumn()) {
            throw new ApiError('unknown_table', "Unknown table: $table", 404, ['name' => $table]);
        }
        $started = microtime(true);
        $rows = $this->pdo->query('OPTIMIZE TABLE ' . Db::ident($db) . '.' . Db::ident($table))->fetchAll(PDO::FETCH_ASSOC);
        return ['ok' => true, 'result' => $rows, 'timeMs' => round((microtime(true) - $started) * 1000)];
    }

    // ------------------------------------------------------------------
    // Advisor
    // ------------------------------------------------------------------

    /**
     * Simple rules with a plain-language explanation (UI translates by id),
     * the current value and the setting or table to look at.
     */
    public function advisor(): array
    {
        $raw = $this->rawStatus();
        $s = $raw['status'];
        $v = $raw['variables'];
        $out = [];
        $add = static function (string $id, string $level, array $params, string $ref) use (&$out) {
            $out[] = ['id' => $id, 'level' => $level, 'params' => $params, 'ref' => $ref];
        };
        $user = "NOT IN ('information_schema','performance_schema','mysql','sys')";

        // Buffer pool vs InnoDB data.
        $innodb = (int) $this->pdo->query("SELECT COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH), 0) FROM information_schema.TABLES WHERE ENGINE = 'InnoDB' AND TABLE_SCHEMA $user")->fetchColumn();
        $bp = (int) ($v['innodb_buffer_pool_size'] ?? 0);
        if ($innodb > 0 && $bp > 0 && $bp < $innodb * 0.8) {
            $add('buffer_pool_small', $bp < $innodb * 0.3 ? 'crit' : 'warn', ['pool' => $bp, 'data' => $innodb], 'innodb_buffer_pool_size');
        }
        // Temporary tables on disk.
        $tmp = (int) ($s['Created_tmp_tables'] ?? 0);
        $tmpDisk = (int) ($s['Created_tmp_disk_tables'] ?? 0);
        if ($tmp > 100 && $tmpDisk / max(1, $tmp) > 0.25) {
            $add('tmp_disk', $tmpDisk / $tmp > 0.5 ? 'crit' : 'warn', ['pct' => round($tmpDisk / $tmp, 3), 'tmpSize' => (int) ($v['tmp_table_size'] ?? 0)], 'tmp_table_size');
        }
        // Connections near the limit.
        $max = (int) ($v['max_connections'] ?? 0);
        $used = (int) ($s['Max_used_connections'] ?? 0);
        if ($max > 0 && $used / $max >= 0.8) {
            $add('connections_near_max', $used / $max >= 0.95 ? 'crit' : 'warn', ['used' => $used, 'max' => $max], 'max_connections');
        }
        // Aborted connections.
        $conns = (int) ($s['Connections'] ?? 0);
        $aborted = (int) ($s['Aborted_connects'] ?? 0);
        if ($conns > 100 && $aborted / $conns > 0.02) {
            $add('aborted_connects', 'warn', ['aborted' => $aborted, 'pct' => round($aborted / $conns, 3)], 'Aborted_connects');
        }
        // Tables without a primary key.
        $noPk = $this->pdo->query(
            "SELECT t.TABLE_SCHEMA AS db, t.TABLE_NAME AS name FROM information_schema.TABLES t
             LEFT JOIN information_schema.TABLE_CONSTRAINTS c
               ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME AND c.CONSTRAINT_TYPE = 'PRIMARY KEY'
             WHERE t.TABLE_TYPE = 'BASE TABLE' AND t.TABLE_SCHEMA $user AND c.CONSTRAINT_NAME IS NULL LIMIT 100"
        )->fetchAll(PDO::FETCH_ASSOC);
        if ($noPk) {
            $add('no_primary_key', 'warn', ['count' => count($noPk), 'tables' => array_map(static fn ($r) => "$r[db].$r[name]", array_slice($noPk, 0, 20))], 'information_schema.TABLE_CONSTRAINTS');
        }
        // MyISAM tables.
        $myisam = $this->pdo->query("SELECT TABLE_SCHEMA AS db, TABLE_NAME AS name FROM information_schema.TABLES WHERE ENGINE = 'MyISAM' AND TABLE_SCHEMA $user LIMIT 100")->fetchAll(PDO::FETCH_ASSOC);
        if ($myisam) {
            $add('myisam', 'warn', ['count' => count($myisam), 'tables' => array_map(static fn ($r) => "$r[db].$r[name]", array_slice($myisam, 0, 20))], 'ENGINE=InnoDB');
        }
        // xxx_id columns without any index (first column of an index).
        $unindexed = $this->pdo->query(
            "SELECT c.TABLE_SCHEMA AS db, c.TABLE_NAME AS t, c.COLUMN_NAME AS col FROM information_schema.COLUMNS c
             JOIN information_schema.TABLES tb ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME AND tb.TABLE_TYPE = 'BASE TABLE'
             LEFT JOIN information_schema.STATISTICS s
               ON s.TABLE_SCHEMA = c.TABLE_SCHEMA AND s.TABLE_NAME = c.TABLE_NAME AND s.COLUMN_NAME = c.COLUMN_NAME AND s.SEQ_IN_INDEX = 1
             WHERE c.TABLE_SCHEMA $user AND c.COLUMN_NAME LIKE '%\\_id' AND s.INDEX_NAME IS NULL LIMIT 200"
        )->fetchAll(PDO::FETCH_ASSOC);
        if ($unindexed) {
            $add('fk_without_index', 'warn', ['count' => count($unindexed), 'columns' => array_map(static fn ($r) => "$r[db].$r[t].$r[col]", array_slice($unindexed, 0, 25))], 'CREATE INDEX');
        }
        // Duplicate indexes: same columns in the same order on one table.
        $idx = $this->pdo->query(
            "SELECT TABLE_SCHEMA AS db, TABLE_NAME AS t, INDEX_NAME AS i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
             FROM information_schema.STATISTICS WHERE TABLE_SCHEMA $user
             GROUP BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME"
        )->fetchAll(PDO::FETCH_ASSOC);
        $groups = [];
        foreach ($idx as $r) {
            $groups["$r[db].$r[t]|$r[cols]"][] = $r['i'];
        }
        $dups = [];
        foreach ($groups as $key => $names) {
            if (count($names) > 1) {
                [$table, $cols] = explode('|', $key, 2);
                $dups[] = "$table ($cols): " . implode(', ', $names);
            }
        }
        if ($dups) {
            $add('duplicate_indexes', 'warn', ['count' => count($dups), 'items' => array_slice($dups, 0, 20)], 'DROP INDEX');
        }
        // Slow query log off.
        if (!in_array(strtoupper((string) ($v['slow_query_log'] ?? 'OFF')), ['ON', '1'], true)) {
            $add('slow_log_off', 'info', [], 'slow_query_log');
        }
        // Query cache on where it hurts (MariaDB 10.1.7+ off by default; removed in MySQL 8).
        $qcType = strtoupper((string) ($v['query_cache_type'] ?? 'OFF'));
        $qcSize = (int) ($v['query_cache_size'] ?? 0);
        if ($qcSize > 0 && !in_array($qcType, ['OFF', '0'], true)) {
            $add('query_cache_on', 'warn', ['size' => $qcSize], 'query_cache_type');
        }
        if (!$out) {
            $add('all_good', 'ok', [], '');
        }
        return ['items' => $out];
    }

    // ------------------------------------------------------------------
    // Deadlock
    // ------------------------------------------------------------------

    public function lastDeadlock(bool $hideLiterals): array
    {
        try {
            $row = $this->pdo->query('SHOW ENGINE INNODB STATUS')->fetch(PDO::FETCH_ASSOC);
        } catch (\PDOException $e) {
            return ['available' => false, 'missing' => $this->denied($e, 'PROCESS')];
        }
        $text = (string) ($row['Status'] ?? '');
        $dl = self::parseDeadlock($text);
        if ($dl && $hideLiterals) {
            foreach ($dl['transactions'] as &$tx) {
                $tx['query'] = Sql::maskLiterals($tx['query']);
            }
            unset($tx);
        }
        return ['available' => true, 'deadlock' => $dl];
    }

    /**
     * Parse "LATEST DETECTED DEADLOCK" from SHOW ENGINE INNODB STATUS
     * (MySQL 5.7/8 and MariaDB 10.x layouts). Null when there is none.
     */
    public static function parseDeadlock(string $status): ?array
    {
        if (!preg_match('~-{3,}\s*\nLATEST DETECTED DEADLOCK\s*\n-{3,}\s*\n(.*?)\n-{3,}\s*\n[A-Z][A-Z /]+\n-{3,}~s', $status, $m)) {
            return null;
        }
        $body = $m[1];
        $time = preg_match('~^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})~', $body, $tm) ? $tm[1] : null;
        // Sections start with "*** (1) TRANSACTION:", "*** (1) HOLDS THE LOCK(S):", "*** (1) WAITING FOR THIS LOCK TO BE GRANTED:".
        $parts = preg_split('~^\*\*\* ~m', $body) ?: [];
        $txs = [];
        $rolledBack = null;
        foreach ($parts as $part) {
            if (preg_match('~^\((\d+)\) TRANSACTION:\s*\n(.*)$~s', $part, $p)) {
                $n = (int) $p[1];
                $chunk = $p[2];
                $tx = ['n' => $n, 'id' => null, 'thread' => null, 'user' => null, 'host' => null, 'state' => null, 'query' => '', 'holds' => [], 'waits' => []];
                if (preg_match('~TRANSACTION (\d+), ACTIVE (\d+) sec(?: ([^\n]+))?~', $chunk, $x)) {
                    $tx['id'] = $x[1];
                    $tx['state'] = trim($x[3] ?? '');
                }
                if (preg_match('~MySQL thread id (\d+), OS thread handle \S+, query id \d+ (\S+) (\S+) ([^\n]*)~', $chunk, $x)) {
                    $tx['thread'] = (int) $x[1];
                    $tx['host'] = $x[2];
                    $tx['user'] = $x[3];
                }
                // The statement is what follows the "MySQL thread id" line, up to the next "***" section.
                if (preg_match('~MySQL thread id[^\n]*\n(.*)$~s', $chunk, $x)) {
                    $tx['query'] = trim($x[1]);
                }
                $txs[$n] = $tx;
            } elseif (preg_match('~^\((\d+)\) (HOLDS THE LOCK\(S\)|WAITING FOR THIS LOCK TO BE GRANTED):\s*\n(.*)$~s', $part, $p)) {
                $n = (int) $p[1];
                $locks = [];
                if (preg_match_all('~^(RECORD|TABLE) LOCK[^\n]*?(?:index (\S+) of )?table `([^`]+)`\.`([^`]+)`[^\n]*?(lock_mode \S+(?: [^\n]*?)?|lock mode \S+)?\s*$~m', $p[3], $lm, PREG_SET_ORDER)) {
                    foreach ($lm as $l) {
                        $locks[] = ['type' => $l[1], 'index' => $l[2] !== '' ? $l[2] : null, 'table' => $l[3] . '.' . $l[4], 'mode' => trim($l[5] ?? '')];
                    }
                }
                if (isset($txs[$n])) {
                    $txs[$n][$p[2] === 'HOLDS THE LOCK(S)' ? 'holds' : 'waits'] = $locks;
                }
            } elseif (preg_match('~^WE ROLL BACK TRANSACTION \((\d+)\)~', $part, $p)) {
                $rolledBack = (int) $p[1];
            }
        }
        if (!$txs) {
            return null;
        }
        return ['time' => $time, 'transactions' => array_values($txs), 'rolledBack' => $rolledBack];
    }
}
