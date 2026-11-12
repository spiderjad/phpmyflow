<?php
declare(strict_types=1);

use PhpMyFlow\ApiError;
use PhpMyFlow\Jobs;

require_once __DIR__ . '/../php/support.php';

/*
 * Job folders (export files, import uploads) live in the system temp dir by
 * default, which every local user can write to. A folder that already exists
 * is only used when it is ours and private: not a link, owned by this
 * process's user, no access for group or others (POSIX; Windows temp folders
 * are per user).
 */

function secTmp(string $tag): string
{
    return sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'pmf_sec_' . $tag . '_' . bin2hex(random_bytes(4));
}

function refused(callable $fn): bool
{
    try {
        $fn();
        return false;
    } catch (ApiError $e) {
        return $e->errorCode === 'import_dir';
    }
}

return [
    'a new job folder is created private' => static function (): void {
        $dir = secTmp('jobs') . DIRECTORY_SEPARATOR . 'session';
        eq($dir, Jobs::privateDir($dir));
        ok(is_dir($dir), 'created');
        if (DIRECTORY_SEPARATOR === '/') {
            eq('700', substr(sprintf('%o', fileperms($dir)), -3), 'mode 0700');
            eq('700', substr(sprintf('%o', fileperms(dirname($dir))), -3), 'parent mode 0700');
        }
        rmdir($dir);
        rmdir(dirname($dir));
    },

    'a folder another user could have prepared is refused' => static function (): void {
        if (DIRECTORY_SEPARATOR !== '/') {
            echo "       (skipped: POSIX permissions)\n";
            return;
        }
        $open = secTmp('open');
        mkdir($open);
        chmod($open, 0777);
        ok(refused(static fn () => Jobs::privateDir($open)), 'a world-writable folder is refused');
        ok(refused(static fn () => Jobs::privateDir($open . '/session')), 'a folder inside it is refused too');
        rmdir($open);

        $target = secTmp('target');
        mkdir($target, 0700);
        $link = secTmp('link');
        symlink($target, $link);
        ok(refused(static fn () => Jobs::privateDir($link)), 'a symlink is refused');
        unlink($link);
        rmdir($target);
    },
];
