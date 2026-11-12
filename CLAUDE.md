# CLAUDE.md — phpMyFlow

Modern, open source replacement for phpMyAdmin (MySQL/MariaDB). Public project: code, comments, commits and docs in **English**. The UI is translated (en, es, it, fr).

## Product rules (do not break)

1. **Runs wherever phpMyAdmin runs.** The server is plain PHP 8.1+ with only `pdo_mysql` and `openssl` (8.1 is the floor, still common on shared hosting; docs recommend 8.3+ because 8.1 gets no security fixes, and CI tests 8.1 and 8.3). No Composer packages, no `mbstring`, no `curl`, no URL rewriting. Use the helpers in `server/src/bootstrap.php` (`pmf_substr`, `pmf_is_utf8`) instead of `mb_*`.
2. **The release is just the `server/` folder** (the UI is built into it). Node is a dev-only dependency.
3. **The assistant never executes SQL.** It only returns text to the editor. Never send row data to the AI provider, only schema and EXPLAIN output.
4. **The API always answers JSON.** `Guard::install()` (first line of api.php): display_errors off, output buffered, warnings to the PHP log, exceptions and fatals (time limit, memory) → `{error: {code, message, details: {incident}}}`. Nothing is ever echoed before `Http::json()`; long work runs as jobs of short steps (see Export/Import), never one long request.
5. **Security first.** Every write action is POST + CSRF. Identifiers from the client are validated against `information_schema` before being quoted with `Db::ident()`. Values always go through prepared statements. One statement per request (`MYSQL_ATTR_MULTI_STATEMENTS => false`).
6. **Every user-facing string goes through i18n** and exists in all four files in `web/src/locales/`. Keys must match exactly; run the key-parity check below.

## Verified behaviors (must never break)

Each one is a Playwright test in `web/e2e/verified-behaviors.spec.ts`, run first and on its own in CI (`.github/workflows/ci.yml`, e2e job). The data is in `docker/sample.sql`: `plantas`, `departamentos.id_planta`, `catalogo.id_departamento`, **without declared foreign keys** (the relations come from the inference of the `id_xxx` style). If a change breaks one, fix the change, not the test.

1. **Related columns use a record picker in "New row".** In `catalogo`, `id_departamento` is a combobox; typing "mant" shows "3 · Mantenimiento"; picking it and saving stores `id_departamento = 3`.
2. **The grid shows names and edits with the picker.** In `departamentos`, `id_planta` reads "Planta Norte · 1" (Ctrl+C still copies `1`); double click opens the picker and changing the plant is saved.
3. **Yes/No and numeric defaults read right in "New row".** `is_active` (TINYINT(1) DEFAULT 1) shows the switch on and "Default: Yes"; `sort_order` shows "Default: 0" without quotes.
4. **One `lookup_many` per page.** Loading a page of the grid makes exactly one `lookup_many` request (never one per cell or row).

Relations used by 1-4 come from `Schema::inferRelations` (`xxx_id`, `xxx_id_suffix` and `id_xxx`, English and Spanish plurals; declared FKs win; polymorphic pairs excluded) and reach the UI through `app.relations` (`lib/relations.ts` `linksOf`).

## Layout

