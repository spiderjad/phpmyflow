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
     * another user) and no qualifier of the source database.
     */
    public static function viewSql(string $create, ?string $db = null): string
    {
        $sql = (string) preg_replace('~\sDEFINER=(`[^`]*`|\S+)@(`[^`]*`|\S+)~', '', $create);
        if ($db !== null) {
            $sql = str_replace(Db::ident($db) . '.', '', $sql);
        }
        return rtrim($sql, "; \n") . ';';
    }
}
