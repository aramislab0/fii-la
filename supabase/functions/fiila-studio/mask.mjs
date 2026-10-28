// Fii Studio — masque de FIBO 2.0 (28/10) à partir du détourage Bria RMBG (PNG avec transparence) :
// blanc = zone que FIBO refait (le décor), noir = produit gardé au pixel près (opacité du détourage ≥ 50 %).
// Module sans dépendance (Deno et Node) : PNG lu et écrit ici, compression par CompressionStream ('deflate' = zlib).
// PNG acceptés : 8 bits, sans entrelacement, RVBA (type 6) ou gris + alpha (type 4) — ce que renvoie le détourage.

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function pipe(bytes, stream) {
  const out = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  return out;
}
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

// Opacité (0–255) de chaque pixel d'un PNG RVBA ou gris + alpha.
export async function pngAlpha(png) {
  const b = png instanceof Uint8Array ? png : new Uint8Array(png);
  if (b.length < 33 || SIG.some((v, i) => b[i] !== v)) throw new Error('png_invalid');
  let w = 0, h = 0, type = -1, depth = 0, interlace = 0, i = 8;
  const idat = [];
  while (i + 8 <= b.length) {
    const len = u32(b, i), name = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]), data = b.subarray(i + 8, i + 8 + len);
    if (name === 'IHDR') { w = u32(data, 0); h = u32(data, 4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    i += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (type !== 6 && type !== 4) || !w || !h || w * h > 40e6) throw new Error('png_unsupported');
  const bpp = type === 6 ? 4 : 2, stride = w * bpp;
  const raw = await pipe(concat(idat), new DecompressionStream('deflate'));
  if (raw.length < h * (stride + 1)) throw new Error('png_invalid');
  const alpha = new Uint8Array(w * h), prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      else if (f !== 0) throw new Error('png_invalid');
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < w; x++) alpha[y * w + x] = cur[x * bpp + bpp - 1];
    prev.set(cur);
  }
  return { width: w, height: h, alpha };
}
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function chunk(name, data) {
  const out = new Uint8Array(12 + data.length), nm = new TextEncoder().encode(name);
  new DataView(out.buffer).setUint32(0, data.length); out.set(nm, 4); out.set(data, 8);
  new DataView(out.buffer).setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
// PNG en niveaux de gris 8 bits (une valeur par pixel).
export async function grayPng(width, height, px) {
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) raw.set(px.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 0;
  return concat([new Uint8Array(SIG), chunk('IHDR', ihdr), chunk('IDAT', await pipe(raw, new CompressionStream('deflate'))), chunk('IEND', new Uint8Array(0))]);
}
// Détourage (PNG) → masque FIBO (PNG) ; share = part de l'image occupée par le produit. Refus si le produit est absent ou
// occupe presque toute l'image (détourage raté : rien à protéger ou rien à refaire).
export async function maskFromCutout(png) {
  const { width, height, alpha } = await pngAlpha(png);
  const px = new Uint8Array(alpha.length); let kept = 0;
  for (let i = 0; i < alpha.length; i++) { if (alpha[i] >= 128) { kept++; px[i] = 0; } else px[i] = 255; }
  const share = kept / alpha.length;
  if (share < 0.01 || share > 0.97) throw new Error('mask_unusable');
  return { width, height, share, png: await grayPng(width, height, px) };
}
