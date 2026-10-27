// Fii Studio — bench interne temporaire (logique dans handler.mjs).
import { makeHandler } from './handler.mjs';

const digest = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
  .map((b) => b.toString(16).padStart(2, '0')).join('');
// Empreinte SHA-256 du jeton de la session de bench du 27/10/2026 (le jeton lui-même n'est écrit nulle part ; une empreinte
// d'un jeton aléatoire de 256 bits ne permet pas de le retrouver).
const NONCE_SHA = '62bdc88d44e8eff83482eeb83e4440a8bf44444b60219e784b2fd2f9c924fe66';
Deno.serve(makeHandler({ env: (k: string) => (k === 'BENCH_NONCE_SHA256' ? NONCE_SHA : Deno.env.get(k)), fetch, digest }));
