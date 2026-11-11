<?php
declare(strict_types=1);

namespace PhpMyFlow;

final class Sql
{
    public const KNOWN_VERBS = [
        'SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN',
        'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE', 'SET', 'USE', 'CALL', 'DO',
        'ANALYZE', 'OPTIMIZE', 'REPAIR', 'CHECK', 'CHECKSUM', 'FLUSH', 'KILL', 'LOCK', 'UNLOCK', 'LOAD',
        'HANDLER', 'HELP', 'BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'PREPARE',
        'EXECUTE', 'DEALLOCATE', 'INSTALL', 'UNINSTALL', 'BINLOG', 'PURGE', 'RESET', 'CHANGE', 'XA', 'VALUES', 'TABLE',
    ];

    private const READ = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH', 'HELP'];

    /** Remove comments and string literals so keyword checks can't be fooled. */
    public static function skeleton(string $sql): string
    {
        $out = preg_replace([
            '~/\*.*?\*/~s',             // block comments
            '~(--\s|#)[^\n]*~',          // line comments
            "~'(?:[^'\\\\]|\\\\.|'')*'~s", // single-quoted strings
            '~"(?:[^"\\\\]|\\\\.|"")*"~s', // double-quoted strings
            '~`(?:[^`]|``)*`~',          // quoted identifiers
        ], [' ', ' ', "''", '""', '``'], $sql);
        return trim((string) $out);
    }

    /**
     * @return array{verb:string, readOnly:bool, destructive:bool, reason:?string}
     */
    public static function classify(string $sql): array
    {
        $sk = strtoupper(self::skeleton($sql));
        preg_match('~^\(*\s*([A-Z]+)~', $sk, $m);
        $verb = $m[1] ?? '';
        $readOnly = in_array($verb, self::READ, true)
            && !preg_match('~\b(INSERT|UPDATE|DELETE|REPLACE|INTO\s+OUTFILE|INTO\s+DUMPFILE)\b~', $sk);

        $reason = null;
        $hasWhere = (bool) preg_match('~\bWHERE\b~', $sk);
        if ($verb === 'DROP') {
            $reason = 'drop';
        } elseif ($verb === 'TRUNCATE') {
            $reason = 'truncate';
        } elseif (in_array($verb, ['DELETE', 'UPDATE'], true) && !$hasWhere) {
            $reason = 'no_where';
        } elseif ($verb === 'ALTER' && preg_match('~\bDROP\b~', $sk)) {
            $reason = 'alter_drop';
        }

        return ['verb' => $verb, 'readOnly' => $readOnly, 'destructive' => $reason !== null, 'reason' => $reason];
    }

    /** Turn a PDOException into a structured, translatable error. */
    public static function errorFromPdo(\PDOException $e): ApiError
    {
        $info = $e->errorInfo ?? [];
        $errno = (int) ($info[1] ?? 0);
        $message = (string) ($info[2] ?? $e->getMessage());
        $details = ['mysqlCode' => $errno, 'sqlState' => $info[0] ?? null, 'serverMessage' => $message];

        if (preg_match("~near '(.*)' at line (\\d+)~s", $message, $m)) {
            $details['near'] = \pmf_substr($m[1], 80);
            $details['line'] = (int) $m[2];
        }
        // Pull the offending name out of the common "unknown X" errors.
        if (preg_match("~Unknown column '([^']+)'~", $message, $m)
            || preg_match("~Table '[^.']*\\.?([^']+)' doesn't exist~", $message, $m)
            || preg_match("~Unknown table '([^']+)'~", $message, $m)
            // 1052: Column 'id' in field list is ambiguous
            || preg_match("~Column '([^']+)' in .* is ambiguous~", $message, $m)
            // 1055: ... contains nonaggregated column 'db.t.col' which is not functionally dependent ...
            || preg_match("~nonaggregated column '([^']+)'~", $message, $m)) {
            $details['name'] = $m[1];
        }
        // 3780: Referencing column 'a' and referenced column 'b' in foreign key constraint 'c' are incompatible.
        if (preg_match("~Referencing column '([^']+)' and referenced column '([^']+)'~", $message, $m)) {
            $details['name'] = $m[1];
            $details['ref'] = $m[2];
        }
        // 1822: Missing index for constraint 'c' in the referenced table 't'
        if (preg_match("~Missing index for constraint '([^']+)' in the referenced table '([^']+)'~", $message, $m)) {
            $details['name'] = $m[1];
            $details['ref'] = $m[2];
        }
        return new ApiError('sql_error', $message, 400, $details);
    }

    /**
     * Replace literal values with "?" (strings, numbers, hex), keeping
     * identifiers and backticked names. Used by the monitor so running
     * queries don't reveal data by default.
     */
    public static function maskLiterals(string $sql): string
    {
        $out = preg_replace_callback(
            "~`(?:[^`]|``)*`|'(?:[^'\\\\]|\\\\.|'')*'|\"(?:[^\"\\\\]|\\\\.|\"\")*\"|(?<![\\w\$.])(?:0x[0-9a-f]+|-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)(?![\\w\$])~i",
            static fn ($m) => $m[0][0] === '`' ? $m[0] : '?',
            $sql
        );
        return $out ?? $sql;
    }
}
