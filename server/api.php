<?php
declare(strict_types=1);

/*
 * Single JSON endpoint: api.php?a=<action>
 * No URL rewriting needed, so it works on any Apache/Nginx/IIS host.
 */

use PhpMyFlow\{Ai, ApiError, Auth, Collector, Db, Ddl, Export, ExportJob, Http, Import, Jobs, Lookup, Metrics, MetricsStore, Monitor, Objects, Privileges, Schema, Sql, TableEditor, Tools};

// PHP's built-in server started from the repository root would serve this
// file as /server/api.php next to everything else in the repo. Only answer
// when server/ is the document root (php -S … -t server).
if (PHP_SAPI === 'cli-server' && realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? '')) !== realpath(__DIR__)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Serve the server/ folder: php -S <ip>:<port> -t server\n";
    exit;
}

require __DIR__ . '/src/bootstrap.php';

// JSON whatever happens: no PHP message, HTML or stray output ever reaches the browser.
PhpMyFlow\Guard::install();

/** The 8 system colors (web/src/lib/theme.ts COLORS). */
const PMF_COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'];

header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
header('Referrer-Policy: no-referrer');

pmf_start_session();

$action = (string) ($_GET['a'] ?? '');

$publicActions = ['session', 'login', 'login_test'];
// Test-only fault injection (tests/php/ApiJsonTest.php): never available unless
// the server process was started with PMF_TEST_FAULTS=1.
$testFaults = getenv('PMF_TEST_FAULTS') === '1';
if ($testFaults) {
    $publicActions[] = 'test_fault';
}
$writeActions = ['login', 'login_test', 'logout', 'update_cell', 'delete_rows', 'query', 'check', 'ai', 'monitor_kill', 'monitor_reset_digests', 'monitor_optimize', 'alter_preview', 'alter_apply', 'insert_row', 'ddl_checks',
    'db_create', 'db_alter', 'db_drop', 'table_create', 'table_rename', 'table_copy', 'table_copy_rows', 'table_copy_fks', 'view_copy',
    'tables_truncate', 'tables_drop', 'import_upload', 'import_run', 'import_finish', 'import_inspect', 'export_start', 'export_step', 'export_cancel',
    'object_preview', 'object_save', 'object_drop', 'routine_execute',
    'maint_run', 'search_plan', 'search_table', 'bulk_plan', 'bulk_apply', 'gen_rows', 'lookup_many'];

