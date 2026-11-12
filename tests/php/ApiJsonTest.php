<?php
declare(strict_types=1);

require_once __DIR__ . '/support.php';

/*
 * The API answers JSON whatever happens inside PHP: warnings, stray output,
 * uncaught exceptions and fatals (time limit, memory). Runs a real `php -S`
 * with this machine's php.ini (display_errors and html_errors as the user has
 * them) and the test-only action `test_fault` (enabled by PMF_TEST_FAULTS=1).
 */

function faultServer(): array
{
    static $srv = null;
    // display_errors on, like php.ini-development and the default php -S setup on Windows.
    $srv ??= new TestServer(['display_errors' => '1', 'html_errors' => '1', 'log_errors' => '0'], ['PMF_TEST_FAULTS' => '1']);
    return [$srv, new TestClient($srv->url)];
}

/**
 * Does this PHP run shutdown functions after "Allowed memory size exhausted"?
 * The official builds do; some patched ones (ondrej PHP 8.1 on Ubuntu) end the
 * process at once, so no handler can turn the fatal into JSON.
 */
function shutdownRunsAfterOom(): bool
{
    $code = 'register_shutdown_function(function () { echo "SHUTDOWN_RAN"; });'
        . 'ini_set("memory_limit", "16M"); $x = str_repeat("x", 64 * 1024 * 1024);';
    $out = (string) shell_exec(escapeshellarg(PHP_BINARY) . ' -d display_errors=0 -r ' . escapeshellarg($code) . ' 2>&1');
    return str_contains($out, 'SHUTDOWN_RAN');
}

function assertCleanJson(TestClient $c, string $query): array
{
    $d = $c->json('GET', $query);
    ok(str_starts_with(ltrim($c->body), '{'), "body starts with JSON for $query: " . substr($c->body, 0, 120));
    ok(!preg_match('~Fatal error|Warning|Deprecated|<br|\.php|[A-Z]:\\\\~', $c->body), "no PHP message, HTML or path leaks for $query: " . substr($c->body, 0, 300));
    $ct = implode("\n", $c->headers);
    ok((bool) preg_match('~^Content-Type: application/json~mi', $ct), "JSON content type for $query");
    return $d;
}

return [
    'a warning or deprecation is logged, the response stays the action’s JSON' => static function (): void {
        [, $c] = faultServer();
        eq(['ok' => true, 'fault' => 'warning'], assertCleanJson($c, 'a=test_fault&kind=warning'));
        eq(200, $c->status);
        eq(['ok' => true, 'fault' => 'deprecated'], assertCleanJson($c, 'a=test_fault&kind=deprecated'));
    },

    'stray output before Http::json is discarded' => static function (): void {
        [, $c] = faultServer();
        eq(['ok' => true, 'fault' => 'echo'], assertCleanJson($c, 'a=test_fault&kind=echo'));
    },

    'an uncaught exception is a JSON error with an incident id and no details' => static function (): void {
        [, $c] = faultServer();
        $d = assertCleanJson($c, 'a=test_fault&kind=exception');
        eq(500, $c->status);
        eq('internal', $d['error']['code']);
        ok((bool) preg_match('~^[a-f0-9]{8}$~', (string) ($d['error']['details']['incident'] ?? '')), 'incident id');
        ok(!str_contains($c->body, 'secret detail'), 'exception message stays in the log');
    },

    'a fatal (time limit) is a JSON error, not HTML with 200' => static function (): void {
        [, $c] = faultServer();
        $d = assertCleanJson($c, 'a=test_fault&kind=time_limit');
        eq(500, $c->status);
        eq('time_limit', $d['error']['code']);
        ok(isset($d['error']['details']['incident']), 'incident id');
    },

    'a fatal (memory) is a JSON error' => static function (): void {
        if (!shutdownRunsAfterOom()) {
            echo "       (skipped: this PHP build ends the process when memory runs out, before any shutdown function:
"
                . "        nothing can answer, the browser sees a dropped connection. Seen on Ubuntu's ondrej PHP 8.1.)
";
            return;
        }
        [, $c] = faultServer();
        $d = assertCleanJson($c, 'a=test_fault&kind=memory');
        eq(500, $c->status);
        eq('memory_limit', $d['error']['code']);
    },

    'test_fault does not exist without PMF_TEST_FAULTS' => static function (): void {
        $srv = new TestServer(['display_errors' => '1']);
        $c = new TestClient($srv->url);
        $d = $c->json('GET', 'a=test_fault&kind=warning');
        ok(in_array($d['error']['code'], ['unknown_action', 'not_authenticated'], true), 'not available: ' . $d['error']['code']);
        $srv->stop();
    },
];
