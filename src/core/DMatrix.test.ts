import { describe, expect, it } from 'vitest';
import { DMatrix } from './DMatrix';

function map(m: DMatrix, x: number, y: number): [number, number] {
  const out = [0, 0];
  m.mapPoints(out, [x, y]);
  return [out[0], out[1]];
}

describe('DMatrix', () => {
  it('starts as identity', () => {
    const m = new DMatrix();
    expect(m.isIdentity()).toBe(true);
    expect(map(m, 3, 4)).toEqual([3, 4]);
  });

  it('inverts a translation', () => {
    const m = new DMatrix();
    m.setTranslate(10, -5);
    const inv = new DMatrix();
    expect(m.invert(inv)).toBe(true);
    expect(map(inv, 10, -5)).toEqual([0, 0]);
  });

  it('refuses to invert a singular matrix', () => {
    const m = new DMatrix();
    m.setValues([1, 2, 0, 2, 4, 0, 0, 0, 1]);
    expect(m.invert(new DMatrix())).toBe(false);
  });

  it('M · M⁻¹ = I for a general affine matrix', () => {
    const m = new DMatrix();
    m.setValues([2, 0.5, 7, -0.3, 1.5, -2, 0, 0, 1]);
    const inv = new DMatrix();
    expect(m.invert(inv)).toBe(true);
    const prod = new DMatrix();
    prod.setConcat(m, inv);
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    prod.getValues().forEach((v, i) => expect(v).toBeCloseTo(identity[i], 12));
  });

  it.each([2, 3])('setPolyToPoly maps %i source points onto destination points', (count) => {
    const src = [0, 0, 100, 0, 0, 50].slice(0, count * 2);
    const dst = [34.1, 31.2, 34.2, 31.2, 34.1, 31.15].slice(0, count * 2);
    const m = new DMatrix();
    expect(m.setPolyToPoly(src, dst, count)).toBe(true);
    for (let i = 0; i < count; i++) {
      const [x, y] = map(m, src[2 * i], src[2 * i + 1]);
      expect(x).toBeCloseTo(dst[2 * i], 10);
      expect(y).toBeCloseTo(dst[2 * i + 1], 10);
    }
  });
});
