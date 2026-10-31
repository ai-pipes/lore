/** Users administration (admins) — shared by the identity HTTP interface and the CLI. */
export type UserRole = 'admin' | 'member';

export interface UserSummary {
  id: string;
  login: string;
  display_name: string;
  role: UserRole;
  disabled: boolean;
  /** Linked to a single sign-on account. */
  sso: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface CreateUserRequest {
  login: string;
  /** Blank = the login. */
  display_name?: string;
  /** At least 12 characters. */
  password: string;
  role: UserRole;
}

export interface UpdateUserRequest {
  display_name?: string;
  role?: UserRole;
  disabled?: boolean;
}

export interface ResetPasswordRequest {
  password: string;
}
