/** Small seeded PRNG so procedural decoration is identical on every load. */
export function seededRandom(seedText: string): () => number {
  let a = 0;
  for (let i = 0; i < seedText.length; i++) a = (a * 31 + seedText.charCodeAt(i)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
