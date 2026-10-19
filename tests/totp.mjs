// TOTP (RFC 6238 : SHA-1, 30 s, 6 chiffres) — pour l'émulation locale de Supabase Auth et les tests de double authentification.
import { createHmac, randomBytes } from 'node:crypto';
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newSecret() {
  const b = randomBytes(20); let bits = '', out = '';
  for (const x of b) bits += x.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHA[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function decode(secret) {
  let bits = '';
  for (const c of secret.replace(/[\s=]/g, '').toUpperCase()) { const v = ALPHA.indexOf(c); if (v < 0) throw new Error('base32'); bits += v.toString(2).padStart(5, '0'); }
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret, at = Date.now(), step = 0) {
  const counter = Math.floor(at / 1000 / 30) + step;
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, '0');
}
export function totpOk(secret, code) { return [-1, 0, 1].some((s) => totp(secret, Date.now(), s) === String(code)); }
