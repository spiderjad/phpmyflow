<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * AI assistant. The server builds the prompt with the real schema, so the
 * model writes queries against tables and columns that actually exist.
 * Generated SQL is only ever returned to the editor, never executed here.
 */
final class Ai
{
    private const LANGS = ['en' => 'English', 'es' => 'Spanish', 'it' => 'Italian', 'fr' => 'French'];
    private const MAX_SCHEMA_CHARS = 60000;

    public static function enabled(): bool
    {
        $ai = pmf_config()['ai'];
        return $ai['enabled'] && ($ai['api_key'] !== '' || $ai['base_url'] !== '');
    }

    /**
     * @param 'generate'|'explain'|'fix'|'optimize' $mode
     * @return array{sql:string, explanation:string, warnings:string[]}
     */
    public static function run(string $mode, string $db, string $lang, string $prompt, string $sql, string $error): array
    {
        if (!self::enabled()) {
            throw new ApiError('ai_disabled', 'The AI assistant is not configured', 400);
        }
        $language = self::LANGS[$lang] ?? 'English';
        $schema = self::schemaText($db);
        $version = Db::serverVersion();

        $system = <<<TXT
        You are an expert MySQL/MariaDB assistant inside a database admin tool.
        Server version: $version. Current database: `$db`.
        Use ONLY tables and columns from this schema. Quote identifiers with backticks when needed.
        If the request is ambiguous or needs data that is not in the schema, say so in "explanation".
        Prefer readable SQL: one clause per line, explicit JOINs, table aliases.
        For SELECTs without an explicit limit from the user, add LIMIT 100.
        Never produce more than one statement.

        Schema (table: columns; PK = primary key, FK = foreign key):
        $schema

        Reply with JSON only, no markdown fences:
        {"sql": "...", "explanation": "...", "warnings": ["..."]}
        Write "explanation" and "warnings" in $language. "warnings" lists risks (data loss, full scans, missing index), or is empty.
        TXT;

        $user = match ($mode) {
            'generate' => "Write a query for this request:\n$prompt" . ($sql !== '' ? "\n\nCurrent editor content, for context:\n$sql" : ''),
            'explain' => "Explain step by step what this query does and what it returns. Return the same query, formatted, in \"sql\".\n\n$sql",
            'fix' => "This query failed. Return a corrected version and explain the cause briefly.\n\nQuery:\n$sql\n\nError:\n$error",
            'optimize' => "Suggest a faster equivalent query (and indexes as comments if useful). Explain why.\n\nQuery:\n$sql\n\nEXPLAIN output:\n" . self::explainOutput($sql),
            'optimize_digest' => self::digestPrompt($prompt),
            'peak' => self::peakPrompt($prompt),
            'columns' => "Propose new columns for the table `" . str_replace('`', '', $sql) . "` from this description:\n$prompt\n\n"
                . "Return in \"sql\" ONE statement: ALTER TABLE `table` ADD COLUMN name TYPE [UNSIGNED] [NOT NULL|NULL] [DEFAULT value] [COMMENT '...'], ADD COLUMN ... "
                . "Use simple MySQL types (INT, BIGINT, TINYINT(1) for yes/no, VARCHAR(n), TEXT, DECIMAL(p,s), DATE, DATETIME, TIMESTAMP, ENUM('a','b')). "
                . "Use snake_case English names unless the existing columns use another language. Put the reasoning in \"explanation\".",
            default => throw new ApiError('bad_mode', 'Unknown AI mode', 400),
        };

        $text = self::complete($system, $user);
        return self::parse($text);
    }

