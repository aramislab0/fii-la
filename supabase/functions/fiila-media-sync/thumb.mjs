// Fii — miniature JPEG d'une photo d'article (grilles de la vitrine, du fil et de la liste du commerçant), 28/10.
// Le codec JPEG est fourni par l'appelant (jpeg-js : npm:jpeg-js@0.4.4 sous Deno, paquet de développement sous Node), ce
// module reste sans dépendance. Réduction par moyenne de zone (deux passes, largeur puis hauteur) : net, sans crénelage,
// environ 80 ms pour une photo de 1280 px. Une photo plus petite que la limite est seulement réencodée.
export const THUMB_SIDE = 640;
export const THUMB_QUALITY = 74;

// Pixels RVBA (w × h) réduits à (tw × th) ; l'alpha est fixé à 255 (JPEG).
export function shrink(src, w, h, tw, th) {
  const tmp = new Float32Array(tw * h * 3), out = new Uint8Array(tw * th * 4);
  const sx = w / tw, sy = h / th;
  for (let x = 0; x < tw; x++) {
    const a = x * sx, b = a + sx, i0 = Math.floor(a), i1 = Math.min(Math.ceil(b), w);
    for (let y = 0; y < h; y++) {
      let r = 0, g = 0, bl = 0;
      for (let i = i0; i < i1; i++) {
        const wt = Math.min(b, i + 1) - Math.max(a, i), k = (y * w + i) * 4;
        r += src[k] * wt; g += src[k + 1] * wt; bl += src[k + 2] * wt;
      }
      const o = (y * tw + x) * 3;
      tmp[o] = r / sx; tmp[o + 1] = g / sx; tmp[o + 2] = bl / sx;
    }
  }
  for (let y = 0; y < th; y++) {
    const a = y * sy, b = a + sy, j0 = Math.floor(a), j1 = Math.min(Math.ceil(b), h);
    for (let x = 0; x < tw; x++) {
      let r = 0, g = 0, bl = 0;
      for (let j = j0; j < j1; j++) {
        const wt = Math.min(b, j + 1) - Math.max(a, j), k = (j * tw + x) * 3;
        r += tmp[k] * wt; g += tmp[k + 1] * wt; bl += tmp[k + 2] * wt;
      }
      const o = (y * tw + x) * 4;
      out[o] = Math.round(r / sy); out[o + 1] = Math.round(g / sy); out[o + 2] = Math.round(bl / sy); out[o + 3] = 255;
    }
  }
  return out;
}

// Fabrique la fonction miniature : octets JPEG → octets JPEG (exception si la photo est illisible).
export function makeThumb(jpeg, side = THUMB_SIDE, quality = THUMB_QUALITY) {
  return (bytes) => {
    const im = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256, maxResolutionInMP: 40 });
    const s = Math.min(1, side / Math.max(im.width, im.height));
    const tw = Math.max(1, Math.round(im.width * s)), th = Math.max(1, Math.round(im.height * s));
    const px = s < 1 ? shrink(im.data, im.width, im.height, tw, th) : im.data;
    return new Uint8Array(jpeg.encode({ data: px, width: tw, height: th }, quality).data);
  };
}
