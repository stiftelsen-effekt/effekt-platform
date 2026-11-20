/**
 * Minimal wrapper around the native fetch, replacing request-promise-native.
 *
 * Mirrors the request-promise behaviour the API relied on:
 * - `json: data` sends `data` as a JSON body (content-type and accept set to application/json
 *   unless given) and resolves with the parsed response body (the raw text if it is not JSON,
 *   undefined if it is empty).
 * - Otherwise `body` is sent as is and the response body resolves as text ("" if empty).
 * - Non-2xx responses reject with HttpStatusError (statusCode, body). Network errors reject
 *   with fetch's own error.
 *
 * HttpStatusError never holds the request headers or body, only the method and URL, so it is
 * safe to log (credentials such as Authorization or client_secret travel in headers).
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HttpRequestOptions = {
  method: HttpMethod;
  headers?: Record<string, string>;
  /** Sent as a JSON body; the response is parsed as JSON */
  json?: unknown;
  /** Sent as is; the response resolves as text */
  body?: string;
  /** Aborts the request after this many milliseconds. No timeout if omitted. */
  timeoutMs?: number;
};

export class HttpStatusError extends Error {
  readonly statusCode: number;
  /** The response body, parsed as JSON when possible */
  readonly body: unknown;
  /** The request, without headers or body */
  readonly request: { method: HttpMethod; url: string };

  constructor(statusCode: number, body: unknown, request: { method: HttpMethod; url: string }) {
    // Same message format as request-promise's StatusCodeError
    super(`${statusCode} - ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.name = "HttpStatusError";
    this.statusCode = statusCode;
    this.body = body;
    this.request = request;
  }
}

const parseJsonOr = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const hasHeader = (headers: Record<string, string>, name: string) =>
  Object.keys(headers).some((key) => key.toLowerCase() === name);

export async function httpRequest<T = any>(url: string, options: HttpRequestOptions): Promise<T> {
  const { method, timeoutMs } = options;
  const jsonMode = options.json !== undefined;
  const headers = { ...options.headers };
  let body: string | undefined = options.body;

  if (jsonMode) {
    if (!hasHeader(headers, "accept")) headers["accept"] = "application/json";
    if (!hasHeader(headers, "content-type")) headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined,
  });

  const text = await response.text();

  if (!response.ok) {
    const errorBody = text === "" ? undefined : parseJsonOr(text);
    throw new HttpStatusError(response.status, errorBody, { method, url });
  }

  if (!jsonMode) return text as T;
  return (text === "" ? undefined : parseJsonOr(text)) as T;
}
