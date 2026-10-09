import { expect, test } from '@playwright/test';
import { LIMITS, quotaProblem } from '../api/upload';

// The upload quota runs in the Vercel Function (api/upload.ts), which `vite preview` doesn't serve,
// so no browser can reach it here; this checks the rule directly. It keeps link sharing inside the
// free Hobby plan — going over blocks Vercel Blob for 30 days and breaks every shared link.
// The browser side of a refusal is covered in sharelink.spec.ts.
const MB = 1024 * 1024;
const now = Date.parse('2026-09-24T12:00:00Z');
const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000);

test('allows uploads while under both caps', () => {
  expect(quotaProblem([], now)).toBeNull();
  expect(quotaProblem([{ size: 100 * MB, uploadedAt: daysAgo(1) }], now)).toBeNull();
});

test('refuses once another max-size map would not fit in storage', () => {
  const full = [{ size: LIMITS.storageBytes - LIMITS.fileBytes + 1, uploadedAt: daysAgo(90) }];
  expect(quotaProblem(full, now)).toBe('Link sharing is full');
});

test('counts only the last 30 days of uploads', () => {
  const recent = Array.from({ length: LIMITS.uploadsPer30Days }, () => ({ size: 1, uploadedAt: daysAgo(29) }));
  expect(quotaProblem(recent, now)).toBe('Link sharing has reached its monthly limit');
  const old = recent.map((b) => ({ ...b, uploadedAt: daysAgo(31) }));
  expect(quotaProblem(old, now)).toBeNull();
});
