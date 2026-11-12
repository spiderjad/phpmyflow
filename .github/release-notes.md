Ready for a public read-only demo, plus safer read-only installations.

> Early development: try it with test data or a read-only user first.

## What's new

- **Read-only mode is enforced by MySQL too.** With `'read_only' => true`, every connection opens a read-only session (`SET SESSION TRANSACTION READ ONLY`), and KILL and statistics resets are refused.
- **Statement time limit.** `'query_timeout_seconds'` stops any statement after that many seconds (MariaDB `max_statement_time`, MySQL `MAX_EXECUTION_TIME` for SELECT).
- **Demo sign-in.** `'demo_login' => ['user' => …, 'password' => …]` fills in the sign-in form, only on read-only installations.
- `docker/demo.sql` (the sample data for shared hosting) and `scripts/demo-reset.php` (nightly reset) in the repository; see `docs/demo-setup.md`.

## Install

Requirements: PHP 8.1 or newer with `pdo_mysql` and `openssl` (8.3+ recommended: older versions no longer get security fixes). No Composer, no Node on the server.

1. Download `phpmyflow-0.1.1.zip` below and unzip it into your site, for example `public_html/phpmyflow/`.
2. Copy `config.sample.php` to `config.php` and list your database servers.
3. Open `https://your-site/phpmyflow/` and sign in with a MySQL user.

Updating from 0.1.0: replace the files and keep your `config.php`.

## License

GNU AGPL-3.0. Report security issues privately (see SECURITY.md).
