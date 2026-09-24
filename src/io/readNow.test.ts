import { describe, expect, it } from 'vitest';
import { readNow } from './readNow';

describe('readNow', () => {
  it('returns an in-memory copy, detached from the picked File', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'map.jpg', { type: 'image/jpeg' });
    const blob = await readNow(file);
    expect(blob).not.toBeInstanceOf(File);
    expect(blob.type).toBe('image/jpeg');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('surfaces an unreadable file immediately, at pick time', async () => {
    const file = new File([], 'gone.jpg');
    file.arrayBuffer = () => Promise.reject(new DOMException('revoked', 'NotReadableError'));
    await expect(readNow(file)).rejects.toThrow('revoked');
  });
});
