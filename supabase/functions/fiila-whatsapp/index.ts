// Fii La — le Manager Fii La Carrière sur WhatsApp. Déployée SANS vérification JWT : Meta appelle le webhook avec sa propre
// signature (contrôlée dans le module) ; l'action « push » de l'équipe vérifie elle-même la session.
import { makeHandler } from './handler.mjs';

Deno.serve(makeHandler({ env: (k: string) => Deno.env.get(k), fetch }));
