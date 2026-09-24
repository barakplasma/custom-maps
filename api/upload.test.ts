import { describe, expect, it } from 'vitest';
import { LIMITS, quotaProblem } from './upload';

const MB = 1024 * 1024;
const now = Date.parse('2026-09-24T12:00:00Z');
const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000);

describe('quotaProblem', () => {
  it('allows uploads while under both caps', () => {
    expect(quotaProblem([], now)).toBeNull();
    expect(quotaProblem([{ size: 100 * MB, uploadedAt: daysAgo(1) }], now)).toBeNull();
  });

  it('refuses once another max-size map would not fit in storage', () => {
    const full = [{ size: LIMITS.storageBytes - LIMITS.fileBytes + 1, uploadedAt: daysAgo(90) }];
    expect(quotaProblem(full, now)).toBe('Link sharing is full');
  });

  it('counts only the last 30 days of uploads', () => {
    const recent = Array.from({ length: LIMITS.uploadsPer30Days }, () => ({ size: 1, uploadedAt: daysAgo(29) }));
    expect(quotaProblem(recent, now)).toBe('Link sharing has reached its monthly limit');
    const old = recent.map((b) => ({ ...b, uploadedAt: daysAgo(31) }));
    expect(quotaProblem(old, now)).toBeNull();
  });
});
