<?php
declare(strict_types=1);

use PhpMyFlow\Sql;

require_once __DIR__ . '/../php/support.php';

/*
 * In read-only mode a statement reaches MySQL without the app's write check
 * only when Sql::classify() calls it read-only. MySQL runs the text of
 * executable comments (/*! … *\/, /*M! … *\/), and a "#" or "--" inside a
 * string is not a comment, so neither may hide a write from the check.
 */

return [
    'executable comments and comment markers inside strings never hide a write' => static function (): void {
        foreach ([
            "SELECT 1 /*! INTO OUTFILE '/tmp/pmf_x' */",
            "SELECT 1 /*!50000 INTO DUMPFILE '/tmp/pmf_x' */",
            "SELECT 1 /*M!100000 INTO OUTFILE '/tmp/pmf_x' */",
            "/*!50000 DELETE FROM t */",
            "WITH x AS (SELECT 1) SELECT * FROM x /*! INTO OUTFILE '/tmp/pmf_x' */",
            "SELECT '#', 1 INTO OUTFILE '/tmp/pmf_x'",
            "SELECT '-- ', 1 INTO OUTFILE '/tmp/pmf_x'",
            "SELECT \"#\" INTO DUMPFILE '/tmp/pmf_x'",
        ] as $sql) {
            eq(false, Sql::classify($sql)['readOnly'], $sql);
        }
    },

    'plain reads stay read-only' => static function (): void {
        foreach ([
            "SELECT '/*! INTO OUTFILE */' AS s",
            "SELECT 'INTO OUTFILE' AS s",
            'SELECT 1 -- INTO OUTFILE',
            "SELECT 1 # DELETE\n",
            'SELECT `a#b` FROM t /* INTO OUTFILE */',
            "SHOW TABLES",
        ] as $sql) {
            eq(true, Sql::classify($sql)['readOnly'], $sql);
        }
        eq('DELETE', Sql::classify('/*!50000 DELETE FROM t */')['verb']);
        eq('no_where', Sql::classify('/*!50000 DELETE FROM t */')['reason'], 'a hidden DELETE without WHERE still asks for confirmation');
    },
];