```
server/                 PHP backend + build output (this folder is the release)
  api.php               single endpoint: api.php?a=<action>
  config.sample.php     defaults (env vars for Docker); users copy to config.php
  src/Auth.php          login with DB credentials, encrypted password, CSRF, rate limit (wrong passwords only), SSL options (session)
  src/ConnectError.php  classifies failed connections: login_failed, server_unreachable, host_not_found, not_mysql, ssl_*, auth_plugin_unsupported
  src/Db.php            PDO connection, ident quoting
  src/Schema.php        information_schema reads (also identifier validation), relation inference by naming convention
  src/Sql.php           statement classification, MySQL error parsing
  src/Ai.php            Anthropic / OpenAI-compatible client, prompt building
  src/TableEditor.php   structure editor: validates structured changes, builds one ALTER, data warnings
  src/Ddl.php           database-level DDL from specs: databases, CREATE TABLE, rename, copy (rows in batches, FKs), truncate/drop + impact, overview
  src/Privileges.php    SHOW GRANTS parser (global, db LIKE patterns, table); roles = unknown (null)
  src/Guard.php         API always JSON: error/exception/shutdown handlers, incident ids, onFatal hooks (save job state)
  src/Jobs.php          per-session private temp folder for jobs (24 h cleanup), step budget ('job_step_seconds'), atomic state files
  src/ExportJob.php     export as a job of short steps: plan in 3 queries, units (header, structure, ~4 MB row batch, views…), state + file size saved so a cut step resumes exactly; sql(.gz) / csv / json / xlsx
  src/ZipWriter.php     stored ZIP written across requests (CRC context saved in state, headers patched), no ZipArchive / zlib
  src/Export.php        viewSql() (no DEFINER, no database qualifier)
  src/Import.php        chunked upload to a private temp dir, run statements a few seconds per request (position saved every 0.3 s and on a fatal), replays the dump's session SETs
  src/Lookup.php        record labels: picker search (`lookup`) and grid names (`lookup_many`, one IN query per related column)
  src/Objects.php       views, procedures/functions, triggers, events: DDL from specs (bodies as written), safe replace (MySQL: temp name, swap, restore), execute, impact, export block
  src/Tools.php         maintenance (OPTIMIZE/ANALYZE/CHECK/REPAIR/CHECKSUM), per-table text search with a time limit, bulk table editor, test data (plan, FK pools, CHECK ranges)
  src/DataGen.php       pure test data generator: seeded, by type and column name, UNIQUE across batches, FK from id pools
  src/SqlRetarget.php   import into another database: inspect() (header db, USE, CREATE DATABASE, db-qualified table names, WordPress prefix) and rewrite() (skip USE / CREATE DATABASE, drop the source qualifier outside strings and comments)
  src/SqlSplitter.php   streaming statement splitter (strings, comments, /*! */, DELIMITER), resumable by offset
  src/Monitor.php       monitor queries, privileges/GRANTs, advisor, deadlock parser
  src/Metrics.php       pure metric math: rates, peaks, hourly aggregation (tests/php)
  src/MetricsStore.php  history storage: SQLite or JSON Lines fallback, retention
  src/Collector.php     one collection run (cron or pseudo-cron), alerts webhook
  collect.php           CLI entry for cron
web/                    Svelte 5 + Vite + TypeScript UI
  src/lib/api.ts        typed API client
  src/lib/state.svelte.ts  global app state (runes)
  src/lib/i18n.svelte.ts   t(), locale detection
  src/lib/sqlRules.ts   rule layer (own lexer): clause order, commas, aliases, = NULL… with quick fixes
  src/lib/sqlLint.ts    linter: rules → syntax → schema names → server EXPLAIN
  src/lib/relations.ts  helpers over declared + inferred relations (JOIN completion, neighbours)
  src/lib/indexes.ts    index helpers: "col(len) DESC" specs, Key badges with position, columns allowed per type, names, duplicate/redundant, 3072-byte limit
  src/components/ui/    Segmented (radiogroup), Select (listbox: no native <select> anywhere, see docs/spider-ui-gaps.md), Menu (the one menu: icons from lib/menuIcons.ts, separators, kbd, submenus on hover / →, danger last, disabled with a reason, first-letter type-ahead)
  src/lib/tableDraft.ts structure editor model: draft vs original diff, descriptions, undo/redo
  src/lib/columnTypes.ts, columnDefaults.ts  type catalog/labels, smart defaults, quick-line parser
  src/lib/sqlText.ts    offset-preserving masking, statement splitting
  src/lib/errors.ts     friendly errors, "did you mean" (Levenshtein)
  src/lib/keyIcons.ts   key icons per column (PK, U, I, FT, SP + position in composite keys, declared FK, inferred relation) for the grid header and Structure; components/KeyIcon.svelte draws them (shape + letter + color + tooltip)
  src/lib/fkLabels.ts   names for FK cells: distinct ids per page, one lookup_many, "Name · id" / broken reference
  src/lib/grid.ts       column kinds, auto widths, compact dates + full tooltip (zone), special cells (NULL / empty / binary), Yes/No, JSON summary, CSV, virtual range (pure, tested)
  src/lib/sensitive.ts  sensitive columns: name patterns (Settings → Data) + bcrypt/argon values; masked in grid and detail until revealed, copy warns
  src/lib/fuzzy.ts      fuzzy table filter, common prefix detection
  src/lib/prefs.svelte.ts  localStorage prefs: density, sidebar width, pinned tables, table sort
  src/lib/theme.ts      themes: data-theme/data-mode/data-density/data-radius on <html>, accent + text size, contrast math, config.php 'ui' defaults; index.html has the pre-paint copy
  src/styles/themes/    one CSS file per theme (spider-ui token names, light + dark); AA checked by lib/theme.test.ts
  src/lib/tabs.svelte.ts   SQL tabs store (list, active id, undo, persistence per user@host)
  src/lib/history.ts    dated SQL history per user@host, grouped by day
  src/lib/dbApi.ts, dbActions.svelte.ts, dbTools.svelte.ts  database tools: API client, dialogs + context menus, privileges (db_caps)
  src/lib/exporter.ts, importer.ts  export / import jobs driven step by step (one request at a time: works on php -S); copier.ts; jobs.svelte.ts  background jobs (stats, log, stall after 20 s, retry one step, resume); tableTemplates.ts
  src/lib/objects.ts    object specs, API client, RecordPicker lookup helpers; src/lib/sqlHighlight.ts shared SQL colors
  src/components/objects/  ObjectView (one editor for every kind), CodeBox (body editor), ExecuteDialog, RecordPicker, ResultTable
  src/lib/toolsApi.ts, toolJobs.ts, search.svelte.ts  phase C tools: API client, jobs (per table / per batch), search store (keeps running across views)
  src/components/tools/ MaintenanceDialog, SearchView (Ctrl+Shift+F), BulkDialog, GenerateDialog
  src/components/db/    DbOverview, menus host (DbDialogs), dialogs (create/edit/drop db, copy, export, import, new table), JobsPanel; JobProgress = export/import panel (real %, table, rows, MB, speed, ETA, log, "looks stopped" after 20 s, resume from a table, download, minimize to a bar)
  src/lib/settings.svelte.ts  Settings store per user@host (appearance, editor, data, general), applied live, reset per section, JSON export/import; config.php 'ui_locked' freezes appearance
  src/lib/idle.svelte.ts  last activity (api.ts marks it); components/IdleWarning.svelte warns a minute before 'session_idle_seconds' (keepalive renews); components/LogoutDialog.svelte = "Sign out?" with the warnings that apply
  src/lib/writeGuard.ts production connections confirm every write in api.ts request() (batch jobs once); src/lib/sqlKind.ts first keyword / read-only SQL
  src/components/settings/  SettingsDialog (gear / Ctrl+,), ThemeCards, AccentPicker, LivePreview, ConnectionsSection
  src/lib/connections.ts  recent logins (max 4, no passwords), color/env per server (config.php wins on env), suggested env by host
  src/components/login/ ServerPicker (grouped listbox in the auth look); Login.svelte uses spider-ui auth-* under data-mode-scope="light"
  src/components/       Login, Sidebar, DataGrid (shared by TableView and SqlView), RowDetail, StructureView, SqlEditor, AiPanel…
  src/locales/*.json    en, es, it, fr
docker/                 Dockerfile, sample.sql (shop database + read-only demo user)
site/                   public website (phpmyflow.spiderjad.com), NOT part of the release: static Astro, en at / and es at /es/ (it/fr prepared in src/i18n/locales.ts)
  src/config.ts         URLs, DEMO_URL + DEMO_ENABLED (false: "Demo · coming soon" disabled), contact, LICENSE (null = "License: TBD"), ANALYTICS hook
  src/i18n/*.ts         all texts (Messages type: a missing key fails astro check); src/components/Home.astro = every section
  src/components/Shot.astro  light/dark <picture> in AVIF/WebP widths (sharp); screenshots from scripts/shots.mjs (sample DB only), og.mjs social images
  public/.htaccess      HTTPS, headers, 404, cache (_astro/.htaccess: immutable); CSP is a <meta> per page so it never reaches /demo/
scripts/build-release.sh  builds dist/phpmyflow-<version>.zip
```

