// Name for a map the user didn't name: short, readable, and unlikely to collide,
// e.g. "Map k3v9". Letters and digits only, skipping look-alikes (0/o, 1/l/i).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function randomMapName(random: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < 4; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `Map ${id}`;
}

// Short id of a shared map, derived from its bytes: sharing the same map again gives the same
// link and stores nothing new. 8 characters of a 31-letter alphabet ≈ 8.5 × 10¹¹ ids.
export async function contentId(bytes: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash.subarray(0, 8), (b) => ALPHABET[b % ALPHABET.length]).join('');
}
