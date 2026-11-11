<?php
declare(strict_types=1);

/*
 * Router for PHP's built-in server, used by scripts/serve-lan.ps1 and
 * scripts/serve-lan.sh:  php -S <ip>:<port> -t server scripts/lan-router.php
 *
 * The built-in server ignores .htaccess / web.config, so without this router
 * it would hand out server/data/ (monitor history), server/src/ and any other
 * file under server/. Only the UI and the API endpoint are served.
 */

if (PHP_SAPI !== 'cli-server') {
    http_response_code(404);
    exit;
}

$path = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));

$allowed = $path === '/'
    || $path === '/index.html'
    || $path === '/api.php'
    || (str_starts_with($path, '/assets/') && !str_contains($path, '..') && !str_ends_with(strtolower($path), '.php'));

if (!$allowed) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not found\n";
    return true;
}

// Let the built-in server serve the file (or run api.php) as usual.
return false;
