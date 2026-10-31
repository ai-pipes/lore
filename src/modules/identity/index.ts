/** Public API of the identity module: users, web sessions, tokens, password sign-in and the admin key. */
export { extractToken } from './interfaces/http/bearer.js';
export { identityRoutes, unauthenticated, type IdentityRouteOptions } from './interfaces/http/auth-routes.js';
export {
  SESSION_COOKIE,
  clearedSessionCookie,
  parseCookies,
  sessionCookie,
  sessionIdFromCookies,
} from './interfaces/http/session-cookie.js';
export { tokenRoutes, type TokenRouteOptions } from './interfaces/http/token-routes.js';
export { userRoutes } from './interfaces/http/user-routes.js';
export { renderAccountPage, renderCliLoginPage, type AccountPage } from './interfaces/web/pages.js';
export { cliLoginRoutes, type CliLoginRouteOptions } from './interfaces/http/cli-login-routes.js';
export { ACCOUNT_CSS, ACCOUNT_JS } from './interfaces/web/account-assets.js';
export { logout, passwordLogin, startSession, unlockLogin } from './application/sessions.js';
export { authenticateBearer, authenticateSession } from './application/authenticate.js';
export { bootstrapAdmin } from './application/bootstrap.js';
export { createUser, DISPLAY_NAME_MAX_LENGTH, listUsers, resetPassword, updateUser } from './application/users.js';
export { createToken, listTokens, mcpAddCommand, revokeToken, TOKEN_NAME_MAX_LENGTH } from './application/tokens.js';
export { completeSsoLogin, linkSso, startSsoLogin, unlinkSso } from './application/oidc-login.js';
export { decideDeviceLogin, describeDeviceLogin, pollDeviceLogin, startDeviceLogin } from './application/device-login.js';
export {
  DEVICE_LOGIN_TTL_MS,
  POLL_INTERVAL_SEC,
  USER_CODE_ALPHABET,
  formatUserCode,
  normalizeHostname,
  normalizeUserCode,
  pollOutcome,
  type DeviceStatus,
} from './domain/device-login.js';

export {
  accessFor,
  checkPassword,
  IdentityError,
  isInteractiveAdmin,
  MAX_PASSWORD_LENGTH,
  normalizeLogin,
  type GroupPolicy,
  type IdentityErrorCode,
  type OidcClaims,
  type Principal,
  type Role,
  type User,
} from './domain/user.js';
export {
  isLoginStateExpired,
  loginBase,
  loginCandidate,
  loginStateExpiry,
  MAX_LOGIN_LENGTH,
  normalizeReturnTo,
} from './domain/login-flow.js';
export {
  cliTokenExpiry,
  DEFAULT_CLI_TOKEN_TTL_DAYS,
  isTokenExpired,
  MAX_CLI_TOKEN_TTL_DAYS,
} from './domain/token-policy.js';
export {
  DEFAULT_SSO_SESSION_MAX_HOURS,
  MAX_SSO_SESSION_MAX_HOURS,
  KNOWN_DEVICE_TTL_MS,
  knownDeviceExpiry,
  SESSION_REFRESH_AFTER_MS,
  SESSION_TTL_MS,
  sessionExpiry,
  sessionNeedsRefresh,
} from './domain/session-policy.js';
export type { SignInMethod } from './domain/session-policy.js';
export type {
  ApiTokenRecord,
  ConcurrencyLimiter,
  DeviceLoginRecord,
  DeviceLoginRepository,
  IdentityDeps,
  NewUser,
  OidcProvider,
  PasswordHasher,
  PendingLogin,
  PendingLoginRepository,
  RateLimiter,
  Secrets,
  SessionRepository,
  SignInKeys,
  SsoDeps,
  TokenRepository,
  UserPatch,
  UserRepository,
} from './application/ports.js';
export { createPgIdentity, type IdentityConfig } from './infrastructure/compose.js';
export { normalizeScopes, OIDC_REQUIRED, ssoConfigFromEnv, type SsoConfig } from './infrastructure/sso-config.js';
