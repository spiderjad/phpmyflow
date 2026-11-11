import { describe, expect, it } from 'vitest';
import { formatBytes } from '../bytes';

describe('formatBytes', () => {
  it.each([
    [0, 'en', '0 B'],
    [null, 'en', '0 B'],
    [512, 'en', '512 B'],
    [16384, 'en', '16 KB'],
    [1536 * 1024, 'en', '1.5 MB'],
    [1536 * 1024, 'es', '1,5 MB'],
    [2228224, 'fr', '2,13 MB'],
    [250 * 1024 ** 3, 'it', '250 GB'],
  ])('%s bytes in %s -> %s', (bytes, locale, expected) => {
    expect(formatBytes(bytes as number | null, locale).replace(/ | /g, ' ')).toBe(expected);
  });
});
