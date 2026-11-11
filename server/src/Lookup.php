<?php
declare(strict_types=1);

namespace PhpMyFlow;

use PDO;

/**
 * Labels for related records: the RecordPicker search (`lookup`) and the
 * grid's names for foreign key cells (`lookup_many`, one query per column).
 */
final class Lookup
{
    public const MAX_REFS = 15;
    public const MAX_IDS = 500;

    public function __construct(private PDO $pdo, private string $db)
    {
    }

    /** @return list<array{name:string, dataType:string}> */
    private function columns(string $table): array
    {
        $st = $this->pdo->prepare('SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION');
        $st->execute([$this->db, $table]);
        $cols = $st->fetchAll(PDO::FETCH_ASSOC);
        if (!$cols) {
            throw new ApiError('unknown_table', "Unknown table: $table", 404, ['name' => $table]);
        }
        return $cols;
    }

    /**
     * Label column: the one asked for, else nombre/name/descripcion/titulo/
     * codigo/email..., else the first VARCHAR/CHAR, else the key.
     */
    public static function labelColumn(array $cols, string $key, ?string $wanted): string
    {
        $names = array_column($cols, 'name');
        if ($wanted !== null && in_array($wanted, $names, true)) {
            return $wanted;
        }
        foreach (['nombre', 'name', 'descripcion', 'description', 'titulo', 'title', 'label', 'codigo', 'code', 'email', 'username', 'completename', 'realname'] as $cand) {
            foreach ($names as $n) {
                if (strcasecmp($n, $cand) === 0 && $n !== $key) {
                    return $n;
                }
            }
        }
        foreach ($cols as $c) {
            if (in_array(strtolower((string) $c['dataType']), ['varchar', 'char'], true) && $c['name'] !== $key) {
                return $c['name'];
            }
        }
        return $key;
    }

    /** Key column: the one given (validated), else the single-column primary key. */
    private function keyColumn(string $table, array $cols, ?string $wanted): string
    {
        $names = array_column($cols, 'name');
        if ($wanted !== null && in_array($wanted, $names, true)) {
            return $wanted;
        }
        $st = $this->pdo->prepare("SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'");
        $st->execute([$this->db, $table]);
        $pk = $st->fetchAll(PDO::FETCH_COLUMN);
        if (count($pk) !== 1) {
            throw new ApiError('no_single_key', 'The table needs a single-column primary key', 400, ['name' => $table]);
        }
        return (string) $pk[0];
    }

    private function t(string $table): string
    {
        return Db::ident($this->db) . '.' . Db::ident($table);
    }

    /** Time limit for one picker query: the picker runs on every keystroke. */
    public const SEARCH_MS = 1500;
    /** Above this many rows (estimate), the list before typing is in key order (no sort of the whole table). */
    public const SORT_ROWS = 20000;

    /**
     * Second searchable column (code, email...) next to the label, if any:
     * "A-102" finds "3 · Mantenimiento" when the table has codigo = 'A-102'.
     */
    public static function extraColumn(array $cols, string $key, string $label): ?string
    {
        foreach (['codigo', 'code', 'sku', 'referencia', 'reference', 'ref', 'email', 'username', 'nombre', 'name'] as $cand) {
            foreach ($cols as $c) {
                $n = (string) $c['name'];
                if (strcasecmp($n, $cand) === 0 && $n !== $key && $n !== $label
                    && in_array(strtolower((string) $c['dataType']), ['varchar', 'char'], true)) {
                    return $n;
                }
            }
        }
        return null;
    }

    private function mariadb(): bool
    {
        return stripos((string) $this->pdo->getAttribute(PDO::ATTR_SERVER_VERSION), 'mariadb') !== false;
    }

    /**
     * Runs a SELECT with a time limit. Returns null when it ran out of time.
     * @return list<array<string, mixed>>|null
     */
    private function limited(string $select, array $params): ?array
    {
        $sql = $this->mariadb()
            ? 'SET STATEMENT max_statement_time=' . round(self::SEARCH_MS / 1000, 3) . ' FOR ' . $select
            : 'SELECT /*+ MAX_EXECUTION_TIME(' . self::SEARCH_MS . ') */ ' . substr($select, 7);
        try {
            $st = $this->pdo->prepare($sql);
            $st->execute($params);
            return $st->fetchAll(PDO::FETCH_ASSOC);
        } catch (\PDOException $e) {
            if (in_array((int) ($e->errorInfo[1] ?? 0), [3024, 1969, 1028], true)) {
                return null;
            }
            throw $e;
        }
    }

    private function estimate(string $table): int
    {
        $st = $this->pdo->prepare('SELECT TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?');
        $st->execute([$this->db, $table]);
        return (int) $st->fetchColumn();
    }

