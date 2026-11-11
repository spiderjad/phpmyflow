<?php
declare(strict_types=1);

require_once __DIR__ . '/support.php';

// The test compares two ~55 MB dumps in memory.
ini_set('memory_limit', '1G');

/*
 * Export as a job of short steps driven by the client (export_start →
 * export_step… → export_download) against a real `php -S`: bounded memory,
 * no request over the step budget, and resumable after the server dies in
 * the middle of a step. Needs the pmf_big fixture (built on first run, ~20 s).
 */

function bigDb(): ?array
{
    $db = testDb();
    if (!$db) {
        return null;
    }
    [$host, $port, $user, $pass] = $db;
    $pdo = new PDO("mysql:host=$host;port=$port", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $n = (int) $pdo->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pmf_big'")->fetchColumn();
    $posts = $n ? (int) $pdo->query('SELECT COUNT(*) FROM pmf_big.wp_posts')->fetchColumn() : 0;
    if ($n !== 142 || $posts < 9000) {
        passthru(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/fixtures/make_big_db.php') . ' ' . escapeshellarg("$host:$port:$user:$pass") . ' 50');
    }
    return $db;
}

/** Runs steps until done (or $max steps); returns the last status and the slowest step in seconds. */
function runSteps(TestClient $c, string $id, int $max = 10000): array
{
    $slowest = 0.0;
    $r = [];
    for ($i = 0; $i < $max; $i++) {
        $t = microtime(true);
        $r = $c->json('POST', 'a=export_step', ['id' => $id]);
        $slowest = max($slowest, microtime(true) - $t);
        if (isset($r['error'])) {
            throw new RuntimeException('step failed: ' . json_encode($r['error']));
        }
        if ($r['status'] !== 'running') {
            break;
        }
    }
    return [$r, $slowest];
}

/** Dump without the lines that change between runs (date). */
function stable(string $sql): string
{
    return (string) preg_replace('~^-- Date: .*$~m', '', $sql);
}

return [
    'export of ~50 MB in steps with memory_limit=64M: every step short, the file is complete' => static function (): void {
        if (!($db = bigDb())) {
            echo "       (skipped: no test database)\n";
            return;
        }
        [$host, $port, $user, $pass] = $db;
        $srv = new TestServer(['memory_limit' => '64M', 'max_execution_time' => '30', 'display_errors' => '1'], ['PMF_JOB_STEP_SECONDS' => '2']);
        $c = new TestClient($srv->url);
        $c->login($host, $port, $user, $pass);
        $start = $c->json('POST', 'a=export_start', ['db' => 'pmf_big', 'format' => 'sql', 'options' => ['structure' => true, 'data' => true, 'dropTable' => true, 'noFkChecks' => true]]);
        ok(isset($start['id']), 'job id: ' . json_encode($start));
        eq(142, $start['tablesTotal']);
        [$r, $slowest] = runSteps($c, $start['id']);
        eq('done', $r['status'], json_encode($r));
        ok($slowest < 10, "every step stays short (slowest {$slowest}s)");
        ok($r['memoryPeak'] < 48 * 1048576, 'memory stays bounded: ' . round($r['memoryPeak'] / 1048576, 1) . ' MB');
        ok($r['bytes'] > 40 * 1048576, 'file size ' . $r['bytes']);
        $sql = $c->raw('GET', 'a=export_download&id=' . $start['id']);
        eq(200, $c->status);
        ok((bool) preg_match('~^Content-Disposition: attachment; filename="pmf_big-[\d-]+\.sql"~mi', implode("\n", $c->headers)), 'download headers');
        eq($r['bytes'], strlen($sql));
        // One line per row ("(" at the start of a line: values never contain raw newlines).
        $pdo = new PDO("mysql:host=$host;port=$port;dbname=pmf_big", $user, $pass);
        $rows = 0;
        foreach ($pdo->query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pmf_big' AND TABLE_TYPE = 'BASE TABLE'")->fetchAll(PDO::FETCH_COLUMN) as $t) {
            $rows += (int) $pdo->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
        }
        eq($rows, preg_match_all('~^\(~m', $sql));
        eq($rows, $r['rows']);
        ok(str_contains($sql, 'CREATE ALGORITHM') && str_contains($sql, '`wp_published`'), 'view exported');
        ok(!str_contains($sql, 'CREATE DATABASE') && !str_contains($sql, 'USE `'), 'portable by default');
        // Served once, then deleted.
        $again = $c->json('GET', 'a=export_download&id=' . $start['id']);
        eq('job_not_found', $again['error']['code']);
        $srv->stop();
    },

    'killed in the middle of a step: resume continues and the file is identical' => static function (): void {
        if (!($db = bigDb())) {
            echo "       (skipped: no test database)\n";
            return;
        }
        [$host, $port, $user, $pass] = $db;
        $opts = ['db' => 'pmf_big', 'tables' => ['wp_options', 'wp_posts', 'wp_plugin_log'], 'format' => 'sql', 'options' => ['structure' => true, 'data' => true, 'dropTable' => true]];

        // Reference: uninterrupted.
        $srv = new TestServer([], ['PMF_JOB_STEP_SECONDS' => '0.2']);
        $c = new TestClient($srv->url);
        $c->login($host, $port, $user, $pass);
        $ref = $c->json('POST', 'a=export_start', $opts);
        runSteps($c, $ref['id']);
        $expected = stable($c->raw('GET', 'a=export_download&id=' . $ref['id']));

        // Cut: one step (a fast machine writes ~20 MB per step, three could
        // finish the whole export), then the server dies while the next one runs.
        $job = $c->json('POST', 'a=export_start', $opts);
        [$r] = runSteps($c, $job['id'], 1);
        eq('running', $r['status']);
        $cookie = implode('; ', array_map(static fn ($k, $v) => "$k=$v", array_keys($c->jar), $c->jar));
        $body = json_encode(['id' => $job['id']]);
        $sock = stream_socket_client('tcp://127.0.0.1:' . $srv->port());
        fwrite($sock, "POST /api.php?a=export_step HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: $cookie\r\nX-CSRF-Token: {$c->csrf}\r\nContent-Type: application/json\r\nContent-Length: " . strlen($body) . "\r\nConnection: close\r\n\r\n$body");
        usleep(60000); // the step is writing now (early: one step can write ~25 MB)
        $srv->stop();
        fclose($sock);

        // A new server (same session files): the job resumes where it was saved.
        $srv2 = new TestServer([], ['PMF_JOB_STEP_SECONDS' => '0.2']);
        $c->base = $srv2->url;
        $st = $c->json('GET', 'a=export_status&id=' . $job['id']);
        eq('running', $st['status']);
        ok($st['tablesDone'] < 3, 'not finished before the cut');
        [$r] = runSteps($c, $job['id']);
        eq('done', $r['status']);
        $got = stable($c->raw('GET', 'a=export_download&id=' . $job['id']));
        eq(strlen($expected), strlen($got), 'same size as the uninterrupted export');
        eq(md5($expected), md5($got), 'byte for byte');
        $srv2->stop();
    },

    'CSV of several tables is one zip; XLSX is one workbook with a sheet per table' => static function (): void {
        if (!($db = testDb())) {
            echo "       (skipped: no test database)\n";
            return;
        }
        [$host, $port, $user, $pass] = $db;
        $srv = new TestServer();
        $c = new TestClient($srv->url);
        $c->login($host, $port, $user, $pass);
        foreach (['csv' => 'zip', 'xlsx' => 'xlsx', 'json' => 'zip'] as $format => $ext) {
            $j = $c->json('POST', 'a=export_start', ['db' => 'shop', 'tables' => ['customers', 'orders'], 'format' => $format, 'options' => []]);
            [$r] = runSteps($c, $j['id']);
            eq('done', $r['status'], $format);
            ok(str_ends_with($r['fileName'], ".$ext"), "$format → $ext: {$r['fileName']}");
            $bin = $c->raw('GET', 'a=export_download&id=' . $j['id']);
            $tmp = tempnam(sys_get_temp_dir(), 'pmfzip');
            file_put_contents($tmp, $bin);
            $names = zipNames($tmp);
            unlink($tmp);
            if ($format === 'xlsx') {
                ok(in_array('xl/worksheets/sheet2.xml', $names, true) && in_array('[Content_Types].xml', $names, true), 'xlsx parts: ' . implode(',', $names));
            } else {
                eq(["customers.$format", "orders.$format"], $names);
            }
        }
        $srv->stop();
    },

    'cleanup: drop the big fixture (whole-server searches in other tests stay fast)' => static function (): void {
        if (!($db = testDb())) {
            return;
        }
        [$host, $port, $user, $pass] = $db;
        (new PDO("mysql:host=$host;port=$port", $user, $pass))->exec('DROP DATABASE IF EXISTS pmf_big');
    },
];

/** Entry names from a zip's central directory (no ZipArchive needed). */
function zipNames(string $file): array
{
    $d = file_get_contents($file);
    $eocd = strrpos($d, "PK\x05\x06");
    ok($eocd !== false, 'zip end record');
    $n = unpack('v', substr($d, $eocd + 10, 2))[1];
    $off = unpack('V', substr($d, $eocd + 16, 4))[1];
    $names = [];
    for ($i = 0; $i < $n; $i++) {
        ok(substr($d, $off, 4) === "PK\x01\x02", 'central entry');
        $h = unpack('vnameLen/vextraLen/vcommentLen', substr($d, $off + 28, 6));
        $crc = unpack('V', substr($d, $off + 16, 4))[1];
        $size = unpack('V', substr($d, $off + 24, 4))[1];
        $local = unpack('V', substr($d, $off + 42, 4))[1];
        $name = substr($d, $off + 46, $h['nameLen']);
        // The local header must agree (CRC and size patched after streaming).
        $lh = unpack('vnameLen/vextraLen', substr($d, $local + 26, 4));
        $data = substr($d, $local + 30 + $lh['nameLen'] + $lh['extraLen'], $size);
        eq($crc, crc32($data), "crc of $name");
        eq($crc, unpack('V', substr($d, $local + 14, 4))[1], "local crc of $name");
        $names[] = $name;
        $off += 46 + $h['nameLen'] + $h['extraLen'] + $h['commentLen'];
    }
    return $names;
}
