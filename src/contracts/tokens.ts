/** Personal `sk_` tokens — shared by the identity HTTP interface and the CLI. */
export interface TokenSummary {
  id: string;
  name: string;
  /** The first characters of the token (`sk_…`), to tell tokens apart. */
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  /** Null: never expires. CLI sign-in tokens (`cli-<hostname>`) expire. */
  expires_at: string | null;
}

export interface CreateTokenRequest {
  /** 1-100 characters after trimming. */
  name: string;
}

/** The token itself is returned only here, once. */
export interface CreateTokenResponse extends TokenSummary {
  token: string;
  /** A ready `claude mcp add …` command with this token. */
  mcp_command: string;
}
