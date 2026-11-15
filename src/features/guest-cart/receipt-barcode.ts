/** The thank-you receipt's decorative barcode, drawn on the server from the order number. */
function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/gu, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function receiptBarcodeSvg(code: string): string {
  const clean = escapeText(String(code || "DINKUS-0000").toUpperCase());
  const bars: string[] = [];
  let x = 8;
  bars.push(`<rect x="${x}" y="4" width="2" height="34" fill="currentColor"/>`);
  x += 4;
  bars.push(`<rect x="${x}" y="4" width="1" height="34" fill="currentColor"/>`);
  x += 3;
  for (let i = 0; i < clean.length; i += 1) {
    const h = fnv1aHash(`${clean}:${i}`);
    for (let b = 0; b < 4; b += 1) {
      const w = ((h >>> (b * 4)) & 3) + 1;
      const gap = ((h >>> (b * 4 + 2)) & 2) + 1;
      bars.push(`<rect x="${x}" y="4" width="${w}" height="30" fill="currentColor"/>`);
      x += w + gap;
    }
  }
  bars.push(`<rect x="${x}" y="4" width="1" height="34" fill="currentColor"/>`);
  x += 3;
  bars.push(`<rect x="${x}" y="4" width="2" height="34" fill="currentColor"/>`);
  const totalW = x + 10;
  return `<svg class="ephemera-barcode-svg" viewBox="0 0 ${totalW} 48" width="100%" height="44" role="img" aria-label="Order barcode ${clean}">${bars.join("")}<text x="${totalW / 2}" y="45" text-anchor="middle" font-size="8.5" font-family="var(--font-mono, monospace)" letter-spacing="2.2" fill="currentColor">${clean}</text></svg>`;
}
