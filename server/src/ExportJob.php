<?php
declare(strict_types=1);

namespace PhpMyFlow;

use PDO;

/**
 * Export as a job of short steps driven by the browser:
 *
 *   export_start  → plan (2 queries, whatever the number of tables) + state
 *   export_step   → works ~3 s (config 'job_step_seconds'), appends to a
 *                   private temp file, returns progress; the browser asks again
 *   export_download → serves the finished file once, then deletes it
 *
 * Why: one long request dies on hosts with a time limit, and on `php -S` it
 * blocks everything else (and on Windows max_execution_time counts the time
 * spent waiting for a remote MySQL). Every step is a few units (header, one
 * table's structure, one batch of rows, views...), and after each unit the
 * output is flushed and the state saved with the file size: if a request is
 * cut, the next step truncates the file to that size and goes on, so nothing
 * is lost or duplicated. Rows are read unbuffered in batches of about 4 MB.
 *
 * Formats: sql (optionally gzip, one gzip member per unit), csv / json (one
 * file, or a ZIP with a file per table), xlsx (one workbook, a sheet per table).
 */
final class ExportJob
{
    public const FORMATS = ['sql', 'csv', 'json', 'xlsx'];
    /** Bytes per write. */
    private const FLUSH = 262144;
    /** Target bytes per batch of rows. */
    private const BATCH_BYTES = 4 * 1048576;
    private const XLSX_MAX_ROWS = 1048575;
    private const LOG_MAX = 400;

    private array $s;
    /** @var resource|null */
    private $fh = null;
    private string $buf = '';
    private ?ZipWriter $zip = null;
    /** @var resource|\DeflateContext|null */
    private $gz = null;
    private int $memBase = 0;
    private float $savedAt = 0.0;

    private function __construct(private ?PDO $pdo, private string $dir, array $state)
    {
        $this->s = $state;
    }

    // ------------------------------------------------------------------
    // API
    // ------------------------------------------------------------------

