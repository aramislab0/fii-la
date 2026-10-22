// Fii — copie des photos publiques vers Supabase Storage. Déployée SANS vérification JWT : appelée par pg_cron et par le
// back-office ; elle ne fait que vider une file d'attente idempotente et ne renvoie que des compteurs.
import { makeHandler } from './handler.mjs';

Deno.serve(makeHandler({ env: (k: string) => Deno.env.get(k), fetch }));
