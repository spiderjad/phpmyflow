<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * Users log in with their own database credentials (like phpMyAdmin's
 * cookie auth). The password is kept encrypted in the server session;
 * the decryption key lives only in an HttpOnly cookie, so neither the
 * session file nor the cookie alone reveals it.
 */
final class Auth
{
    private const KEY_COOKIE = 'pmf_key';
    private const CIPHER = 'aes-256-gcm';

    public static function csrfToken(): string
    {
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf'];
    }

    public static function checkCsrf(): void
    {
        $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($sent) || !hash_equals(self::csrfToken(), $sent)) {
            throw new ApiError('csrf', 'Invalid or missing CSRF token', 403);
        }
    }

    public static function isAuthenticated(): bool
    {
        if (empty($_SESSION['auth'])) {
            return false;
        }
        $idle = (int) pmf_config()['session_idle_seconds'];
        if (time() - (int) ($_SESSION['auth']['last_seen'] ?? 0) > $idle) {
            self::logout();
            return false;
        }
        $_SESSION['auth']['last_seen'] = time();
        return true;
    }

    public static function requireAuth(): void
    {
        if (!self::isAuthenticated()) {
            throw new ApiError('not_authenticated', 'Please log in', 401);
        }
    }

    public static function publicInfo(): ?array
    {
        if (!self::isAuthenticated()) {
            return null;
        }
        $a = $_SESSION['auth'];
        return ['user' => $a['user'], 'host' => $a['host'], 'port' => $a['port'], 'ssl' => !empty($a['ssl']['enabled'])];
    }

    /**
     * @param array{enabled?:mixed,verify?:mixed,ca?:mixed} $sslRequest SSL choices from the login form
     */
    public static function login(string $host, int $port, string $user, #[\SensitiveParameter] string $password, array $sslRequest = []): void
    {
        $server = self::resolveServer($host, $port);
        self::assertNotRateLimited();
        $ssl = self::sslOptions($server, $sslRequest);

        self::open($host, $port, $user, $password, $ssl);

        self::clearFailures();
        session_regenerate_id(true);

        $key = random_bytes(32);
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($password, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv, $tag);

        $_SESSION['auth'] = [
            'host' => $host,
            'port' => $port,
            'user' => $user,
            'pw' => base64_encode($iv . $tag . $cipher),
            // SSL settings travel with the rest of the connection data.
            'ssl' => $ssl,
            'last_seen' => time(),
        ];
        $params = session_get_cookie_params();
        setcookie(self::KEY_COOKIE, base64_encode($key), [
            'expires' => 0,
            'path' => $params['path'],
            'secure' => $params['secure'],
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        unset($_SESSION['csrf']);
    }

    /**
     * "Test connection" on the login form: same checks as login (allowed hosts,
     * rate limit, wrong passwords count), but no session is created.
     *
     * @return array{version:string,sslCipher:?string}
     */
    public static function testConnection(string $host, int $port, string $user, #[\SensitiveParameter] string $password, array $sslRequest = []): array
    {
        $server = self::resolveServer($host, $port);
        self::assertNotRateLimited();
        $ssl = self::sslOptions($server, $sslRequest);
        $pdo = self::open($host, $port, $user, $password, $ssl);
        $cipher = null;
        try {
            $row = $pdo->query("SHOW SESSION STATUS LIKE 'Ssl_cipher'")->fetch();
            $cipher = is_array($row) && ($row['Value'] ?? '') !== '' ? (string) $row['Value'] : null;
        } catch (\PDOException) {
            // Not important enough to fail the test.
        }
        return ['version' => (string) $pdo->getAttribute(\PDO::ATTR_SERVER_VERSION), 'sslCipher' => $cipher];
    }

    /** Connect or throw a specific error; only credential errors count as failed attempts. */
    private static function open(string $host, int $port, string $user, #[\SensitiveParameter] string $password, array $ssl): \PDO
    {
        try {
            return self::withReadTimeout(static fn () => Db::connect($host, $port, $user, $password, null, $ssl));
        } catch (\PDOException $e) {
            $err = ConnectError::fromException($e, Db::$lastWarnings, $host, $port, !empty($ssl['enabled']), $password);
            if (in_array($err->errorCode, ConnectError::CREDENTIAL_CODES, true)) {
                self::recordFailure();
            }
            if ($err->errorCode === 'ssl_failed' && ($ssl['verify'] ?? true) && self::tlsWorksUnverified($host, $port, $ssl)) {
                throw new ApiError('ssl_untrusted', 'The server certificate is not trusted', 400, $err->details);
            }
            throw $err;
        }
    }

    /**
     * mysqlnd says only "Cannot connect to MySQL using SSL" when the certificate
     * is rejected. To tell an untrusted certificate from a broken TLS setup, try
     * the handshake once more without verification and WITHOUT the user's
     * credentials (a dummy user, empty password): nothing secret goes over the
     * unverified channel and the connection is dropped right away.
     */
    private static function tlsWorksUnverified(string $host, int $port, array $ssl): bool
    {
        try {
            self::withReadTimeout(static fn () => Db::connect($host, $port, 'phpmyflow_tls_probe', '', null, ['verify' => false] + $ssl));
            return true;
        } catch (\PDOException $e) {
            // Any answer from the server after the handshake (e.g. access denied) means TLS itself works.
            return (bool) preg_match('/\[(1045|1044|1130|1698)\]/', $e->getMessage());
        }
    }

    /**
     * A port that isn't MySQL (SQL Server, PostgreSQL, HTTP…) accepts the TCP
     * connection and then never sends a greeting: without a read timeout the
     * login would hang for a minute. Only for the short-lived login connections;
     * the timeout stays on the connection, so normal queries don't get it.
     */
    private static function withReadTimeout(callable $fn): mixed
    {
        $old = ini_get('mysqlnd.net_read_timeout');
        @ini_set('mysqlnd.net_read_timeout', (string) max(1, (int) (pmf_config()['connect_timeout_seconds'] ?? 10)));
        try {
            return $fn();
        } finally {
            if ($old !== false) {
                @ini_set('mysqlnd.net_read_timeout', $old);
            }
        }
    }

    /**
     * SSL settings for a connection. Listed servers use their config.php keys
     * unless they set 'ssl_choice' => true; custom hosts use the form, where the
     * CA can only be the system store or a file named in config 'ssl_ca_files'
     * (the client never sends a path).
     *
     * @return array{enabled:bool,verify:bool,ca:string,cert:string,key:string}
     */
    public static function sslOptions(?array $server, array $req): array
    {
        $fromServer = [
            'enabled' => (bool) ($server['ssl'] ?? false),
            'verify' => ($server['ssl_verify'] ?? true) !== false,
            'ca' => (string) ($server['ssl_ca'] ?? ''),
            'cert' => (string) ($server['ssl_cert'] ?? ''),
            'key' => (string) ($server['ssl_key'] ?? ''),
        ];
        if ($server !== null && empty($server['ssl_choice'])) {
            return $fromServer;
        }
        $ca = $fromServer['ca'];
        if (array_key_exists('ca', $req)) {
            $label = (string) $req['ca'];
            $files = (array) (pmf_config()['ssl_ca_files'] ?? []);
            if ($label === '') {
                $ca = '';
            } elseif (isset($files[$label]) && is_string($files[$label])) {
                $ca = $files[$label];
            } else {
                throw new ApiError('bad_request', 'Unknown CA', 400);
            }
        }
        return [
            'enabled' => array_key_exists('enabled', $req) ? (bool) $req['enabled'] : $fromServer['enabled'],
            'verify' => array_key_exists('verify', $req) ? (bool) $req['verify'] : $fromServer['verify'],
            'ca' => $ca,
            'cert' => $fromServer['cert'],
            'key' => $fromServer['key'],
        ];
    }

    public static function logout(): void
    {
        unset($_SESSION['auth'], $_SESSION['csrf']);
        setcookie(self::KEY_COOKIE, '', ['expires' => time() - 3600, 'path' => '/']);
    }

    /** @return array{host:string,port:int,user:string,password:string,ssl:array} */
    public static function credentials(): array
    {
        self::requireAuth();
        $a = $_SESSION['auth'];
        $key = base64_decode($_COOKIE[self::KEY_COOKIE] ?? '', true);
        $raw = base64_decode($a['pw'], true);
        if ($key === false || strlen($key) !== 32 || $raw === false) {
            self::logout();
            throw new ApiError('not_authenticated', 'Session expired', 401);
        }
        $password = openssl_decrypt(substr($raw, 28), self::CIPHER, $key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
        if ($password === false) {
            self::logout();
            throw new ApiError('not_authenticated', 'Session expired', 401);
        }
        return ['host' => $a['host'], 'port' => (int) $a['port'], 'user' => $a['user'], 'password' => $password, 'ssl' => (array) ($a['ssl'] ?? [])];
    }

    /**
     * The config.php server for host:port, or null for a custom host.
     * Throws when the host isn't listed and custom hosts are off.
     */
    private static function resolveServer(string $host, int $port): ?array
    {
        $config = pmf_config();
        foreach ($config['servers'] as $server) {
            if ($server['host'] === $host && (int) $server['port'] === $port) {
                return $server;
            }
        }
        if ($config['allow_custom_host']) {
            return null;
        }
        throw new ApiError('host_not_allowed', 'This server is not in the allowed list', 403);
    }

    // --- brute-force protection (file based, works on shared hosting) ---

    private static function attemptsFile(): string
    {
        return sys_get_temp_dir() . '/pmf_login_' . hash('sha256', Http::clientIp());
    }

    /** @return int[] timestamps of recent failures */
    private static function recentFailures(): array
    {
        $file = self::attemptsFile();
        $window = (int) pmf_config()['login_window_seconds'];
        $list = is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: []) : [];
        return array_values(array_filter($list, static fn ($t) => is_int($t) && $t > time() - $window));
    }

    private static function assertNotRateLimited(): void
    {
        if (count(self::recentFailures()) >= (int) pmf_config()['login_max_attempts']) {
            throw new ApiError('too_many_attempts', 'Too many failed logins. Try again later.', 429);
        }
    }

    private static function recordFailure(): void
    {
        $list = self::recentFailures();
        $list[] = time();
        file_put_contents(self::attemptsFile(), json_encode($list), LOCK_EX);
    }

    private static function clearFailures(): void
    {
        @unlink(self::attemptsFile());
    }
}
