<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * Streaming SQL statement splitter for imports. Reads a file handle in
 * chunks, never the whole file, and understands what the mysql client does:
 * strings ('', "", ``, backslash escapes, doubled quotes), comments (-- , #,
 * block comments; executable /*! ... *\/ comments are statements), and the
 * DELIMITER command (not sent to the server).
 *
 * A run can stop after any statement and resume later from offset(),
 * delimiter() and line(), which is how imports run in short requests.
 */
final class SqlSplitter
{
    /** Bigger statements are refused (max_allowed_packet is rarely above this). */
    public const MAX_STATEMENT = 256 * 1024 * 1024;

    private string $buf = '';
    /** File offset of $buf[0]. */
    private int $base;
    private int $pos = 0;
    private bool $eof = false;

    /** @param resource $fh */
    public function __construct(
        private $fh,
        int $offset = 0,
        private string $delimiter = ';',
        private int $line = 1,
        private int $chunk = 1048576,
    ) {
        fseek($this->fh, $offset);
        $this->base = $offset;
    }

    public function offset(): int
    {
        return $this->base + $this->pos;
    }

    public function delimiter(): string
    {
        return $this->delimiter;
    }

    public function line(): int
    {
        return $this->line;
    }

    /** @return array{sql:string, line:int}|null */
    public function next(): ?array
    {
        while (true) {
            $this->skipNoise();
            if (!$this->ensure(1)) {
                return null;
            }
            if ($this->delimiterCommand()) {
                continue;
            }
            return $this->statement();
        }
    }

    // ------------------------------------------------------------------

    /** Make sure $n bytes are available after pos (false at end of file). */
    private function ensure(int $n): bool
    {
        while (strlen($this->buf) - $this->pos < $n && !$this->eof) {
            $data = fread($this->fh, $this->chunk);
            if ($data === false || $data === '') {
                $this->eof = true;
                break;
            }
            $this->buf .= $data;
        }
        return strlen($this->buf) - $this->pos >= $n;
    }

    /** Drop consumed bytes so memory stays bounded. */
    private function compact(): void
    {
        if ($this->pos > $this->chunk) {
            $this->buf = substr($this->buf, $this->pos);
            $this->base += $this->pos;
            $this->pos = 0;
        }
    }

    private function advance(int $to): void
    {
        $this->line += substr_count($this->buf, "\n", $this->pos, $to - $this->pos);
        $this->pos = $to;
    }

    /** Find $needle from $from, reading more as needed. Returns its index or -1 at EOF. */
    private function find(string $needle, int $from): int
    {
        while (true) {
            $i = strpos($this->buf, $needle, $from);
            if ($i !== false) {
                return $i;
            }
            $from = max($from, strlen($this->buf) - strlen($needle) + 1);
            if (!$this->more()) {
                return -1;
            }
        }
    }

    private function more(): bool
    {
        if ($this->eof) {
            return false;
        }
        $have = strlen($this->buf);
        $this->ensure($have - $this->pos + 1);
        return strlen($this->buf) > $have;
    }

    /** Whitespace and pure comments between statements. */
    private function skipNoise(): void
    {
        while (true) {
            $this->compact();
            if (!$this->ensure(1)) {
                return;
            }
            $ws = strspn($this->buf, " \t\r\n", $this->pos);
            if ($ws > 0) {
                $this->advance($this->pos + $ws);
                if ($this->pos >= strlen($this->buf)) {
                    continue;
                }
            }
            $this->ensure(3);
            $c = $this->buf[$this->pos] ?? '';
            $two = substr($this->buf, $this->pos, 2);
            if ($c === '#' || ($two === '--' && $this->isDashComment($this->pos))) {
                $nl = $this->find("\n", $this->pos);
                $this->advance($nl < 0 ? strlen($this->buf) : $nl + 1);
                continue;
            }
            if ($two === '/*' && !in_array($this->buf[$this->pos + 2] ?? '', ['!', '+'], true)) {
                $end = $this->find('*/', $this->pos + 2);
                $this->advance($end < 0 ? strlen($this->buf) : $end + 2);
                continue;
            }
            return;
        }
    }

    /** "--" starts a comment only when followed by whitespace, a control char or the end. */
    private function isDashComment(int $i): bool
    {
        $this->ensure($i - $this->pos + 3);
        $next = $this->buf[$i + 2] ?? '';
        return $next === '' || ord($next) <= 32;
    }

    /** "DELIMITER xx" at the start of a statement: change it, send nothing. */
    private function delimiterCommand(): bool
    {
        $this->ensure(10);
        if (strncasecmp(substr($this->buf, $this->pos, 10), 'delimiter', 9) !== 0 || !in_array($this->buf[$this->pos + 9] ?? '', [' ', "\t"], true)) {
            return false;
        }
        $nl = $this->find("\n", $this->pos);
        $end = $nl < 0 ? strlen($this->buf) : $nl;
        $arg = trim(substr($this->buf, $this->pos + 10, $end - $this->pos - 10));
        $arg = preg_split('~\s+~', $arg)[0] ?? '';
        if ($arg !== '') {
            $this->delimiter = $arg;
        }
        $this->advance($nl < 0 ? $end : $nl + 1);
        return true;
    }

    /** @return array{sql:string, line:int} */
    private function statement(): array
    {
        $start = $this->pos;
        $startLine = $this->line;
        $line = $this->line;
        $d = $this->delimiter;
        $mask = "'\"`-#/\n" . $d[0];
        $i = $this->pos;
        while (true) {
            if ($i - $start > self::MAX_STATEMENT) {
                throw new ApiError('statement_too_big', 'Statement too large', 400, ['line' => $startLine]);
            }
            $i += strcspn($this->buf, $mask, $i);
            if ($i >= strlen($this->buf)) {
                if ($this->more()) {
                    continue;
                }
                // Last statement without a delimiter.
                return $this->emit($start, strlen($this->buf), strlen($this->buf), $startLine);
            }
            $c = $this->buf[$i];
            if ($c === "\n") {
                $i++;
                continue;
            }
            if ($c === $d[0] && substr($this->buf, $i, strlen($d)) === $d) {
                return $this->emit($start, $i, $i + strlen($d), $startLine);
            }
            if ($c === $d[0] && strlen($this->buf) - $i < strlen($d) && $this->more()) {
                continue;
            }
            if ($c === "'" || $c === '"' || $c === '`') {
                $i = $this->skipQuoted($i, $c);
                continue;
            }
            if ($c === '#') {
                $nl = $this->find("\n", $i);
                $i = $nl < 0 ? strlen($this->buf) : $nl;
                continue;
            }
            if ($c === '-') {
                $this->ensure($i - $this->pos + 3);
                if (($this->buf[$i + 1] ?? '') === '-' && $this->isDashComment($i)) {
                    $nl = $this->find("\n", $i);
                    $i = $nl < 0 ? strlen($this->buf) : $nl;
                    continue;
                }
                $i++;
                continue;
            }
            if ($c === '/') {
                $this->ensure($i - $this->pos + 2);
                if (($this->buf[$i + 1] ?? '') === '*') {
                    $end = $this->find('*/', $i + 2);
                    $i = $end < 0 ? strlen($this->buf) : $end + 2;
                    continue;
                }
                $i++;
                continue;
            }
            $i++; // first char of a multi-char delimiter that didn't match
        }
    }

    /** Index after the closing quote (or the end of the data). */
    private function skipQuoted(int $i, string $q): int
    {
        $j = $i + 1;
        $stops = $q === '`' ? '`' : $q . '\\';
        while (true) {
            $j += strcspn($this->buf, $stops, $j);
            if ($j >= strlen($this->buf)) {
                if ($this->more()) {
                    continue;
                }
                return strlen($this->buf);
            }
            if ($this->buf[$j] === '\\') {
                if ($j + 1 >= strlen($this->buf) && !$this->more()) {
                    return strlen($this->buf);
                }
                $j += 2;
                continue;
            }
            // Closing quote, or a doubled one ('' inside '...').
            if ($j + 1 >= strlen($this->buf)) {
                $this->more();
            }
            if (($this->buf[$j + 1] ?? '') === $q) {
                $j += 2;
                continue;
            }
            return $j + 1;
        }
    }

    /** @return array{sql:string, line:int} */
    private function emit(int $start, int $end, int $after, int $line): array
    {
        $sql = rtrim(substr($this->buf, $start, $end - $start));
        $this->advance($after);
        return ['sql' => $sql, 'line' => $line];
    }
}