try {
    if (in_array($action, $writeActions, true)) {
        if (Http::method() !== 'POST') {
            throw new ApiError('method_not_allowed', 'Use POST', 405);
        }
        Auth::checkCsrf();
    }
    if (!in_array($action, $publicActions, true)) {
        Auth::requireAuth();
    }

    $config = pmf_config();

    switch ($action) {
        case 'session':
            Http::json([
                'version' => PMF_VERSION,
                'csrf' => Auth::csrfToken(),
                'auth' => Auth::publicInfo(),
                'servers' => array_map(static fn ($s) => [
                    'label' => $s['label'], 'host' => $s['host'], 'port' => (int) $s['port'],
                    'ssl' => (bool) ($s['ssl'] ?? false), 'sslChoice' => (bool) ($s['ssl_choice'] ?? false),
                    // Optional look: one of the 8 system colors and the environment (production asks before writes).
                    'color' => in_array($s['color'] ?? null, PMF_COLORS, true) ? $s['color'] : null,
                    'env' => in_array($s['env'] ?? null, ['production', 'staging', 'development', 'local'], true) ? $s['env'] : null,
                ], $config['servers']),
                'allowCustomHost' => (bool) $config['allow_custom_host'],
                // Labels only: the client picks a CA by name, never by path.
                'sslCaFiles' => array_values(array_map('strval', array_keys((array) ($config['ssl_ca_files'] ?? [])))),
                'readOnly' => (bool) $config['read_only'],
                'ai' => Ai::enabled(),
                'gzip' => function_exists('deflate_init'),
                // Inactivity limit: the browser warns a minute before (and "keepalive" renews).
                'idleSeconds' => (int) $config['session_idle_seconds'],
                // Appearance defaults for everyone ('ui'), optionally locked.
                'ui' => uiDefaults((array) ($config['ui'] ?? [])),
                'uiLocked' => (bool) ($config['ui_locked'] ?? false),
            ]);

        case 'login':
        case 'login_test':
            $sslReq = Http::input('ssl');
            $loginArgs = [
                Http::requireString('host'),
                (int) Http::input('port', 3306),
                Http::requireString('user'),
                (string) Http::input('password', ''),
                is_array($sslReq) ? $sslReq : [],
            ];
            if ($action === 'login_test') {
                Http::json(['ok' => true] + Auth::testConnection(...$loginArgs));
            }
            Auth::login(...$loginArgs);
            Http::json(['ok' => true, 'auth' => Auth::publicInfo(), 'csrf' => Auth::csrfToken()]);

        case 'logout':
            Auth::logout();
            Http::json(['ok' => true]);

        case 'keepalive':
            // "Stay signed in": requireAuth() above already renewed last_seen.
            Http::json(['ok' => true, 'idleSeconds' => (int) $config['session_idle_seconds']]);

        case 'databases':
            // Time zone of DATETIME / TIMESTAMP values as the session sees them (grid tooltips).
            [$tz, $sys] = Db::pdo()->query('SELECT @@session.time_zone, @@system_time_zone')->fetch(PDO::FETCH_NUM);
            Http::json(['databases' => Schema::databases(), 'serverVersion' => Db::serverVersion(), 'timeZone' => $tz === 'SYSTEM' ? (string) $sys : (string) $tz]);

        case 'tables':
            $db = Http::requireString('db');
            Schema::assertDatabaseExists($db);
            Http::json(['tables' => Schema::tables($db)]);

        case 'schema':
            $full = Schema::full(Http::requireString('db'));
            Http::json(['tables' => $full, 'relations' => Schema::relations($full), 'polymorphic' => Schema::polymorphic($full)]);

        case 'ref_counts':
            Http::json(refCounts());

        case 'rows':
            Http::json(rows());

        case 'count':
            Http::json(countRows());

        case 'update_cell':
            Http::json(updateCell());

        case 'insert_row':
            Http::json(insertRow());

        case 'delete_rows':
            Http::json(deleteRows());

        case 'query':
            Http::json(runQuery());

        case 'check':
            Http::json(checkQuery());

        // --- structure editor ---
        case 'table_info':
            Http::json(TableEditor::forSession(Http::requireString('db'))->info(Http::requireString('table')));

        case 'alter_preview':
            $changes = Http::input('changes');
            Http::json(TableEditor::forSession(Http::requireString('db'))->preview(Http::requireString('table'), is_array($changes) ? $changes : []));

        case 'ddl_checks':
            $fks = Http::input('foreignKeys');
            $defs = Http::input('columns');
            $chk = Http::input('checks');
            $uq = Http::input('uniques');
            $editor = TableEditor::forSession(Http::requireString('db'));
            $tbl = Http::requireString('table');
            Http::json($editor->fkChecks($tbl, is_array($fks) ? $fks : [], is_array($defs) ? $defs : [])
                + ['checks' => $editor->checkViolations($tbl, is_array($chk) ? $chk : []), 'uniques' => $editor->uniqueChecks($tbl, is_array($uq) ? $uq : [])]);

        case 'poly_types':
            Http::json(polyTypes());

        case 'fk_incoming':
            Http::json(TableEditor::forSession(Http::requireString('db'))->incomingCounts(Http::requireString('table')));

        case 'alter_apply':
            assertWritable();
            $changes = Http::input('changes');
            Http::json(TableEditor::forSession(Http::requireString('db'))->apply(Http::requireString('table'), is_array($changes) ? $changes : []));

        // --- monitor (server level) ---
        case 'monitor_caps':
            Http::json(Monitor::forSession()->capabilities());

        case 'monitor_live':
            Http::json(Monitor::live());

        case 'processlist':
            Http::json(Monitor::forSession()->processlist(Http::input('hideLiterals', '1') !== '0'));

        case 'monitor_explain':
            Http::json(Monitor::forSession()->explainThread((int) Http::input('id', 0)));

        case 'monitor_kill':
            Http::json(Monitor::forSession()->kill((int) Http::input('id', 0), (bool) Http::input('queryOnly', true), (int) Http::input('selfId', 0)));

        case 'top_queries':
            Http::json(Monitor::forSession()->topQueries((string) Http::input('sort', 'total')));

        case 'digest_detail':
            Http::json(Monitor::forSession()->digestDetail(Http::requireString('digest')));

        case 'monitor_reset_digests':
            Http::json(Monitor::forSession()->resetDigests());

        case 'monitor_storage':
            Http::json(Monitor::forSession()->storage());

        case 'monitor_optimize':
            if ($config['read_only']) {
                throw new ApiError('read_only', 'This installation is read-only', 403);
            }
            Http::json(Monitor::forSession()->optimize(Http::requireString('db'), Http::requireString('table')));

        case 'monitor_advisor':
            Http::json(Monitor::forSession()->advisor());

        case 'monitor_deadlock':
            Http::json(Monitor::forSession()->lastDeadlock(Http::input('hideLiterals', '1') !== '0'));

        case 'monitor_history':
            Http::json(monitorHistory());

        case 'monitor_peak':
            $peak = MetricsStore::open()->peak(Collector::sessionKey(), Http::requireString('id'));
            if (!$peak) {
                throw new ApiError('not_found', 'Peak not found', 404);
            }
            Http::json($peak);

        case 'ai':
            $db = Http::requireString('db');
            Db::useDatabase($db);
            Http::json(Ai::run(
                (string) Http::input('mode', 'generate'),
                $db,
                (string) Http::input('lang', 'en'),
                pmf_substr((string) Http::input('prompt', ''), 4000),
                pmf_substr((string) Http::input('sql', ''), 20000),
                pmf_substr((string) Http::input('error', ''), 2000)
            ));

        // --- database tools (phase A) ---
        case 'db_caps':
            Http::json(dbCaps());

        case 'db_overview':
            Http::json(Ddl::forSession()->overview(Http::requireString('db')));

        case 'charsets':
            Http::json(Ddl::forSession()->charsets());

        case 'db_impact':
            Http::json(Ddl::forSession()->databaseImpact(Http::requireString('db')));

        case 'tables_impact':
            Http::json(Ddl::forSession()->tablesImpact(Http::requireString('db'), jsonList('tables')));

        case 'table_create_code':
            Http::json(['sql' => Ddl::forSession()->createCode(Http::requireString('db'), Http::requireString('table'))]);

        case 'db_create':
            assertWritable();
            Http::json(Ddl::forSession()->createDatabase(Http::requireString('name'), strOrNull('charset'), strOrNull('collation')));

        case 'db_alter':
            assertWritable();
            Http::json(Ddl::forSession()->alterDatabase(Http::requireString('db'), strOrNull('charset'), strOrNull('collation')));

        case 'db_drop':
            assertWritable();
            $db = Http::requireString('db');
            requireTyped($db);
            Http::json(Ddl::forSession()->dropDatabase($db));

        case 'table_create':
            assertWritable();
            $spec = Http::input('spec');
            Http::json(Ddl::forSession()->createTable(Http::requireString('db'), is_array($spec) ? $spec : []));

        case 'table_rename':
            assertWritable();
            Http::json(Ddl::forSession()->renameTable(Http::requireString('db'), Http::requireString('from'), Http::requireString('to')));

        case 'table_copy':
            assertWritable();
            Http::json(Ddl::forSession()->copyStructure(Http::requireString('db'), Http::requireString('table'), Http::requireString('targetDb'), Http::requireString('newName'), (bool) Http::input('indexes', true)));

        case 'table_copy_rows':
            assertWritable();
            $after = Http::input('after');
            Http::json(Ddl::forSession()->copyRows(Http::requireString('db'), Http::requireString('table'), Http::requireString('targetDb'), Http::requireString('newName'), is_array($after) ? $after : null, (int) Http::input('batch', 5000)));

        case 'table_copy_fks':
            assertWritable();
            Http::json(Ddl::forSession()->copyForeignKeys(Http::requireString('db'), Http::requireString('table'), Http::requireString('targetDb'), Http::requireString('newName'), (bool) Http::input('remap', false)));

        case 'view_copy':
            assertWritable();
            Http::json(Ddl::forSession()->copyView(Http::requireString('db'), Http::requireString('view'), Http::requireString('targetDb')));

        case 'tables_truncate':
        case 'tables_drop':
            assertWritable();
            $db = Http::requireString('db');
            $list = Http::input('tables');
            $list = is_array($list) ? array_values(array_filter($list, 'is_string')) : [];
            if (!$list) {
                throw new ApiError('missing_param', 'Missing parameter: tables', 400);
            }
            requireTyped(count($list) === 1 ? $list[0] : $db);
            Http::json(Ddl::forSession()->emptyOrDrop($db, $list, $action === 'tables_drop', (bool) Http::input('ignoreFks', false)));

        // Export = a job of short steps driven by the browser (ExportJob).
        case 'export_start':
            $db = Http::requireString('db');
            Schema::assertDatabaseExists($db);
            Db::useDatabase($db);
            $tables = Http::input('tables');
            Http::json(ExportJob::start(Db::pdo(), Jobs::dir(), ['db' => $db, 'tables' => is_array($tables) ? $tables : [], 'format' => (string) Http::input('format', 'sql'), 'options' => (array) Http::input('options', [])]));

        case 'export_step':
            $job = ExportJob::load(Db::pdo(), Jobs::dir(), Http::requireString('id'));
            Db::useDatabase($job->db());
            Http::json($job->step(Jobs::stepSeconds()));

        case 'export_status':
            Http::json(ExportJob::peek(Jobs::dir(), Http::requireString('id')));

        case 'export_download':
            ExportJob::download(Jobs::dir(), Http::requireString('id'));

        case 'export_cancel':
            Http::json(ExportJob::cancel(Jobs::dir(), Http::requireString('id')));

        // --- views, routines, triggers, events (phase B) ---
        case 'db_objects':
            Http::json(Objects::forSession(Http::requireString('db'))->list());

        case 'object_info':
            Http::json(Objects::forSession(Http::requireString('db'))->info(Http::requireString('kind'), Http::requireString('name')));

        case 'object_code':
            Http::json(['sql' => Objects::forSession(Http::requireString('db'))->createCode(Http::requireString('kind'), Http::requireString('name'))]);

        case 'object_impact':
            Http::json(Objects::forSession(Http::requireString('db'))->impact(Http::requireString('kind'), Http::requireString('name')));

        case 'object_preview':
            $spec = Http::input('spec');
            $steps = Objects::forSession(Http::requireString('db'))->plan(Http::requireString('kind'), is_array($spec) ? $spec : [], strOrNull('original'));
            Http::json(['sql' => implode(";\n", $steps) . ';', 'steps' => count($steps)]);

        case 'object_save':
            assertWritable();
            $spec = Http::input('spec');
            Http::json(Objects::forSession(Http::requireString('db'))->save(Http::requireString('kind'), is_array($spec) ? $spec : [], strOrNull('original')));

        case 'object_drop':
            assertWritable();
            $name = Http::requireString('name');
            requireTyped($name);
            Http::json(Objects::forSession(Http::requireString('db'))->drop(Http::requireString('kind'), $name));

        case 'routine_execute':
            assertWritable(); // a routine can change data
            $args = Http::input('args');
            Http::json(Objects::forSession(Http::requireString('db'))->execute(Http::requireString('kind'), Http::requireString('name'), is_array($args) ? $args : [], min(1000, (int) $config['max_result_rows'])));

        case 'lookup':
            Http::json(lookup());

        case 'lookup_many':
            Http::json(lookupMany());

        // --- database tools (phase C) ---
        case 'maint_run':
            assertWritable();
            Http::json(Tools::forSession()->maintenance(Http::requireString('db'), Http::requireString('table'), Http::requireString('op'), strOrNull('option')));

        case 'search_plan':
            $dbs = Http::input('dbs');
            $tbls = Http::input('tables');
            Http::json(Tools::forSession()->searchPlan(is_array($dbs) ? array_values(array_filter($dbs, 'is_string')) : null, is_array($tbls) ? array_values(array_filter($tbls, 'is_string')) : null));

        case 'search_table':
            Http::json(Tools::forSession()->searchTable(Http::requireString('db'), Http::requireString('table'), (string) Http::input('q', ''), Http::requireString('mode'), (bool) Http::input('caseSensitive', false), (bool) Http::input('allColumns', false), (int) Http::input('timeoutMs', 10000)));

        case 'bulk_plan':
            $tbls = Http::input('tables');
            $ch = Http::input('changes');
            Http::json(Tools::forSession()->bulkPlan(Http::requireString('db'), is_array($tbls) ? $tbls : [], is_array($ch) ? $ch : []));

        case 'bulk_apply':
            assertWritable();
            $ch = Http::input('changes');
            Http::json(Tools::forSession()->bulkApply(Http::requireString('db'), Http::requireString('table'), is_array($ch) ? $ch : []));

        case 'gen_plan':
            Http::json(Tools::forSession()->genPlan(Http::requireString('db'), Http::requireString('table')));

        case 'gen_rows':
            $insert = (bool) Http::input('insert', false);
            if ($insert) {
                assertWritable();
            }
            $cols = Http::input('columns');
            Http::json(Tools::forSession()->generate(Http::requireString('db'), Http::requireString('table'), is_array($cols) ? $cols : [], (int) Http::input('count', 10), (int) Http::input('start', 0), (int) Http::input('seed', 1), (string) Http::input('token', 'x'), $insert));

        case 'import_upload':
            assertWritable();
            // Raw body (one chunk); id and offset in the query string.
            Http::json(Import::upload(isset($_GET['id']) ? (string) $_GET['id'] : null, (int) ($_GET['offset'] ?? 0), (string) file_get_contents('php://input')));

        case 'import_run':
            assertWritable();
            $db = Http::requireString('db');
            Schema::assertDatabaseExists($db);
            $retarget = Http::input('retarget');
            Http::json(Import::run(Http::requireString('id'), ['db' => $db, 'noFkChecks' => (bool) Http::input('noFkChecks', false), 'continueOnError' => (bool) Http::input('continueOnError', false), 'retarget' => is_array($retarget) ? array_values(array_filter($retarget, 'is_string')) : null]));

        case 'import_inspect':
            // The first 256 KB of the file (raw body): what it says about its source database.
            $head = (string) file_get_contents('php://input', false, null, 0, 300 * 1024);
            Http::json(PhpMyFlow\SqlRetarget::inspect($head));

        case 'import_status':
            Http::json(Import::status(Http::requireString('id')));

        case 'import_finish':
            Http::json(Import::finish(Http::requireString('id')));

        case 'test_fault':
            if (!$testFaults) {
                throw new ApiError('unknown_action', 'Unknown action', 404);
            }
            testFault((string) ($_GET['kind'] ?? ''));

        default:
            throw new ApiError('unknown_action', 'Unknown action', 404);
    }
} catch (ApiError $e) {
    Http::json(['error' => ['code' => $e->errorCode, 'message' => $e->getMessage(), 'details' => $e->details]], $e->status);
} catch (\PDOException $e) {
    $err = Sql::errorFromPdo($e);
    Http::json(['error' => ['code' => $err->errorCode, 'message' => $err->getMessage(), 'details' => $err->details]], $err->status);
} catch (\Throwable $e) {
    // Detail to the PHP log under an incident id; the browser gets the id only.
    PhpMyFlow\Guard::fail('internal', 'Internal error', $e);
    exit;
}

