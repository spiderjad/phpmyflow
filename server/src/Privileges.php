<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * What the logged-in user may do, read from SHOW GRANTS (global, database
 * with LIKE wildcards, and table grants). Actions the user can't run are
 * shown disabled with the GRANT that would allow them.
 *
 * Granted roles can't be resolved reliably on every server version, so with
 * roles a missing privilege is "unknown" (null): the action stays enabled and
 * the server has the last word.
 */
final class Privileges
{
    /** @var list<array{privs: list<string>, db: ?string, table: ?string}> */
    private array $grants = [];
    private bool $roles = false;

    private function __construct(private string $grantee)
    {
    }

    public static function current(): self
    {
        $pdo = Db::pdo();
        $lines = array_map(static fn ($r) => (string) array_values($r)[0], $pdo->query('SHOW GRANTS')->fetchAll(\PDO::FETCH_ASSOC));
        $cu = (string) $pdo->query('SELECT CURRENT_USER()')->fetchColumn();
        $at = strrpos($cu, '@');
        $user = $at === false ? $cu : substr($cu, 0, $at);
        $host = $at === false ? '%' : substr($cu, $at + 1);
        return self::parse($lines, "'" . str_replace("'", "''", $user) . "'@'" . str_replace("'", "''", $host) . "'");
    }

    /** @param list<string> $lines SHOW GRANTS output */
    public static function parse(array $lines, string $grantee): self
    {
        $p = new self($grantee);
        foreach ($lines as $line) {
            if (!preg_match('~^GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO\s~is', $line, $m)) {
                // "GRANT `role`@`%` TO ..." (MySQL) or "GRANT `role` TO ..." (MariaDB).
                if (preg_match('~^GRANT\s+`[^`]+`(@`[^`]*`)?(\s*,\s*`[^`]+`(@`[^`]*`)?)*\s+TO\s~i', $line)) {
                    $p->roles = true;
                }
                continue;
            }
            [$privList, $on] = [$m[1], $m[2]];
            if (stripos($on, 'PROCEDURE ') === 0 || stripos($on, 'FUNCTION ') === 0 || str_starts_with($on, "''@")) {
                continue;
            }
            // Column grants ("SELECT (`a`, `b`)") only cover some columns: ignored.
            $privList = (string) preg_replace('~\w[\w ]*\s*\([^)]*\)\s*,?~', '', $privList);
            $privs = array_values(array_filter(array_map(static fn ($x) => strtoupper(trim($x)), explode(',', $privList))));
            if (in_array('ALL PRIVILEGES', $privs, true) || in_array('ALL', $privs, true)) {
                $privs = ['ALL'];
            }
            if (!$privs || $privs === ['USAGE']) {
                continue;
            }
            if ($on === '*.*') {
                $p->grants[] = ['privs' => $privs, 'db' => null, 'table' => null];
            } elseif (preg_match('~^`((?:[^`]|``)+)`\.(\*|`((?:[^`]|``)+)`)$~', $on, $o)) {
                $p->grants[] = ['privs' => $privs, 'db' => str_replace('``', '`', $o[1]), 'table' => $o[2] === '*' ? null : str_replace('``', '`', $o[3])];
            }
        }
        return $p;
    }

    /**
     * Does the user have $priv on the server (db null), a database, or a table?
     * Null when it isn't granted directly but roles might grant it.
     */
    public function has(string $priv, ?string $db, ?string $table = null): ?bool
    {
        $priv = strtoupper($priv);
        foreach ($this->grants as $g) {
            if (!in_array('ALL', $g['privs'], true) && !in_array($priv, $g['privs'], true)) {
                continue;
            }
            if ($g['db'] === null) {
                return true;
            }
            if ($db === null || !self::dbMatches($g['db'], $db)) {
                continue;
            }
            if ($g['table'] === null || ($table !== null && strcasecmp($g['table'], $table) === 0)) {
                return true;
            }
        }
        return $this->roles ? null : false;
    }

    /** CREATE on *.* or on some database pattern (creating a matching name works). */
    public function canCreateSomeDatabase(): bool
    {
        foreach ($this->grants as $g) {
            if ($g['table'] === null && (in_array('ALL', $g['privs'], true) || in_array('CREATE', $g['privs'], true))) {
                return true;
            }
        }
        return $this->roles;
    }

    public function grant(string $priv, ?string $db, ?string $table = null): string
    {
        $on = $db === null ? '*.*' : Db::ident($db) . '.' . ($table === null ? '*' : Db::ident($table));
        return "GRANT $priv ON $on TO {$this->grantee};";
    }

    /** Database grant patterns use LIKE: % and _ are wildcards, \_ and \% literal. */
    private static function dbMatches(string $pattern, string $db): bool
    {
        if (!preg_match('~(?<!\\\\)[%_]~', $pattern)) {
            return strcasecmp(str_replace(['\\_', '\\%'], ['_', '%'], $pattern), $db) === 0;
        }
        $re = '';
        $len = strlen($pattern);
        for ($i = 0; $i < $len; $i++) {
            $c = $pattern[$i];
            if ($c === '\\' && $i + 1 < $len) {
                $re .= preg_quote($pattern[++$i], '~');
            } elseif ($c === '%') {
                $re .= '.*';
            } elseif ($c === '_') {
                $re .= '.';
            } else {
                $re .= preg_quote($c, '~');
            }
        }
        return (bool) preg_match('~^' . $re . '$~is', $db);
    }
}
