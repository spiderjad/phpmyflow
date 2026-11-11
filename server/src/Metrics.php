<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * Pure metric math shared by the collector and the live endpoint:
 * counter deltas (with restart detection), peak detection, hourly
 * aggregation and retention. No I/O here, so tests/php can cover it.
 *
 * The browser mirrors rates() in web/src/lib/monitor.ts for live charts;
 * keep both in sync.
 */
final class Metrics
{
    /** SHOW GLOBAL STATUS counters (monotonic since server start). */
    public const COUNTERS = [
        'Questions', 'Com_select', 'Com_insert', 'Com_update', 'Com_delete', 'Com_replace',
        'Bytes_received', 'Bytes_sent', 'Created_tmp_disk_tables', 'Created_tmp_tables',
        'Sort_scan', 'Sort_range', 'Sort_merge_passes', 'Slow_queries',
        'Innodb_row_lock_waits', 'Innodb_row_lock_time',
        'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads',
        'Aborted_connects', 'Aborted_clients', 'Connections',
    ];

    /** SHOW GLOBAL STATUS gauges (current values). */
    public const GAUGES = ['Threads_connected', 'Threads_running', 'Max_used_connections', 'Uptime', 'Open_tables'];

    /** Variables the monitor and the advisor read. */
    public const VARIABLES = [
        'max_connections', 'innodb_buffer_pool_size', 'slow_query_log', 'long_query_time', 'slow_query_log_file',
        'log_output', 'query_cache_type', 'query_cache_size', 'performance_schema', 'version', 'version_comment',
        'tmp_table_size', 'max_heap_table_size', 'table_open_cache', 'innodb_log_file_size',
    ];

    /** Metrics the collector stores and the charts draw. */
    public const SERIES = [
        'qps', 'select', 'insert', 'update', 'delete', 'other', 'threads_running', 'threads_connected',
        'bytes_in', 'bytes_out', 'tmp_disk', 'tmp', 'sorts', 'sort_merge', 'row_lock_waits', 'row_lock_ms',
        'slow_per_min', 'bp_hit', 'aborted_connects', 'max_used', 'max_connections',
    ];

    /** Metrics checked for peaks. */
    public const PEAK_METRICS = ['threads_running', 'qps', 'threads_connected'];

    /**
     * Per-second rates between two raw snapshots.
     * Returns null when the server restarted in between (Uptime went
     * down or a counter decreased): there is no meaningful delta.
     *
     * @param array<string, float|int|string> $prev raw status (+ '_t' = unix time with decimals)
     * @param array<string, float|int|string> $cur
     * @return array<string, float|null>|null
     */
    public static function rates(array $prev, array $cur): ?array
    {
        $dt = (float) ($cur['_t'] ?? 0) - (float) ($prev['_t'] ?? 0);
        if ($dt <= 0) {
            return null;
        }
        if (isset($prev['Uptime'], $cur['Uptime']) && (float) $cur['Uptime'] < (float) $prev['Uptime']) {
            return null;
        }
        $d = [];
        foreach (self::COUNTERS as $k) {
            $a = (float) ($prev[$k] ?? 0);
            $b = (float) ($cur[$k] ?? 0);
            if ($b < $a) {
                return null; // counter reset (FLUSH STATUS or restart)
            }
            $d[$k] = $b - $a;
        }
        $per = static fn (float $v) => $v / $dt;
        $select = $per($d['Com_select']);
        $insert = $per($d['Com_insert'] + $d['Com_replace']);
        $update = $per($d['Com_update']);
        $delete = $per($d['Com_delete']);
        $qps = $per($d['Questions']);
        $requests = $d['Innodb_buffer_pool_read_requests'];
        return [
            'qps' => $qps,
            'select' => $select,
            'insert' => $insert,
            'update' => $update,
            'delete' => $delete,
            'other' => max(0.0, $qps - $select - $insert - $update - $delete),
            'threads_running' => (float) ($cur['Threads_running'] ?? 0),
            'threads_connected' => (float) ($cur['Threads_connected'] ?? 0),
            'bytes_in' => $per($d['Bytes_received']),
            'bytes_out' => $per($d['Bytes_sent']),
            'tmp_disk' => $per($d['Created_tmp_disk_tables']),
            'tmp' => $per($d['Created_tmp_tables']),
            'sorts' => $per($d['Sort_scan'] + $d['Sort_range']),
            'sort_merge' => $per($d['Sort_merge_passes']),
            'row_lock_waits' => $per($d['Innodb_row_lock_waits']),
            'row_lock_ms' => $per($d['Innodb_row_lock_time']),
            'slow_per_min' => $per($d['Slow_queries']) * 60,
            'bp_hit' => $requests > 0 ? 1 - $d['Innodb_buffer_pool_reads'] / $requests : null,
            'aborted_connects' => $per($d['Aborted_connects']),
            'max_used' => (float) ($cur['Max_used_connections'] ?? 0),
            'max_connections' => isset($cur['max_connections']) ? (float) $cur['max_connections'] : null,
        ];
    }