// --------------------------------------------------------------------------

/** Forced failures for tests/php/ApiJsonTest.php (only with PMF_TEST_FAULTS=1). */
function testFault(string $kind): never
{
    switch ($kind) {
        case 'warning':
            $a = [];
            $x = $a['missing']; // Warning: Undefined array key
            break;
        case 'deprecated':
            trigger_error('Something old', E_USER_DEPRECATED);
            break;
        case 'echo':
            echo "debug output
";
            break;
        case 'exception':
            throw new \RuntimeException('secret detail C:\path\file.php');
        case 'time_limit':
            set_time_limit(1);
            $t = microtime(true);
            while (true) {
                $t += 1; // busy: the time limit stops it
            }
        case 'memory':
            ini_set('memory_limit', '16M');
            $big = str_repeat('x', 64 * 1024 * 1024);
            break;
    }
    Http::json(['ok' => true, 'fault' => $kind]);
}

/** Destructive actions: the client must send the name the user typed. */
function requireTyped(string $name): void
{
    if (Http::input('confirm') !== $name) {
        throw new ApiError('confirm_name', 'Type the name to confirm', 400, ['name' => $name]);
    }
}

function strOrNull(string $key): ?string
{
    $v = Http::input($key);
    return is_string($v) && $v !== '' ? $v : null;
}

