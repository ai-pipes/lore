/** Postgres prints timestamptz as `2026-10-31 09:53:31.418641+00`; clients get ISO-8601 UTC. */
export function isoTimestamp(timestamp: string): string;
export function isoTimestamp(timestamp: string | null): string | null;
export function isoTimestamp(timestamp: string | null): string | null {
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

/** `row` with its `key` timestamp in ISO-8601 UTC. */
export function withIso<T, K extends keyof T>(row: T, key: K): T {
  return { ...row, [key]: isoTimestamp(row[key] as string | null) };
}