## API actions

| Action | Method | Notes |
|---|---|---|
| `session` | GET | version, `sourceUrl` (AGPL link), csrf token, auth info, servers (+ `color`, `env` from config.php), readOnly, ai enabled, `idleSeconds`, `ui` defaults + `uiLocked` |
| `keepalive` | GET | renews the session ("Stay signed in"), returns `idleSeconds` |
| `login` / `logout` / `login_test` | POST | `ssl` {enabled, verify, ca label} for custom hosts or `ssl_choice` servers; `login_test` connects without a session (version, cipher). Connection errors carry `details` {host, port, mysqlCode, serverMessage, seenFrom?}; only 1045 counts for the rate limit |
| `databases`, `tables`, `schema` | GET | `databases`/`tables` include sizes (`databases` also `timeZone` for date tooltips); `schema` = tables → columns + declared FKs + `inferredKeys`, plus a flat `relations` list (`declared` / `inferred`) and `polymorphic` pairs (itemtype + items_id: never inferred as a FK) |
| `poly_types` | GET | distinct values of a polymorphic type column (first 100k rows, max 50) |
| `ref_counts` | GET | rows in other tables pointing to one record (relations computed server-side, each count capped at 1000) |
| `rows` | GET | page, perPage (≤500), sort, dir, filters (JSON, typed: `10..20`, `>5`, `2026-01-01..2026-03-31`, `NULL`, `=a` exact, `=a|b` any of). Returns `estimate`; `total` only when the page proves it |
| `count` | GET | same filters as `rows`; exact `COUNT(*)` (estimate above 500k rows), requested after the rows |
| `update_cell`, `delete_rows` | POST | by primary key only |
| `insert_row` | POST | only the columns sent (others take their default); generated columns refused |
| `query` | POST | returns `needsConfirm` for destructive statements unless `confirm: true` |
| `check` | POST | EXPLAIN-based validation, never executes |
| `ai` | POST | modes: generate, explain, fix, optimize, optimize_digest (digest id), peak (peak id) |
| `table_info` | GET | columns, indexes, FKs, options, `canAlter` + reason, engines, collations, CREATE |
| `alter_preview`, `alter_apply` | POST | structured changes (never SQL) → one validated ALTER TABLE (drop FK → columns → indexes → add FK, auto index for FKs); preview adds data warnings; FK `fix`: nullify orphans / create with FOREIGN_KEY_CHECKS=0. preview always runs the FK checks: `fk_orphans` (count + samples) / `fk_issue` warnings with `blocking`; a failed apply returns `alter_failed` with `change` (the one that failed), `cause`, `params` (1452: orphan count + samples read afterwards). |
| `ddl_checks` | POST | live FK validation: engines, exact type/collation match (+ fix), target index, SET NULL vs NOT NULL, orphan rows |
| `fk_incoming` | GET | declared + inferred relations pointing to a table, with row counts |
| `db_caps` | GET | SHOW GRANTS per privilege (true/false/null), GRANT text, readOnly, system db, managedBy, createDb |
| `db_overview`, `charsets`, `db_impact`, `tables_impact`, `table_create_code` | GET | overview (tables with sizes/dates, counts), charsets+collations, what a drop/truncate takes (rows, referencing tables) |
| `db_create`, `db_alter`, `db_drop` | POST | `db_drop` needs `confirm` = the name typed; system databases refused |
| `table_create`, `table_rename`, `table_copy`, `table_copy_rows`, `table_copy_fks`, `view_copy` | POST | create from a spec (`dryRun` returns the SQL); copy = structure, then rows in PK batches (cursor), then FKs (`remap` for whole-db copies) |
| `tables_truncate`, `tables_drop` | POST | `confirm` = table name (one) or database name (several); `ignoreFks` when other tables point to them |
| `export_start`, `export_step`, `export_cancel` | POST | export job: start (plan + state), one step of ~`job_step_seconds` (status: table, tables done/total, rows, bytes, progress, log, error, resumeFrom), delete |
| `export_status`, `export_download` | GET | status without working; the finished file once (then deleted; kept 24 h otherwise) |
| `import_upload`, `import_run`, `import_finish` | POST | raw 2 MB chunks (id/offset in the query), run ~`job_step_seconds` from the saved position (table, tables created, log), delete temp files |
| `import_status` | GET | where an import is (resume after a cut) |
| `import_inspect` | POST | raw first 256 KB of a dump → `{database, uses, createDbs, qualified, sources, wordpress}`; `import_run` takes `retarget: [source names]` to import everything into `db` |
| `db_objects`, `object_info`, `object_code`, `object_impact` | GET | sidebar list (+ event_scheduler, trigger order support), one object for the editor, SHOW CREATE, objects whose code mentions it |
| `object_preview`, `object_save`, `object_drop` | POST | spec → the statements that will run (shown in the review); save never leaves the object missing; drop needs `confirm` = name |
| `routine_execute` | POST | CALL / SELECT with prepared args; OUT/INOUT through session variables; every result set |
| `lookup` | GET | RecordPicker: id + label (`label` or detected: nombre, name, descripcion, titulo, codigo, email, first VARCHAR) + `extra` (codigo/code/sku/email, also searched). Never the whole table: exact id, then labels starting with the text, then containing it; max 20, `more` when there are others, 1.5 s limit per query (`timedOut`); before typing, key order above 20k rows |
| `lookup_many` | POST | grid names: `{ db, refs: [{ table, column, ids }] }` (max 15 refs, 500 ids) -> `{ labels: { "table.col": { id: { label } } } }`; missing ids left out |
| `maint_run` | POST | one table: OPTIMIZE / ANALYZE / CHECK [mode] / REPAIR (MyISAM, Aria, ARCHIVE, CSV only) / CHECKSUM |
| `search_plan`, `search_table` | POST | tables to search (db, several, server); one table = one scan with SUM(cond) per column, LIKE escaped, regex with inline case flag, max_statement_time / MAX_EXECUTION_TIME |
| `bulk_plan`, `bulk_apply` | POST | engine, CONVERT TO / DEFAULT charset+collation, comment, move (RENAME) per table; plan has statements and a time estimate |
| `gen_plan`, `gen_rows` | GET / POST | columns with a guessed generator (FKs declared + inferred, UNIQUE, CHECK ranges); `gen_rows` previews 10 or inserts a batch (refused on managed apps) |
| `monitor_caps`, `monitor_live` | GET | flavor, privileges + GRANTs, thresholds; live = SHOW GLOBAL STATUS/VARIABLES (backend enforces ≥ 900 ms between polls) |
| `processlist`, `monitor_explain` | GET | literals hidden by default (`Sql::maskLiterals`) |
| `top_queries`, `digest_detail` | GET | performance_schema digests; slow log status when unavailable |
| `monitor_storage`, `monitor_advisor`, `monitor_deadlock` | GET | sizes, advisor rules, parsed SHOW ENGINE INNODB STATUS |
| `monitor_history`, `monitor_peak` | GET | collector data (minute ≤ 2 days, hourly beyond), peak snapshots |
| `monitor_kill`, `monitor_reset_digests`, `monitor_optimize` | POST | confirm in the UI; KILL never targets the monitor connection |

