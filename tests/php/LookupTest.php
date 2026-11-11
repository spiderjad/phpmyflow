<?php
declare(strict_types=1);

use PhpMyFlow\ApiError;
use PhpMyFlow\Db;
use PhpMyFlow\Lookup;

/* lookup / lookup_many against a real server (PMF_TEST_DB, default docker sample on 3307). */

function lookupPdo(): ?PDO
{
    [$host, $port, $user, $pass] = explode(':', getenv('PMF_TEST_DB') ?: '127.0.0.1:3307:root:root') + [null, 3306, 'root', ''];
    try {
        $pdo = Db::connect($host, (int) $port, $user, $pass);
    } catch (PDOException) {
        return null;
    }
    $pdo->exec('DROP DATABASE IF EXISTS pmf_t_lookup');
    $pdo->exec('CREATE DATABASE pmf_t_lookup');
    $pdo->exec('CREATE TABLE pmf_t_lookup.plantas (id INT UNSIGNED PRIMARY KEY, nombre VARCHAR(80) NOT NULL)');
    $pdo->exec('CREATE TABLE pmf_t_lookup.cosas (codigo VARCHAR(10) PRIMARY KEY, peso INT NULL, detalle VARCHAR(40) NULL)');
    $pdo->exec("INSERT INTO pmf_t_lookup.plantas VALUES (1,'Planta Norte'),(2,'Planta Sur'),(3,'Norte 2')");
    $pdo->exec("INSERT INTO pmf_t_lookup.cosas VALUES ('A1', 3, 'tuerca')");
    return $pdo;
}

function throwsLookup(string $code, callable $fn): void
{
    try {
        $fn();
    } catch (ApiError $e) {
        eq($code, $e->errorCode);
        return;
    }
    throw new RuntimeException("expected ApiError $code");
}

return [
    'lookup_many: several columns in one call, missing ids left out, labels detected' => static function (): void {
        if (!($pdo = lookupPdo())) {
            echo "       (skipped: no test database)\n";
            return;
        }
        $l = new Lookup($pdo, 'pmf_t_lookup');
        eq([
            'plantas.id' => ['1' => ['label' => 'Planta Norte'], '3' => ['label' => 'Norte 2']],
            'cosas.codigo' => ['A1' => ['label' => 'tuerca']], // no nombre/name...: first VARCHAR that isn't the key
        ], $l->many([
            ['table' => 'plantas', 'column' => 'id', 'ids' => [1, '3', 99, 1, null, '']],
            ['table' => 'cosas', 'column' => 'codigo', 'ids' => ['A1']],
        ]));
        $pdo->exec('DROP DATABASE pmf_t_lookup');
    },
    'lookup_many: validation and limits' => static function (): void {
        if (!($pdo = lookupPdo())) {
            echo "       (skipped: no test database)\n";
            return;
        }
        $l = new Lookup($pdo, 'pmf_t_lookup');
        throwsLookup('unknown_table', static fn () => $l->many([['table' => 'nope', 'column' => 'id', 'ids' => [1]]]));
        throwsLookup('unknown_column', static fn () => $l->many([['table' => 'plantas', 'column' => 'id`; DROP TABLE plantas; --', 'ids' => [1]]]));
        throwsLookup('too_many_ids', static fn () => $l->many([['table' => 'plantas', 'column' => 'id', 'ids' => range(1, 501)]]));
        throwsLookup('bad_refs', static fn () => $l->many(array_fill(0, 16, ['table' => 'plantas', 'column' => 'id', 'ids' => [1]])));
        eq(['plantas.id' => []], $l->many([['table' => 'plantas', 'column' => 'id', 'ids' => []]]));
        $pdo->exec('DROP DATABASE pmf_t_lookup');
    },
    'lookup: search by label or id, exact id first' => static function (): void {
        if (!($pdo = lookupPdo())) {
            echo "       (skipped: no test database)\n";
            return;
        }
        $l = new Lookup($pdo, 'pmf_t_lookup');
        $r = $l->search('plantas', 'norte', null, null);
        eq(['id', 'nombre'], [$r['key'], $r['label']]);
        eq(['Norte 2', 'Planta Norte'], array_column($r['rows'], 'label'));
        eq(3, (int) $l->search('plantas', '3', null, null)['rows'][0]['id']);
        eq(false, $r['more']);
        $pdo->exec('DROP DATABASE pmf_t_lookup');
    },

    'lookup: 1000+ rows: 20 at most, prefix before contains, "more", code column searched too' => static function (): void {
        if (!($pdo = lookupPdo())) {
            echo "       (skipped: no test database)\n";
            return;
        }
        $pdo->exec('CREATE TABLE pmf_t_lookup.deptos (id INT UNSIGNED PRIMARY KEY, nombre VARCHAR(80) NOT NULL, codigo VARCHAR(20) NULL, KEY (nombre))');
        $values = [];
        for ($i = 1; $i <= 1500; $i++) {
            $values[] = "($i, 'Sector $i', 'S-$i')";
        }
        $values[] = "(2001, 'Mantenimiento', 'MNT-01')";
        $values[] = "(2002, 'Jefe de mantenimiento', 'JM-01')";
        $pdo->exec('INSERT INTO pmf_t_lookup.deptos VALUES ' . implode(',', $values));
        $l = new Lookup($pdo, 'pmf_t_lookup');

        $r = $l->search('deptos', '', null, null);
        eq(20, count($r['rows']));
        eq(true, $r['more']);
        eq('codigo', $r['extra']);

        $r = $l->search('deptos', 'sector 1', null, null);
        eq(20, count($r['rows']));
        eq(true, $r['more']);

        // "Mantenimiento" (starts with) before "Jefe de mantenimiento" (contains), not alphabetical.
        $r = $l->search('deptos', 'mant', null, null);
        eq(['Mantenimiento', 'Jefe de mantenimiento'], array_column($r['rows'], 'label'));
        eq(false, $r['more']);
        eq(false, $r['timedOut']);

        // By code.
        $r = $l->search('deptos', 'MNT', null, null);
        eq(['2001'], array_map('strval', array_column($r['rows'], 'id')));
        eq('MNT-01', $r['rows'][0]['extra']);

        // Exact id first, then labels containing the number.
        $r = $l->search('deptos', '150', null, null);
        eq('150', (string) $r['rows'][0]['id']);
        eq(true, count($r['rows']) > 1);

        // LIKE wildcards are literal.
        eq([], $l->search('deptos', '%', null, null)['rows']);
        $pdo->exec('DROP DATABASE pmf_t_lookup');
    },
];
