<?php
declare(strict_types=1);

namespace PhpMyFlow;

final class Http
{
    private static ?array $body = null;

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    /** JSON body for POST, query string for GET. */
    public static function input(string $key, mixed $default = null): mixed
    {
        if (self::method() === 'POST') {
            if (self::$body === null) {
                $raw = file_get_contents('php://input') ?: '';
                $decoded = json_decode($raw, true);
                self::$body = is_array($decoded) ? $decoded : [];
            }
            return self::$body[$key] ?? $default;
        }
        return $_GET[$key] ?? $default;
    }

    public static function requireString(string $key): string
    {
        $value = self::input($key);
        if (!is_string($value) || $value === '') {
            throw new ApiError('missing_param', "Missing parameter: $key", 400);
        }
        return $value;
    }

    public static function json(array $data, int $status = 200): never
    {
        // Anything printed before (a stray echo) would break the JSON.
        Guard::discardOutput();
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION);
        exit;
    }

    public static function clientIp(): string
    {
        return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    }
}
