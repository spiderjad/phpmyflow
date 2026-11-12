# Public demo: set up on Hostinger

The demo at <https://phpmyflow.spiderjad.com/demo/> is a normal phpMyFlow
release in read-only mode, signed in to a database that only holds the sample
data (`docker/demo.sql`). **Never real data.**

On shared hosting a database user always gets every privilege on its
database, and the demo password is public. So the protection comes from
phpMyFlow and the hosting:

| Layer | What it does |
|---|---|
| `'read_only' => true` | The app refuses every write, KILL and statistics reset. |
| Same flag, in MySQL | Each connection opens a read-only session (`SET SESSION TRANSACTION READ ONLY`): a write that got past the app would still fail. |
| `'query_timeout_seconds' => 10` | No statement runs longer than 10 s (MariaDB `max_statement_time`, MySQL `MAX_EXECUTION_TIME`). |
| `'allow_custom_host' => false` | Visitors can only reach the demo database, never another host. |
| Remote MySQL off | The public credentials only work from the server itself. |
| Daily reset (cron) | `scripts/demo-reset.php` reloads the sample data every night. |

## 1. Database

1. hPanel → **Databases → MySQL Databases**: create a database and a user, for
   example `u123456789_demo` / `u123456789_demo`, with a **new password used
   nowhere else** (it will be shown to everyone).
2. hPanel → **Databases → Remote MySQL**: make sure there is no entry. The
   credentials must only work from the server.
3. hPanel → **Databases → phpMyAdmin** for that database → **Import** →
   `docker/demo.sql` from the repository. You should see 10 tables (customers,
   orders, products, plantas, departamentos, catalogo…).

## 2. PHP version

hPanel → **Advanced → PHP Configuration**: PHP **8.3** or newer for the website
(8.1 and 8.2 work but no longer get security fixes, or will stop at the end
of 2026). Extensions `pdo_mysql` and `openssl` are on by default.

## 3. phpMyFlow in /demo/

1. Download `phpmyflow-<version>.zip` from
   <https://github.com/spiderjad/phpmyflow/releases/latest>.
2. File Manager → `public_html/phpmyflow/` (the website's folder) → upload the
   zip → **Extract** here. It creates `phpmyflow-<version>/`: **rename it to
   `demo`**. Delete the zip.
3. In `demo/`, create `config.php`:

```php
<?php
// Public read-only demo (docs/demo-setup.md). Only the sample data.
return [
    'servers' => [
        ['label' => 'Demo', 'host' => 'localhost', 'port' => 3306],
    ],
    'allow_custom_host' => false,
    'read_only' => true,
    'query_timeout_seconds' => 10,
    // Filled in on the sign-in screen (only works with read_only).
    'demo_login' => ['user' => 'u123456789_demo', 'password' => 'THE-DEMO-PASSWORD'],
    'ai' => ['enabled' => false],
];
```

4. Open <https://phpmyflow.spiderjad.com/demo/>: the sign-in screen says
   "Demo: read-only access…" with the user and password filled in. Sign in,
   open `departamentos` (plant names instead of ids), and check that editing a
   cell is refused.

`config.php` is never served (the release's `.htaccess` denies it).

### Updating the demo to a new release

Upload the new zip, extract it, copy `demo/config.php` into the new folder,
then swap the folders (`demo` → `demo-old`, new → `demo`) and delete
`demo-old` once it works.

## 4. Nightly reset

1. File Manager → go **above** `public_html` (your home folder, e.g.
   `/home/u123456789/`) → create a folder `demo-reset`. Nothing in it can be
   reached from the web.
2. Upload `scripts/demo-reset.php` and `docker/demo.sql` there, and create
   `demo-reset.config.php`:

```php
<?php return [
    'host' => 'localhost', 'port' => 3306,
    'user' => 'u123456789_demo', 'password' => 'THE-DEMO-PASSWORD',
    'database' => 'u123456789_demo',
    'sql' => __DIR__ . '/demo.sql',
];
```

3. hPanel → **Advanced → Cron Jobs** → type **PHP** (or Custom) →
   command `/home/u123456789/demo-reset/demo-reset.php` (Custom:
   `/usr/bin/php /home/u123456789/demo-reset/demo-reset.php`) → once a day,
   for example at 04:00.
4. The cron output shows one line per run:
   `… demo reset: 10 objects dropped, 21 statements run in 0.4 s`.

## 5. Turn the button on

In `site/src/config.ts` set `DEMO_ENABLED = true`, rebuild the website
(`scripts/build-site.ps1`) and upload it as in `docs/site-deploy.md`. The hero
button becomes "Try the demo" / "Probar la demo".
