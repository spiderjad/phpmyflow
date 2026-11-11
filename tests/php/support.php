<?php
declare(strict_types=1);

/*
 * Helpers for tests that need a real web server: start `php -S` on server/
 * (with the machine's php.ini, like a user would, plus -d overrides), and an
 * HTTP client with cookies. Not a *Test.php file, so run.php doesn't load it
 * as tests.
 */

final class TestServer
{
    /** @var resource */
    private $proc;
    public string $url;
    private array $pipes = [];

    /**
     * @param array<string,string> $ini  -d overrides (memory_limit, max_execution_time...)
     * @param array<string,string> $env  environment for the server (PMF_TEST_FAULTS...)
     */
    public function __construct(array $ini = [], array $env = [], ?int $port = null)
    {
        $port ??= self::freePort();
        $this->url = "http://127.0.0.1:$port/";
        $cmd = [PHP_BINARY];
        foreach ($ini as $k => $v) {
            $cmd[] = '-d';
            $cmd[] = "$k=$v";
        }
        array_push($cmd, '-S', "127.0.0.1:$port", '-t', realpath(__DIR__ . '/../../server'));
        $nul = PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null';
        $this->proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['file', $nul, 'w'], 2 => ['file', $nul, 'w']], $this->pipes, null, $env + getenv());
        if (!is_resource($this->proc)) {
            throw new RuntimeException('Cannot start php -S');
        }
        // Even if the test dies of a fatal (no destructors), never leave the server running.
        register_shutdown_function([$this, 'stop']);
        for ($i = 0; $i < 100; $i++) {
            $s = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.1);
            if ($s) {
                fclose($s);
                return;
            }
            usleep(50000);
        }
        throw new RuntimeException("php -S did not start on $port");
    }

    public function port(): int
    {
        return (int) parse_url($this->url, PHP_URL_PORT);
    }

    /** Kill the server (and its child on Windows). */
    public function stop(): void
    {
        if (!is_resource($this->proc)) {
            return;
        }
        $pid = proc_get_status($this->proc)['pid'] ?? 0;
        if (PHP_OS_FAMILY === 'Windows' && $pid) {
            exec("taskkill /F /T /PID $pid >NUL 2>&1");
        } else {
            proc_terminate($this->proc, 9);
        }
        proc_close($this->proc);
    }

    public function __destruct()
    {
        $this->stop();
    }

    public static function freePort(): int
    {
        $s = stream_socket_server('tcp://127.0.0.1:0');
        $name = stream_socket_get_name($s, false);
        fclose($s);
        return (int) substr($name, strrpos($name, ':') + 1);
    }
}

final class TestClient
{
    public array $jar = [];
    public string $csrf = '';
    /** Last response: status, headers, raw body. */
    public int $status = 0;
    public string $body = '';
    public array $headers = [];

    public function __construct(public string $base)
    {
    }

    public function raw(string $method, string $query, string|array|null $body = null, string $type = 'application/json'): string
    {
        $h = 'Cookie: ' . implode('; ', array_map(static fn ($k, $v) => "$k=$v", array_keys($this->jar), $this->jar)) . "\r\n";
        $o = ['http' => ['method' => $method, 'ignore_errors' => true, 'timeout' => 120, 'header' => $h]];
        if ($method === 'POST') {
            $o['http']['header'] .= "Content-Type: $type\r\nX-CSRF-Token: {$this->csrf}\r\n";
            $o['http']['content'] = is_string($body) ? $body : json_encode($body ?? []);
        }
        $b = @file_get_contents($this->base . 'api.php?' . $query, false, stream_context_create($o));
        $this->headers = $http_response_header ?? [];
        $this->status = 0;
        foreach ($this->headers as $x) {
            if (preg_match('~^HTTP/\S+ (\d+)~', $x, $m)) {
                $this->status = (int) $m[1];
            }
            if (preg_match('~^Set-Cookie: ([^=]+)=([^;]*)~i', $x, $m)) {
                $this->jar[$m[1]] = $m[2];
            }
        }
        if ($b === false) {
            throw new RuntimeException("No response from $query");
        }
        return $this->body = $b;
    }

    /** JSON response, or a failure that shows what came back. */
    public function json(string $method, string $query, string|array|null $body = null, string $type = 'application/json'): array
    {
        $raw = $this->raw($method, $query, $body, $type);
        $d = json_decode($raw, true);
        if (!is_array($d)) {
            throw new RuntimeException("Not JSON (HTTP {$this->status}) for $query:\n" . substr($raw, 0, 500));
        }
        return $d;
    }

    public function login(string $host, int $port, string $user, string $pass): void
    {
        $this->csrf = $this->json('GET', 'a=session')['csrf'];
        $r = $this->json('POST', 'a=login', compact('host', 'port', 'user') + ['password' => $pass]);
        if (empty($r['ok'])) {
            throw new RuntimeException('Login failed: ' . json_encode($r));
        }
        $this->csrf = $this->json('GET', 'a=session')['csrf'];
    }
}

/** [host, port, user, pass] of the test database, or null when it can't be reached. */
function testDb(): ?array
{
    [$host, $port, $user, $pass] = explode(':', getenv('PMF_TEST_DB') ?: '127.0.0.1:3307:root:root') + [null, 3306, 'root', ''];
    try {
        new PDO("mysql:host=$host;port=$port", $user, $pass, [PDO::ATTR_TIMEOUT => 2]);
    } catch (PDOException) {
        return null;
    }
    return [$host, (int) $port, $user, $pass];
}
