export function createMathRandomRng() {
  return { next: () => Math.random() };
}

export function createSeededRng(seed = 1) {
  let value = seed >>> 0;
  return { next() { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; } };
}