    /**
     * RecordPicker search, at most 20 rows, never the whole table:
     * 1. the exact key when the text is a number;
     * 2. labels (or the extra column) that START with the text (can use an index);
     * 3. only if there is room left, labels that CONTAIN it.
     * Each query has a time limit; `more` says there are rows beyond the 20,
     * `timedOut` that a step was cut (the rows found so far are returned).
     *
     * @return array{key:string, label:string, extra:?string, rows:list<array{id:mixed, label:mixed, extra?:mixed}>, more:bool, timedOut:bool}
     */
    public function search(string $table, string $q, ?string $column, ?string $label, int $limit = 20): array
    {
        $cols = $this->columns($table);
        $key = $this->keyColumn($table, $cols, $column);
        $lab = self::labelColumn($cols, $key, $label);
        $extra = $lab === $key ? null : self::extraColumn($cols, $key, $lab);
        $k = Db::ident($key);
        $l = Db::ident($lab);
        $x = $extra !== null ? Db::ident($extra) : null;
        $limit = max(1, min(20, $limit));
        $select = "SELECT $k AS id, $l AS label" . ($x ? ", $x AS extra" : '') . ' FROM ' . $this->t($table);
        $q = trim($q);
        $rows = [];
        $seen = [];
        $timedOut = false;
        $add = static function (array $found) use (&$rows, &$seen): void {
            foreach ($found as $r) {
                $id = (string) $r['id'];
                if (!isset($seen[$id])) {
                    $seen[$id] = true;
                    $rows[] = $r;
                }
            }
        };

        if ($q === '') {
            // Alphabetical on small tables; key order (index) on big ones.
            $order = $this->estimate($table) > self::SORT_ROWS ? $k : $l;
            $found = $this->limited("$select ORDER BY $order LIMIT " . ($limit + 1), []);
            $timedOut = $found === null;
            $add($found ?? []);
        } else {
            if (is_numeric($q)) {
                $st = $this->pdo->prepare("$select WHERE $k = ? LIMIT 1");
                $st->execute([$q]);
                $add($st->fetchAll(PDO::FETCH_ASSOC));
            }
            $esc = addcslashes($q, '%_\\');
            $prefix = "$l LIKE ?" . ($x ? " OR $x LIKE ?" : '');
            $pp = $x ? [$esc . '%', $esc . '%'] : [$esc . '%'];
            $found = $this->limited("$select WHERE ($prefix) ORDER BY $l LIMIT " . ($limit + 1), $pp);
            $timedOut = $found === null;
            $add($found ?? []);
            if (!$timedOut && count($rows) <= $limit) {
                $contains = "$l LIKE ?" . ($x ? " OR $x LIKE ?" : '');
                $cp = $x ? ['%' . $esc . '%', '%' . $esc . '%'] : ['%' . $esc . '%'];
                $found = $this->limited("$select WHERE ($contains) AND NOT ($prefix) ORDER BY $l LIMIT " . ($limit + 1 - count($rows)), [...$cp, ...$pp]);
                $timedOut = $found === null;
                $add($found ?? []);
            }
        }
        $more = count($rows) > $limit;
        return ['key' => $key, 'label' => $lab, 'extra' => $extra, 'rows' => array_slice($rows, 0, $limit), 'more' => $more, 'timedOut' => $timedOut];
    }

    /**
     * @param list<array{table:string, column:string, ids:list<mixed>, label?:string}> $refs
     * @return array<string, array<string, array{label:?string}>> "table.column" => id => label
     */
    public function many(array $refs): array
    {
        if (count($refs) > self::MAX_REFS) {
            throw new ApiError('bad_refs', 'Up to ' . self::MAX_REFS . ' columns per call', 400);
        }
        $out = [];
        foreach ($refs as $r) {
            $table = (string) ($r['table'] ?? '');
            $cols = $this->columns($table);
            $key = (string) ($r['column'] ?? '');
            if (!in_array($key, array_column($cols, 'name'), true)) {
                throw new ApiError('unknown_column', "Unknown column: $key", 404, ['name' => $key]);
            }
            $ids = array_values(array_unique(array_map('strval', array_filter((array) ($r['ids'] ?? []), static fn ($v) => is_scalar($v) && $v !== ''))));
            if (count($ids) > self::MAX_IDS) {
                throw new ApiError('too_many_ids', 'Up to ' . self::MAX_IDS . ' ids per column', 400);
            }
            $label = self::labelColumn($cols, $key, isset($r['label']) && is_string($r['label']) ? $r['label'] : null);
            $map = [];
            if ($ids) {
                $st = $this->pdo->prepare('SELECT ' . Db::ident($key) . ' AS id, ' . Db::ident($label) . ' AS label FROM ' . $this->t($table)
                    . ' WHERE ' . Db::ident($key) . ' IN (' . implode(', ', array_fill(0, count($ids), '?')) . ')');
                $st->execute($ids);
                foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
                    $map[(string) $row['id']] = ['label' => $row['label'] === null ? null : \pmf_substr((string) $row['label'], 200)];
                }
            }
            $out["$table.$key"] = $map;
        }
        return $out;
    }
}