/** A list parameter: JSON array in the query string (GET) or an array (POST). */
function jsonList(string $key): array
{
    $v = Http::input($key);
    if (is_string($v)) {
        $v = json_decode($v, true);
    }
    return is_array($v) ? array_values(array_filter($v, 'is_string')) : [];
}

/**
 * What the user may do on the server and on one database, from SHOW GRANTS.
 * The UI disables actions with the missing privilege and its GRANT.
 */
function dbCaps(): array
{
    $p = Privileges::current();
    $db = strOrNull('db');
    $privs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'INDEX', 'REFERENCES', 'CREATE VIEW', 'SHOW VIEW', 'LOCK TABLES', 'CREATE ROUTINE', 'ALTER ROUTINE', 'EXECUTE', 'TRIGGER', 'EVENT'];
    $on = [];
    $grants = [];
    foreach ($privs as $priv) {
        $on[$priv] = $db === null ? $p->has($priv, null) : $p->has($priv, $db);
        $grants[$priv] = $p->grant($priv, $db);
    }
    $managed = null;
    if ($db !== null) {
        Schema::assertDatabaseExists($db);
        try {
            $managed = TableEditor::forSession($db)->managedBy();
        } catch (\Throwable) {
            $managed = null;
        }
    }
    return [
        'readOnly' => (bool) pmf_config()['read_only'],
        'db' => $db,
        'system' => $db !== null && in_array(strtolower($db), Ddl::SYSTEM_DBS, true),
        'managedBy' => $managed,
        'privileges' => $on,
        'grants' => $grants,
        'createDb' => $p->canCreateSomeDatabase(),
        'setDefiner' => $p->has('SUPER', null) === true || $p->has('SET_USER_ID', null) === true,
        'createDbGrant' => $p->grant('CREATE', null),
    ];
}

