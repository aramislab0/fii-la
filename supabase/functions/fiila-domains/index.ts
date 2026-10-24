// Fii — domaine propre d'une boutique (Cloudflare for SaaS). Logique dans handler.mjs (testée sous Node).
import { makeHandler } from './handler.mjs';

Deno.serve(makeHandler({ env: (k: string) => Deno.env.get(k), fetch }));
