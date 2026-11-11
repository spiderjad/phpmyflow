<?php
declare(strict_types=1);

use PhpMyFlow\TableEditor;

$glpi = ['glpi_alerts', 'glpi_configs', 'glpi_entities', 'glpi_tickets'];
$wp = ['wp_options', 'wp_posts', 'wp_postmeta', 'wp_users'];

return [
    'GLPI: glpi_configs with context core' => static function () use ($glpi): void {
        $seen = [];
        eq('glpi', TableEditor::detectManaged($glpi, static function (string $sql) use (&$seen) { $seen[] = $sql; return true; }));
        ok(str_contains($seen[0], "`glpi_configs` WHERE context = 'core'"), 'probes glpi_configs: ' . $seen[0]);
    },
    'WordPress: wp_options with siteurl' => static function () use ($wp): void {
        eq('wordpress', TableEditor::detectManaged($wp, static fn (string $sql) => str_contains($sql, 'siteurl')));
    },
    'probe fails (no SELECT privilege): fall back to the shared prefix' => static function () use ($glpi, $wp): void {
        eq('glpi', TableEditor::detectManaged($glpi, static fn () => null));
        eq('wordpress', TableEditor::detectManaged($wp, static fn () => null));
    },
    'config table not visible: fall back to the shared prefix' => static function (): void {
        eq('glpi', TableEditor::detectManaged(['glpi_alerts', 'glpi_tickets'], static fn () => true));
        eq('wordpress', TableEditor::detectManaged(['wp_posts', 'wp_users'], static fn () => true));
    },
    'not managed: the probe answers no, or mixed prefixes' => static function () use ($glpi): void {
        eq(null, TableEditor::detectManaged($glpi, static fn () => false));
        eq(null, TableEditor::detectManaged(['glpi_alerts', 'customers'], static fn () => null));
        eq(null, TableEditor::detectManaged(['customers', 'orders'], static fn () => true));
        eq(null, TableEditor::detectManaged([], static fn () => true));
    },
];
