<?php
declare(strict_types=1);

/*
 * phpMyFlow bootstrap.
 * Zero dependencies on purpose: it must run anywhere phpMyAdmin runs
 * (shared hosting with PHP 8.1+, pdo_mysql and openssl).
 */

const PMF_VERSION = '0.1.0-dev';

spl_autoload_register(static function (string $class): void {
    $prefix = 'PhpMyFlow\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

function pmf_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }
    $defaults = require __DIR__ . '/../config.sample.php';
    $local = is_file(__DIR__ . '/../config.php') ? require __DIR__ . '/../config.php' : [];
    $config = array_replace_recursive($defaults, is_array($local) ? $local : []);
    return $config;
}

function pmf_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('pmf_session');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    ini_set('session.use_strict_mode', '1');
    session_start();
}

// mbstring is not guaranteed on every host: tiny UTF-8 helpers instead.
function pmf_is_utf8(string $s): bool
{
    return preg_match('//u', $s) === 1;
}

function pmf_substr(string $s, int $length): string
{
    if (!pmf_is_utf8($s)) {
        return substr($s, 0, $length);
    }
    preg_match('/^.{0,' . $length . '}/us', $s, $m);
    return $m[0] ?? '';
}
