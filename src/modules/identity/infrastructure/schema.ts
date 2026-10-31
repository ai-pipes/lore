/** Drizzle tables of the identity module: users, web sessions, personal tokens, SSO and CLI login state. */
import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, timestamp, uuid, index, unique, check } from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    login: text('login').notNull().unique(),
    display_name: text('display_name').notNull(),
    role: text('role').notNull(),
    disabled: boolean('disabled').notNull().default(false),
    password_hash: text('password_hash'),
    oidc_iss: text('oidc_iss'),
    oidc_sub: text('oidc_sub'),
    email: text('email'),
    groups: text('groups').array().notNull().default(sql`'{}'`),
    last_login_at: timestamp('last_login_at', { mode: 'date', withTimezone: true }),
    created_at: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('users_oidc_subject_unique').on(t.oidc_iss, t.oidc_sub),
    check('users_role_check', sql`${t.role} in ('admin', 'member')`),
    check('users_oidc_subject_check', sql`(${t.oidc_iss} is null) = (${t.oidc_sub} is null)`),
  ],
);

export const web_sessions = pgTable(
  'web_sessions',
  {
    id_hash: text('id_hash').primaryKey(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    expires_at: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    last_seen_at: timestamp('last_seen_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    sign_in_method: text('sign_in_method').notNull().default('password'),
    absolute_expires_at: timestamp('absolute_expires_at', { mode: 'date', withTimezone: true }),
  },
  (t) => [index('idx_web_sessions_user').on(t.user_id)],
);

export const api_tokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    hash: text('hash').notNull().unique(),
    created_at: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    last_used_at: timestamp('last_used_at', { mode: 'date', withTimezone: true }),
    revoked_at: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
    expires_at: timestamp('expires_at', { mode: 'date', withTimezone: true }),
  },
  (t) => [index('idx_api_tokens_user').on(t.user_id)],
);

export const oidc_pending = pgTable('oidc_pending', {
  state: text('state').primaryKey(),
  code_verifier: text('code_verifier').notNull(),
  nonce: text('nonce').notNull(),
  return_to: text('return_to').notNull(),
  expires_at: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
});

export const cli_logins = pgTable(
  'cli_logins',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    device_code_hash: text('device_code_hash').notNull().unique(),
    user_code: text('user_code').notNull().unique(),
    hostname: text('hostname').notNull(),
    request_ip: text('request_ip').notNull(),
    status: text('status').notNull(),
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    expires_at: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
  },
  (t) => [
    index('idx_cli_logins_user').on(t.user_id),
    check('cli_logins_status_check', sql`${t.status} in ('pending', 'approved', 'denied', 'consumed')`),
  ],
);
