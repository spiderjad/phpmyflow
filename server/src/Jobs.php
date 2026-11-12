<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * Private temp folder for long jobs (export files, import uploads): one
 * folder per session (an id from another session is never found), outside
 * the web root by default ('import_dir' in config.php), files older than a
 * day removed. Job state lives here as JSON, so a job resumes after a cut.
 */
final class Jobs
{
    public static function dir(): string
    {
        $base = (string) (pmf_config()['import_dir'] ?? '') ?: sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpmyflow-import';
        $dir = self::privateDir(rtrim($base, '/\\') . DIRECTORY_SEPARATOR . substr(hash('sha256', session_id() . '|' . Auth::csrfToken()), 0, 24));
        self::cleanup(dirname($dir));
        return $dir;
    }

    /**
     * $dir and its parent, created 0700, or refused when one already exists and
     * is not ours and private: a link, owned by another user, or open to group /
     * others (the default base is in the shared temp dir, where anyone could
     * have prepared it). Owner and mode are checked where POSIX has them.
     */
    public static function privateDir(string $dir): string
    {
        foreach ([dirname($dir), $dir] as $d) {
            if (is_link($d)) {
                throw new ApiError('import_dir', 'The temporary folder is not private', 500);
            }
            if (!is_dir($d)) {
                if (!@mkdir($d, 0700) && !is_dir($d)) {
                    throw new ApiError('import_dir', 'Cannot create the temporary folder for imports', 500);
                }
                @chmod($d, 0700);
            }
            clearstatcache(true, $d);
            if (DIRECTORY_SEPARATOR === '/') {
                $euid = function_exists('posix_geteuid') ? posix_geteuid() : getmyuid();
                if (is_link($d) || fileowner($d) !== $euid || (fileperms($d) & 0077) !== 0) {
                    throw new ApiError('import_dir', 'The temporary folder is not private', 500);
                }
            }
        }
        return $dir;
    }

    /** Remove files older than a day (abandoned jobs, undownloaded exports). */
    private static function cleanup(string $base): void
    {
        if (random_int(1, 20) !== 1) {
            return;
        }
        foreach (glob($base . '/*/*') ?: [] as $f) {
            if (is_file($f) && filemtime($f) < time() - 86400) {
                @unlink($f);
            }
        }
    }

    public static function checkId(string $id): string
    {
        if (!preg_match('~^[a-f0-9]{32}$~', $id)) {
            throw new ApiError('job_not_found', 'Unknown job', 404);
        }
        return $id;
    }

    public static function newId(): string
    {
        return bin2hex(random_bytes(16));
    }

    /** Seconds of work per request (config 'job_step_seconds', env PMF_JOB_STEP_SECONDS). */
    public static function stepSeconds(): float
    {
        $v = (float) (pmf_config()['job_step_seconds'] ?? 3);
        return max(0.2, min(25.0, $v));
    }

    public static function readState(string $file): ?array
    {
        if (!is_file($file)) {
            return null;
        }
        $s = json_decode((string) file_get_contents($file), true);
        return is_array($s) ? $s : null;
    }

    /** Atomic write: a cut never leaves half a state file. */
    public static function writeState(string $file, array $state): void
    {
        $tmp = $file . '.tmp';
        file_put_contents($tmp, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE), LOCK_EX);
        if (!@rename($tmp, $file)) {
            // Windows: rename over an open file can fail; copy instead.
            copy($tmp, $file);
            @unlink($tmp);
        }
    }

    /** Give a step some room on hosts that allow it (the step itself stops at its budget). */
    public static function roomToWork(float $budget): void
    {
        $limit = (int) ini_get('max_execution_time');
        $want = (int) ceil($budget * 4 + 30);
        if ($limit !== 0 && $limit < $want) {
            @set_time_limit($want);
        }
    }
}