    private static function schemaText(string $db): string
    {
        $lines = [];
        foreach (Schema::full($db) as $table => $info) {
            $cols = array_map(static function ($c) use ($info) {
                $tag = $c['key'] === 'PRI' ? ' PK' : '';
                foreach ($info['foreignKeys'] as $fk) {
                    if ($fk['column'] === $c['name']) {
                        $tag .= ' FK->' . $fk['references'];
                    }
                }
                // No FOREIGN KEY, but the name says so (GLPI-style): mark it as inferred.
                foreach ($info['inferredKeys'] ?? [] as $fk) {
                    if ($fk['column'] === $c['name']) {
                        $tag .= ' ~>' . $fk['references'] . ' (inferred)';
                    }
                }
                return $c['name'] . ' ' . $c['type'] . $tag;
            }, $info['columns']);
            $lines[] = $table . ($info['type'] === 'VIEW' ? ' (view)' : '') . ': ' . implode(', ', $cols);
        }
        $lines[] = 'Notation: "FK->t.c" is a declared foreign key; "~>t.c (inferred)" is a relation inferred from column names (no constraint): use it for JOINs.';
        $text = implode("\n", $lines);
        return strlen($text) > self::MAX_SCHEMA_CHARS
            ? \pmf_substr($text, self::MAX_SCHEMA_CHARS) . "\n…(schema truncated)"
            : $text;
    }

    /**
     * Heavy query from performance_schema: the normalized digest (literals
     * are already "?") plus the EXPLAIN of its sample when the server keeps one.
     */
    private static function digestPrompt(string $digest): string
    {
        $d = Monitor::forSession()->digestDetail($digest);
        $explain = $d['explain'] ? self::table($d['explain']['columns'], $d['explain']['rows']) : '(no EXPLAIN available: the server keeps no sample of this statement)';
        return "This normalized statement (literals replaced by ?) is one of the heaviest on the server. "
            . "Suggest how to make it faster: indexes (as CREATE INDEX statements in comments), a rewrite, or settings. "
            . "Return the improved query in \"sql\" with ? kept as placeholders.\n\nDatabase: " . ($d['db'] ?? '?') . "\n\nStatement:\n" . $d['text'] . "\n\nEXPLAIN:\n" . $explain;
    }

    /** A stored peak: metric values, running statements (literals hidden) and top digests. Never row data. */
    private static function peakPrompt(string $peakId): string
    {
        $peak = MetricsStore::open()->peak(Collector::sessionKey(), $peakId);
        if (!$peak) {
            throw new ApiError('not_found', 'Peak not found', 404);
        }
        $lines = ['Time (UTC): ' . gmdate('Y-m-d H:i', (int) $peak['ts'])];
        foreach ($peak['peaks'] as $p) {
            $lines[] = sprintf('Triggered: %s = %.2f (threshold %.2f)', $p['metric'], $p['value'], $p['threshold']);
        }
        $r = $peak['snapshot']['rates'] ?? [];
        $lines[] = sprintf('Rates: qps %.1f, threads_running %d, connected %d, tmp_disk/s %.2f, row_lock_waits/s %.2f', $r['qps'] ?? 0, $r['threads_running'] ?? 0, $r['threads_connected'] ?? 0, $r['tmp_disk'] ?? 0, $r['row_lock_waits'] ?? 0);
        $lines[] = "\nActive statements (literals hidden):";
        foreach (array_slice($peak['snapshot']['processes'] ?? [], 0, 30) as $p) {
            $lines[] = sprintf('- %s@%s db=%s %ss %s: %s', $p['user'], preg_replace('~:\d+$~', '', (string) $p['host']), $p['db'] ?? '-', $p['time'], $p['state'] ?? '', \pmf_substr((string) ($p['info'] ?? ''), 300));
        }
        $lines[] = "\nTop statements by total time:";
        foreach ($peak['snapshot']['digests'] ?? [] as $d) {
            $lines[] = sprintf('- %dx, total %.0f ms, avg %.1f ms, rows examined %d: %s', $d['count'], $d['total'], $d['avg'], $d['examined'], \pmf_substr((string) $d['text'], 300));
        }
        return "Explain the most likely cause of this load peak on a MySQL/MariaDB server and what to do about it. "
            . "Put a diagnostic query in \"sql\" if one helps (read-only), or leave it empty.\n\n" . implode("\n", $lines);
    }

