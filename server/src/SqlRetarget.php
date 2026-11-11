<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * Importing a dump into another database.
 *
 *  inspect(): what the first statements say about the source — database in
 *  the header comment (phpMyFlow, phpMyAdmin in any language, mysqldump),
 *  USE, CREATE DATABASE, names qualified with a database in table positions
 *  (CREATE / INSERT / ALTER / DROP TABLE, REFERENCES), and WordPress (table
 *  prefix). The import modal sends the first 256 KB of the file.
 *
 *  rewrite(): with "import everything into the chosen database", USE and
 *  CREATE DATABASE are skipped and the source database qualifier is dropped
 *  in identifiers (`src`.`t` → `t`), never inside strings or comments.
 */
final class SqlRetarget
{
    /** @var array<string, true> lower-case source database names */
    private array $sources = [];

    /** @param list<string> $sources database names to drop as qualifiers */
    public function __construct(array $sources)
    {
        foreach ($sources as $s) {
            if (is_string($s) && $s !== '') {
                $this->sources[strtolower($s)] = true;
            }
        }
    }

    /** The statement to run instead, or null to skip it. */
    public function rewrite(string $sql): ?string
    {
        if (self::isDatabaseStatement($sql)) {
            return null;
        }
        return $this->sources ? $this->dropQualifiers($sql) : $sql;
    }

    /** USE x, CREATE DATABASE / SCHEMA x (also inside a /*!…*\/ version comment). */
    public static function isDatabaseStatement(string $sql): bool
    {
        $s = self::head($sql);
        $s = (string) preg_replace('~^/\*!\d*\s*~', '', $s);
        return (bool) preg_match('~^(USE\s|CREATE\s+(DATABASE|SCHEMA)\b)~i', $s);
    }

    private static function head(string $sql): string
    {
        return ltrim((string) preg_replace('~^(?:\s+|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|/\*(?!!).*?\*/)*~s', '', substr($sql, 0, 2000)));
    }

    /** Drop `src`. / src. before an identifier, outside strings and comments. */
    private function dropQualifiers(string $sql): string
    {
        $out = '';
        $n = strlen($sql);
        $i = 0;
        $prevSignificant = '';
        while ($i < $n) {
            $c = $sql[$i];
            // Strings
            if ($c === "'" || $c === '"') {
                $j = $i + 1;
                while ($j < $n) {
                    if ($sql[$j] === '\\') {
                        $j += 2;
                        continue;
                    }
                    if ($sql[$j] === $c) {
                        if ($j + 1 < $n && $sql[$j + 1] === $c) {
                            $j += 2;
                            continue;
                        }
                        break;
                    }
                    $j++;
                }
                $out .= substr($sql, $i, $j + 1 - $i);
                $i = $j + 1;
                $prevSignificant = $c;
                continue;
            }
            // Comments (/*! … *\/ is code: only its marker is copied as is)
            if (($c === '-' && substr($sql, $i, 3) === '-- ') || $c === '#' || ($c === '-' && substr($sql, $i, 3) === "--\n")) {
                $j = strpos($sql, "\n", $i);
                $j = $j === false ? $n : $j + 1;
                $out .= substr($sql, $i, $j - $i);
                $i = $j;
                continue;
            }
            if ($c === '/' && ($sql[$i + 1] ?? '') === '*' && ($sql[$i + 2] ?? '') !== '!') {
                $j = strpos($sql, '*/', $i + 2);
                $j = $j === false ? $n : $j + 2;
                $out .= substr($sql, $i, $j - $i);
                $i = $j;
                continue;
            }
            // Identifiers: `quoted` or bare
            $ident = null;
            $j = $i;
            if ($c === '`') {
                $j = $i + 1;
                while ($j < $n) {
                    if ($sql[$j] === '`') {
                        if (($sql[$j + 1] ?? '') === '`') {
                            $j += 2;
                            continue;
                        }
                        break;
                    }
                    $j++;
                }
                $ident = str_replace('``', '`', substr($sql, $i + 1, $j - $i - 1));
                $j++;
            } elseif (preg_match('~[A-Za-z0-9_$]~', $c) && !preg_match('~[A-Za-z0-9_$]~', $i > 0 ? $sql[$i - 1] : ' ')) {
                $m = [];
                preg_match('~[A-Za-z0-9_$]+~A', $sql, $m, 0, $i);
                $ident = $m[0];
                $j = $i + strlen($ident);
            }
            if ($ident !== null) {
                // `src` . <identifier>, and not itself the second part of a name (x.`src`).
                if ($prevSignificant !== '.' && isset($this->sources[strtolower($ident)]) && preg_match('~\s*\.\s*(?=[`A-Za-z_$])~A', $sql, $m, 0, $j)) {
                    $i = $j + strlen($m[0]);
                    $prevSignificant = '';
                    continue;
                }
                $out .= substr($sql, $i, $j - $i);
                $i = $j;
                $prevSignificant = 'id';
                continue;
            }
            $out .= $c;
            if (!ctype_space($c)) {
                $prevSignificant = $c;
            }
            $i++;
        }
        return $out;
    }

