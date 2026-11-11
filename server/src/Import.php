<?php
declare(strict_types=1);

namespace PhpMyFlow;


/**
 * SQL import in short requests:
 *  1. upload(): the browser sends the file in 2 MB chunks (it decompresses
 *     .sql.gz itself), appended to a private temp file;
 *  2. run(): executes statements for a few seconds from the saved position
 *     (SqlSplitter), then returns progress; the browser calls it again;
 *  3. finish(): deletes the temp files.
 *
 * State lives next to the file (never trusted from the client): position,
 * delimiter, line, current database, and the session SETs the dump made
 * (SET NAMES, FOREIGN_KEY_CHECKS, SQL_MODE, time_zone...), which are replayed
 * at the start of every request because each request is a new connection.
 */
final class Import
{
    public const CHUNK = 2 * 1024 * 1024;

    public static function dir(): string
    {
        return Jobs::dir();
    }

    private static function paths(string $id): array
    {
        if (!preg_match('~^[a-f0-9]{32}$~', $id)) {
            throw new ApiError('bad_import', 'Unknown import', 404);
        }
        $dir = self::dir();
        return [$dir . DIRECTORY_SEPARATOR . $id . '.sql', $dir . DIRECTORY_SEPARATOR . $id . '.json'];
    }

    /** Append one chunk. $offset must be the current size (a repeated chunk is ignored). */
    public static function upload(?string $id, int $offset, string $bytes): array
    {
        if (strlen($bytes) > self::CHUNK + 1024) {
            throw new ApiError('chunk_too_big', 'Chunk too big', 413);
        }
        $max = (int) (pmf_config()['import_max_bytes'] ?? 2147483648);
        if ($id === null || $id === '') {
            $id = bin2hex(random_bytes(16));
        }
        [$file] = self::paths($id);
        clearstatcache(true, $file);
        $size = is_file($file) ? filesize($file) : 0;
        if ($offset < $size) {
            return ['id' => $id, 'size' => $size]; // retry of a chunk already stored
        }
        if ($offset > $size) {
            throw new ApiError('bad_offset', 'Chunk out of order', 409, ['size' => $size]);
        }
        if ($size + strlen($bytes) > $max) {
            throw new ApiError('import_too_big', 'File too large for this server', 413, ['max' => $max]);
        }
        file_put_contents($file, $bytes, FILE_APPEND | LOCK_EX);
        clearstatcache(true, $file);
        return ['id' => $id, 'size' => filesize($file)];
    }

    /**
     * Run statements for about $budgetMs from the saved position.
     *
     * @param array{db:string, noFkChecks?:bool, continueOnError?:bool} $opts
     */
    public static function run(string $id, array $opts, ?int $budgetMs = null): array
    {
        $budgetMs ??= (int) round(Jobs::stepSeconds() * 1000);
        [$file, $stateFile] = self::paths($id);
        if (!is_file($file)) {
            throw new ApiError('bad_import', 'Unknown import', 404);
        }
        Jobs::roomToWork($budgetMs / 1000);
        $state = Jobs::readState($stateFile) ?? [];
        $state += ['offset' => 0, 'delimiter' => ';', 'line' => 1, 'db' => $opts['db'], 'session' => [], 'executed' => 0, 'errors' => 0, 'started' => time(), 'workMs' => 0, 'table' => null, 'log' => [], 'tables' => 0];
        $t0 = microtime(true);
        $saved = microtime(true);
        // A fatal (time limit on a slow statement) must not lose the position:
        // statements already run would run again on resume.
        Guard::onFatal(static function () use (&$state, $stateFile, $t0): void {
            $state['workMs'] += (int) round((microtime(true) - $t0) * 1000);
            Jobs::writeState($stateFile, $state);
        });
        $pdo = Db::pdo();
        Db::useDatabase((string) $state['db']);
        if (!empty($opts['noFkChecks'])) {
            $pdo->exec('SET SESSION foreign_key_checks = 0');
        }
        foreach ($state['session'] as $s) {
            try {
                $pdo->exec($s);
            } catch (\PDOException) {
                // It failed the first time too; already reported.
            }
        }

        // "Import everything into the chosen database": no USE / CREATE DATABASE, no source qualifier.
        $retarget = isset($opts['retarget']) && is_array($opts['retarget']) ? new SqlRetarget($opts['retarget']) : null;
        if ($retarget) {
            $state['db'] = $opts['db'];
        }
        $fh = fopen($file, 'rb');
        $splitter = new SqlSplitter($fh, (int) $state['offset'], (string) $state['delimiter'], (int) $state['line']);
        $deadline = microtime(true) + $budgetMs / 1000;
        $newErrors = [];
        $stopped = false;
        $done = false;
        while (true) {
            $st = $splitter->next();
            if ($st === null) {
                $done = true;
                break;
            }
            if ($retarget) {
                $sql = $retarget->rewrite($st['sql']);
                if ($sql === null) {
                    self::log($state, ['type' => 'skipped', 'line' => $st['line'], 'message' => \pmf_substr(trim($st['sql']), 80)]);
                    $state['offset'] = $splitter->offset();
                    $state['delimiter'] = $splitter->delimiter();
                    $state['line'] = $splitter->line();
                    continue;
                }
                $st['sql'] = $sql;
            }
            $target = self::tableOf($st['sql']);
            if ($target) {
                $state['table'] = $target['table'];
            }
            try {
                $pdo->exec($st['sql']);
                $state['executed']++;
                if ($target && $target['verb'] === 'create') {
                    $state['tables']++;
                    self::log($state, ['type' => 'table', 'table' => $target['table']]);
                }
                if (self::isSessionSet($st['sql'])) {
                    // Keep the last occurrence: SET X=0 ... SET X=1 must replay as 1.
                    $state['session'] = array_values(array_filter($state['session'], static fn ($x) => $x !== $st['sql']));
                    $state['session'] = array_slice([...$state['session'], $st['sql']], -40);
                }
            } catch (\PDOException $e) {
                $state['errors']++;
                $newErrors[] = [
                    'line' => $st['line'],
                    'statement' => \pmf_substr($st['sql'], 300),
                    'code' => (int) ($e->errorInfo[1] ?? 0),
                    'message' => (string) ($e->errorInfo[2] ?? $e->getMessage()),
                ];
                if (empty($opts['continueOnError']) || $state['errors'] >= 1000) {
                    $stopped = true;
                }
            }
            $state['offset'] = $splitter->offset();
            $state['delimiter'] = $splitter->delimiter();
            $state['line'] = $splitter->line();
            if (microtime(true) - $saved >= 0.3) {
                Jobs::writeState($stateFile, $state);
                $saved = microtime(true);
            }
            if ($stopped || microtime(true) >= $deadline) {
                break;
            }
        }
        fclose($fh);
        $cur = $pdo->query('SELECT DATABASE()')->fetchColumn();
        if (!$retarget && is_string($cur) && $cur !== '') {
            $state['db'] = $cur; // the dump may USE another database
        }
        if (!empty($opts['noFkChecks'])) {
            $pdo->exec('SET SESSION foreign_key_checks = 1');
        }
        $state['workMs'] += (int) round((microtime(true) - $t0) * 1000);
        foreach ($newErrors as $e) {
            self::log($state, ['type' => 'error', 'line' => $e['line'], 'message' => $e['message']]);
        }
        if ($done) {
            self::log($state, ['type' => 'done', 'executed' => $state['executed'], 'errors' => $state['errors']]);
        }
        Jobs::writeState($stateFile, $state);
        return self::report($state, (int) filesize($file)) + ['errors' => $newErrors, 'stopped' => $stopped, 'done' => $done];
    }

