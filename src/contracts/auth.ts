/** Sign-in and "who am I" — shared by the identity HTTP interface and the CLI. */
export interface LoginRequest {
  login: string;
  password: string;
}

export type MeResponse =
  | { kind: 'user'; login: string; display_name: string; role: 'admin' | 'member' }
  | { kind: 'admin-key'; role: 'admin' }
  | { kind: 'project'; namespace: string; key_name: string; library_id: string | null };

export interface AuthConfigResponse {
  method: 'password' | 'sso';
}

/** The `?loginError=` codes the single sign-on routes send the browser back to `/login` with. */
export type SsoLoginError = 'invalid_state' | 'not_allowed' | 'disabled' | 'idp_unavailable' | 'rate_limited' | 'internal';
