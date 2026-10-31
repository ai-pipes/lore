import { createPgCatalog, type CatalogDeps } from '../modules/catalog/index.js';
import { createPgChat, insightsLibraryId, type ChatDeps } from '../modules/chat/index.js';
import { createLanguageModel } from '../modules/llm/index.js';
import { createPgIdentity, ssoConfigFromEnv, type IdentityDeps, type SsoConfig } from '../modules/identity/index.js';
import { createSearch, type SearchDeps } from '../modules/search/index.js';
import { cliTokenTtlDaysFromEnv, ssoSessionMaxHoursFromEnv } from './config.js';
import { cookieSecureFromEnv } from './http/cookies.js';

/** All module dependencies, built once per server (rate limiters are per container). */
export interface Container {
  catalog: CatalogDeps;
  search: SearchDeps;
  chat: ChatDeps;
  identity: IdentityDeps;
  /** `LORE_COOKIE_SECURE=true`: cookies are `Secure` even on plain-http requests (TLS proxy). */
  cookieSecure: boolean;
}

export interface ContainerOverrides {
  /** Single sign-on settings instead of the ones from `env` (null = password mode). */
  sso?: SsoConfig | null;
  /** Where the identity module's provider warnings go. */
  logger?: { warn(fields: object, msg: string): void };
}

export function buildContainer(env: Record<string, string | undefined> = process.env, o: ContainerOverrides = {}): Container {
  const llm = createLanguageModel(env);
  // The insights library is written by the chat module only: reserved for every push.
  const catalog = createPgCatalog({ reservedLibraryIds: [insightsLibraryId(env)], llm });
  const search = createSearch(catalog, llm, env);
  return {
    catalog,
    search,
    chat: createPgChat(catalog, search, llm),
    identity: createPgIdentity({
      adminKey: env.LORE_API_KEY || undefined,
      deviceCookieSecret: env.LORE_DEVICE_COOKIE_SECRET || undefined,
      cliTokenTtlDays: cliTokenTtlDaysFromEnv(env),
      ssoSessionMaxHours: ssoSessionMaxHoursFromEnv(env),
      sso: o.sso !== undefined ? o.sso : ssoConfigFromEnv(env),
      ...(o.logger ? { logger: o.logger } : {}),
    }),
    cookieSecure: cookieSecureFromEnv(env),
  };
}
