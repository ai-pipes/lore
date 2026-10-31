/** CLI device login — shared by the identity HTTP interface and the CLI. */
type Role = 'admin' | 'member';

export interface StartDeviceLoginRequest {
  hostname: string;
}

export interface StartDeviceLoginResponse {
  /** Secret of the CLI; sent back on every poll. Only its SHA-256 is stored. */
  device_code: string;
  /** Shown to the person, who approves the request by it: `BCDF-GHJK`. */
  user_code: string;
  /** `<public url>/cli/login` — opened in the browser, where the person types `user_code`. */
  verification_url: string;
  /** Seconds between polls. */
  interval: number;
  /** Seconds until the request expires. */
  expires_in: number;
}

export interface PollDeviceLoginRequest {
  device_code: string;
}

export type PollDeviceLoginResponse =
  | { status: 'pending' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'approved'; token: string; login: string; role: Role };

export interface DescribeDeviceLoginResponse {
  /** As reported by the CLI; nobody verified it. */
  hostname: string;
  /** The client address that started the request. */
  requested_ip: string;
  user_code: string;
  status: 'pending' | 'approved' | 'denied' | 'consumed';
}

export interface DecideDeviceLoginRequest {
  user_code: string;
  approve: boolean;
}
