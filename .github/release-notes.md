First public preview of phpMyFlow, a modern replacement for phpMyAdmin for MySQL and MariaDB.

> Early development: try it with test data or a read-only user first.

## Install

Requirements: PHP 8.1 or newer with `pdo_mysql` and `openssl`. No Composer, no Node on the server.
Use PHP 8.3 or newer when you can: 8.1 no longer gets security fixes and 8.2 stops getting them at the end of 2026.

1. Download `phpmyflow-0.1.0.zip` below and unzip it into your site, for example `public_html/phpmyflow/`.
2. Copy `config.sample.php` to `config.php` and list your database servers.
3. Open `https://your-site/phpmyflow/` and sign in with a MySQL user.

Restrict access to the folder if you can (IP allow-list, VPN or HTTP authentication) and serve it over HTTPS only.

## What's in it

- Single-page app: browse, sort, filter and edit tables without reloads; virtualized grid with keyboard navigation.
- SQL editor with tabs and dated history; unknown tables and columns underlined as you type, with "did you mean" fixes.
- Related columns show names instead of ids ("Planta Norte · 1"), also for relations inferred from column names, and edit with a record picker.
- Structure editor (columns, indexes, foreign keys, CHECK constraints) that reviews one ALTER before applying it; new tables from templates.
- Export (SQL, CSV, JSON, Excel) and SQL import in short, resumable steps that work on shared hosting.
- Views, procedures, functions, triggers and events; maintenance, server-wide text search, bulk table changes and test data.
- Server monitor: live counters, processes, heavy queries, storage, advisor and history.
- Optional assistant (Anthropic, OpenAI-compatible APIs or a local model through Ollama): it sees the schema, never row data, and never runs SQL by itself.
- Safe by default: CSRF on every change, one statement per request, confirmations for destructive statements, production connections, hidden password columns, read-only mode.
- English, Spanish, Italian and French; light and dark themes.

## License

GNU AGPL-3.0. Report security issues privately (see SECURITY.md).
