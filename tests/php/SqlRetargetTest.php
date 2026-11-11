<?php
declare(strict_types=1);

use PhpMyFlow\SqlRetarget;

/*
 * Importing a dump into another database: what the file says about its
 * source (header, USE, CREATE DATABASE, qualified names, WordPress), and the
 * rewrite that puts everything into the chosen database.
 */

const PMA_HEAD = <<<'SQL'
-- phpMyAdmin SQL Dump
-- version 5.2.1
-- Servidor: 127.0.0.1
-- Base de datos: `u000000000_demo`
--

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;

CREATE DATABASE IF NOT EXISTS `u000000000_demo` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `u000000000_demo`;

CREATE TABLE `wp_options` (
  `option_id` bigint(20) UNSIGNED NOT NULL,
  `option_name` varchar(191) NOT NULL DEFAULT '',
  `option_value` longtext NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `wp_options` (`option_id`, `option_name`, `option_value`) VALUES
(1, 'siteurl', 'https://byt.example.com'),
(2, 'home', 'https://byt.example.com');

CREATE TABLE `wp_posts` (`ID` bigint(20) UNSIGNED NOT NULL) ENGINE=InnoDB;
INSERT INTO `u000000000_demo`.`wp_posts` VALUES (1);
SQL;

return [
    'inspect: phpMyAdmin dump (localized header, CREATE DATABASE, USE, qualified names, WordPress)' => static function (): void {
        $r = SqlRetarget::inspect(PMA_HEAD);
        eq('u000000000_demo', $r['database']);
        eq(['u000000000_demo'], $r['uses']);
        eq(['u000000000_demo'], $r['createDbs']);
        eq(['u000000000_demo'], $r['qualified']);
        eq(['u000000000_demo'], $r['sources']);
        eq(['prefix' => 'wp_'], $r['wordpress']);
        ok($r['statements'] >= 7, 'statements read: ' . $r['statements']);
    },

    'inspect: mysqldump header, no USE; a portable phpMyFlow export has nothing to rewrite' => static function (): void {
        $r = SqlRetarget::inspect("-- MySQL dump 10.13  Distrib 8.0.36\n--\n-- Host: localhost    Database: shop_live\n-- ------\n\nCREATE TABLE `orders` (`id` int);\nINSERT INTO `orders` VALUES (1);\n");
        eq('shop_live', $r['database']);
        eq([], $r['uses']);
        eq([], $r['qualified']);
        eq(null, $r['wordpress']);
        $p = SqlRetarget::inspect("-- phpMyFlow 0.1.0-dev SQL export\n-- Server: 11.4\n-- Database: shop\n-- Date: x\n\nSET NAMES utf8mb4;\n\nCREATE TABLE `a` (`id` int);\n");
        eq('shop', $p['database']);
        eq(['shop'], $p['sources']);
        eq([], $p['uses']);
    },

    'inspect: the last statement cut by the 256 KB head is ignored, table.column is not a database' => static function (): void {
        $r = SqlRetarget::inspect("CREATE VIEW `v` AS SELECT `wp_posts`.`ID` FROM `wp_posts`;\nALTER TABLE `x` ADD CONSTRAINT `fk` FOREIGN KEY (`a`) REFERENCES `olddb`.`y` (`id`);\nINSERT INTO `olddb`.`t` VALUES ('cut here");
        eq(['olddb'], $r['qualified']);
    },

    'rewrite: USE / CREATE DATABASE skipped, qualifiers dropped, strings and comments untouched' => static function (): void {
        $rt = new SqlRetarget(['u000000000_demo']);
        eq(null, $rt->rewrite('USE `u000000000_demo`'));
        eq(null, $rt->rewrite('CREATE DATABASE IF NOT EXISTS `u000000000_demo` DEFAULT CHARACTER SET utf8mb4'));
        eq(null, $rt->rewrite('CREATE SCHEMA other_db'));
        eq(null, $rt->rewrite('/*!40000 USE x*/'));
        eq('INSERT INTO `wp_posts` VALUES (1)', $rt->rewrite('INSERT INTO `u000000000_demo`.`wp_posts` VALUES (1)'));
        eq('INSERT INTO wp_posts VALUES (1)', $rt->rewrite('INSERT INTO u000000000_demo . wp_posts VALUES (1)'));
        eq("INSERT INTO `t` VALUES ('`u000000000_demo`.`wp_posts` stays', \"u000000000_demo.x\")", $rt->rewrite("INSERT INTO `U000000000_DEMO`.`t` VALUES ('`u000000000_demo`.`wp_posts` stays', \"u000000000_demo.x\")"));
        eq("SELECT 1 -- u000000000_demo.t\n", $rt->rewrite("SELECT 1 -- u000000000_demo.t\n"));
        eq('ALTER TABLE `a` ADD CONSTRAINT `f` FOREIGN KEY (`x`) REFERENCES `b` (`id`)', $rt->rewrite('ALTER TABLE `u000000000_demo`.`a` ADD CONSTRAINT `f` FOREIGN KEY (`x`) REFERENCES `u000000000_demo`.`b` (`id`)'));
        // Other databases and table.column stay as they are.
        eq('SELECT `t`.`c`, `other`.`t2`.`c` FROM `t`', $rt->rewrite('SELECT `t`.`c`, `other`.`t2`.`c` FROM `u000000000_demo`.`t`'));
        // An escaped quote inside a string does not end it.
        eq("INSERT INTO `t` VALUES ('it\\'s u000000000_demo.t', 'x''y')", $rt->rewrite("INSERT INTO `u000000000_demo`.`t` VALUES ('it\\'s u000000000_demo.t', 'x''y')"));
    },

    'rewrite with no source names only skips USE and CREATE DATABASE' => static function (): void {
        $rt = new SqlRetarget([]);
        eq(null, $rt->rewrite('USE `x`'));
        eq('INSERT INTO `x`.`t` VALUES (1)', $rt->rewrite('INSERT INTO `x`.`t` VALUES (1)'));
    },
];
