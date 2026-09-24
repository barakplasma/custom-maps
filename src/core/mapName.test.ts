import { describe, expect, it } from 'vitest';
import { contentId, randomMapName } from './mapName';

describe('randomMapName', () => {
  it('is "Map" plus a 4-character id without look-alike characters', () => {
    for (let i = 0; i < 200; i++) expect(randomMapName()).toMatch(/^Map [a-hj-km-np-z2-9]{4}$/);
  });

  it('varies between calls', () => {
    expect(new Set(Array.from({ length: 50 }, () => randomMapName())).size).toBeGreaterThan(45);
  });
});

describe('contentId', () => {
  const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

  it('is 8 characters from the same alphabet, the same for the same content', async () => {
    const id = await contentId(bytes('a map'));
    expect(id).toMatch(/^[a-hj-km-np-z2-9]{8}$/);
    expect(await contentId(bytes('a map'))).toBe(id);
  });

  it('differs for different content', async () => {
    expect(await contentId(bytes('a map'))).not.toBe(await contentId(bytes('another map')));
  });
});