    /**
     * What the start of a dump says about its source.
     *
     * @return array{database:?string, uses:list<string>, createDbs:list<string>, qualified:list<string>, sources:list<string>, wordpress:?array{prefix:string}, statements:int}
     */
    public static function inspect(string $head): array
    {
        $database = null;
        if (preg_match('~^--\s*(?:Database|Base de datos|Base de données|Banco de dados|Datenbank|Database|Baza danych|Databáze)\s*:\s*`?([^`\s]+)`?\s*$~mi', $head, $m)) {
            $database = $m[1];
        } elseif (preg_match('~^-- Host:.*?\bDatabase:\s*(\S+)~mi', $head, $m)) {
            $database = $m[1];
        }
        // Whole statements only: the last one may be cut by the 256 KB limit.
        $fh = fopen('php://memory', 'w+b');
        fwrite($fh, $head);
        rewind($fh);
        $split = new SqlSplitter($fh, 0, ';', 1);
        $stmts = [];
        while (($st = $split->next()) !== null && count($stmts) < 2000) {
            $stmts[] = $st['sql'];
        }
        fclose($fh);
        $complete = rtrim($head) !== '' && preg_match('~;\s*$~', rtrim($head));
        if (!$complete && $stmts) {
            array_pop($stmts);
        }
        $uses = [];
        $createDbs = [];
        $qualified = [];
        $tables = [];
        $siteurl = false;
        $one = '(?:`((?:[^`]|``)+)`|([\w$]+))';
        foreach ($stmts as $sql) {
            $h = (string) preg_replace('~^/\*!\d*\s*~', '', self::head($sql));
            if (preg_match("~^USE\s+$one~i", $h, $m)) {
                $uses[] = str_replace('``', '`', $m[1] !== '' ? $m[1] : $m[2]);
                continue;
            }
            if (preg_match("~^CREATE\s+(?:DATABASE|SCHEMA)\s+(?:IF\s+NOT\s+EXISTS\s+)?$one~i", $h, $m)) {
                $createDbs[] = str_replace('``', '`', $m[1] !== '' ? $m[1] : $m[2]);
                continue;
            }
            // db.table in table positions only (never table.column).
            $positions = "(?:CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?|(?:INSERT|REPLACE)(?:\s+(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY|IGNORE))*\s+(?:INTO\s+)?|ALTER\s+(?:ONLINE\s+|IGNORE\s+)?TABLE\s+|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?|LOCK\s+TABLES\s+|REFERENCES\s+|TRUNCATE\s+(?:TABLE\s+)?)";
            if (preg_match_all("~$positions$one\s*\.\s*$one~i", $sql, $mm, PREG_SET_ORDER)) {
                foreach ($mm as $q) {
                    $qualified[] = str_replace('``', '`', $q[1] !== '' ? $q[1] : $q[2]);
                }
            }
            $t = Import::tableOf($sql);
            if ($t && $t['verb'] === 'create') {
                $tables[] = $t['table'];
            }
            if ($t && $t['verb'] === 'insert' && str_ends_with($t['table'], 'options') && stripos($sql, "'siteurl'") !== false) {
                $siteurl = $t['table'];
            }
        }
        $wordpress = null;
        foreach ($tables as $t) {
            if (preg_match('~^(\w*_)options$~', $t, $m) && in_array($m[1] . 'posts', $tables, true)) {
                $wordpress = ['prefix' => $m[1]];
                break;
            }
        }
        if (!$wordpress && is_string($siteurl) && preg_match('~^(\w*_)options$~', $siteurl, $m)) {
            $wordpress = ['prefix' => $m[1]];
        }
        $uniq = static fn (array $a) => array_values(array_unique($a));
        $sources = $uniq(array_filter([$database, ...$uses, ...$createDbs, ...$qualified], static fn ($x) => is_string($x) && $x !== ''));
        return [
            'database' => $database,
            'uses' => $uniq($uses),
            'createDbs' => $uniq($createDbs),
            'qualified' => $uniq($qualified),
            'sources' => $sources,
            'wordpress' => $wordpress,
            'statements' => count($stmts),
        ];
    }
}
