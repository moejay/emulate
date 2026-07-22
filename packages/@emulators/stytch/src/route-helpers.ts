import type { Context } from "@emulators/core";
import type { AppEnv, ContentfulStatusCode, Store } from "@emulators/core";
import { renderErrorPage } from "@emulators/core";
import { defaultCredentials, matchServerAuthorization, requestId } from "./helpers.js";
import { getStytchConfig } from "./store.js";

const SERVICE_LABEL = "Stytch";

export function stytchError(
  c: Context<AppEnv>,
  status: number,
  errorType: string,
  errorMessage: string,
  extras: Record<string, unknown> = {},
): Response {
  return c.json(
    {
      request_id: requestId(),
      status_code: status,
      error_type: errorType,
      error_message: errorMessage,
      error_url: `https://stytch.com/docs/b2b/api/errors/${errorType}`,
      ...extras,
    },
    status as ContentfulStatusCode,
  );
}

export function requireServerAuth(c: Context<AppEnv>, store: Store): Response | true {
  if (matchServerAuthorization(c, store)) return true;
  return stytchError(c, 401, "unauthorized_credentials", "Invalid project credentials.");
}

export function readJsonBody<T extends Record<string, unknown>>(c: Context<AppEnv>): Promise<T> {
  return c.req
    .json()
    .then((body) => (body && typeof body === "object" ? (body as T) : ({} as T)))
    .catch(() => ({} as T));
}

export function renderInvalidPublicToken(message: string): Response {
  return new Response(renderErrorPage("Invalid public token", message, SERVICE_LABEL), {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function publicTokenMatches(store: Store, candidate: string | undefined): boolean {
  const config = getStytchConfig(store) ?? defaultCredentials();
  return candidate === config.public_token;
}

export function success<T extends Record<string, unknown>>(payload: T, status = 200): T & {
  request_id: string;
  status_code: number;
} {
  return {
    request_id: requestId(),
    status_code: status,
    ...payload,
  };
}
