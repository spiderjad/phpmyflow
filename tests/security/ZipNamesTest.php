<?php
declare(strict_types=1);

use PhpMyFlow\Db;
use PhpMyFlow\ExportJob;

require_once __DIR__ . '/../php/support.php';

/*
 * CSV / JSON exports of several tables are a ZIP with one file per table.
 * Table names may contain "/", "\" and "..": entry names are plain file
 * names, so extracting the archive never writes outside its folder.
 */

/** File names in a ZIP's central directory. */
function secZipEntryNames(string $zip): array
{
    $names = [];
    $pos = 0;
    while (($pos = strpos($zip, "PK\x01\x02", $pos)) !== false) {
        $len = unpack('v', substr($zip, $pos + 28, 2))[1];
        $names[] = substr($zip, $pos + 46, $len);
        $pos += 46 + $len;
    }
    return $names;
}

return [
    'ZIP entries are plain, unique file names' => static function (): void {
        if (!($db = testDb())) {
            echo "       (skipped: no test database)\n";
            return;
        }
        [$host, $port, $user, $pass] = $db;
        $pdo = Db::connect($host, $port, $user, $pass);
        $pdo->exec('DROP DATABASE IF EXISTS pmf_t_sec_zip');
        $pdo->exec('CREATE DATABASE pmf_t_sec_zip');
        $pdo->exec('USE pmf_t_sec_zip');
        $tables = ['../../pmf_evil', 'a\b', 'c/d', '.hidden', 'plain'];
        foreach ($tables as $t) {
            $pdo->exec('CREATE TABLE ' . Db::ident($t) . ' (id INT PRIMARY KEY)');
            $pdo->exec('INSERT INTO ' . Db::ident($t) . ' VALUES (1)');
        }
        $dir = sys_get_temp_dir() . '/pmf_sec_zip_' . bin2hex(random_bytes(4));
        mkdir($dir);
        try {
            $start = ExportJob::start($pdo, $dir, ['db' => 'pmf_t_sec_zip', 'format' => 'csv']);
            for ($i = 0; $i < 100; $i++) {
                $r = ExportJob::load($pdo, $dir, $start['id'])->step(5);
                if ($r['status'] !== 'running') {
                    break;
                }
            }
            eq('done', $r['status'], json_encode($r));
            $names = secZipEntryNames((string) file_get_contents($dir . '/' . $start['id'] . '.export.out'));
            eq(count($tables), count($names), json_encode($names));
            eq(count($names), count(array_unique(array_map('strtolower', $names))), 'unique: ' . json_encode($names));
            foreach ($names as $n) {
                $plain = !str_contains($n, '/') && !str_contains($n, chr(92)) && !preg_match('~[\x00-\x1f]~', $n)
                    && $n[0] !== '.' && str_ends_with($n, '.csv');
                ok($plain, 'plain file name: ' . json_encode($n));
            }
            ok(in_array('plain.csv', $names, true), 'ordinary names are kept');
        } finally {
            array_map('unlink', glob($dir . '/*') ?: []);
            rmdir($dir);
            $pdo->exec('DROP DATABASE pmf_t_sec_zip');
        }
    },
];
