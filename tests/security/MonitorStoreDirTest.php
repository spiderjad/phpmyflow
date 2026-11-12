<?php
declare(strict_types=1);

use PhpMyFlow\MetricsStore;

require_once __DIR__ . '/../php/support.php';

/*
 * By default Monitor history lives under server/data, inside the web root,
 * where only .htaccess / web.config keep it private (nginx, Caddy and php -S
 * ignore them). The files go into a subfolder with a random name made on
 * first use, so no history file has a path anyone can guess; history written
 * by earlier versions is moved into it.
 */

return [
    'history inside the web root lives in a random, stable subfolder' => static function (): void {
        $base = sys_get_temp_dir() . '/pmf_sec_store_' . bin2hex(random_bytes(4));
        mkdir($base);
        file_put_contents("$base/samples-20261110.jsonl", "{}\n");
        file_put_contents("$base/state.json", '{}');
        try {
            $dir = MetricsStore::hiddenDir($base);
            ok((bool) preg_match('~^s-[a-f0-9]{32}$~', basename($dir)), "random name: $dir");
            eq($dir, MetricsStore::hiddenDir($base), 'the same folder every time');
            ok(is_file("$dir/samples-20261110.jsonl") && is_file("$dir/state.json"), 'earlier history moved in');
            eq([], glob("$base/*.jsonl") ?: [], 'no history file left at a known path');
            ok(!is_file("$base/state.json"), 'state moved too');
            ok(is_file("$base/.htaccess") && is_file("$dir/.htaccess"), 'deny files in both folders');

            $store = MetricsStore::open($dir);
            $store->addSize('h:1', time(), 'db', 1);
            eq([], glob("$base/*.jsonl") ?: [], 'new history is written inside the random folder');
        } finally {
            foreach (array_merge(glob("$base/*/{,.}*", GLOB_BRACE) ?: [], glob("$base/{,.}*", GLOB_BRACE) ?: []) as $f) {
                is_file($f) && @unlink($f);
            }
            foreach (glob("$base/*", GLOB_ONLYDIR) ?: [] as $d) {
                @rmdir($d);
            }
            @rmdir($base);
        }
    },
];
