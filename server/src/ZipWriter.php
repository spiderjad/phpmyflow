<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * ZIP (stored, no compression) written into a job's output file across
 * several requests: no ZipArchive or zlib needed. Each entry's local header
 * is written with zero CRC/size and patched when the entry ends (the file is
 * seekable). The running CRC is kept between requests in the state array
 * (a serialized crc32b hash context). Limit: 4 GB per entry and file.
 *
 * State: ['entries' => [{name, crc, size, offset}], 'cur' => null|{name, offset, size, ctx}]
 */
final class ZipWriter
{
    /** @var resource */
    private $fh;
    private array $s;
    private ?\HashContext $ctx = null;
    private int $time;
    private int $date;

    /** @param resource $fh output file, positioned at its end */
    public function __construct($fh, array $state)
    {
        $this->fh = $fh;
        $this->s = $state + ['entries' => [], 'cur' => null];
        if ($this->s['cur']) {
            $this->ctx = unserialize(base64_decode($this->s['cur']['ctx']), ['allowed_classes' => [\HashContext::class]]);
        }
        $t = getdate();
        $this->time = ($t['hours'] << 11) | ($t['minutes'] << 5) | intdiv($t['seconds'], 2);
        $this->date = (($t['year'] - 1980) << 9) | ($t['mon'] << 5) | $t['mday'];
    }

    public function inEntry(): bool
    {
        return $this->s['cur'] !== null;
    }

    public function begin(string $name): void
    {
        if ($this->s['cur']) {
            $this->end();
        }
        $offset = ftell($this->fh);
        // Version 20, flag 0x0800 = UTF-8 names, method 0 = stored; CRC and sizes patched in end().
        fwrite($this->fh, pack('VvvvvvVVVvv', 0x04034b50, 20, 0x0800, 0, $this->time, $this->date, 0, 0, 0, strlen($name), 0) . $name);
        $this->ctx = hash_init('crc32b');
        $this->s['cur'] = ['name' => $name, 'offset' => $offset, 'size' => 0, 'ctx' => ''];
    }

    public function write(string $data): void
    {
        if ($data === '') {
            return;
        }
        fwrite($this->fh, $data);
        hash_update($this->ctx, $data);
        $this->s['cur']['size'] += strlen($data);
        if ($this->s['cur']['size'] > 0xFFFFFFFF) {
            throw new ApiError('export_too_big', 'A file inside the ZIP is over 4 GB', 413);
        }
    }

    public function end(): void
    {
        $c = $this->s['cur'];
        if (!$c) {
            return;
        }
        $crc = (int) hexdec(hash_final($this->ctx));
        $end = ftell($this->fh);
        fseek($this->fh, $c['offset'] + 14);
        fwrite($this->fh, pack('VVV', $crc, $c['size'], $c['size']));
        fseek($this->fh, $end);
        $this->s['entries'][] = ['name' => $c['name'], 'crc' => $crc, 'size' => $c['size'], 'offset' => $c['offset']];
        $this->s['cur'] = null;
        $this->ctx = null;
    }

    /** Central directory + end record. */
    public function finish(): void
    {
        $this->end();
        $start = ftell($this->fh);
        $cd = '';
        foreach ($this->s['entries'] as $e) {
            $cd .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0x0800, 0, $this->time, $this->date, $e['crc'], $e['size'], $e['size'], strlen($e['name']), 0, 0, 0, 0, 0, $e['offset']) . $e['name'];
        }
        $n = count($this->s['entries']);
        fwrite($this->fh, $cd . pack('VvvvvVVv', 0x06054b50, 0, 0, $n, $n, strlen($cd), $start, 0));
    }

    /** State to save (with the running CRC) after the output was flushed. */
    public function state(): array
    {
        $s = $this->s;
        if ($s['cur'] && $this->ctx) {
            $s['cur']['ctx'] = base64_encode(serialize($this->ctx));
        }
        return $s;
    }
}
