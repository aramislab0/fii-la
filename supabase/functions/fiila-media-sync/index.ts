// Fii — copie des photos publiques vers Supabase Storage. Déployée SANS vérification JWT par la passerelle : le module exige
// lui-même le jeton de pg_cron (x-sync-token) ou la session d'un membre de l'équipe (sinon 401).
import { makeHandler } from './handler.mjs';

Deno.serve(makeHandler({ env: (k: string) => Deno.env.get(k), fetch }));
