<?php
declare(strict_types=1);

/*
 * Tiny test runner (no Composer, like the server). Each *Test.php file returns
 * an array of name => closure; a closure fails by throwing.
 *
 *   php tests/php/run.php            all tests
 *   php tests/php/run.php Schema     files whose name contains "Schema"
 */

require __DIR__ . '/../../server/src/bootstrap.php';

function eq(mixed $expected, mixed $actual, string $what = ''): void
{
    if ($expected !== $actual) {
        throw new RuntimeException(($what ? "$what\n" : '') . '  expected: ' . json_encode($expected, JSON_UNESCAPED_SLASHES) . "\n  actual:   " . json_encode($actual, JSON_UNESCAPED_SLASHES));
    }
}

function ok(bool $cond, string $what): void
{
    if (!$cond) {
        throw new RuntimeException($what);
    }
}

$filter = $argv[1] ?? '';
$failed = 0;
$passed = 0;
foreach (glob(__DIR__ . '/*Test.php') as $file) {
    if ($filter !== '' && stripos(basename($file), $filter) === false) {
        continue;
    }
    foreach (require $file as $name => $fn) {
        try {
            $fn();
            $passed++;
            echo "  ok   " . basename($file, '.php') . " > $name\n";
        } catch (Throwable $e) {
            $failed++;
            echo "  FAIL " . basename($file, '.php') . " > $name\n" . $e->getMessage() . "\n";
        }
    }
}
echo "\n$passed passed, $failed failed\n";
exit($failed ? 1 : 0);
