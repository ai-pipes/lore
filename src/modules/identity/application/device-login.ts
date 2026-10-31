/**
 * CLI device login. The CLI starts a request and polls with its device code; a person signed in to
 * the web UI approves or denies it by its user code. The token is minted by the poll that finds the
 * request approved, in the same transaction that consumes it, so no plaintext token is ever stored
 * and a request issues at most one token.
 */
import { err, ok, type Result } from '../../../shared-kernel/index.js';
import type { PollDeviceLoginResponse, StartDeviceLoginResponse } from '../../../contracts/cli-login.js';
import {
  cliTokenName,
  DEVICE_LOGIN_TTL_MS,
  deviceLoginExpiry,
  isDeviceLoginExpired,
  normalizeHostname,
  normalizeUserCode,
  POLL_INTERVAL_SEC,
  pollOutcome,
  userCodeFromRandom,
  type DeviceStatus,
} from '../domain/device-login.js';
import { cliTokenExpiry } from '../domain/token-policy.js';
import { IdentityError } from '../domain/user.js';
import type { DeviceLoginRecord, IdentityDeps } from './ports.js';
import { newTokenSecret } from './tokens.js';

const MAX_CODE_ATTEMPTS = 5;
const alreadyDecided = () => err(new IdentityError('already_decided', 'this sign-in request was already answered'));

function newUserCode(d: IdentityDeps): string {
  // The digest of 32 random bytes: uniformly distributed, and never short of usable digits in practice.
  for (;;) {
    const code = userCodeFromRandom(d.secrets.sha256B64url(d.secrets.random('')));
    if (code) return code;
  }
}

/**
 * Starts a device login for the CLI on `hostname`. Counts against the client IP (30 per 600 s);
 * `baseUrl` is where the person opens the approval page (`PUBLIC_URL` or the request's origin).
 */
export async function startDeviceLogin(
  d: IdentityDeps,
  i: { hostname: string; ip: string; baseUrl: string },
): Promise<Result<StartDeviceLoginResponse, IdentityError>> {
  const limit = d.deviceStartLimiter.hit(i.ip);
  if (!limit.allowed) return err(new IdentityError('rate_limited', 'too many sign-in requests', limit.retryAfterSec));
  const hostname = normalizeHostname(i.hostname);
  if (hostname === null) {
    return err(new IdentityError('invalid_input', 'hostname must be 1-64 characters of A-Z, a-z, 0-9, ".", "_" and "-"'));
  }

  const now = d.clock.now();
  await d.deviceLogins.deleteExpired(now);
  const deviceCode = d.secrets.random('');
  const deviceCodeHash = d.secrets.sha256Hex(deviceCode);
  const expiresAt = deviceLoginExpiry(now);
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const userCode = newUserCode(d);
    if (await d.deviceLogins.insert({ deviceCodeHash, userCode, hostname, requestIp: i.ip, expiresAt })) {
      return ok({
        device_code: deviceCode,
        user_code: userCode,
        // No code in the link: the person types the code their terminal shows, so a link someone
        // else sends cannot carry a request into a one-click approval.
        verification_url: `${i.baseUrl.replace(/\/+$/, '')}/cli/login`,
        interval: POLL_INTERVAL_SEC,
        expires_in: DEVICE_LOGIN_TTL_MS / 1000,
      });
    }
  }
  throw new Error('could not allocate a unique user code');
}

async function findLive(d: IdentityDeps, rawUserCode: string): Promise<Result<DeviceLoginRecord, IdentityError>> {
  const userCode = normalizeUserCode(rawUserCode);
  const record = userCode === null ? null : await d.deviceLogins.findByUserCode(userCode);
  if (!record) return err(new IdentityError('not_found', 'unknown sign-in request'));
  if (isDeviceLoginExpired(record.expiresAt, d.clock.now())) {
    return err(new IdentityError('expired', 'this sign-in request has expired'));
  }
  return ok(record);
}

/** What the approval page shows: the hostname the CLI reported, the user code, the status and the requesting IP. */
export async function describeDeviceLogin(
  d: IdentityDeps,
  userCode: string,
): Promise<Result<{ hostname: string; user_code: string; status: DeviceStatus; requested_ip: string }, IdentityError>> {
  const r = await findLive(d, userCode);
  if (!r.ok) return r;
  return ok({ hostname: r.value.hostname, user_code: r.value.userCode, status: r.value.status, requested_ip: r.value.requestIp });
}

/** Approves or denies a pending, unexpired request as `userId`. A second decision is `already_decided`. */
export async function decideDeviceLogin(
  d: IdentityDeps,
  userId: string,
  userCode: string,
  approve: boolean,
): Promise<Result<void, IdentityError>> {
  const r = await findLive(d, userCode);
  if (!r.ok) return r;
  if (r.value.status !== 'pending') return alreadyDecided();
  // The conditional update decides concurrent approvals: only one of them wins.
  const won = await d.deviceLogins.decide(r.value.userCode, userId, approve ? 'approved' : 'denied', d.clock.now());
  return won ? ok(undefined) : alreadyDecided();
}

/**
 * One poll of the CLI. An unknown, consumed or expired request is `expired`. The poll that finds the
 * request approved mints a `cli-<hostname>` token (expiring after `cliTokenTtlDays`) for the approver and consumes the request in one
 * step; a concurrent or later poll gets `expired`. A disabled or deleted approver gets `denied`.
 */
export async function pollDeviceLogin(d: IdentityDeps, deviceCode: string): Promise<PollDeviceLoginResponse> {
  const record = await d.deviceLogins.findByDeviceCodeHash(d.secrets.sha256Hex(deviceCode));
  if (!record) return { status: 'expired' };
  const now = d.clock.now();
  const outcome = pollOutcome(record, now);
  if (outcome !== 'issue') return { status: outcome };

  const user = record.userId === null ? null : await d.users.findById(record.userId);
  if (!user || user.disabled) {
    // Denied for good, so enabling the approver again does not revive the request
    await d.deviceLogins.deny(record.id);
    return { status: 'denied' };
  }
  const { token, row } = newTokenSecret(d, cliTokenName(record.hostname));
  const issued = await d.deviceLogins.consumeAndIssueToken(
    record.id,
    { ...row, expiresAt: cliTokenExpiry(now, d.cliTokenTtlDays) },
    now,
  );
  if (!issued) return { status: 'expired' };
  return { status: 'approved', token, login: user.login, role: user.role };
}
