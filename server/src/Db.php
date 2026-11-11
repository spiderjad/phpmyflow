<?php
declare(strict_types=1);

namespace PhpMyFlow;

use PDO;

final class Db
{
    /**
     * A pdo_mysql attribute: Pdo\Mysql::ATTR_* on PHP 8.4+ (the PDO::MYSQL_ATTR_*
     * constants are deprecated in PHP 8.5, and a deprecation printed by the host
     * would break the JSON), PDO::MYSQL_ATTR_* before. Same integer values.
     */
    public static function attr(string $name): int
    {
        return defined("Pdo\Mysql::ATTR_$name") ? constant("Pdo\Mysql::ATTR_$name") : constant("PDO::MYSQL_ATTR_$name");
    }

    private static ?PDO $pdo = null;

    /** PHP warnings raised by the last connect() (mysqlnd reports TLS details there). */
    public static array $lastWarnings = [];

    /**
     * @param array{enabled?:bool,verify?:bool,ca?:string,cert?:string,key?:string} $ssl
     */
    public static function connect(string $host, int $port, string $user, #[\SensitiveParameter] string $password, ?string $db = null, array $ssl = []): PDO
    {
        $dsn = "mysql:host=$host;port=$port;charset=utf8mb4" . ($db !== null ? ';dbname=' . $db : '');
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            // One statement per request: blocks "SELECT 1; DROP TABLE x" piggybacking.
            self::attr('MULTI_STATEMENTS') => false,
            PDO::ATTR_TIMEOUT => max(1, (int) (pmf_config()['connect_timeout_seconds'] ?? 10)),
        ] + self::sslAttributes($ssl);

        self::$lastWarnings = [];
        set_error_handler(static function (int $no, string $msg): bool {
            self::$lastWarnings[] = $msg;
            return true;
        });
        try {
            return new PDO($dsn, $user, $password, $options);
        } finally {
            restore_error_handler();
        }
    }

    /**
     * PDO attributes for an SSL connection. Without a CA file the system trust
     * store is used (OpenSSL default paths; the certificate store on Windows).
     * Verification is only off when explicitly asked for.
     */
    public static function sslAttributes(array $ssl): array
    {
        if (empty($ssl['enabled'])) {
            return [];
        }
        $a = [];
        if (!empty($ssl['ca'])) {
            $a[self::attr('SSL_CA')] = (string) $ssl['ca'];
        }
        if (!empty($ssl['cert'])) {
            $a[self::attr('SSL_CERT')] = (string) $ssl['cert'];
        }
        if (!empty($ssl['key'])) {
            $a[self::attr('SSL_KEY')] = (string) $ssl['key'];
        }
        if (!$a) {
            // pdo_mysql only turns TLS on when one SSL option is set: with no
            // CA file, a cipher list does it and leaves trust to the system store.
            $a[self::attr('SSL_CIPHER')] = 'HIGH:!aNULL:!eNULL:!MD5:!RC4';
        }
        if (defined('Pdo\Mysql::ATTR_SSL_VERIFY_SERVER_CERT') || defined('PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT')) {
            $a[self::attr('SSL_VERIFY_SERVER_CERT')] = ($ssl['verify'] ?? true) !== false;
        }
        return $a;
    }

    /** Connection for the logged-in user (lazy, one per request). */
    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $c = Auth::credentials();
            try {
                self::$pdo = self::connect($c['host'], $c['port'], $c['user'], $c['password'], null, $c['ssl']);
            } catch (\PDOException $e) {
                throw ConnectError::fromException($e, self::$lastWarnings, $c['host'], $c['port'], !empty($c['ssl']['enabled']), $c['password']);
            }
        }
        return self::$pdo;
    }

    public static function useDatabase(string $db): void
    {
        Schema::assertDatabaseExists($db);
        self::pdo()->exec('USE ' . self::ident($db));
    }

    /** Quote an identifier. Callers must still validate names against information_schema. */
    public static function ident(string $name): string
    {
        return '`' . str_replace('`', '``', $name) . '`';
    }

    public static function all(string $sql, array $params = []): array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    public static function serverVersion(): string
    {
        return (string) self::pdo()->getAttribute(PDO::ATTR_SERVER_VERSION);
    }
}