    /** Mean and standard deviation of the non-null values. */
    public static function meanStd(array $values): array
    {
        $v = array_values(array_filter($values, static fn ($x) => $x !== null));
        $n = count($v);
        if ($n === 0) {
            return [0.0, 0.0];
        }
        $mean = array_sum($v) / $n;
        $var = 0.0;
        foreach ($v as $x) {
            $var += ($x - $mean) ** 2;
        }
        return [$mean, sqrt($var / $n)];
    }

    /** Floors so a quiet server doesn't flag "3 threads" as a peak. */
    public const PEAK_FLOOR = ['threads_running' => 5, 'qps' => 50, 'threads_connected' => 20];

    /**
     * Which metrics of `$sample` are peaks. A fixed threshold from config
     * wins; otherwise mean + 3σ of `$history` (needs 30+ samples), never
     * below PEAK_FLOOR.
     *
     * @param array<string, float|null> $sample
     * @param list<array<string, float|null>> $history recent samples (e.g. last hour)
     * @param array<string, float> $fixed config thresholds
     * @return list<array{metric:string, value:float, threshold:float}>
     */
    public static function detectPeaks(array $sample, array $history, array $fixed = []): array
    {
        $out = [];
        foreach (self::PEAK_METRICS as $m) {
            $value = $sample[$m] ?? null;
            if ($value === null) {
                continue;
            }
            if (isset($fixed[$m])) {
                $threshold = (float) $fixed[$m];
            } else {
                $series = array_column($history, $m);
                if (count(array_filter($series, static fn ($x) => $x !== null)) < 30) {
                    continue;
                }
                [$mean, $std] = self::meanStd($series);
                $threshold = max($mean + 3 * $std, self::PEAK_FLOOR[$m] ?? 0);
            }
            if ($value > $threshold) {
                $out[] = ['metric' => $m, 'value' => (float) $value, 'threshold' => (float) $threshold];
            }
        }
        return $out;
    }

    /** Nearest-rank percentile (0..100) of non-null values. */
    public static function percentile(array $values, float $p): ?float
    {
        $v = array_values(array_filter($values, static fn ($x) => $x !== null));
        if (!$v) {
            return null;
        }
        sort($v);
        $rank = (int) ceil($p / 100 * count($v));
        return (float) $v[max(0, min(count($v) - 1, $rank - 1))];
    }

    /**
     * Aggregate minute samples into one hourly row: min, avg, max, p95 per metric.
     *
     * @param list<array<string, float|null>> $samples
     * @return array<string, array{min:float, avg:float, max:float, p95:float}>
     */
    public static function aggregate(array $samples): array
    {
        $out = [];
        foreach (self::SERIES as $m) {
            $v = array_values(array_filter(array_column($samples, $m), static fn ($x) => $x !== null));
            if (!$v) {
                continue;
            }
            $out[$m] = [
                'min' => (float) min($v),
                'avg' => array_sum($v) / count($v),
                'max' => (float) max($v),
                'p95' => (float) self::percentile($v, 95),
            ];
        }
        return $out;
    }

    /** Start of the hour (unix seconds). */
    public static function hourOf(int $ts): int
    {
        return $ts - ($ts % 3600);
    }

    /**
     * Downsample [ts => sample] rows to at most `$points` buckets (average
     * per bucket), for charts over long ranges.
     *
     * @param list<array{ts:int, m:array<string, float|null>}> $rows sorted by ts
     * @return list<array{ts:int, m:array<string, float|null>}>
     */
    public static function downsample(array $rows, int $points): array
    {
        $n = count($rows);
        if ($n <= $points || $points < 1) {
            return $rows;
        }
        $size = (int) ceil($n / $points);
        $out = [];
        for ($i = 0; $i < $n; $i += $size) {
            $chunk = array_slice($rows, $i, $size);
            $m = [];
            foreach (self::SERIES as $k) {
                $v = array_values(array_filter(array_map(static fn ($r) => $r['m'][$k] ?? null, $chunk), static fn ($x) => $x !== null));
                $m[$k] = $v ? array_sum($v) / count($v) : null;
            }
            $out[] = ['ts' => $chunk[0]['ts'], 'm' => $m];
        }
        return $out;
    }
}
