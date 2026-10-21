// Fii — crochet « Send SMS » de Supabase Auth : codes de vérification envoyés par Africa's Talking.
// Déployée sans vérification JWT (Supabase Auth l'appelle avec une signature Standard Webhooks, contrôlée dans le module).
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { makeHandler } from './handler.mjs';

Deno.serve(makeHandler({ env: (k: string) => Deno.env.get(k), fetch, Webhook }));
