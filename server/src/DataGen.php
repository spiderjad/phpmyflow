<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * Test data generator. Pure: given a column plan, a seed and pools of
 * existing ids for foreign keys, it returns rows. The same seed gives the
 * same rows (preview = what gets inserted), and row numbers continue
 * between batches, so UNIQUE columns never repeat across requests.
 *
 * Values follow the type (length, range, scale, enum) and the column name
 * (email, phone, name, city, price...). AUTO_INCREMENT and generated
 * columns are left to the server.
 */
final class DataGen
{
    private int $state;

    private const FIRST = ['Ana', 'Lucía', 'María', 'Sofía', 'Carmen', 'Laura', 'Elena', 'Paula', 'Giulia', 'Chiara', 'Emma', 'Léa', 'Marco', 'Luca', 'Javier', 'Diego', 'Pablo', 'Mateo', 'Hugo', 'Daniel', 'Lucas', 'Martín', 'Tom', 'James', 'Olivia', 'Noah'];
    private const LAST = ['García', 'Fernández', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Díaz', 'Rossi', 'Russo', 'Ferrari', 'Bianchi', 'Martin', 'Bernard', 'Dubois', 'Smith', 'Jones', 'Brown', 'Moreno', 'Romero', 'Navarro', 'Torres'];
    private const CITY = ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Girona', 'Roma', 'Milano', 'Torino', 'Paris', 'Lyon', 'Lisboa', 'Buenos Aires', 'Montevideo', 'Ciudad de México', 'Bogotá', 'London', 'Berlin'];
    private const COUNTRY = ['ES', 'IT', 'FR', 'PT', 'AR', 'UY', 'MX', 'CO', 'GB', 'DE', 'US'];
    private const COMPANY = ['Acme', 'Norte', 'Delta', 'Sigma', 'Atlas', 'Nova', 'Orbit', 'Vertex', 'Iberia', 'Costa', 'Solar', 'Prisma'];
    private const SUFFIX = ['S.L.', 'S.A.', 'SRL', 'SpA', 'SAS', 'Ltd', 'GmbH'];
    private const STREET = ['Calle Mayor', 'Avenida del Sol', 'Via Roma', 'Rue de la Paix', 'Gran Vía', 'Paseo de Gracia', 'Main Street'];
    private const LOREM = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim', 'minim', 'veniam', 'quis', 'nostrud'];

    /** @param string $token per job: unique values also differ from earlier runs */
    public function __construct(int $seed, private string $token = '')
    {
        $this->state = ($seed & 0x7fffffff) ?: 1;
    }

    // ------------------------------------------------------------------
    // Plan: one strategy per writable column
    // ------------------------------------------------------------------

    /**
     * @param list<array{name:string, dataType:string, columnType:string, nullable:bool, auto?:bool, generated?:bool, unique?:bool, length?:?int, values?:list<string>, unsigned?:bool, fk?:?array, precision?:?int, scale?:?int, strategy?:string, options?:array}> $cols
     */
    public static function plan(array $cols): array
    {
        $out = [];
        foreach ($cols as $c) {
            if (!empty($c['auto']) || !empty($c['generated'])) {
                continue;
            }
            $c['strategy'] = !empty($c['strategy']) ? (string) $c['strategy'] : self::guess($c);
            $c['options'] = (array) ($c['options'] ?? []);
            $out[] = $c;
        }
        return $out;
    }

    public static function guess(array $c): string
    {
        $n = strtolower((string) $c['name']);
        $t = strtolower((string) $c['dataType']);
        if (!empty($c['fk'])) {
            return 'fk';
        }
        if (in_array($t, ['enum'], true)) {
            return 'enum';
        }
        if ($t === 'set') {
            return 'set';
        }
        if ($t === 'json') {
            return 'json';
        }
        if (in_array($t, ['date'], true)) {
            return 'date';
        }
        if (in_array($t, ['datetime', 'timestamp'], true)) {
            return 'datetime';
        }
        if ($t === 'time') {
            return 'time';
        }
        if ($t === 'year') {
            return 'year';
        }
        if (in_array($t, ['bit', 'bool', 'boolean'], true) || ($t === 'tinyint' && (preg_match('~^(is|has|can|es|tiene)_|active|activo|enabled|visible|deleted|paid~', $n) || preg_match('~tinyint\(1\)~', (string) $c['columnType'])))) {
            return 'bool';
        }
        $int = in_array($t, ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint'], true);
        $num = $int || in_array($t, ['decimal', 'numeric', 'float', 'double', 'real'], true);
        if ($num) {
            if (preg_match('~price|precio|amount|importe|total|cost|coste|costo|salary|salario|balance|saldo|fee|tax|iva~', $n)) {
                return 'amount';
            }
            return $int ? 'int' : 'amount';
        }
        if (in_array($t, ['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'geometry', 'point', 'linestring', 'polygon'], true)) {
            return 'null';
        }
        $text = in_array($t, ['text', 'tinytext', 'mediumtext', 'longtext'], true);
        $rules = [
            '~e-?mail|correo~' => 'email',
            '~phone|tel(e|é)?fono|^tel$|mobile|movil|móvil|cell~' => 'phone',
            '~^uuid$|guid|_uuid$~' => 'uuid',
            '~url|website|web$|sitio~' => 'url',
            '~^first_?name$|^nombre$|^firstname$|given~' => 'first_name',
            '~last_?name|surname|apellido~' => 'last_name',
            '~(^|_)city|ciudad|citta|ville|localidad~' => 'city',
            '~country|pais|país|paese~' => 'country',
            '~address|direccion|dirección|street|calle~' => 'address',
            '~company|empresa|razon|razón|azienda|organi~' => 'company',
            '~(^|_)(code|codigo|código|sku|ref|reference|referencia)($|_)~' => 'code',
            '~descr|comment|coment|notes?$|nota|body|content|message|mensaje|bio|summary|resumen~' => 'sentence',
            '~title|titulo|título|subject|asunto~' => 'title',
            '~(^|_)(name|nombre|nome|nom|fullname|username|user)($|_)~' => 'name',
            '~status|estado|state|type|tipo|kind|level|nivel|category|categoria~' => 'word',
        ];
        foreach ($rules as $re => $s) {
            if (preg_match($re, $n)) {
                return $s;
            }
        }
        return $text ? 'sentence' : 'word';
    }

    // ------------------------------------------------------------------
    // Rows
    // ------------------------------------------------------------------

    /** Small deterministic PRNG (xorshift), independent from mt_rand state. */
    private function rand(int $min, int $max): int
    {
        $x = $this->state;
        $x ^= ($x << 13) & 0x7fffffff;
        $x ^= $x >> 17;
        $x ^= ($x << 5) & 0x7fffffff;
        $this->state = $x & 0x7fffffff ?: 1;
        return $min + ($this->state % max(1, $max - $min + 1));
    }

    private function pick(array $list): mixed
    {
        return $list[$this->rand(0, count($list) - 1)];
    }

    /**
     * @param array<string, list<mixed>> $pools existing ids, "table.column" => ids
     * @return list<list<mixed>>
     */
    public function rows(array $plan, int $count, int $start, array $pools): array
    {
        // Each row has its own stream: a batch gives the same rows as one big run.
        $base = $this->state;
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $n = $start + $i;
            $this->state = (($base * 1103515245 + $n * 12345 + 7) & 0x7fffffff) ?: 1;
            $this->rand(0, 1);
            $row = [];
            foreach ($plan as $c) {
                $row[] = $this->value($c, $n, $pools);
            }
            $rows[] = $row;
        }
        $this->state = $base;
        return $rows;
    }

    private function value(array $c, int $n, array $pools): mixed
    {
        $o = (array) ($c['options'] ?? []);
        $unique = !empty($c['unique']);
        $nullable = !empty($c['nullable']);
        $nullPct = (int) ($o['nullPct'] ?? ($nullable && !$unique ? 10 : 0));
        $s = (string) $c['strategy'];
        if ($s === 'null') {
            return null;
        }
        if ($nullable && $nullPct > 0 && $this->rand(1, 100) <= $nullPct && $s !== 'fk') {
            return null;
        }
        $len = isset($c['length']) && $c['length'] ? (int) $c['length'] : null;
        $tag = $this->token . base_convert((string) $n, 10, 36);

        switch ($s) {
            case 'fk':
                $key = $c['fk']['table'] . '.' . $c['fk']['column'];
                $pool = $pools[$key] ?? [];
                if (!$pool) {
                    if ($nullable) {
                        return null;
                    }
                    throw new ApiError('gen_empty_fk', "The table {$c['fk']['table']} has no rows to point to", 400, ['name' => (string) $c['name'], 'table' => (string) $c['fk']['table']]);
                }
                return $this->pick($pool);
            case 'enum':
                return $this->pick((array) ($c['values'] ?: ['']));
            case 'set':
                $vals = (array) ($c['values'] ?: ['']);
                return implode(',', array_values(array_unique([$this->pick($vals), $this->pick($vals)])));
            case 'bool':
                return $this->rand(0, 99) < (int) ($o['truePct'] ?? 70) ? 1 : 0;
            case 'int':
                [$lo, $hi] = $this->intRange($c);
                $nm = strtolower((string) $c['name']);
                $rating = (bool) preg_match('~rating|stars|estrellas|puntuaci|valoraci|score~', $nm);
                $lo = max($lo, (int) ($o['min'] ?? ($rating || preg_match('~qty|quant|cantidad~', $nm) ? 1 : 0)));
                $hi = min($hi, (int) ($o['max'] ?? ($unique ? $hi : ($rating ? 5 : min($hi, 1000)))));
                if ($unique) {
                    return min($hi, ((int) ($o['startAt'] ?? max($lo, 1))) + $n);
                }
                return $this->rand($lo, max($lo, $hi));
            case 'amount':
                $scale = (int) ($c['scale'] ?? 2);
                $prec = (int) ($c['precision'] ?? 10);
                $maxInt = $prec - $scale > 0 ? (10 ** min(9, $prec - $scale)) - 1 : 0;
                $min = (float) ($o['min'] ?? 1);
                $max = (float) ($o['max'] ?? min($maxInt, 1000));
                $v = $min + $this->rand(0, 1000000) / 1000000 * max(0, $max - $min);
                if (!empty($c['unsigned']) && $v < 0) {
                    $v = -$v;
                }
                return number_format($v, $scale, '.', '');
            case 'date':
            case 'datetime':
            case 'time':
            case 'year':
                $from = strtotime((string) ($o['from'] ?? date('Y-01-01', strtotime('-2 years')))) ?: 0;
                $to = strtotime((string) ($o['to'] ?? date('Y-m-d'))) ?: time();
                $to = max($from, $to + ($s === 'date' ? 0 : 86399));
                $ts = $unique ? $from + $n * ($s === 'date' ? 86400 : 1) : $from + $this->rand(0, max(0, $to - $from));
                return match ($s) {
                    'date' => date('Y-m-d', $ts),
                    'time' => sprintf('%02d:%02d:%02d', $this->rand(0, 23), $this->rand(0, 59), $this->rand(0, 59)),
                    'year' => (int) date('Y', $ts),
                    default => date('Y-m-d H:i:s', $ts),
                };
            case 'uuid':
                $h = '';
                for ($k = 0; $k < 8; $k++) {
                    $h .= str_pad(dechex($this->rand(0, 65535)), 4, '0', STR_PAD_LEFT);
                }
                $h = substr_replace($h, sprintf('%08x', $n & 0xffffffff), 0, 8);
                return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-4' . substr($h, 13, 3) . '-a' . substr($h, 17, 3) . '-' . substr($h, 20, 12);
            case 'json':
                return json_encode(['n' => $n, 'tag' => $this->pick(self::LOREM)]);
            case 'email':
                $local = self::ascii(strtolower($this->pick(self::FIRST) . '.' . $this->pick(self::LAST)));
                $domain = '@example.com';
                $suffix = $unique ? '.' . $tag : '';
                $max = ($len ?? 120) - strlen($domain) - strlen($suffix);
                return substr($local, 0, max(1, $max)) . $suffix . $domain;
            case 'phone':
                return $this->fit('+34 6' . $this->rand(10, 99) . ' ' . $this->rand(100, 999) . ' ' . $this->rand(100, 999), $len, $unique ? $tag : '');
            case 'url':
                return $this->fit('https://' . self::ascii(strtolower($this->pick(self::COMPANY))) . '.example.com/' . $this->pick(self::LOREM), $len, $unique ? $tag : '');
            case 'first_name':
                return $this->fit($this->pick(self::FIRST), $len, $unique ? $tag : '');
            case 'last_name':
                return $this->fit($this->pick(self::LAST), $len, $unique ? $tag : '');
            case 'name':
                return $this->fit($this->pick(self::FIRST) . ' ' . $this->pick(self::LAST), $len, $unique ? $tag : '');
            case 'city':
                return $this->fit($this->pick(self::CITY), $len, $unique ? $tag : '');
            case 'country':
                return $this->fit($this->pick(self::COUNTRY), $len, $unique ? $tag : '');
            case 'address':
                return $this->fit($this->pick(self::STREET) . ' ' . $this->rand(1, 200), $len, $unique ? $tag : '');
            case 'company':
                return $this->fit($this->pick(self::COMPANY) . ' ' . $this->pick(self::SUFFIX), $len, $unique ? $tag : '');
            case 'code':
                return $this->fit(strtoupper(substr($this->pick(self::LOREM), 0, 3)) . '-' . str_pad((string) $this->rand(0, 9999), 4, '0', STR_PAD_LEFT), $len, $unique ? $tag : '');
            case 'title':
                return $this->fit(ucfirst(implode(' ', $this->words($this->rand(2, 5)))), $len, $unique ? $tag : '');
            case 'sentence':
                return $this->fit(ucfirst(implode(' ', $this->words($this->rand(6, 16)))) . '.', $len, $unique ? $tag : '');
            case 'word':
            default:
                return $this->fit($this->pick(self::LOREM), $len, $unique ? $tag : '');
        }
    }

    private function words(int $k): array
    {
        $w = [];
        for ($i = 0; $i < $k; $i++) {
            $w[] = $this->pick(self::LOREM);
        }
        return $w;
    }

    /** Cut to the column length, keeping the unique suffix whole. */
    private function fit(string $v, ?int $len, string $suffix): string
    {
        $suffix = $suffix === '' ? '' : '-' . $suffix;
        if ($len === null) {
            return $v . $suffix;
        }
        $room = max(0, $len - strlen($suffix));
        return \pmf_substr($v, $room) . $suffix;
    }

    private static function ascii(string $s): string
    {
        $map = ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ñ' => 'n', 'ü' => 'u', 'à' => 'a', 'è' => 'e', 'ì' => 'i', 'ò' => 'o', 'ù' => 'u', 'ç' => 'c', 'é' => 'e'];
        return (string) preg_replace('~[^a-z0-9.]~', '', strtr($s, $map));
    }

    /** @return array{0:int,1:int} */
    private function intRange(array $c): array
    {
        $t = strtolower((string) $c['dataType']);
        $u = !empty($c['unsigned']) || str_contains(strtolower((string) $c['columnType']), 'unsigned');
        $bits = ['tinyint' => 8, 'smallint' => 16, 'mediumint' => 24, 'int' => 32, 'integer' => 32, 'bigint' => 32][$t] ?? 32;
        if ($u) {
            return [0, $bits >= 32 ? 2147483647 : (2 ** $bits) - 1];
        }
        return [-(2 ** ($bits - 1)), (2 ** ($bits - 1)) - 1];
    }
}
