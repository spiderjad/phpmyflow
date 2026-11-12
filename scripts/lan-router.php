<?php
declare(strict_types=1);

/*
 * Router for PHP's built-in server, used by scripts/serve-lan.ps1 and
 * scripts/serve-lan.sh:  php -S <ip>:<port> -t server scripts/lan-router.php
 *
 * The built-in server ignores .htaccess / web.config, so without this router
 * it would hand out server/data/ (monitor history), server/src/ and any other
 * file under server/. Only the UI and the API endpoint are served.
 *
 * The router serves every allowed file itself and never returns false: php -S
 * maps a request target to a file in its own way (leading "//", encoded
 * slashes, a PATH_INFO tail after an existing file), so a path checked here
 * could otherwise be served as a different file.
 */

if (PHP_SAPI !== 'cli-server') {
    http_response_code(404);
    exit;
}

$root = realpath(__DIR__ . '/../server');

$notFound = static function (): bool {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not found\n";
    return true;
};

$sendFile = static function (string $file, string $type): bool {
    header('Content-Type: ' . $type);
    header('X-Content-Type-Options: nosniff');
    header('Content-Length: ' . (string) filesize($file));
    readfile($file);
    return true;
};

// The raw target up to the query: exactly one leading "/", no encoded or
// backslash separators, no control characters, no "..".
$raw = strtok((string) ($_SERVER['REQUEST_URI'] ?? '/'), '?#');
if (!is_string($raw) || !preg_match('~^/(?!/)~', $raw) || preg_match('~%(?:2f|5c|00)|\\\\|[\x00-\x1f]~i', $raw)) {
    return $notFound();
}
$path = rawurldecode($raw);
if (str_contains($path, '..') || preg_match('~[\\\\\x00-\x1f:]~', $path)) {
    return $notFound();
}

if ($path === '/' || $path === '/index.html') {
    return is_file("$root/index.html") ? $sendFile("$root/index.html", 'text/html; charset=utf-8') : $notFound();
}

if ($path === '/api.php') {
    chdir($root);
    require $root . '/api.php';
    return true;
}

if (preg_match('~^/assets/([A-Za-z0-9._-]+)$~', $path, $m) && !str_ends_with(strtolower($m[1]), '.php')) {
    $assets = realpath("$root/assets");
    $file = $assets ? realpath("$assets/{$m[1]}") : false;
    if ($file !== false && is_file($file) && dirname($file) === $assets) {
        $types = [
            'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8',
            'css' => 'text/css; charset=utf-8', 'json' => 'application/json', 'map' => 'application/json',
            'svg' => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp',
            'avif' => 'image/avif', 'ico' => 'image/x-icon', 'gif' => 'image/gif',
            'woff' => 'font/woff', 'woff2' => 'font/woff2', 'ttf' => 'font/ttf', 'wasm' => 'application/wasm', 'txt' => 'text/plain; charset=utf-8',
        ];
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        return isset($types[$ext]) ? $sendFile($file, $types[$ext]) : $notFound();
    }
}

return $notFound();
