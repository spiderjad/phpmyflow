<?php
declare(strict_types=1);

/*
 * Shown when someone runs `php -S` from the repository root instead of
 * serving the server/ folder. It only explains how to start phpMyFlow:
 * it never includes or serves anything from server/.
 */

http_response_code(200);
header('Content-Type: text/html; charset=utf-8');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
header('Referrer-Policy: no-referrer');

$built = is_file(__DIR__ . '/server/index.html');
$host = $_SERVER['SERVER_NAME'] ?? '127.0.0.1';
$port = (int) ($_SERVER['SERVER_PORT'] ?? 8090);
$h = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
$listen = $h($host . ':' . $port);
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>phpMyFlow — start it from server/</title>
<style>
  :root { --bg: #fff; --text: #111; --muted: #555; --border: #e5e5e5; --code: #f5f5f5; --warn: #8a5a00; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0a0a0a; --text: #ededed; --muted: #a1a1a1; --border: #2e2e2e; --code: #1a1a1a; --warn: #f5b74f; }
  }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 system-ui, sans-serif; }
  main { max-width: 640px; margin: 48px auto; padding: 0 16px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  p { margin: 0 0 12px; }
  pre { background: var(--code); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; overflow-x: auto; }
  code { font: 13px/1.5 ui-monospace, monospace; }
  .muted { color: var(--muted); }
  .warn { color: var(--warn); border-left: 3px solid var(--warn); padding-left: 10px; }
</style>
</head>
<body>
<main>
  <h1>phpMyFlow is not served from the repository root</h1>
  <p>The app lives in <code>server/</code>. Start it with the script, which checks PHP, builds the UI if needed and prints the URLs:</p>
  <pre><code># Windows (PowerShell)
.\scripts\serve-lan.ps1

# macOS / Linux
./scripts/serve-lan.sh</code></pre>
  <p>Or serve the <code>server/</code> folder yourself:</p>
  <pre><code>php -S <?= $listen ?> -t server scripts/lan-router.php</code></pre>
<?php if (!$built): ?>
  <p class="warn">The UI is not built yet (<code>server/index.html</code> is missing). The script builds it, or run:<br><code>cd web &amp;&amp; npm ci &amp;&amp; npm run build</code></p>
<?php endif; ?>
  <p class="muted">PHP's built-in server has no HTTPS: passwords travel unencrypted over the network. Use it only on trusted networks.</p>
</main>
</body>
</html>
