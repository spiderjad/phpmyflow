<?php
declare(strict_types=1);

/*
 * phpMyFlow monitor collector. Run every minute from cron:
 *
 *   * * * * * php /path/to/phpmyflow/collect.php >/dev/null 2>&1
 *
 * Uses the 'monitor' user from config.php (see README: "Monitor").
 * Options: --once (default), --verbose.
 */

use PhpMyFlow\{Collector, Metrics, MetricsStore, Monitor};

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/src/bootstrap.php';

$verbose = in_array('--verbose', $argv, true);

try {
    $pdo = Monitor::configConnection();
    if ($pdo === null) {
        fwrite(STDERR, "phpMyFlow: no 'monitor' user in config.php. See README, section Monitor.\n");
        exit(2);
    }
    $store = MetricsStore::open();
    $lock = fopen(MetricsStore::defaultDir() . '/collect.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        if ($verbose) {
            echo "Another collector run is in progress.\n";
        }
        exit(0);
    }
    $result = Collector::run($pdo, (string) Collector::configKey(), $store);
    flock($lock, LOCK_UN);
    if ($verbose) {
        echo json_encode($result + ['storage' => $store->kind()]), "\n";
    }
} catch (\Throwable $e) {
    fwrite(STDERR, 'phpMyFlow collector: ' . $e->getMessage() . "\n");
    exit(1);
}
