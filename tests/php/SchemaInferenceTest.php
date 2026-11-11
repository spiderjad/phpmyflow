<?php
declare(strict_types=1);

use PhpMyFlow\Schema;

/** Minimal `Schema::full()` shape: columns as [name, type, key]. */
function schemaOf(array $spec): array
{
    $out = [];
    foreach ($spec as $table => $cols) {
        $out[$table] = ['type' => 'BASE TABLE', 'comment' => '', 'foreignKeys' => [], 'columns' => array_map(
            static fn ($c) => ['name' => $c[0], 'type' => $c[1], 'key' => $c[2] ?? '', 'nullable' => false, 'comment' => ''],
            $cols
        )];
    }
    return $out;
}

/** GLPI-like schema: the case that produced a wrong FK in a real GLPI. */
function glpiSchema(): array
{
    return schemaOf([
        'glpi_alerts' => [['id', 'int unsigned', 'PRI'], ['itemtype', 'varchar(100)', 'MUL'], ['items_id', 'int unsigned'], ['type', 'int']],
        'glpi_agents' => [['id', 'int unsigned', 'PRI'], ['agenttypes_id', 'int unsigned', 'MUL'], ['entities_id', 'int unsigned'], ['deviceid', 'varchar(255)']],
        'glpi_agenttypes' => [['id', 'int unsigned', 'PRI'], ['name', 'varchar(255)']],
        'glpi_apiclients' => [['id', 'int unsigned', 'PRI'], ['name', 'varchar(255)']],
        // A table whose name matches "items_id": still not a concrete target.
        'glpi_items' => [['id', 'int unsigned', 'PRI']],
        // String key: a *_id that is not an integer is never inferred.
        'glpi_sessions' => [['id', 'varchar(64)', 'PRI']],
        'glpi_logs' => [['id', 'int unsigned', 'PRI'], ['itemtype', 'varchar(100)'], ['items_id', 'int unsigned'], ['itemtype_link', 'varchar(100)'], ['sessions_id', 'varchar(64)']],
        // Two polymorphic pairs side by side (GLPI glpi_items_* link tables).
        'glpi_networkports' => [['id', 'int unsigned', 'PRI'], ['itemtype', 'varchar(100)'], ['items_id', 'int unsigned'], ['mainitemtype', 'varchar(100)'], ['mainitems_id', 'int unsigned']],
        // Rails/Laravel style.
        'glpi_comments' => [['id', 'int unsigned', 'PRI'], ['commentable_type', 'varchar(50)'], ['commentable_id', 'int unsigned']],
    ]);
}

return [
    'GLPI: only agenttypes_id is inferred (no FK for itemtype + items_id, no missing entities)' => static function (): void {
        $rels = array_map(static fn ($r) => "{$r['from']}.{$r['column']} -> {$r['to']}.{$r['toColumn']}", Schema::inferRelations(glpiSchema()));
        eq(['glpi_agents.agenttypes_id -> glpi_agenttypes.id'], $rels);
    },
    'GLPI: itemtype + items_id pairs are polymorphic' => static function (): void {
        $poly = array_map(static fn ($p) => "{$p['table']}: {$p['typeColumn']} + {$p['idColumn']}", Schema::polymorphic(glpiSchema()));
        eq([
            'glpi_alerts: itemtype + items_id',
            'glpi_comments: commentable_type + commentable_id',
            'glpi_logs: itemtype + items_id',
            'glpi_networkports: itemtype + items_id',
            'glpi_networkports: mainitemtype + mainitems_id',
        ], $poly);
    },
    'a *_type column that is not a string does not make a pair polymorphic' => static function (): void {
        $s = schemaOf([
            'orders' => [['id', 'int unsigned', 'PRI'], ['customer_type', 'tinyint'], ['customer_id', 'int unsigned']],
            'customers' => [['id', 'int unsigned', 'PRI']],
        ]);
        eq([], Schema::polymorphic($s));
        eq(['orders.customer_id'], array_map(static fn ($r) => "{$r['from']}.{$r['column']}", Schema::inferRelations($s)));
    },
    'generated columns: not MySQL 8 DEFAULT_GENERATED (CURRENT_TIMESTAMP defaults)' => static function (): void {
        eq(true, Schema::isGenerated('VIRTUAL GENERATED'));
        eq(true, Schema::isGenerated('STORED GENERATED'));
        eq(true, Schema::isGenerated('PERSISTENT GENERATED'));
        eq(false, Schema::isGenerated('DEFAULT_GENERATED'));
        eq(false, Schema::isGenerated('DEFAULT_GENERATED on update CURRENT_TIMESTAMP'));
        eq(false, Schema::isGenerated('auto_increment'));
        eq(false, Schema::isGenerated(null));
    },
    'id_xxx prefix style with Spanish and English plurals (sigim_db)' => static function (): void {
        $s = schemaOf([
            'plantas' => [['id', 'int unsigned', 'PRI'], ['nombre', 'varchar(80)']],
            'departamentos' => [['id', 'int unsigned', 'PRI'], ['nombre', 'varchar(80)'], ['id_planta', 'int unsigned']],
            'catalogo' => [['id', 'int unsigned', 'PRI'], ['name', 'varchar(100)'], ['id_departamento', 'int unsigned'], ['id_categoria', 'int unsigned'], ['id_material', 'int unsigned']],
            'categorias' => [['id', 'int unsigned', 'PRI']],
            'materiales' => [['id', 'int unsigned', 'PRI']],
            'cities' => [['id', 'int unsigned', 'PRI']],
            'branch' => [['id', 'int unsigned', 'PRI'], ['id_city', 'int unsigned']],
        ]);
        $rels = array_map(static fn ($r) => "{$r['from']}.{$r['column']} -> {$r['to']}", Schema::inferRelations($s));
        sort($rels);
        eq(['branch.id_city -> cities', 'catalogo.id_categoria -> categorias', 'catalogo.id_departamento -> departamentos', 'catalogo.id_material -> materiales', 'departamentos.id_planta -> plantas'], $rels);
    },
    'declared FKs win over inference; a bare id is never a relation' => static function (): void {
        $s = schemaOf([
            'plantas' => [['id', 'int unsigned', 'PRI']],
            'departamentos' => [['id', 'int unsigned', 'PRI'], ['id_planta', 'int unsigned']],
        ]);
        $s['departamentos']['foreignKeys'] = [['column' => 'id_planta', 'references' => 'otra.id']];
        eq([], Schema::inferRelations($s));
    },
    'plain conventions still work (sample shop)' => static function (): void {
        $s = schemaOf([
            'products' => [['id', 'int unsigned', 'PRI']],
            'customers' => [['id', 'int unsigned', 'PRI']],
            'orders' => [['id', 'int unsigned', 'PRI']],
            'reviews' => [['id', 'int unsigned', 'PRI'], ['product_id', 'int unsigned'], ['customer_id', 'int unsigned']],
            'order_notes' => [['id', 'int unsigned', 'PRI'], ['orders_id', 'int unsigned'], ['uuid', 'char(36)']],
        ]);
        $rels = array_map(static fn ($r) => "{$r['from']}.{$r['column']} -> {$r['to']}", Schema::inferRelations($s));
        sort($rels);
        eq(['order_notes.orders_id -> orders', 'reviews.customer_id -> customers', 'reviews.product_id -> products'], $rels);
    },
];
