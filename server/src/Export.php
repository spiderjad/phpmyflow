<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * Export helpers shared by the export job (ExportJob) and database copies
 * (Ddl). The export itself runs as a job of short steps: see ExportJob.
 */
final class Export
{
    /**
     * CREATE VIEW that imports anywhere: no DEFINER (it would need SUPER for
     * another user) and no qualifier of the source database (only in
     * identifiers, never inside strings or comments).
     */
    public static function viewSql(string $create, ?string $db = null): string
    {
        $sql = self::stripDefiner($create);
        if ($db !== null) {
            $sql = (string) (new SqlRetarget([$db]))->rewrite($sql);
        }
        return rtrim($sql, "; \n") . ';';
    }

    /**
     * SHOW CREATE VIEW / PROCEDURE / FUNCTION / TRIGGER / EVENT without the
     * DEFINER clause of its header. Only the header is matched (anchored, once):
     * the body, written by whoever created the object, is never rewritten.
     */
    public static function stripDefiner(string $create): string
    {
        // `user` (`` inside), 'user' (\' or '' inside) or a bare name.
        $part = "(?:`(?:[^`]|``)*`|'(?:[^'\\\\]|\\\\.|'')*'|[^\\s@`']+)";
        return (string) preg_replace(
            '~^(\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:ALGORITHM\s*=\s*\w+\s+)?)DEFINER\s*=\s*' . $part . '(?:@' . $part . ')?\s+~i',
            '$1',
            $create,
            1,
        );
    }

    /** An identifier for a "-- " comment line: no line breaks or other control characters. */
    public static function commentName(string $name): string
    {
        return (string) preg_replace('~[\x00-\x1F\x7F]~', ' ', Db::ident($name));
    }
}
