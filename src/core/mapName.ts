// Name for a map the user didn't name: short, readable, and unlikely to collide,
// e.g. "Map k3v9". Letters and digits only, skipping look-alikes (0/o, 1/l/i).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function randomMapName(random: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < 4; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `Map ${id}`;
}
