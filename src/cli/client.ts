/** HTTP client of the CLI. The CLI reaches the server over HTTP only. */

/** A non-2xx response. `body` is the raw response text. */
export class ApiError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${url} failed ${status}: ${body}`);
    this.name = 'ApiError';
  }
}

export interface ApiRequestInit {
  method?: string;
  /** Bearer token; omitted only for the public device-login routes. */
  token?: string;
  json?: unknown;
  form?: FormData;
}

/**
 * Sends `init.method` (default GET) to `baseUrl + path` with `Authorization: Bearer <token>` (when given),
 * a JSON body (`json`) or a multipart body (`form`). Returns the parsed JSON response, or
 * `undefined` for an empty body. Throws `ApiError` on a non-2xx status.
 */
export async function apiRequest<T>(baseUrl: string, path: string, init: ApiRequestInit): Promise<T> {
  const method = init.method ?? 'GET';
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.Authorization = `Bearer ${init.token}`;
  let body: string | FormData | undefined;
  if (init.form) {
    body = init.form;
  } else if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  if (!res.ok) throw new ApiError(method, url, res.status, text);
  return (text ? JSON.parse(text) : undefined) as T;
}