Errors: `{ error: { code, message, details } }`. `code` is a stable key translated in the UI as `error.<code>`; MySQL errors use `mysql.<errno>` and `mysql.<errno>.hint`.

## Commands

```bash
cd server && php -S 127.0.0.1:8080          # API
cd web && npm run dev                        # UI on :5173 (proxies api.php)
cd web && npm run check                      # svelte-check, must be 0 errors / 0 warnings
cd web && npm test                           # Vitest unit tests (src/**/*.test.ts)
php tests/php/run.php                        # PHP tests (no Composer); DB tests use PMF_TEST_DB=host:port:user:pass (default docker sample on 3307); some start their own php -S (tests/php/support.php)
cd web && npm run e2e                        # Playwright (needs php -S + docker/sample.sql; see web/playwright.config.ts)
cd web && npm run build                      # writes server/index.html + server/assets
for f in server/api.php server/src/*.php; do php -l "$f"; done
scripts/build-release.sh                     # dist zip (no config.php, no data/; releases are built by .github/workflows/release.yml on a v* tag)
cd site && npm run build                      # website → site/dist (scripts/build-site.ps1 → site-dist.zip; docs/site-deploy.md)
scripts/serve-lan.ps1 / serve-lan.sh         # serve on the LAN (checks PHP, builds the UI, firewall hint); php -S … -t server scripts/lan-router.php only serves the UI and api.php
```

