import type { Messages } from './types';

// Text between backticks is shown as code (lib/rich.ts).
export const en: Messages = {
  meta: {
    title: 'phpMyFlow · The modern phpMyAdmin replacement',
    description:
      'Open source web admin for MySQL and MariaDB that installs like phpMyAdmin: one folder of PHP, no page reloads, an SQL editor that catches mistakes and an optional assistant that knows your schema.',
    ogImageAlt: 'phpMyFlow: the modern phpMyAdmin replacement, with its data grid',
  },
  a11y: {
    skip: 'Skip to content',
    mainNav: 'Main',
    mobileNav: 'Main (mobile)',
    menu: 'Menu',
    language: 'Language',
    external: '(opens GitHub)',
  },
  nav: { features: 'Features', screenshots: 'Screenshots', compare: 'Compare', install: 'Install', faq: 'FAQ' },
  hero: {
    eyebrow: 'Open source · MySQL and MariaDB',
    title: 'The modern phpMyAdmin replacement',
    subtitle: 'Upload one folder of PHP, sign in with your MySQL user and work without page reloads.',
    download: 'Download',
    demo: 'Try the demo',
    demoSoon: 'Demo · coming soon',
    github: 'GitHub',
    status: 'Early development (v0.1): try it with test data first.',
    shotAlt:
      'phpMyFlow showing the orders table of the sample database: customer names next to their ids, and the details of order 2 with its related rows.',
  },
  features: {
    eyebrow: 'Features',
    title: 'Everything you do in phpMyAdmin, with less friction',
    intro: 'Built for the daily work: browsing, fixing a row, writing a query, moving a database.',
    items: [
      {
        icon: 'bolt',
        title: 'No page reloads',
        text: 'Browse tables, sort, filter and edit cells instantly. The grid stays fast with thousands of rows.',
      },
      {
        icon: 'spark-check',
        title: 'An SQL editor that catches mistakes',
        text: 'Typos in table or column names are underlined as you type, with a one-click fix: "Did you mean `customers`?"',
      },
      {
        icon: 'assistant',
        title: 'An assistant that knows your schema',
        text: 'Describe what you need and get the query. It explains, fixes and optimizes, and never runs anything by itself.',
      },
      {
        icon: 'link',
        title: 'Names instead of ids',
        text: 'Related columns show "Planta Norte · 1", even without declared foreign keys, and edit with a record picker.',
      },
      {
        icon: 'transfer',
        title: 'Safe export and import',
        text: 'Big databases move in short steps with real progress. If the connection drops, it resumes where it stopped.',
      },
      {
        icon: 'shield',
        title: 'Secure by default',
        text: 'Production connections confirm every write, password columns stay hidden, CSRF on every change and a read-only mode.',
      },
    ],
  },
  gallery: {
    eyebrow: 'Screenshots',
    title: 'See it working',
    intro: 'All screenshots use the sample database that ships with the project. They follow your light or dark mode.',
    items: [
      {
        id: 'grid',
        title: 'Data grid',
        text: 'Related rows by name, edited with a record picker.',
        alt: 'The departamentos table: the plant column reads "Planta Norte · 1", and a picker lists the plants by name.',
      },
      {
        id: 'sql',
        title: 'SQL editor',
        text: 'A misspelled table is underlined with a fix before you run anything.',
        alt: 'The SQL editor underlines "custmers" and suggests "customers".',
      },
      {
        id: 'structure',
        title: 'Structure editor',
        text: 'Change columns and indexes, then review the single ALTER that will run.',
        alt: 'The structure of the products table with column types, keys and defaults.',
      },
      {
        id: 'relations',
        title: 'Relations',
        text: 'Declared and inferred relations of each table, as a diagram with row counts.',
        alt: 'Relations of the orders table: it points to customers; order_items (declared) and order_notes (inferred) point to it.',
      },
      {
        id: 'export',
        title: 'Export',
        text: 'SQL, CSV, JSON or Excel, in steps that work on any shared host.',
        alt: 'The export dialog with the format, tables and options.',
      },
      {
        id: 'monitor',
        title: 'Monitor',
        text: 'Live counters, running processes and the heaviest queries.',
        alt: 'The Monitor tab with live charts of queries and connections.',
      },
    ],
  },
  compare: {
    eyebrow: 'Compare',
    title: 'phpMyFlow, phpMyAdmin and Adminer',
    intro:
      'phpMyAdmin and Adminer are mature, proven tools. This is an honest comparison, including what phpMyFlow does not do yet.',
    caption: 'Feature comparison between phpMyFlow, phpMyAdmin and Adminer',
    feature: 'Feature',
    marks: { yes: 'Yes', partial: 'Partly', no: 'No' },
    rows: [
      {
        label: 'Single-page app (no reloads)',
        cells: [{ mark: 'yes' }, { mark: 'partial', note: 'Some actions' }, { mark: 'no' }],
      },
      {
        label: 'Unknown table and column names marked as you type',
        cells: [{ mark: 'yes', note: 'With "did you mean"' }, { mark: 'partial', note: 'Syntax linter' }, { mark: 'no' }],
      },
      {
        label: 'Assistant that writes SQL from your schema',
        cells: [{ mark: 'yes', note: 'Optional' }, { mark: 'no' }, { mark: 'partial', note: 'Plugin' }],
      },
      {
        label: 'Names instead of ids in related columns',
        cells: [
          { mark: 'yes', note: 'Also inferred relations' },
          { mark: 'partial', note: 'Needs configuration storage' },
          { mark: 'no' },
        ],
      },
      {
        label: 'Export and import that resume after a cut',
        cells: [{ mark: 'yes' }, { mark: 'partial', note: 'Import only' }, { mark: 'no' }],
      },
      {
        label: 'Production warnings and hidden password columns',
        cells: [{ mark: 'yes' }, { mark: 'no' }, { mark: 'no' }],
      },
      { label: 'Server monitor', cells: [{ mark: 'yes' }, { mark: 'yes' }, { mark: 'no' }] },
      {
        label: 'User and privilege management',
        cells: [{ mark: 'no', note: 'Shows your grants' }, { mark: 'yes' }, { mark: 'yes' }],
      },
      {
        label: 'Two-factor login',
        cells: [{ mark: 'no', note: 'Planned' }, { mark: 'yes' }, { mark: 'partial', note: 'Plugin' }],
      },
      {
        label: 'Database engines',
        cells: [{ text: 'MySQL, MariaDB' }, { text: 'MySQL, MariaDB' }, { text: 'MySQL, MariaDB, PostgreSQL, SQLite and more' }],
      },
      {
        label: 'Installation',
        cells: [{ text: 'Upload a folder' }, { text: 'Upload a folder' }, { text: 'Upload one PHP file' }],
      },
      { label: 'Interface languages', cells: [{ text: '4' }, { text: '70+' }, { text: '40+' }] },
      { label: 'Maturity', cells: [{ text: 'New (v0.1)' }, { text: 'Since 1998' }, { text: 'Since 2007' }] },
    ],
    footnote:
      'Compared with phpMyAdmin 5.2 and Adminer 5 without extra plugins unless noted. Something wrong? Open an issue on GitHub.',
  },
  install: {
    eyebrow: 'Install',
    title: 'Running in five minutes',
    intro: 'Requirements: PHP 8.1 or newer with `pdo_mysql` and `openssl`. No Composer, no Node on the server, no URL rewriting.',
    tablist: 'Ways to install',
    tabs: [
      {
        id: 'hosting',
        label: 'PHP hosting',
        intro: 'The same way you install phpMyAdmin: upload a folder.',
        steps: [
          { text: 'Download `phpmyflow-x.y.z.zip` from the latest release and unzip it.' },
          { text: 'Upload the folder to your site, for example `public_html/phpmyflow/`.' },
          {
            text: 'Copy `config.sample.php` to `config.php` and list your database servers.',
            code: 'cp config.sample.php config.php',
            codeLabel: 'Command',
          },
          { text: 'Open `https://your-site/phpmyflow/` and sign in with a MySQL user.' },
        ],
        note: 'Restrict access to the folder if you can (IP allow-list, VPN or HTTP authentication) and always serve it over HTTPS.',
      },
      {
        id: 'docker',
        label: 'Docker',
        intro: 'Starts MariaDB with a sample `shop` database next to phpMyFlow.',
        steps: [
          {
            text: 'Clone the repository and start it.',
            code: 'git clone https://github.com/spiderjad/phpmyflow.git\ncd phpmyflow\ndocker compose up --build',
            codeLabel: 'Commands',
          },
          { text: 'Open `http://localhost:8080` and sign in with user `root`, password `root`.' },
        ],
      },
      {
        id: 'lan',
        label: 'Local network',
        intro: 'Serve it to your team from your own computer with PHP’s built-in server.',
        steps: [
          {
            text: 'Clone the repository.',
            code: 'git clone https://github.com/spiderjad/phpmyflow.git\ncd phpmyflow',
            codeLabel: 'Commands',
          },
          {
            text: 'Windows (PowerShell):',
            code: '.\\scripts\\serve-lan.ps1',
            codeLabel: 'Windows (PowerShell)',
          },
          { text: 'macOS or Linux:', code: './scripts/serve-lan.sh', codeLabel: 'macOS or Linux' },
          {
            text: 'The script checks PHP, builds the interface the first time (needs Node.js once) and prints the address for the other computers.',
          },
        ],
        note: 'PHP’s built-in server has no HTTPS: use it only on networks you trust.',
      },
    ],
    copy: 'Copy',
    copied: 'Copied',
  },
  ai: {
    eyebrow: 'AI and privacy',
    title: 'The assistant sees your schema, never your rows',
    intro: 'The assistant is optional and off by default. When you turn it on, this is exactly what happens.',
    points: [
      {
        title: 'Only the structure is sent',
        text: 'Table and column names, types, keys and execution plans (`EXPLAIN`). Row data never leaves your server.',
      },
      {
        title: 'The key stays on the server',
        text: 'The API key lives in `config.php`. The browser never receives it.',
      },
      {
        title: 'It never runs SQL',
        text: 'The query lands in the editor. You read it and decide whether to run it.',
      },
      {
        title: 'Fully local with Ollama',
        text: 'Works with Anthropic, OpenAI-compatible APIs, OpenRouter or a local model through Ollama, so nothing leaves your network.',
      },
    ],
  },
  security: {
    eyebrow: 'Security',
    title: 'Direct access to databases deserves care',
    intro: 'phpMyFlow is built so the safe thing is the default.',
    points: [
      'Every change is a POST request with a CSRF token.',
      'One statement per request; table and column names are checked against the server before use, values always go through prepared statements.',
      'Confirmation before `DROP`, `TRUNCATE`, or `UPDATE` and `DELETE` without `WHERE`.',
      'Login rate limiting, an allow-list of servers and an optional read-only mode.',
      'Connections marked as production confirm every write; password columns stay hidden until you reveal them.',
    ],
    reportTitle: 'Found a vulnerability?',
    report:
      'Please don’t open a public issue. Report it privately through GitHub or by email; you’ll get an answer within 72 hours.',
    policy: 'Read the security policy',
    email: 'Email',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Frequently asked questions',
    items: [
      {
        q: 'Is it free?',
        a: 'Yes. phpMyFlow is open source and free to use. The exact license will be chosen before the first stable release.',
      },
      {
        q: 'Will it work on my hosting?',
        a: 'If phpMyAdmin runs there, phpMyFlow does too: it only needs PHP 8.1 or newer with `pdo_mysql` and `openssl`. No Composer, no Node and no URL rewriting on the server.',
      },
      {
        q: 'Does it support PostgreSQL?',
        a: 'Not yet. Today it works with MySQL and MariaDB. A PostgreSQL driver is on the roadmap.',
      },
      {
        q: 'What are the requirements?',
        a: 'A web server with PHP 8.1+ (`pdo_mysql` and `openssl`), a MySQL or MariaDB server and a recent browser. Node.js is only needed to build from source.',
      },
      {
        q: 'Does my data go to the AI?',
        a: 'No. The assistant is off by default. When it is on, it sends the schema and execution plans, never rows, and with Ollama nothing leaves your machine.',
      },
      {
        q: 'Is it ready for production?',
        a: 'Not yet. phpMyFlow is in early development (v0.1). Try it with test data or a read-only user first, and follow the releases on GitHub.',
      },
    ],
  },
  footer: {
    tagline: 'The modern phpMyAdmin replacement for MySQL and MariaDB.',
    product: 'Product',
    project: 'Project',
    contact: 'Contact',
    releases: 'Releases',
    security: 'Security policy',
    madeBy: 'Made by',
    license: 'License',
    licenseTbd: 'License: TBD',
  },
  notFound: {
    title: 'Page not found',
    text: 'This page doesn’t exist or has moved.',
    back: 'Back to the home page',
  },
};