    /** Progress of an import (to resume after a reload or a cut: import_status). */
    public static function status(string $id): array
    {
        [$file, $stateFile] = self::paths($id);
        if (!is_file($file)) {
            throw new ApiError('bad_import', 'Unknown import', 404);
        }
        return self::report(Jobs::readState($stateFile) ?? [], (int) filesize($file)) + ['errors' => [], 'stopped' => false, 'done' => false];
    }

    private static function report(array $state, int $size): array
    {
        return [
            'offset' => (int) ($state['offset'] ?? 0),
            'size' => $size,
            'line' => (int) ($state['line'] ?? 1),
            'executed' => (int) ($state['executed'] ?? 0),
            'errorsTotal' => (int) ($state['errors'] ?? 0),
            'db' => $state['db'] ?? null,
            'table' => $state['table'] ?? null,
            'tables' => (int) ($state['tables'] ?? 0),
            'workMs' => (int) ($state['workMs'] ?? 0),
            'seconds' => time() - (int) ($state['started'] ?? time()),
            'log' => $state['log'] ?? [],
        ];
    }

    private static function log(array &$state, array $entry): void
    {
        $state['log'][] = $entry + ['at' => time()];
        if (count($state['log']) > 400) {
            array_splice($state['log'], 0, count($state['log']) - 400);
        }
    }

    /**
     * Table a statement writes to (for progress): CREATE TABLE, INSERT /
     * REPLACE INTO, ALTER TABLE. The database qualifier is dropped.
     *
     * @return array{verb:string, table:string}|null
     */
    public static function tableOf(string $sql): ?array
    {
        $head = ltrim((string) preg_replace('~^(?:\s+|--[^\n]*\n|/\*(?!!).*?\*/)*~s', '', substr($sql, 0, 600)));
        $one = '(?:`(?:[^`]|``)+`|[\w$]+)';
        $id = "($one(?:\s*\.\s*$one)?)";
        $re = [
            'create' => "~^CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?$id~i",
            'insert' => "~^(?:INSERT|REPLACE)(?:\s+(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY|IGNORE))*\s+(?:INTO\s+)?$id~i",
            'alter' => "~^ALTER\s+(?:ONLINE\s+|IGNORE\s+)?TABLE\s+$id~i",
        ];
        foreach ($re as $verb => $r) {
            if (preg_match($r, $head, $m)) {
                preg_match_all("~$one~", $m[1], $parts);
                $name = end($parts[0]);
                return ['verb' => $verb, 'table' => str_replace('``', '`', trim((string) $name, '`'))];
            }
        }
        return null;
    }

    /** Session-level SET (incl. /*!40101 SET ... *\/), not SET GLOBAL / PASSWORD. */
    public static function isSessionSet(string $sql): bool
    {
        $s = ltrim((string) preg_replace('~^/\*!\d*\s*~', '', $sql));
        return (bool) preg_match('~^SET\s+(?!GLOBAL\b|PASSWORD\b|@@GLOBAL\.|PERSIST)~i', $s) && strlen($sql) < 2000;
    }

    public static function finish(string $id): array
    {
        foreach (self::paths($id) as $f) {
            if (is_file($f)) {
                @unlink($f);
            }
        }
        return ['ok' => true];
    }
}