    /**
     * @param array{db:string, tables?:list<string>, format?:string, options?:array} $req
     */
    public static function start(PDO $pdo, string $dir, array $req): array
    {
        $db = (string) $req['db'];
        $format = (string) ($req['format'] ?? 'sql');
        if (!in_array($format, self::FORMATS, true)) {
            throw new ApiError('bad_format', 'Unknown format', 400);
        }
        $o = (array) ($req['options'] ?? []);
        $opt = [
            'structure' => $o['structure'] ?? true,
            'data' => $o['data'] ?? true,
            'dropTable' => $o['dropTable'] ?? true,
            'createDb' => $o['createDb'] ?? false,
            'noFkChecks' => $o['noFkChecks'] ?? true,
            'routines' => $o['routines'] ?? false,
            'triggers' => $o['triggers'] ?? false,
            'events' => $o['events'] ?? false,
            'insertRows' => max(1, min(5000, (int) ($o['insertRows'] ?? 500))),
            'gzip' => !empty($o['gzip']) && $format === 'sql' && function_exists('deflate_init'),
        ];
        foreach (['structure', 'data', 'dropTable', 'createDb', 'noFkChecks', 'routines', 'triggers', 'events'] as $k) {
            $opt[$k] = (bool) $opt[$k];
        }
        if ($format === 'sql' && !$opt['structure'] && !$opt['data']) {
            throw new ApiError('bad_options', 'Nothing to export', 400);
        }

        // Two queries for the whole plan (not one per table: on a remote server
        // with 142 tables that alone went over a 30 s time limit).
        $st = $pdo->prepare('SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS approxRows FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME');
        $st->execute([$db]);
        $all = $st->fetchAll(PDO::FETCH_ASSOC);
        $only = array_values(array_map('strval', (array) ($req['tables'] ?? [])));
        if ($only) {
            $known = array_column($all, 'name');
            foreach ($only as $t) {
                if (!in_array($t, $known, true)) {
                    throw new ApiError('unknown_table', "Unknown table: $t", 404, ['name' => $t]);
                }
            }
            $all = array_values(array_filter($all, static fn ($t) => in_array($t['name'], $only, true)));
        }
        $pk = $pdo->prepare("SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY TABLE_NAME, ORDINAL_POSITION");
        $pk->execute([$db]);
        $pks = [];
        foreach ($pk->fetchAll(PDO::FETCH_NUM) as [$t, $c]) {
            $pks[$t][] = $c;
        }
        // Columns of every table in one query too (one round trip less per table).
        $cq = $pdo->prepare('SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION');
        $cq->execute([$db]);
        $colsOf = [];
        foreach ($cq->fetchAll(PDO::FETCH_NUM) as [$t, $name, $type, $extra]) {
            $colsOf[$t][] = self::column((string) $name, (string) $type, (string) $extra);
        }
        $tables = [];
        $views = [];
        foreach ($all as $t) {
            if ($t['type'] === 'VIEW') {
                $views[] = $t['name'];
                continue;
            }
            $tables[] = ['name' => $t['name'], 'pk' => $pks[$t['name']] ?? [], 'approx' => (int) $t['approxRows'], 'rows' => 0, 'bytes' => 0, 'done' => false, 'cols' => $colsOf[$t['name']] ?? null];
        }
        if (!$tables && !$views) {
            throw new ApiError('nothing_to_export', 'The database has no tables', 400);
        }
        $multi = count($tables) + count($views) > 1 || !$only;
        $ext = match ($format) {
            'sql' => $opt['gzip'] ? 'sql.gz' : 'sql',
            'xlsx' => 'xlsx',
            default => $multi ? 'zip' : $format,
        };
        $base = count($only) === 1 ? "$db-{$only[0]}" : ($only ? "$db-" . count($only) . '-tables' : $db);
        $id = Jobs::newId();
        $state = [
            'id' => $id,
            'kind' => 'export',
            'db' => $db,
            'format' => $format,
            'opt' => $opt,
            'zipped' => $format === 'xlsx' || ($format !== 'sql' && $multi),
            'tables' => $tables,
            'views' => $views,
            'cur' => ['ti' => 0, 'phase' => 'header', 'after' => null, 'offset' => 0, 'first' => true, 'cols' => null, 'batch' => 1000],
            'size' => 0,
            'rows' => 0,
            'status' => 'running',
            'error' => null,
            'log' => [],
            'fileName' => preg_replace('~[^\w.\-]+~u', '_', $base) . '-' . date('Y-m-d-His') . ".$ext",
            'started' => time(),
            'workMs' => 0,
            'steps' => 0,
            'memoryPeak' => 0,
            'zip' => [],
        ];
        touch(self::outFile($dir, $id));
        Jobs::writeState(self::stateFile($dir, $id), $state);
        return (new self($pdo, $dir, $state))->status();
    }

    public function db(): string
    {
        return (string) $this->s['db'];
    }

    public static function load(PDO $pdo, string $dir, string $id): self
    {
        $s = Jobs::readState(self::stateFile($dir, Jobs::checkId($id)));
        if (!$s || ($s['kind'] ?? '') !== 'export') {
            throw new ApiError('job_not_found', 'Unknown job', 404);
        }
        return new self($pdo, $dir, $s);
    }

    /** Read-only status (no database needed). */
    public static function peek(string $dir, string $id): array
    {
        $s = Jobs::readState(self::stateFile($dir, Jobs::checkId($id)));
        if (!$s) {
            throw new ApiError('job_not_found', 'Unknown job', 404);
        }
        return (new self(null, $dir, $s))->status();
    }

    public static function cancel(string $dir, string $id): array
    {
        Jobs::checkId($id);
        foreach ([self::stateFile($dir, $id), self::outFile($dir, $id)] as $f) {
            if (is_file($f)) {
                @unlink($f);
            }
        }
        return ['ok' => true];
    }

