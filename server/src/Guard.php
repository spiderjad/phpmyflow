<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * The API always answers JSON, whatever PHP does on this host:
 *  - display_errors off and output buffered from the first line, so a
 *    warning, a deprecation on a newer PHP or a stray echo never lands before
 *    the JSON (Http::json() drops whatever was buffered);
 *  - warnings and notices go to the PHP log and the action continues;
 *  - uncaught exceptions and fatals (max_execution_time, memory_limit) become
 *    {"error": {code, message, details: {incident}}} with status 500; the
 *    detail (message, file, line) only goes to the log, under that incident id.
 *
 * Why: with php.ini-development (and `php -S` on Windows) a fatal is printed
 * as HTML with status 200, which the browser can't read ("Unexpected response
 * (200)"). See tests/php/ApiJsonTest.php.
 */
final class Guard
{
    private static int $baseLevel = 0;
    private static ?string $reserve = null;
    /** @var list<callable> Called on a fatal before the JSON is sent (save job state). */
    private static array $onFatal = [];

    public static function install(): void
    {
        ini_set('display_errors', '0');
        ini_set('html_errors', '0');
        ini_set('log_errors', '1');
        self::$baseLevel = ob_get_level();
        ob_start();
        // A little memory to answer after "Allowed memory size exhausted".
        self::$reserve = str_repeat(' ', 256 * 1024);

        set_error_handler(static function (int $no, string $msg, string $file, int $line): bool {
            if (!(error_reporting() & $no)) {
                return false; // silenced with @
            }
            error_log(sprintf('[phpMyFlow] PHP %s: %s in %s:%d', self::label($no), $msg, $file, $line));
            return true; // handled: never printed
        });

        set_exception_handler(static function (\Throwable $e): void {
            self::fail('internal', 'Internal error', $e);
        });

        register_shutdown_function(static function (): void {
            $err = error_get_last();
            if (!$err || !in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR], true)) {
                return;
            }
            self::$reserve = null;
            @ini_set('memory_limit', '-1');
            $msg = (string) $err['message'];
            $code = str_contains($msg, 'Maximum execution time') ? 'time_limit' : (str_contains($msg, 'Allowed memory size') ? 'memory_limit' : 'fatal');
            foreach (self::$onFatal as $fn) {
                try {
                    $fn($code);
                } catch (\Throwable) {
                    // Nothing more to do: the error below is what matters.
                }
            }
            $details = $code === 'time_limit' ? ['limit' => (int) ini_get('max_execution_time')] : ($code === 'memory_limit' ? ['limit' => (string) ini_get('memory_limit')] : []);
            self::fail($code, $code === 'time_limit' ? 'The server stopped the request: time limit' : ($code === 'memory_limit' ? 'The server ran out of memory' : 'Internal error'), null, $err, $details);
        });
    }

    /** Run $fn if the request dies of a fatal (e.g. save a job's position). */
    public static function onFatal(callable $fn): void
    {
        self::$onFatal[] = $fn;
    }

    /** Drop whatever was printed so far (warnings are never printed; stray echo is). */
    public static function discardOutput(): void
    {
        while (ob_get_level() > self::$baseLevel) {
            ob_end_clean();
        }
    }

    /** Before a raw download: no buffering at all. */
    public static function endBuffering(): void
    {
        self::discardOutput();
    }

    public static function incident(): string
    {
        return bin2hex(random_bytes(4));
    }

    /** Log the detail under an incident id and answer a JSON error. */
    public static function fail(string $code, string $message, ?\Throwable $e = null, ?array $err = null, array $details = []): void
    {
        $incident = self::incident();
        $what = $e ? get_class($e) . ': ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine() . "\n" . $e->getTraceAsString()
            : ($err ? $err['message'] . ' in ' . $err['file'] . ':' . $err['line'] : $message);
        error_log("[phpMyFlow] incident $incident ($code): $what");
        self::discardOutput();
        if (headers_sent()) {
            // A raw download already started: nothing JSON can be sent now.
            echo "\n-- phpMyFlow error ($code, incident $incident)\n";
            return;
        }
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode(['error' => ['code' => $code, 'message' => $message, 'details' => $details + ['incident' => $incident]]]);
    }

    private static function label(int $no): string
    {
        return match ($no) {
            E_WARNING, E_USER_WARNING => 'Warning',
            E_NOTICE, E_USER_NOTICE => 'Notice',
            E_DEPRECATED, E_USER_DEPRECATED => 'Deprecated',
            default => 'Error ' . $no,
        };
    }
}
