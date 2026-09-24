import { describe, expect, it } from 'vitest';
import { randomMapName } from './mapName';

describe('randomMapName', () => {
  it('is "Map" plus a 4-character id without look-alike characters', () => {
    for (let i = 0; i < 200; i++) expect(randomMapName()).toMatch(/^Map [a-hj-km-np-z2-9]{4}$/);
  });

  it('varies between calls', () => {
    expect(new Set(Array.from({ length: 50 }, () => randomMapName())).size).toBeGreaterThan(45);
  });
});
