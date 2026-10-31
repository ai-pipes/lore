/** Started single sign-on attempts in Postgres (`oidc_pending`), ported from ai-pipes/skills-registry. */
import { eq, lte } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import type { PendingLoginRepository } from '../application/ports.js';
import { oidc_pending } from './schema.js';

export const pgPendingLoginRepository: PendingLoginRepository = {
  async insert(p) {
    const db = getDb();
    // Expired attempts are dropped here, so the table never needs a separate sweeper.
    await db.delete(oidc_pending).where(lte(oidc_pending.expires_at, new Date()));
    await db.insert(oidc_pending).values({
      state: p.state,
      code_verifier: p.codeVerifier,
      nonce: p.nonce,
      return_to: p.returnTo,
      expires_at: p.expiresAt,
    });
  },

  async consume(state) {
    // Deleting and returning in one statement: a state is used exactly once, even when raced.
    const rows = await getDb().delete(oidc_pending).where(eq(oidc_pending.state, state)).returning();
    const r = rows[0];
    return r
      ? { state: r.state, codeVerifier: r.code_verifier, nonce: r.nonce, returnTo: r.return_to, expiresAt: r.expires_at }
      : null;
  },
};
