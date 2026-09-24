import { describe, expect, it } from 'vitest';
import { fromStored } from './MapStore';

const base = { id: 'a', name: 'Trail', createdAt: 1 };

describe('fromStored', () => {
  it('rebuilds a Blob from stored bytes', async () => {
    const rec = fromStored({ ...base, kmz: new Uint8Array([1, 2, 3]).buffer });
    expect(rec.kmzBlob.type).toBe('application/vnd.google-earth.kmz');
    expect([...new Uint8Array(await rec.kmzBlob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(rec).not.toHaveProperty('kmz');
  });

  it('still reads records saved by older versions as a Blob', async () => {
    const legacy = { ...base, kmzBlob: new Blob([new Uint8Array([9])]) } as never;
    const rec = fromStored(legacy);
    expect([...new Uint8Array(await rec.kmzBlob.arrayBuffer())]).toEqual([9]);
  });
});
