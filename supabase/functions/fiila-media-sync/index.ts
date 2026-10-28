// Fii — copie des photos publiques vers Supabase Storage. Déployée SANS vérification JWT par la passerelle : le module exige
// lui-même le jeton de pg_cron (x-sync-token) ou la session d'un membre de l'équipe (sinon 401).
// Miniatures : codec JPEG en JavaScript pur (jpeg-js 0.4.4, BSD-3, sans dépendance ni WebAssembly), version figée.
import jpeg from 'npm:jpeg-js@0.4.4';
import { makeHandler } from './handler.mjs';
import { makeThumb } from './thumb.mjs';

Deno.serve(makeHandler({ env: (k: string) => Deno.env.get(k), fetch, thumb: makeThumb(jpeg) }));
