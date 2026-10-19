// Passe la double authentification du back-office dans un test navigateur, comme un membre de l'équipe :
// première fois, lit la clé affichée et saisit le premier code ; ensuite, saisit le code avec la clé gardée.
import { totp } from './totp.mjs';
const SECRETS = new Map();
export async function passMfa(page, email) {
  await page.locator('#bo-mfa').waitFor();
  const enroll = page.locator('#bo-mfa-secret');
  if (await enroll.count()) SECRETS.set(email, (await enroll.textContent()).replace(/\s/g, ''));
  const secret = SECRETS.get(email);
  if (!secret) throw new Error('aucune clé de double authentification connue pour ' + email);
  await page.fill('#bo-mfa-code', totp(secret));
  await page.click('#bo-mfa-ok');
  await page.locator('#bo-mfa').waitFor({ state: 'detached' });
}
export function mfaCode(email) { return totp(SECRETS.get(email)); }