    /** Serve the finished file once (then delete it). */
    public static function download(string $dir, string $id): never
    {
        $s = Jobs::readState(self::stateFile($dir, Jobs::checkId($id)));
        $file = self::outFile($dir, $id);
        if (!$s || !is_file($file)) {
            throw new ApiError('job_not_found', 'This export is no longer available', 404);
        }
        if ($s['status'] !== 'done') {
            throw new ApiError('job_not_done', 'The export has not finished', 409);
        }
        Guard::endBuffering();
        @set_time_limit(0);
        $name = (string) $s['fileName'];
        $mime = match (true) {
            str_ends_with($name, '.gz') => 'application/gzip',
            str_ends_with($name, '.zip') => 'application/zip',
            str_ends_with($name, '.xlsx') => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            str_ends_with($name, '.csv') => 'text/csv; charset=utf-8',
            str_ends_with($name, '.json') => 'application/json; charset=utf-8',
            default => 'application/sql; charset=utf-8',
        };
        clearstatcache(true, $file);
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . filesize($file));
        header('Content-Disposition: attachment; filename="' . $name . '"; filename*=UTF-8\'\'' . rawurlencode($name));
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        $in = fopen($file, 'rb');
        while (!feof($in)) {
            echo fread($in, 1048576);
            flush();
            if (connection_aborted()) {
                fclose($in);
                exit; // keep the file: the download can be tried again
            }
        }
        fclose($in);
        self::cancel($dir, $id);
        exit;
    }

    // ------------------------------------------------------------------
    // One step
    // ------------------------------------------------------------------

    public function step(float $budget): array
    {
        if ($this->s['status'] === 'done' || $this->s['status'] === 'cancelled') {
            return $this->status();
        }
        $this->s['status'] = 'running';
        $this->s['error'] = null;
        $t0 = microtime(true);
        $deadline = $t0 + $budget;
        $this->memBase = memory_get_usage();
        Jobs::roomToWork($budget);

        $out = self::outFile($this->dir, $this->s['id']);
        $this->fh = fopen($out, 'c+b');
        // Whatever a cut request wrote after the last saved point is dropped.
        ftruncate($this->fh, (int) $this->s['size']);
        fseek($this->fh, 0, SEEK_END);
        if ($this->s['zipped']) {
            $this->zip = new ZipWriter($this->fh, $this->s['zip']);
        }
        if ($this->s['format'] === 'sql') {
            // TIMESTAMP values are dumped in UTC and the header restores UTC on import.
            $this->pdo->exec("SET SESSION time_zone = '+00:00'");
            // The same sql_mode as the dump header, so quote() escapes values for the
            // mode the dump is imported with (whatever the server's default mode is).
            $this->pdo->exec("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'");
        }
        try {
            do {
                $this->unit();
                $this->commit();
            } while ($this->s['status'] === 'running' && microtime(true) < $deadline);
        } catch (\PDOException | ApiError $e) {
            $this->buf = '';
            $this->gz = null;
            $tb = $this->s['tables'][$this->s['cur']['ti']]['name'] ?? null;
            $this->s['status'] = 'error';
            $this->s['error'] = $e instanceof \PDOException
                ? ['code' => 'mysql', 'mysqlCode' => (int) ($e->errorInfo[1] ?? 0), 'message' => (string) ($e->errorInfo[2] ?? $e->getMessage()), 'table' => $tb]
                : ['code' => $e->errorCode, 'message' => $e->getMessage(), 'table' => $tb];
            $this->log('error', $tb, ['message' => $this->s['error']['message']]);
        } finally {
            $this->pdo->setAttribute(Db::attr('USE_BUFFERED_QUERY'), true);
            $this->s['workMs'] += (int) round((microtime(true) - $t0) * 1000);
            $this->s['steps']++;
            $this->s['memoryPeak'] = max($this->s['memoryPeak'], memory_get_peak_usage());
            fclose($this->fh);
            $this->fh = null;
            Jobs::writeState(self::stateFile($this->dir, $this->s['id']), $this->s);
        }
        return $this->status();
    }

    public function status(): array
    {
        $s = $this->s;
        $tables = $s['tables'];
        $done = count(array_filter($tables, static fn ($t) => $t['done']));
        $approx = 0;
        $got = 0;
        foreach ($tables as $t) {
            $a = max(1, $t['approx']);
            $approx += $a + 1;
            $got += $t['done'] ? $a + 1 : min($a, $t['rows']);
        }
        $views = count($s['views']);
        $total = count($tables) + $views;
        $doneAll = $s['status'] === 'done';
        $progress = $doneAll ? 1.0 : ($approx ? min(0.99, $got / ($approx + ($views ? 1 : 0))) : 0.0);
        $cur = $tables[$s['cur']['ti']] ?? null;
        return [
            'id' => $s['id'],
            'kind' => 'export',
            'status' => $s['status'],
            'phase' => $s['cur']['phase'],
            'table' => $cur['name'] ?? null,
            'tableRows' => $cur['rows'] ?? 0,
            'tableApprox' => $cur['approx'] ?? 0,
            'tablesDone' => $done + ($doneAll ? $views : 0),
            'tablesTotal' => $total,
            'rows' => $s['rows'],
            'rowsTotal' => array_sum(array_column($tables, 'approx')),
            'bytes' => $s['size'],
            'progress' => round($progress, 4),
            'workMs' => $s['workMs'],
            'startedAt' => $s['started'],
            'steps' => $s['steps'],
            'error' => $s['error'],
            'fileName' => $s['fileName'],
            'log' => $s['log'],
            'memoryPeak' => $s['memoryPeak'],
            'resumeFrom' => $s['status'] === 'error' ? ($cur['name'] ?? null) : null,
        ];
    }

    // ------------------------------------------------------------------
    // Units
    // ------------------------------------------------------------------

    private function unit(): void
    {
        $c = &$this->s['cur'];
        $o = $this->s['opt'];
        $sql = $this->s['format'] === 'sql';
        $tables = $this->s['tables'];
        $tb = $tables[$c['ti']] ?? null;
        switch ($c['phase']) {
            case 'header':
                if ($sql) {
                    $this->out($this->sqlHeader());
                }
                $c['phase'] = $tb ? 'table' : 'views';
                return;

            case 'table':
                // Start of a table: structure (SQL) or a new file / sheet.
                $c['after'] = null;
                $c['offset'] = 0;
                $c['first'] = true;
                $c['cols'] = null;
                $c['batch'] = 1000;
                $c['started'] = microtime(true);
                $c['size0'] = $this->s['size'];
                if ($sql && $o['structure']) {
                    $this->out($this->sqlStructure($tb['name']));
                }
                if ($this->s['format'] === 'xlsx') {
                    $this->zip->begin('xl/worksheets/sheet' . ($c['ti'] + 1) . '.xml');
                    $this->out('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' . "\n" . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
                } elseif ($this->zip) {
                    $this->zip->begin($tb['name'] . '.' . $this->s['format']);
                }
                if ($this->s['format'] === 'json') {
                    $this->out("[\n");
                }
                $c['phase'] = (!$sql || $o['data']) ? 'data' : 'endTable';
                return;

            case 'data':
                $more = $this->batch($tb);
                if (!$more) {
                    $c['phase'] = 'endTable';
                }
                return;

            case 'endTable':
                if ($this->s['format'] === 'json') {
                    $this->out($c['first'] ? "]\n" : "\n]\n");
                }
                if ($this->s['format'] === 'xlsx') {
                    $this->out('</sheetData></worksheet>');
                }
                $this->flushBuf();
                if ($this->zip) {
                    $this->zip->end();
                }
                $t = &$this->s['tables'][$c['ti']];
                $t['done'] = true;
                $this->log('table', $t['name'], ['rows' => $t['rows'], 'bytes' => (int) (ftell($this->fh) - ($c['size0'] ?? 0)), 'ms' => (int) round((microtime(true) - ($c['started'] ?? microtime(true))) * 1000)]);
                $c['ti']++;
                $c['phase'] = $c['ti'] < count($tables) ? 'table' : 'views';
                return;

            case 'views':
                if ($sql && $o['structure'] && $this->s['views']) {
                    foreach ($this->s['views'] as $v) {
                        $this->out($this->sqlView($v));
                    }
                    $this->log('views', null, ['count' => count($this->s['views'])]);
                }
                $c['phase'] = 'routines';
                return;

            case 'routines':
                // After the data: triggers must not fire while rows are inserted.
                if ($sql && $o['structure'] && ($o['routines'] || $o['triggers'] || $o['events'])) {
                    $this->out((new Objects($this->pdo, $this->s['db']))->exportSql($o['routines'], $o['triggers'], $o['events'], $o['dropTable']));
                }
                $c['phase'] = 'footer';
                return;

            case 'footer':
                if ($sql) {
                    $this->out($o['noFkChecks'] ? "\nSET FOREIGN_KEY_CHECKS = 1;\n" : "\n");
                }
                if ($this->s['format'] === 'xlsx') {
                    $this->xlsxParts();
                }
                $this->flushBuf();
                if ($this->zip) {
                    $this->zip->finish();
                }
                $c['phase'] = 'done';
                $this->s['status'] = 'done';
                $this->log('done', null, ['bytes' => (int) ftell($this->fh), 'rows' => $this->s['rows']]);
                return;
        }
    }

    /** One batch of rows (about 4 MB). False when the table is finished. */
    private function batch(array $tb): bool
    {
        $c = &$this->s['cur'];
        $t = &$this->s['tables'][$c['ti']];
        $format = $this->s['format'];
        if ($c['cols'] === null) {
            $c['cols'] = $tb['cols'] ?? $this->columns($tb['name']);
        }
        $cols = $c['cols'];
        $use = $format === 'sql' ? array_values(array_filter($cols, static fn ($x) => !$x['generated'])) : $cols;
        $names = array_column($use, 'name');
        // The key columns are read too (to know where the next batch starts).
        $pk = $tb['pk'];
        $extra = array_values(array_diff($pk, $names));
        $select = implode(', ', array_map([Db::class, 'ident'], [...$names, ...$extra]));
        $limit = max(20, min(5000, (int) $c['batch']));
        if ($format === 'xlsx' && $t['rows'] + $limit > self::XLSX_MAX_ROWS) {
            $limit = self::XLSX_MAX_ROWS - $t['rows'];
            if ($limit <= 0) {
                $this->log('warning', $tb['name'], ['message' => 'xlsx_row_limit']);
                return false;
            }
        }
        $params = [];
        if ($pk) {
            $list = implode(', ', array_map([Db::class, 'ident'], $pk));
            $where = '';
            if ($c['after'] !== null) {
                $where = count($pk) > 1 ? " WHERE ($list) > (" . implode(', ', array_fill(0, count($pk), '?')) . ')' : " WHERE $list > ?";
                $params = $c['after'];
            }
            $q = "SELECT $select FROM " . Db::ident($tb['name']) . "$where ORDER BY $list LIMIT $limit";
        } else {
            $q = "SELECT $select FROM " . Db::ident($tb['name']) . " LIMIT $limit OFFSET " . (int) $c['offset'];
        }
        $pkPos = array_map(static fn ($k) => array_search($k, [...$names, ...$extra], true), $pk);

        $this->pdo->setAttribute(Db::attr('USE_BUFFERED_QUERY'), false);
        $n = 0;
        $bytes = 0;
        $last = null;
        $perInsert = $this->s['opt']['insertRows'];
        $inserts = 0;
        $open = false;
        $head = 'INSERT INTO ' . Db::ident($tb['name']) . ' (' . implode(', ', array_map([Db::class, 'ident'], $names)) . ") VALUES\n";
        try {
            $st = $this->pdo->prepare($q);
            $st->execute($params);
            while (($row = $st->fetch(PDO::FETCH_NUM)) !== false) {
                $n++;
                if ($pk) {
                    $last = array_map(static fn ($i) => $row[$i], $pkPos);
                }
                $vals = array_slice($row, 0, count($names));
                $line = match ($format) {
                    'sql' => $this->sqlTuple($vals, $use),
                    'csv' => $this->csvLine($vals, $use),
                    'json' => $this->jsonRow($vals, $use),
                    'xlsx' => $this->xlsxRow($vals, $use, $t['rows'] + $n + 1),
                };
                $bytes += strlen($line);
                if ($format === 'sql') {
                    // New INSERT every $perInsert rows or ~1 MB (max_allowed_packet).
                    if ($open && ($inserts >= $perInsert || $open > 1000000)) {
                        $this->out(";\n");
                        $open = false;
                    }
                    if (!$open) {
                        $this->out($head . $line);
                        $open = strlen($line);
                        $inserts = 1;
                    } else {
                        $this->out(",\n" . $line);
                        $open += strlen($line);
                        $inserts++;
                    }
                } elseif ($format === 'csv') {
                    if ($c['first'] && $n === 1) {
                        $this->out($this->csvLine($names, array_map(static fn () => ['kind' => 'str'], $names)));
                    }
                    $this->out($line);
                } elseif ($format === 'json') {
                    $this->out(($c['first'] && $n === 1 ? '' : ",\n") . $line);
                } else {
                    if ($c['first'] && $n === 1) {
                        $this->out($this->xlsxRow($names, array_map(static fn () => ['kind' => 'str'], $names), 1));
                    }
                    $this->out($line);
                }
            }
            $st->closeCursor();
        } finally {
            $this->pdo->setAttribute(Db::attr('USE_BUFFERED_QUERY'), true);
        }
        if ($format === 'sql' && $open) {
            $this->out(";\n");
        }
        if ($format === 'csv' && $c['first'] && $n === 0) {
            $this->out($this->csvLine($names, array_map(static fn () => ['kind' => 'str'], $names)));
        }
        if ($format === 'xlsx' && $c['first'] && $n === 0) {
            $this->out($this->xlsxRow($names, array_map(static fn () => ['kind' => 'str'], $names), 1));
        }
        if ($n > 0) {
            $c['first'] = false;
        }
        $t['rows'] += $n;
        $this->s['rows'] += $n;
        $c['after'] = $last;
        $c['offset'] += $n;
        // Next batch ≈ 4 MB, whatever the row size.
        if ($n > 0) {
            $c['batch'] = (int) max(20, min(5000, self::BATCH_BYTES / max(1, $bytes / $n)));
        }
        return $n === $limit && !($format === 'xlsx' && $t['rows'] >= self::XLSX_MAX_ROWS);
    }

    // ------------------------------------------------------------------
    // Output: buffered writes, optional gzip, optional zip entry
    // ------------------------------------------------------------------

    private function out(string $s): void
    {
        $this->buf .= $s;
        if (strlen($this->buf) >= self::FLUSH) {
            $this->flushBuf();
        }
    }

    private function flushBuf(): void
    {
        if ($this->buf === '') {
            return;
        }
        $data = $this->buf;
        $this->buf = '';
        if ($this->s['opt']['gzip']) {
            $this->gz ??= deflate_init(ZLIB_ENCODING_GZIP, ['level' => 6]);
            $data = deflate_add($this->gz, $data, ZLIB_NO_FLUSH);
        }
        if ($this->zip && $this->zip->inEntry()) {
            $this->zip->write($data);
        } else {
            fwrite($this->fh, $data);
        }
    }

    /** End of a unit: everything on disk, state consistent with the file size. */
    private function commit(): void
    {
        $this->flushBuf();
        if ($this->gz) {
            // Close the gzip member: a resume after this point starts a new one (multi-member .gz is standard).
            fwrite($this->fh, deflate_add($this->gz, '', ZLIB_FINISH));
            $this->gz = null;
        }
        fflush($this->fh);
        $this->s['size'] = (int) ftell($this->fh);
        if ($this->zip) {
            $this->s['zip'] = $this->zip->state();
        }
        // Saving every unit costs more than small tables take: at most every 0.3 s
        // (the step always saves at its end). A cut loses only the unsaved units,
        // and the next step truncates the file back to the saved size.
        if (microtime(true) - $this->savedAt >= 0.3 || $this->s['status'] !== 'running') {
            Jobs::writeState(self::stateFile($this->dir, $this->s['id']), $this->s);
            $this->savedAt = microtime(true);
        }
    }

    private function log(string $type, ?string $table, array $data): void
    {
        $this->s['log'][] = ['type' => $type, 'table' => $table, 'at' => time()] + $data;
        if (count($this->s['log']) > self::LOG_MAX) {
            array_splice($this->s['log'], 0, count($this->s['log']) - self::LOG_MAX);
        }
    }

    // ------------------------------------------------------------------
    // SQL
    // ------------------------------------------------------------------

    private function sqlHeader(): string
    {
        $o = $this->s['opt'];
        $db = $this->s['db'];
        $h = '-- phpMyFlow ' . PMF_VERSION . " SQL export\n-- Server: " . (string) $this->pdo->getAttribute(PDO::ATTR_SERVER_VERSION) . "\n-- Database: " . preg_replace('~[\x00-\x1F\x7F]~', ' ', $db) . "\n-- Date: " . gmdate('Y-m-d H:i:s') . " UTC\n\n";
        $h .= "SET NAMES utf8mb4;\nSET time_zone = '+00:00';\nSET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n";
        if ($o['noFkChecks']) {
            $h .= "SET FOREIGN_KEY_CHECKS = 0;\n";
        }
        // Portable by default: no CREATE DATABASE / USE, names never qualified with the database.
        if ($o['createDb']) {
            $st = $this->pdo->prepare('SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?');
            $st->execute([$db]);
            [$cs, $coll] = $st->fetch(PDO::FETCH_NUM);
            $h .= "\nCREATE DATABASE IF NOT EXISTS " . Db::ident($db) . " CHARACTER SET $cs COLLATE $coll;\nUSE " . Db::ident($db) . ";\n";
        }
        return $h . "\n";
    }

    private function sqlStructure(string $table): string
    {
        $create = (string) $this->pdo->query('SHOW CREATE TABLE ' . Db::ident($table))->fetch(PDO::FETCH_NUM)[1];
        $s = "\n--\n-- Table " . Export::commentName($table) . "\n--\n\n";
        if ($this->s['opt']['dropTable']) {
            $s .= 'DROP TABLE IF EXISTS ' . Db::ident($table) . ";\n";
        }
        return $s . $create . ";\n";
    }

    private function sqlView(string $v): string
    {
        $create = (string) $this->pdo->query('SHOW CREATE VIEW ' . Db::ident($v))->fetch(PDO::FETCH_NUM)[1];
        $s = "\n--\n-- View " . Export::commentName($v) . "\n--\n\n";
        if ($this->s['opt']['dropTable']) {
            $s .= 'DROP VIEW IF EXISTS ' . Db::ident($v) . ";\n";
        }
        return $s . Export::viewSql($create, $this->s['db']) . "\n";
    }

    private function sqlTuple(array $row, array $cols): string
    {
        $vals = [];
        foreach ($row as $i => $v) {
            $vals[] = $this->sqlValue($v, $cols[$i]['kind']);
        }
        return '(' . implode(',', $vals) . ')';
    }

    private function sqlValue(mixed $v, string $kind): string
    {
        if ($v === null) {
            return 'NULL';
        }
        if ($kind === 'bit' && is_int($v)) {
            return "b'" . decbin($v) . "'"; // native prepares return BIT as an integer
        }
        $v = (string) $v;
        return match ($kind) {
            'num' => is_numeric($v) ? $v : $this->pdo->quote($v),
            'bin' => $v === '' ? "''" : '0x' . bin2hex($v),
            'bit' => "b'" . (ltrim(implode('', array_map(static fn ($c) => str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT), str_split($v))), '0') ?: '0') . "'",
            default => $this->pdo->quote($v),
        };
    }

    // ------------------------------------------------------------------
    // CSV / JSON / XLSX
    // ------------------------------------------------------------------

    private function csvLine(array $vals, array $cols): string
    {
        $out = [];
        foreach ($vals as $i => $v) {
            if ($v === null) {
                $out[] = '';
                continue;
            }
            $v = ($cols[$i]['kind'] ?? 'str') === 'bin' ? '0x' . bin2hex((string) $v) : (string) $v;
            $out[] = preg_match('~[",\r\n]|^\s|\s$~', $v) || $v === '' ? '"' . str_replace('"', '""', $v) . '"' : $v;
        }
        return implode(',', $out) . "\r\n";
    }

    private function jsonRow(array $vals, array $cols): string
    {
        $obj = [];
        foreach ($vals as $i => $v) {
            $k = $cols[$i]['kind'];
            $obj[$cols[$i]['name']] = $v === null ? null : ($k === 'bin' ? '0x' . bin2hex((string) $v) : ($k === 'num' && is_numeric($v) && !str_contains((string) $v, '.') && abs((float) $v) < 9007199254740991 ? (int) $v : $v));
        }
        return (string) json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_SLASHES);
    }

    private function xlsxRow(array $vals, array $cols, int $r): string
    {
        $x = '<row r="' . $r . '">';
        foreach ($vals as $i => $v) {
            if ($v === null) {
                continue;
            }
            $kind = $cols[$i]['kind'] ?? 'str';
            $ref = self::colName($i) . $r;
            if ($kind === 'num' && is_numeric($v) && strlen((string) $v) < 16) {
                $x .= '<c r="' . $ref . '"><v>' . $v . '</v></c>';
            } else {
                $s = $kind === 'bin' ? '0x' . bin2hex((string) $v) : (string) $v;
                // XML 1.0 can't hold control characters; Excel cells hold 32767 characters.
                $s = (string) preg_replace('~[^\x09\x0A\x0D\x20-\x{D7FF}\x{E000}-\x{FFFD}\x{10000}-\x{10FFFF}]~u', '', pmf_is_utf8($s) ? $s : utf8_encode_safe($s));
                $s = \pmf_substr($s, 32767);
                $x .= '<c r="' . $ref . '" t="inlineStr"><is><t xml:space="preserve">' . htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8') . '</t></is></c>';
            }
        }
        return $x . '</row>';
    }

    private static function colName(int $i): string
    {
        $s = '';
        for ($n = $i + 1; $n > 0; $n = intdiv($n - 1, 26)) {
            $s = chr(65 + ($n - 1) % 26) . $s;
        }
        return $s;
    }

    /** Workbook parts written at the end (they list every sheet). */
    private function xlsxParts(): void
    {
        $sheets = '';
        $rels = '';
        $types = '';
        $used = [];
        foreach ($this->s['tables'] as $i => $t) {
            $n = $i + 1;
            $name = mb_like_sheet_name($t['name'], $used);
            $sheets .= '<sheet name="' . htmlspecialchars($name, ENT_XML1 | ENT_QUOTES, 'UTF-8') . '" sheetId="' . $n . '" r:id="rId' . $n . '"/>';
            $rels .= '<Relationship Id="rId' . $n . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $n . '.xml"/>';
            $types .= '<Override PartName="/xl/worksheets/sheet' . $n . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }
        $k = count($this->s['tables']) + 1;
        $parts = [
            '[Content_Types].xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' . $types . '</Types>',
            '_rels/.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
            'xl/workbook.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' . $sheets . '</sheets></workbook>',
            'xl/_rels/workbook.xml.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $rels . '<Relationship Id="rId' . $k . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
            'xl/styles.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>',
        ];
        foreach ($parts as $name => $xml) {
            $this->zip->begin($name);
            $this->zip->write($xml);
        }
        $this->zip->end();
    }

    // ------------------------------------------------------------------

    /** @return list<array{name:string, kind:string, generated:bool}> */
    private function columns(string $table): array
    {
        $st = $this->pdo->prepare('SELECT COLUMN_NAME AS name, DATA_TYPE AS type, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION');
        $st->execute([$this->s['db'], $table]);
        return array_map(static fn ($c) => self::column((string) $c['name'], (string) $c['type'], (string) $c['extra']), $st->fetchAll(PDO::FETCH_ASSOC));
    }

    /** @return array{name:string, kind:string, generated:bool} */
    private static function column(string $name, string $type, string $extra): array
    {
        $t = strtolower($type);
        $kind = in_array($t, ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real'], true) ? 'num'
            : (in_array($t, ['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'geometry', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon', 'geometrycollection'], true) ? 'bin'
            : ($t === 'bit' ? 'bit' : 'str'));
        return ['name' => $name, 'kind' => $kind, 'generated' => Schema::isGenerated($extra)];
    }

    private static function stateFile(string $dir, string $id): string
    {
        return $dir . DIRECTORY_SEPARATOR . $id . '.export.json';
    }

    private static function outFile(string $dir, string $id): string
    {
        return $dir . DIRECTORY_SEPARATOR . $id . '.export.out';
    }
}

/** Latin-1 bytes (binary in a text column) as UTF-8, without mbstring. */
function utf8_encode_safe(string $s): string
{
    $out = '';
    $len = strlen($s);
    for ($i = 0; $i < $len; $i++) {
        $c = ord($s[$i]);
        $out .= $c < 0x80 ? $s[$i] : chr(0xC0 | ($c >> 6)) . chr(0x80 | ($c & 0x3F));
    }
    return $out;
}

/** Excel sheet name: max 31 characters, no []:*?/\, unique. */
function mb_like_sheet_name(string $name, array &$used): string
{
    $n = (string) preg_replace('~[\[\]:*?/\\\\]~', '_', $name);
    $n = \pmf_substr($n, 31);
    $base = $n;
    for ($i = 2; isset($used[strtolower($n)]); $i++) {
        $n = \pmf_substr($base, 31 - strlen((string) $i) - 1) . "~$i";
    }
    $used[strtolower($n)] = true;
    return $n;
}
