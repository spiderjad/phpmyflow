<?php
declare(strict_types=1);

/*
 * Builds pmf_big: a WordPress-like database of about 50 MB and 142 tables for
 * export/import tests (long texts, zero dates, a table without primary key,
 * 137 small plugin tables, a view).
 *
 *   php tests/php/fixtures/make_big_db.php [host:port:user:pass] [megabytes]
 */
[$host, $port, $user, $pass] = explode(':', $argv[1] ?? (getenv('PMF_TEST_DB') ?: '127.0.0.1:3307:root:root')) + [null, 3306, 'root', ''];
$mb = (int) ($argv[2] ?? 50);

$pdo = new PDO("mysql:host=$host;port=$port;charset=utf8mb4", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('DROP DATABASE IF EXISTS pmf_big');
$pdo->exec('CREATE DATABASE pmf_big CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
$pdo->exec('USE pmf_big');
$pdo->exec("SET SESSION sql_mode = ''");
$pdo->exec("CREATE TABLE wp_options (option_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, option_name VARCHAR(191) NOT NULL UNIQUE, option_value LONGTEXT NOT NULL, autoload VARCHAR(20) NOT NULL DEFAULT 'yes') ENGINE=InnoDB");
$pdo->exec("INSERT INTO wp_options (option_name, option_value) VALUES ('siteurl', 'https://example.com'), ('home', 'https://example.com'), ('blogname', 'Big test')");
$pdo->exec("CREATE TABLE wp_posts (ID BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, post_author BIGINT UNSIGNED NOT NULL DEFAULT 0,
    post_date DATETIME NOT NULL DEFAULT '0000-00-00 00:00:00', post_content LONGTEXT NOT NULL, post_title TEXT NOT NULL,
    post_status VARCHAR(20) NOT NULL DEFAULT 'publish', KEY post_author (post_author)) ENGINE=InnoDB");
$pdo->exec('CREATE TABLE wp_postmeta (meta_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, post_id BIGINT UNSIGNED NOT NULL DEFAULT 0, meta_key VARCHAR(255), meta_value LONGTEXT, KEY post_id (post_id)) ENGINE=InnoDB');
// Plugin tables often have no primary key.
$pdo->exec('CREATE TABLE wp_plugin_log (logged_at DATETIME NULL, message TEXT) ENGINE=InnoDB');
$pdo->exec('CREATE VIEW wp_published AS SELECT ID, post_title FROM wp_posts WHERE post_status = \'publish\'');

$para = str_repeat("Lorem ipsum dolor sit amet, «consectetur» adipiscing elit — ñandú, café, 東京. It's a \"quoted\" line; with \\ backslash.\n", 40);
$rowBytes = strlen($para);
$rows = (int) ceil($mb * 1048576 / $rowBytes);
$ins = $pdo->prepare('INSERT INTO wp_posts (post_author, post_date, post_content, post_title, post_status) VALUES (?, ?, ?, ?, ?)');
$meta = $pdo->prepare('INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)');
$pdo->beginTransaction();
for ($i = 1; $i <= $rows; $i++) {
    $ins->execute([$i % 7, $i % 50 === 0 ? '0000-00-00 00:00:00' : date('Y-m-d H:i:s', 1700000000 + $i * 60), $para . $i, "Post $i", $i % 9 ? 'publish' : 'draft']);
    $meta->execute([$i, '_edit_lock', (string) $i]);
    if ($i % 2000 === 0) {
        $pdo->commit();
        $pdo->beginTransaction();
    }
}
$pdo->commit();
$pdo->exec("INSERT INTO wp_plugin_log VALUES (NOW(), 'a'), (NULL, 'b'), ('2026-01-01 00:00:00', 'c')");
// Plugin tables: 142 tables in total, like the real site this reproduces.
for ($i = 1; $i <= 137; $i++) {
    $t = sprintf('wp_plugin_%03d', $i);
    $pdo->exec("CREATE TABLE `$t` (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, k VARCHAR(64), v TEXT) ENGINE=InnoDB");
    $pdo->exec("INSERT INTO `$t` (k, v) VALUES ('a', 'b'), ('c', 'd')");
}
$size = $pdo->query("SELECT ROUND(SUM(DATA_LENGTH + INDEX_LENGTH) / 1048576, 1) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pmf_big'")->fetchColumn();
echo "pmf_big: $rows posts, ~$size MB\n";
