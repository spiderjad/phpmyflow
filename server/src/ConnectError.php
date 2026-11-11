<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * Turns a failed PDO connection into a specific, actionable API error.
 * "Wrong password" and "can't reach the host" need very different fixes,
 * and only the first one may count towards the login rate limit.
 */
final class ConnectError
{
    /** Codes that are credential failures (count for the rate limit). */
    public const CREDENTIAL_CODES = ['login_failed'];

    /**
     * @param string[] $warnings PHP warnings raised while connecting (mysqlnd puts
     *                           TLS and greeting-packet details there, not in the exception)
     */
    public static function fromException(\PDOException $e, array $warnings, string $host, int $port, bool $ssl, #[\SensitiveParameter] string $password): ApiError
    {
        $message = $e->getMessage();
        $code = 0;
        if (preg_match('/\[(\d{4})\]/', $message, $m)) {
            $code = (int) $m[1];
        } elseif (is_array($e->errorInfo) && isset($e->errorInfo[1])) {
            $code = (int) $e->errorInfo[1];
        } elseif (is_numeric($e->getCode())) {
            $code = (int) $e->getCode();
        }
        $text = trim($message . ' ' . implode(' ', $warnings));
        $c = self::classify($code, $text, $ssl);

        $serverMessage = self::scrub(trim(preg_replace('/^SQLSTATE\[\w+\]\s*(\[\d+\]\s*)?/', '', $message) ?? $message), $password);
        $extra = array_values(array_filter(array_map(
            static fn (string $w) => self::scrub(trim(preg_replace('/^PDO::__construct\(\):\s*/', '', $w) ?? $w), $password),
            $warnings
        )));
        $details = ['host' => $host, 'port' => $port, 'mysqlCode' => $code, 'serverMessage' => $serverMessage] + $c['details'];
        if ($extra) {
            $details['warnings'] = $extra;
        }
        return new ApiError($c['code'], $c['message'], $c['status'], $details);
    }

    /**
     * Pure classification (tested in tests/php).
     *
     * @return array{code:string,message:string,status:int,details:array<string,string>}
     */
    public static function classify(int $code, string $text, bool $ssl): array
    {
        $r = static fn (string $c, string $m, int $s, array $d = []) => ['code' => $c, 'message' => $m, 'status' => $s, 'details' => $d];
        $mentionsTls = (bool) preg_match('/\b(ssl|tls|secure transport|certificate)\b/i', $text);

        if ($code === 1045) {
            $d = [];
            if (preg_match("/@'([^']+)'/", $text, $m)) {
                $d['seenFrom'] = $m[1];
            }
            return $r('login_failed', 'Wrong user, password or server', 401, $d);
        }
        if ($code === 1130) {
            $d = [];
            if (preg_match("/Host '([^']+)'/i", $text, $m)) {
                $d['seenFrom'] = $m[1];
            }
            return $r('client_not_allowed', 'The server does not accept connections from this address', 403, $d);
        }
        if ($code === 3159 || (!$ssl && $mentionsTls)) {
            return $r('ssl_required', 'The server requires an encrypted (SSL) connection', 400);
        }
        if ($ssl && preg_match('/certificate verify failed|self[- ]signed|unable to get (local )?issuer|did not match expected|unknown ca|certificate has expired|hostname mismatch/i', $text)) {
            return $r('ssl_untrusted', 'The server certificate is not trusted', 400);
        }
        if (($code === 2026 && preg_match('/not support|doesn.t support/i', $text)) || preg_match('/server (does not|doesn.t) support ssl/i', $text)) {
            return $r('ssl_unavailable', 'The server does not support SSL', 400);
        }
        if ($ssl && ($code === 2026 || $mentionsTls)) {
            return $r('ssl_failed', 'The SSL handshake failed', 400);
        }
        if ($code === 2054 || stripos($text, 'authentication method unknown') !== false) {
            $d = [];
            if (preg_match('/unknown to the client \[([^\]]*)\]/i', $text, $m)) {
                $d['plugin'] = $m[1];
            }
            return $r('auth_plugin_unsupported', 'Unsupported authentication method', 400, $d);
        }
        if ($code === 2005 || preg_match('/getaddrinfo|no such host|name or service not known|nodename nor servname|unknown (mysql server )?host|temporary failure in name resolution/i', $text)) {
            return $r('host_not_found', 'Unknown host name', 502);
        }
        if (preg_match('/greeting packet|malformed packet|packets out of order|unexpected server respon|reading initial communication packet|protocol mismatch/i', $text)
            || in_array($code, [2006, 2013, 2027, 2047], true)) {
            return $r('not_mysql', 'The service on this port does not look like MySQL/MariaDB', 502);
        }
        if ($code === 2002 || $code === 2003 || preg_match('/refused|timed out|did not properly respond|unreachable/i', $text)) {
            return $r('server_unreachable', 'Could not reach the database server', 502);
        }
        return $r('connection_failed', 'Could not connect to the database server', 502);
    }

    private static function scrub(string $s, string $password): string
    {
        return strlen($password) >= 3 ? str_replace($password, '***', $s) : $s;
    }
}
