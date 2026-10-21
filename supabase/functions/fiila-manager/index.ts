// Fii — Manager Fii Carrière (IA). Déployée avec vérification JWT : seule une personne connectée peut l'appeler ;
// le module vérifie ensuite qui elle est (ambassadeur du message, ou membre de l'équipe avec le droit « strategy »).
import { makeHandler } from './handler.mjs';

Deno.serve(makeHandler({ env: (k: string) => Deno.env.get(k), fetch }));
