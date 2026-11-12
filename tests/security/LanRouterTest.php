<?php
declare(strict_types=1);

require_once __DIR__ . '/../php/support.php';

/*
 * scripts/lan-router.php (php -S on the LAN) serves only the UI and api.php.
 * Request targets that php -S maps differently from a plain path ("//x",
 * encoded slashes, backslashes, PATH_INFO tails) never reach another file
 * under server/, such as the Monitor history in server/data/.
 */

/** Raw HTTP GET with the request target exactly as given: [status, body]. */
function rawGet(string $base, string $target): array
{
    $u = parse_url($base);
    $s = fsockopen($u['host'], (int) $u['port'], $errno, $errstr, 5);
    fwrite($s, "GET $target HTTP/1.0\r\nHost: {$u['host']}\r\nConnection: close\r\n\r\n");
    $resp = stream_get_contents($s);
    fclose($s);
    [$head, $body] = explode("\r\n\r\n", (string) $resp, 2) + ['', ''];
    preg_match('~^HTTP/\S+ (\d+)~', $head, $m);
    return [(int) ($m[1] ?? 0), $body];
}

return [
    'the LAN router never serves files outside the UI and api.php' => static function (): void {
        $data = realpath(__DIR__ . '/../../server') . '/data';
        $made = !is_dir($data) && mkdir($data);
        $probe = $data . '/pmf_sec_probe.json';
        file_put_contents($probe, '{"secret":"pmf-sec-probe-7f3a"}');
        try {
            $srv = new TestServer([], [], null, realpath(__DIR__ . '/../../scripts/lan-router.php'));
            foreach ([
                '/data/pmf_sec_probe.json',
                '//data%2fpmf_sec_probe.json/api.php',
                '//data/pmf_sec_probe.json/api.php',
                '//x/../data/pmf_sec_probe.json',
                '//assets/../data/pmf_sec_probe.json',
                '/assets/..%2fdata%2fpmf_sec_probe.json',
                '/assets/%2e%2e/data/pmf_sec_probe.json',
                '/assets\..\data\pmf_sec_probe.json',
                '/data%2fpmf_sec_probe.json/index.html',
                '/api.php/../data/pmf_sec_probe.json',
                '/index.html/../data/pmf_sec_probe.json',
                '/config.sample.php',
                '//src%2fAuth.php/api.php',
            ] as $target) {
                [$status, $body] = rawGet($srv->url, $target);
                ok(!str_contains($body, 'pmf-sec-probe-7f3a'), "$target served the probe file");
                ok(!str_contains($body, '<?php') && !str_contains($body, 'final class'), "$target served PHP source");
                ok($status === 404 || $status === 400, "$target: HTTP $status");
            }
            [$status, $body] = rawGet($srv->url, '/api.php?a=session');
            eq(200, $status);
            ok(isset(json_decode($body, true)['csrf']), 'api.php still answers');
            if (is_file(realpath(__DIR__ . '/../../server') . '/index.html')) {
                [$status, $body] = rawGet($srv->url, '/');
                eq(200, $status);
                ok(str_contains($body, '<html') || str_contains($body, '<!doctype') || str_contains($body, '<!DOCTYPE'), 'the UI is served');
                foreach (glob(realpath(__DIR__ . '/../../server') . '/assets/*.js') ?: [] as $js) {
                    [$status] = rawGet($srv->url, '/assets/' . basename($js));
                    eq(200, $status, 'an asset is served');
                    break;
                }
            }
        } finally {
            @unlink($probe);
            if ($made) {
                @rmdir($data);
            }
        }
    },
];