function assertWritable(): void
{
    if (pmf_config()['read_only']) {
        throw new ApiError('read_only', 'This installation is read-only', 403);
    }
}

function blobTypes(): array
{
    return ['blob', 'tinyblob', 'mediumblob', 'longblob', 'binary', 'varbinary', 'geometry', 'point', 'linestring', 'polygon'];
}

/**
 * WHERE clause from the grid filters. Column names are checked against
 * information_schema; values only travel as bound parameters.
 *
 * Filter syntax (typed by the column):
 *   any column:  NULL, !NULL, =exact, !=exact, or text (LIKE %text%)
 *   numbers:     10, =10, !=10, >10, >=10, <10, <=10, 10..20
 *   dates:       2026-01-01, >2026-01-01, 2026-01-01..2026-03-31, ..2026-03-31
 */
function rowsFilter(array $columns): array
{
    $byName = [];
    foreach ($columns as $c) {
        $byName[$c['name']] = strtolower($c['dataType']);
    }
    $where = [];
    $params = [];
    $filters = json_decode((string) Http::input('filters', '{}'), true);
    if (!is_array($filters)) {
        return ['', []];
    }
    $num = '-?\d+(?:\.\d+)?';
    $date = '\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?';
    foreach ($filters as $col => $value) {
        if (!is_string($col) || !isset($byName[$col]) || !is_scalar($value)) {
            continue;
        }
        $value = trim((string) $value);
        if ($value === '') {
            continue;
        }
        $id = Db::ident($col);
        $type = $byName[$col];
        if (strtoupper($value) === 'NULL') {
            $where[] = "$id IS NULL";
            continue;
        }
        if (strtoupper($value) === '!NULL') {
            $where[] = "$id IS NOT NULL";
            continue;
        }
        $isNum = (bool) preg_match('/^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|year)$/', $type);
        $isDate = in_array($type, ['date', 'datetime', 'timestamp'], true);
        $m = [];
        if ($isNum && preg_match("/^($num)\s*\.\.\s*($num)$/", $value, $m)) {
            $where[] = "$id BETWEEN ? AND ?";
            array_push($params, $m[1], $m[2]);
            continue;
        }
        if ($isNum && preg_match("/^(>=|<=|!=|<>|>|<|=)?\s*($num)$/", $value, $m)) {
            $op = $m[1] === '' ? '=' : ($m[1] === '<>' ? '!=' : $m[1]);
            $where[] = "$id $op ?";
            $params[] = $m[2];
            continue;
        }
        if ($isDate && preg_match("/^($date)?\s*\.\.\s*($date)?$/", $value, $m) && (($m[1] ?? '') !== '' || ($m[2] ?? '') !== '')) {
            if (($m[1] ?? '') !== '') {
                $where[] = "$id >= ?";
                $params[] = $m[1];
            }
            if (($m[2] ?? '') !== '') {
                // A bare end date includes the whole day.
                if (strlen($m[2]) === 10) {
                    $where[] = "$id < DATE_ADD(?, INTERVAL 1 DAY)";
                } else {
                    $where[] = "$id <= ?";
                }
                $params[] = $m[2];
            }
            continue;
        }
        if ($isDate && preg_match("/^(>=|<=|>|<|=)?\s*($date)$/", $value, $m)) {
            $op = $m[1] === '' ? '=' : $m[1];
            if ($op === '=' && strlen($m[2]) === 10) {
                $where[] = "$id >= ? AND $id < DATE_ADD(?, INTERVAL 1 DAY)";
                array_push($params, $m[2], $m[2]);
            } else {
                $where[] = "$id $op ?";
                $params[] = $m[2];
            }
            continue;
        }
        // Exact match / exclusion for any type ("Filter by this value" in the grid).
        if (strncmp($value, '!=', 2) === 0) {
            $where[] = "($id IS NULL OR CAST($id AS CHAR) <> ?)";
            $params[] = substr($value, 2);
            continue;
        }
        if ($value[0] === '=') {
            // "=a|b": exact match of any of the values (e.g. option_name siteurl or home).
            $list = explode('|', substr($value, 1));
            $where[] = count($list) > 1 ? "CAST($id AS CHAR) IN (" . implode(', ', array_fill(0, count($list), '?')) . ')' : "CAST($id AS CHAR) = ?";
            array_push($params, ...$list);
            continue;
        }
        $where[] = "CAST($id AS CHAR) LIKE ?";
        $params[] = '%' . addcslashes($value, '%_\\') . '%';
    }
    return [$where ? ' WHERE ' . implode(' AND ', $where) : '', $params];
}