    private static function table(array $cols, array $rows): string
    {
        $head = implode(' | ', array_column($cols, 'name'));
        $body = array_map(static fn ($r) => implode(' | ', array_map(static fn ($v) => $v === null ? 'NULL' : (string) $v, $r)), array_slice($rows, 0, 30));
        return $head . "\n" . implode("\n", $body);
    }

    private static function explainOutput(string $sql): string
    {
        if (!Sql::classify($sql)['readOnly']) {
            return '(not available)';
        }
        try {
            $rows = Db::explain(Db::pdo(), $sql, static fn (\PDOStatement $st) => $st->fetchAll());
            return $rows === null ? '(not available)' : (json_encode($rows, JSON_UNESCAPED_UNICODE) ?: '');
        } catch (\PDOException $e) {
            return 'EXPLAIN failed: ' . $e->getMessage();
        }
    }

    private static function complete(string $system, string $user): string
    {
        $ai = pmf_config()['ai'];
        if ($ai['provider'] === 'anthropic') {
            $url = rtrim($ai['base_url'] ?: 'https://api.anthropic.com', '/') . '/v1/messages';
            $headers = ['x-api-key: ' . $ai['api_key'], 'anthropic-version: 2023-06-01'];
            $body = [
                'model' => $ai['model'],
                'max_tokens' => (int) $ai['max_tokens'],
                'system' => $system,
                'messages' => [['role' => 'user', 'content' => $user]],
            ];
            $res = self::post($url, $headers, $body, (int) $ai['timeout_seconds']);
            $text = '';
            foreach ($res['content'] ?? [] as $block) {
                if (($block['type'] ?? '') === 'text') {
                    $text .= $block['text'];
                }
            }
            return $text;
        }

        // OpenAI-compatible chat completions (OpenAI, OpenRouter, Ollama, LM Studio...)
        $url = rtrim($ai['base_url'] ?: 'https://api.openai.com/v1', '/') . '/chat/completions';
        $headers = $ai['api_key'] !== '' ? ['Authorization: Bearer ' . $ai['api_key']] : [];
        $body = [
            'model' => $ai['model'],
            'max_tokens' => (int) $ai['max_tokens'],
            'messages' => [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $user]],
        ];
        $res = self::post($url, $headers, $body, (int) $ai['timeout_seconds']);
        return (string) ($res['choices'][0]['message']['content'] ?? '');
    }

    /** Plain streams instead of cURL: one less extension required on shared hosting. */
    private static function post(string $url, array $headers, array $body, int $timeout): array
    {
        $ctx = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => implode("\r\n", array_merge(['Content-Type: application/json'], $headers)),
            'content' => json_encode($body),
            'timeout' => $timeout,
            'ignore_errors' => true,
        ]]);
        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false) {
            throw new ApiError('ai_unreachable', 'Could not reach the AI provider', 502);
        }
        $status = 0;
        foreach ($http_response_header ?? [] as $h) {
            if (preg_match('~^HTTP/\S+\s+(\d+)~', $h, $m)) {
                $status = (int) $m[1];
            }
        }
        $data = json_decode($raw, true);
        if ($status >= 400 || !is_array($data)) {
            $msg = is_array($data) ? ($data['error']['message'] ?? 'AI provider error') : 'AI provider error';
            throw new ApiError('ai_error', $msg, 502, ['status' => $status]);
        }
        return $data;
    }

    private static function parse(string $text): array
    {
        $clean = trim(preg_replace('~^```(?:json)?|```$~m', '', trim($text)) ?? '');
        $start = strpos($clean, '{');
        $end = strrpos($clean, '}');
        $data = ($start !== false && $end !== false) ? json_decode(substr($clean, $start, $end - $start + 1), true) : null;
        if (!is_array($data)) {
            // Model ignored the format: still give the user something usable.
            return ['sql' => '', 'explanation' => trim($text), 'warnings' => []];
        }
        return [
            'sql' => trim((string) ($data['sql'] ?? '')),
            'explanation' => trim((string) ($data['explanation'] ?? '')),
            'warnings' => array_values(array_filter(array_map('strval', (array) ($data['warnings'] ?? [])))),
        ];
    }
}
