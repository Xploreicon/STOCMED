import { describe, expect, it } from 'vitest';
import {
  isPcnNumberFormatValid,
  normalizePcnNumber,
} from '@/lib/validation/pcn';

describe('PCN premises-number format validation', () => {
  it('normalizes surrounding whitespace without changing leading zeroes', () => {
    expect(normalizePcnNumber('  0023841  ')).toBe('0023841');
  });

  it.each([
    '009855',
    '0023841',
    '8222521',
    '000210810',
  ])('accepts live-compatible numeric values: %s', (value) => {
    expect(isPcnNumberFormatValid(value)).toBe(true);
  });

  it.each([
    '',
    '123',
    '1234',
    '12345',
    '0002108100',
    'PCN-001234',
    'AB1234',
    '12 3456',
    '123/456',
  ])('rejects arbitrary or malformed values: %s', (value) => {
    expect(isPcnNumberFormatValid(value)).toBe(false);
  });
});
