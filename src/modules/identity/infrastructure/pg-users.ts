import { asc, count, eq, and, sql } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import type { NewUser, UserPatch, UserRepository } from '../application/ports.js';
import type { Role, User } from '../domain/user.js';
import { users } from './schema.js';

type UserRow = typeof users.$inferSelect;

function toUser(r: UserRow): User {
  return {
    id: r.id,
    login: r.login,
    displayName: r.display_name,
    role: r.role as Role,
    disabled: r.disabled,
    passwordHash: r.password_hash,
    oidcIss: r.oidc_iss,
    oidcSub: r.oidc_sub,
    email: r.email,
    groups: r.groups,
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
  };
}

function toRow(u: NewUser): typeof users.$inferInsert {
  return {
    login: u.login,
    display_name: u.displayName,
    role: u.role,
    password_hash: u.passwordHash ?? null,
    oidc_iss: u.oidcIss ?? null,
    oidc_sub: u.oidcSub ?? null,
    email: u.email ?? null,
    groups: u.groups ?? [],
  };
}

function toPatch(p: UserPatch): Partial<typeof users.$inferInsert> {
  const out: Partial<typeof users.$inferInsert> = {};
  if (p.login !== undefined) out.login = p.login;
  if (p.displayName !== undefined) out.display_name = p.displayName;
  if (p.role !== undefined) out.role = p.role;
  if (p.disabled !== undefined) out.disabled = p.disabled;
  if (p.passwordHash !== undefined) out.password_hash = p.passwordHash;
  if (p.oidcIss !== undefined) out.oidc_iss = p.oidcIss;
  if (p.oidcSub !== undefined) out.oidc_sub = p.oidcSub;
  if (p.email !== undefined) out.email = p.email;
  if (p.groups !== undefined) out.groups = p.groups;
  if (p.lastLoginAt !== undefined) out.last_login_at = p.lastLoginAt;
  return out;
}

/** Ids come from URLs: anything that is not a UUID is simply unknown (not a Postgres cast error). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Arbitrary constant for the advisory lock that serialises first-user creation. */
const FIRST_USER_LOCK = 0x4c6f7265; // "Lore"

/** Users in Postgres. Unique violations (login, OIDC subject) yield null; check violations throw. */
export const pgUserRepository: UserRepository = {
  async insert(u) {
    const rows = await getDb().insert(users).values(toRow(u)).onConflictDoNothing().returning();
    return rows[0] ? toUser(rows[0]) : null;
  },

  async findById(id) {
    if (!UUID_RE.test(id)) return null;
    const rows = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? toUser(rows[0]) : null;
  },

  async findByLogin(login) {
    const rows = await getDb().select().from(users).where(eq(users.login, login)).limit(1);
    return rows[0] ? toUser(rows[0]) : null;
  },

  async findBySubject(iss, sub) {
    const rows = await getDb()
      .select()
      .from(users)
      .where(and(eq(users.oidc_iss, iss), eq(users.oidc_sub, sub)))
      .limit(1);
    return rows[0] ? toUser(rows[0]) : null;
  },

  async list() {
    const rows = await getDb().select().from(users).orderBy(asc(users.login));
    return rows.map(toUser);
  },

  async count() {
    const rows = await getDb().select({ n: count() }).from(users);
    return Number(rows[0]?.n ?? 0);
  },

  async insertIfEmpty(u) {
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${FIRST_USER_LOCK})`);
      const existing = await tx.select({ id: users.id }).from(users).limit(1);
      if (existing.length > 0) return null;
      const rows = await tx.insert(users).values(toRow(u)).onConflictDoNothing().returning();
      return rows[0] ? toUser(rows[0]) : null;
    });
  },

  async update(id, patch) {
    if (!UUID_RE.test(id)) return null;
    const set = toPatch(patch);
    if (Object.keys(set).length === 0) return pgUserRepository.findById(id);
    const rows = await getDb().update(users).set(set).where(eq(users.id, id)).returning();
    return rows[0] ? toUser(rows[0]) : null;
  },
};