Locale key parity:

```bash
node -e "const f=['en','es','it','fr'].map(l=>Object.keys(require('./web/src/locales/'+l+'.json')).sort().join());console.log(f.every(x=>x===f[0])?'OK':'MISMATCH')"
```

## UI style

Panel look from the spider-ui system (Vercel-like, monochrome). Themes (Monochrome = spider-ui, Graphite, Slate, Spider, Forest, High contrast) only redefine `--sp-*` tokens in `web/src/styles/themes/`; a new token must be added to every theme and pass `lib/theme.test.ts`. Token names in `web/src/styles/app.css` match spider-ui (`--bg`, `--border`, `--text-primary`…) so the shared package can replace them later. Rules:

- Use the existing `.v-input`, `.v-btn-*`, `.v-badge`, `.grid` classes before writing new CSS.
- Colors only through variables; both light and dark must work.
- Color means something: danger = errors, warning = risky, success = done, violet (`--ai`) = assistant only.
- Accessible: visible `:focus-visible`, `aria-invalid` on bad inputs, native `<dialog>` for modals, AA contrast, check 375 px width, respect `prefers-reduced-motion`.
- Spanish UI copy uses neutral "tú", not regional forms.

## Roadmap (next tasks, in order)

1. ~~Insert row form~~ (done: "Add row" drawer in the data view).
2. ~~Export and import~~ (done, DB tools phase A: SQL/CSV/JSON/XLSX export in parts, SQL import in chunks). Still open: CSV import.
3. ~~Alter table UI~~ (done: Structure tab editor with review drawer) and ~~new table~~ (done: from scratch or templates).
4. Command palette (Ctrl+K): jump to table, run action, switch database.
5. ~~Virtualized grid and keyboard navigation~~ (done: DataGrid virtualizes from 500 rows, fixed row height, no extra dependency).
6. ~~Editor tabs~~ (done: `lib/tabs.svelte.ts` + `SqlTabs.svelte`, one EditorView with an EditorState per tab, saved per user@host) and ~~dated history~~ (done: `lib/history.ts`). Still open: named saved queries.
7. Two-factor login (TOTP) as an option.
8. ~~GitHub Actions~~ (done: `ci.yml` = PHP 8.1 + 8.3 tests, web check/build/parity, e2e on MariaDB, site build; `release.yml` = push a `v*` tag matching PMF_VERSION → clean build, zip checked (no config.php / data/), GitHub release with `.github/release-notes.md`, 0.x as pre-release).
9. PostgreSQL driver behind an interface in `server/src/Drivers/`.
10. ~~DB tools phases A, B, C~~ (done: database menu/overview/export/import; views, routines, triggers, events; maintenance, server text search, bulk editor, test data).

License: AGPL-3.0 (LICENSE). The sign-in screen links to `source_url` (config) so every user can get the source. Still to do before announcing: the public read-only demo with the `demo` user from `docker/sample.sql`.
