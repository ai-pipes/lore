import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/**
 * ASCII-only lowercase of a text expression, independent of the database collation (unlike
 * `lower()`): the SQL counterpart of `storageOwnerKey`.
 */
export function asciiLower(value: SQLWrapper | string): SQL {
  return sql`translate(${value}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')`;
}