function rows(): array
{
    $db = Http::requireString('db');
    $table = Http::requireString('table');
    Db::useDatabase($db);
    $columns = Schema::columns($db, $table);
    $names = array_column($columns, 'name');
    $pk = Schema::primaryKey($db, $table);

    $perPage = max(1, min(500, (int) Http::input('perPage', 100)));
    $page = max(1, (int) Http::input('page', 1));
    $sort = (string) Http::input('sort', '');
    $dir = strtoupper((string) Http::input('dir', 'ASC')) === 'DESC' ? 'DESC' : 'ASC';

    [$whereSql, $params] = rowsFilter($columns);
    $from = ' FROM ' . Db::ident($table) . $whereSql;

    $order = '';
    if ($sort !== '' && in_array($sort, $names, true)) {
        $order = ' ORDER BY ' . Db::ident($sort) . ' ' . $dir;
    } elseif ($pk) {
        $order = ' ORDER BY ' . implode(', ', array_map([Db::class, 'ident'], $pk));
    }

    $started = microtime(true);
    $data = Db::all('SELECT *' . $from . $order . ' LIMIT ' . $perPage . ' OFFSET ' . (($page - 1) * $perPage), $params);

    // The exact count is a separate request (action=count) so it never
    // delays the rows. Send the cheap estimate, or the exact total when
    // this page already proves it (a short page).
    $estimate = (int) (Db::all('SELECT TABLE_ROWS AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [$db, $table])[0]['n'] ?? 0);
    $total = count($data) < $perPage && ($data || $page === 1) ? ($page - 1) * $perPage + count($data) : null;

    $blobCols = array_column(array_filter($columns, static fn ($c) => in_array(strtolower($c['dataType']), blobTypes(), true)), 'name');
    foreach ($data as &$row) {
        foreach ($blobCols as $bc) {
            if ($row[$bc] !== null) {
                $row[$bc] = ['$binary' => strlen((string) $row[$bc])];
            }
        }
    }
    unset($row);

    return [
        'columns' => $columns,
        'primaryKey' => $pk,
        'rows' => $data,
        'total' => $total,
        'estimate' => $estimate,
        'filtered' => $whereSql !== '',
        'page' => $page,
        'perPage' => $perPage,
        'timeMs' => round((microtime(true) - $started) * 1000, 1),
    ];
}

/**
 * Rows in other tables that point to one record (declared and inferred
 * relations whose target is this table's single-column PK). Relations are
 * computed on the server from information_schema, never taken from the
 * client. Each count stops at 1000 so unindexed columns stay cheap.
 */
/**
 * Type values used by a polymorphic pair (itemtype + items_id). Read-only and
 * bounded: distinct values within the first 100,000 rows, at most 50.
 */
function polyTypes(): array
{
    $db = Http::requireString('db');
    $table = Http::requireString('table');
    $column = Http::requireString('column');
    $cols = array_column(Schema::columns($db, $table), 'name');
    if (!in_array($column, $cols, true)) {
        throw new ApiError('unknown_column', "Unknown column: $column", 404, ['name' => $column]);
    }
    Db::useDatabase($db);
    $c = Db::ident($column);
    $rows = Db::all("SELECT DISTINCT $c AS v FROM (SELECT $c FROM " . Db::ident($table) . " LIMIT 100000) x WHERE $c IS NOT NULL AND $c <> '' ORDER BY 1 LIMIT 51");
    $types = array_map(static fn ($r) => \pmf_substr((string) $r['v'], 100), $rows);
    return ['types' => array_slice($types, 0, 50), 'more' => count($types) > 50];
}

/**
 * RecordPicker: rows of a table by label or key. The label column is the
 * one the user chose for that table, else the first of name/title/label/...
 * or the first text column. Read-only, at most 20 rows.
 */
/**
 * config.php 'ui' → only known keys with valid values (the browser validates
 * again). Empty object when nothing is set.
 */
function uiDefaults(array $ui): object
{
    $allowed = [
        'theme' => ['monochrome', 'graphite', 'slate', 'spider', 'forest', 'contrast'],
        'mode' => ['light', 'dark', 'system'],
        'density' => ['compact', 'comfortable'],
        'radius' => ['sharp', 'soft', 'round'],
        'fontSize' => [13, 14, 15, 16],
    ];
    $out = [];
    foreach ($allowed as $key => $values) {
        if (isset($ui[$key]) && in_array($ui[$key], $values, true)) {
            $out[$key] = $ui[$key];
        }
    }
    if (isset($ui['accent']) && is_string($ui['accent']) && preg_match('/^#[0-9a-fA-F]{6}$/', $ui['accent'])) {
        $out['accent'] = strtolower($ui['accent']);
    }
    return (object) $out;
}

/** RecordPicker search ("3 · Mantenimiento"). */
function lookup(): array
{
    $db = Http::requireString('db');
    Schema::assertDatabaseExists($db);
    return (new Lookup(Db::pdo(), $db))->search(Http::requireString('table'), (string) Http::input('q', ''), strOrNull('column'), strOrNull('label'), (int) Http::input('limit', 20));
}

/** Names for the grid's foreign key cells: one query per related column. */
function lookupMany(): array
{
    $db = Http::requireString('db');
    Schema::assertDatabaseExists($db);
    $refs = Http::input('refs');
    return ['labels' => (new Lookup(Db::pdo(), $db))->many(is_array($refs) ? $refs : [])];
}

function refCounts(): array
{
    $db = Http::requireString('db');
    $table = Http::requireString('table');
    $value = Http::input('value');
    if (!is_scalar($value)) {
        throw new ApiError('bad_value', 'Unsupported value', 400);
    }
    Db::useDatabase($db);
    $full = Schema::full($db);
    if (!isset($full[$table])) {
        throw new ApiError('unknown_table', "Unknown table: $table", 404, ['name' => $table]);
    }
    $pk = Schema::primaryKey($db, $table);
    if (count($pk) !== 1) {
        return ['counts' => []];
    }
    $out = [];
    foreach (Schema::relations($full) as $rel) {
        if ($rel['to'] !== $table || $rel['toColumn'] !== $pk[0] || count($out) >= 25) {
            continue;
        }
        $st = Db::pdo()->prepare('SELECT COUNT(*) FROM (SELECT 1 FROM ' . Db::ident($rel['from']) . ' WHERE ' . Db::ident($rel['column']) . ' = ? LIMIT 1001) x');
        $st->execute([$value]);
        $n = (int) $st->fetchColumn();
        $out[] = ['table' => $rel['from'], 'column' => $rel['column'], 'kind' => $rel['kind'], 'count' => min($n, 1000), 'more' => $n > 1000];
    }
    return ['counts' => $out];
}

/**
 * History for the logged-in server. Up to 2 days: minute samples
 * (downsampled to ~720 points); longer: hourly aggregates (avg, plus max).
 * `compare=1` adds the same range one week earlier.
 */
function monitorHistory(): array
{
    $to = (int) Http::input('to', time());
    $from = (int) Http::input('from', $to - 3600);
    if ($from >= $to || $to - $from > 91 * 86400) {
        throw new ApiError('bad_value', 'Bad range', 400);
    }
    $server = Collector::sessionKey();
    $store = MetricsStore::open();
    $load = static function (int $from, int $to) use ($store, $server): array {
        if ($to - $from <= 2 * 86400) {
            $rows = Metrics::downsample($store->samples($server, $from, $to), 720);
            $series = [];
            foreach (Metrics::SERIES as $m) {
                $series[$m] = array_map(static fn ($r) => $r['m'][$m] ?? null, $rows);
            }
            return ['resolution' => 'minute', 'ts' => array_column($rows, 'ts'), 'series' => $series];
        }
        $rows = $store->hourly($server, $from, $to);
        $series = [];
        $max = [];
        foreach (Metrics::SERIES as $m) {
            $series[$m] = array_map(static fn ($r) => $r['a'][$m]['avg'] ?? null, $rows);
            $max[$m] = array_map(static fn ($r) => $r['a'][$m]['max'] ?? null, $rows);
        }
        return ['resolution' => 'hour', 'ts' => array_column($rows, 'ts'), 'series' => $series, 'max' => $max];
    };
    $out = $load($from, $to) + [
        'peaks' => $store->peaks($server, $from, $to),
        'sizes' => $store->sizes($server, $from, $to),
        'collector' => Collector::status(),
    ];
    if (Http::input('compare', '0') === '1') {
        $week = 7 * 86400;
        $prev = $load($from - $week, $to - $week);
        $prev['ts'] = array_map(static fn ($t) => $t + $week, $prev['ts']);
        $out['compare'] = $prev;
    }
    return $out;
}

function countRows(): array
{
    $db = Http::requireString('db');
    $table = Http::requireString('table');
    Db::useDatabase($db);
    $columns = Schema::columns($db, $table);
    [$whereSql, $params] = rowsFilter($columns);

    // Exact counts on huge InnoDB tables are slow; fall back to the estimate.
    $estimate = (int) (Db::all('SELECT TABLE_ROWS AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [$db, $table])[0]['n'] ?? 0);
    if ($whereSql === '' && $estimate > 500000 && Http::input('exact') !== '1') {
        return ['total' => $estimate, 'approx' => true, 'timeMs' => 0];
    }
    $started = microtime(true);
    $total = (int) Db::all('SELECT COUNT(*) AS n FROM ' . Db::ident($table) . $whereSql, $params)[0]['n'];
    return ['total' => $total, 'approx' => false, 'timeMs' => round((microtime(true) - $started) * 1000, 1)];
}

/** Build "pk1 = ? AND pk2 = ?" from a client-sent key, validating every column. */
function pkWhere(array $pkCols, mixed $key): array
{
    if (!$pkCols) {
        throw new ApiError('no_primary_key', 'Tables without a primary key cannot be edited from the grid', 400);
    }
    if (!is_array($key)) {
        throw new ApiError('missing_param', 'Missing row key', 400);
    }
    $parts = [];
    $params = [];
    foreach ($pkCols as $col) {
        if (!array_key_exists($col, $key)) {
            throw new ApiError('missing_param', "Missing key column: $col", 400);
        }
        $parts[] = Db::ident($col) . ' = ?';
        $params[] = $key[$col];
    }
    return [implode(' AND ', $parts), $params];
}

function updateCell(): array
{
    assertWritable();
    $db = Http::requireString('db');
    $table = Http::requireString('table');
    $column = Http::requireString('column');
    Db::useDatabase($db);
    $names = array_column(Schema::columns($db, $table), 'name');
    if (!in_array($column, $names, true)) {
        throw new ApiError('unknown_column', "Unknown column: $column", 404, ['name' => $column]);
    }
    [$where, $params] = pkWhere(Schema::primaryKey($db, $table), Http::input('key'));
    $value = Http::input('value');
    if (is_array($value)) {
        throw new ApiError('bad_value', 'Unsupported value', 400);
    }
    $st = Db::pdo()->prepare('UPDATE ' . Db::ident($table) . ' SET ' . Db::ident($column) . ' = ? WHERE ' . $where . ' LIMIT 1');
    $st->execute(array_merge([$value], $params));
    return ['ok' => true, 'affected' => $st->rowCount()];
}

/**
 * Insert one row. Only the columns sent are written (the rest take their
 * default); names are checked against information_schema, generated
 * columns are refused, values go through a prepared statement.
 */
function insertRow(): array
{
    assertWritable();
    $db = Http::requireString('db');
    $table = Http::requireString('table');
    Db::useDatabase($db);
    $columns = array_column(Schema::columns($db, $table), null, 'name');
    $values = Http::input('values');
    if (!is_array($values)) {
        $values = [];
    }
    $names = [];
    $params = [];
    foreach ($values as $col => $value) {
        if (!is_string($col) || !isset($columns[$col])) {
            throw new ApiError('unknown_column', "Unknown column: $col", 404, ['name' => (string) $col]);
        }
        if (Schema::isGenerated($columns[$col]['extra'])) {
            throw new ApiError('generated_column', "Column $col is generated", 400, ['name' => $col]);
        }
        if (is_array($value)) {
            throw new ApiError('bad_value', 'Unsupported value', 400);
        }
        $names[] = Db::ident($col);
        $params[] = $value;
    }
    $sql = 'INSERT INTO ' . Db::ident($table) . ' (' . implode(', ', $names) . ') VALUES (' . implode(', ', array_fill(0, count($names), '?')) . ')';
    $st = Db::pdo()->prepare($sql);
    $st->execute($params);
    $id = Db::pdo()->lastInsertId();
    return ['ok' => true, 'insertId' => $id !== '0' && $id !== false ? $id : null, 'affected' => $st->rowCount()];
}

function deleteRows(): array
{
    assertWritable();
    $db = Http::requireString('db');
    $table = Http::requireString('table');
    Db::useDatabase($db);
    Schema::columns($db, $table);
    $pk = Schema::primaryKey($db, $table);
    $keys = Http::input('keys');
    if (!is_array($keys) || !$keys || count($keys) > 1000) {
        throw new ApiError('missing_param', 'Send between 1 and 1000 row keys', 400);
    }
    $pdo = Db::pdo();
    $pdo->beginTransaction();
    $affected = 0;
    try {
        foreach ($keys as $key) {
            [$where, $params] = pkWhere($pk, $key);
            $st = $pdo->prepare('DELETE FROM ' . Db::ident($table) . ' WHERE ' . $where . ' LIMIT 1');
            $st->execute($params);
            $affected += $st->rowCount();
        }
        $pdo->commit();
    } catch (\Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return ['ok' => true, 'affected' => $affected];
}

function cleanSql(string $sql): string
{
    return rtrim(trim($sql), "; \t\n\r");
}

/** Text protocol for free queries: some statements (SHOW..., CREATE PROCEDURE) can't be prepared. */
function textProtocol(): void
{
    Db::pdo()->setAttribute(\PDO::ATTR_EMULATE_PREPARES, true);
}

function runQuery(): array
{
    $sql = cleanSql(Http::requireString('sql'));
    $db = (string) Http::input('db', '');
    if ($db !== '') {
        Db::useDatabase($db);
    }
    $info = Sql::classify($sql);
    if (!$info['readOnly']) {
        assertWritable();
    }
    if ($info['destructive'] && Http::input('confirm') !== true) {
        return ['needsConfirm' => true, 'reason' => $info['reason'], 'verb' => $info['verb']];
    }

    $max = (int) pmf_config()['max_result_rows'];
    textProtocol();
    $started = microtime(true);
    $st = Db::pdo()->query($sql);
    $timeMs = round((microtime(true) - $started) * 1000, 1);

    if ($st->columnCount() === 0) {
        return ['type' => 'affected', 'verb' => $info['verb'], 'affected' => $st->rowCount(), 'timeMs' => $timeMs];
    }

    $columns = [];
    for ($i = 0; $i < $st->columnCount(); $i++) {
        $meta = $st->getColumnMeta($i) ?: [];
        $columns[] = ['name' => $meta['name'] ?? "col$i", 'type' => strtolower((string) ($meta['native_type'] ?? ''))];
    }
    $rows = [];
    $truncated = false;
    while (($row = $st->fetch(\PDO::FETCH_NUM)) !== false) {
        if (count($rows) >= $max) {
            $truncated = true;
            break;
        }
        foreach ($row as $i => $v) {
            // Non-UTF-8 bytes would break JSON: report size instead.
            if (is_string($v) && !pmf_is_utf8($v)) {
                $row[$i] = ['$binary' => strlen($v)];
            }
        }
        $rows[] = $row;
    }
    $st->closeCursor();

    return ['type' => 'resultset', 'columns' => $columns, 'rows' => $rows, 'truncated' => $truncated, 'maxRows' => $max, 'timeMs' => $timeMs];
}

/**
 * Server-side validation without executing: EXPLAIN parses the statement
 * and resolves every table and column, so it catches what a client-side
 * parser can't (permissions, views, server-specific syntax).
 */
function checkQuery(): array
{
    $sql = cleanSql(Http::requireString('sql'));
    $db = (string) Http::input('db', '');
    if ($db !== '') {
        Db::useDatabase($db);
    }
    $verb = Sql::classify($sql)['verb'];
    if (!in_array($verb, Sql::KNOWN_VERBS, true)) {
        $first = preg_split('~\s+~', $sql)[0] ?? '';
        return ['ok' => false, 'error' => ['code' => 'unknown_statement', 'message' => "Unknown statement: $first", 'details' => ['near' => $first, 'line' => 1]]];
    }
    if (!in_array($verb, ['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'], true)) {
        return ['ok' => true, 'skipped' => true];
    }
    try {
        textProtocol();
        Db::pdo()->query('EXPLAIN ' . $sql)->fetchAll();
        return ['ok' => true];
    } catch (\PDOException $e) {
        $err = Sql::errorFromPdo($e);
        return ['ok' => false, 'error' => ['code' => $err->errorCode, 'message' => $err->getMessage(), 'details' => $err->details]];
    }
}
