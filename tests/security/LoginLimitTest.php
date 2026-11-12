<?php
declare(strict_types=1);

require_once __DIR__ . '/../php/support.php';

/*
 * Sign-in limits on a public demo: the failed-attempt count per IP is never
 * reset by a good sign-in, and with 'demo_login' only the demo user may sign
 * in (any other name is refused before connecting and counts as a failure).
 * Each test runs its own read-only server with a private temp folder, so the
 * counters never leak between tests.
 */

/** @return array{0:TestServer,1:TestClient,2:array}|null */
function demoLimitServer(): ?array
{
    if (!($db = testDb())) {
        echo "       (skipped: no test database)\n";
        return null;
    }
    [$host, $port, $user, $pass] = $db;
    $tmp = sys_get_temp_dir() . '/pmf_sec_' . bin2hex(random_bytes(6));
    mkdir($tmp);
    $srv = new TestServer(['sys_temp_dir' => $tmp, 'session.save_path' => $tmp], [
        'PMF_READ_ONLY' => '1', 'PMF_DEMO_USER' => $user, 'PMF_DEMO_PASSWORD' => $pass,
    ]);
    // After the server's own shutdown function (they run in order): the server stops first.
    register_shutdown_function(static function () use ($tmp): void {
        foreach (glob($tmp . '/*') ?: [] as $f) {
            @unlink($f);
        }
        @rmdir($tmp);
    });
    $c = new TestClient($srv->url);
    $c->csrf = $c->json('GET', 'a=session')['csrf'];
    return [$srv, $c, $db];
}

function signIn(TestClient $c, array $db, string $user, string $pass, string $action = 'login'): ?string
{
    $r = $c->json('POST', "a=$action", ['host' => $db[0], 'port' => $db[1], 'user' => $user, 'password' => $pass]);
    if (!empty($r['ok'])) {
        $c->csrf = $c->json('GET', 'a=session')['csrf'];
        return null;
    }
    return $r['error']['code'] ?? 'no_code';
}

return [
    'a good sign-in does not reset the failed-attempt count' => static function (): void {
        if (!($s = demoLimitServer())) {
            return;
        }
        [, $c, $db] = $s;
        $max = (int) pmf_config()['login_max_attempts'];
        for ($i = 0; $i < $max - 1; $i++) {
            eq('login_failed', signIn($c, $db, $db[2], 'wrong-' . $i));
        }
        eq(null, signIn($c, $db, $db[2], $db[3]), 'the demo sign-in works below the limit');
        $c->json('POST', 'a=logout');
        $c->csrf = $c->json('GET', 'a=session')['csrf'];
        eq('login_failed', signIn($c, $db, $db[2], 'wrong-again'));
        eq('too_many_attempts', signIn($c, $db, $db[2], $db[3]), 'reaching the limit blocks even the demo credentials');
    },

    'with demo sign-in, other users are refused before connecting and counted' => static function (): void {
        if (!($s = demoLimitServer())) {
            return;
        }
        [, $c, $db] = $s;
        eq('demo_only', signIn($c, $db, 'pmf_not_the_demo', 'x'));
        eq('demo_only', signIn($c, $db, 'pmf_not_the_demo', 'x', 'login_test'));
        for ($i = 2; $i < (int) pmf_config()['login_max_attempts']; $i++) {
            eq('demo_only', signIn($c, $db, 'pmf_other_' . $i, 'x'));
        }
        eq('too_many_attempts', signIn($c, $db, $db[2], $db[3]));
    },
];
