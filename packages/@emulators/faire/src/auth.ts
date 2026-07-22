import type { Context, Store } from "@emulators/core";
import { parseCookies } from "@emulators/core";
import { getFaireStore } from "./store.js";
import { makeFaireToken } from "./ids.js";
import type { FaireOAuthApp, FaireSession, FaireToken, FaireTokenType, FaireUser } from "./entities.js";

export interface PendingAuthCode {
  code: string;
  applicationToken: string;
  redirectUrl: string;
  scopes: string[];
  state: string;
  userId: string;
  brandId: string;
  createdAt: number;
}

export interface PendingMfaLink {
  iflt: string;
  iflc: string;
  userId: string;
  brandId: string;
  createdAt: number;
}

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const MFA_TTL_MS = 15 * 60 * 1000;

function getMap<V>(store: Store, key: string): Map<string, V> {
  let map = store.getData<Map<string, V>>(key);
  if (!map) {
    map = new Map();
    store.setData(key, map);
  }
  return map;
}

export function getPendingAuthCodes(store: Store): Map<string, PendingAuthCode> {
  return getMap<PendingAuthCode>(store, "faire.oauth.pendingCodes");
}

export function getPendingMfaLinks(store: Store): Map<string, PendingMfaLink> {
  return getMap<PendingMfaLink>(store, "faire.oauth.pendingMfaLinks");
}

export function normalizeScopes(value: string[] | string | undefined, fallback: string[] = []): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [...fallback];
}

export function createPendingMfaLink(store: Store, userId: string, brandId: string) {
  const iflt = makeFaireToken("iflt", 12);
  const iflc = makeFaireToken("iflc", 12);
  getPendingMfaLinks(store).set(`${iflt}:${iflc}`, {
    iflt,
    iflc,
    userId,
    brandId,
    createdAt: Date.now(),
  });
  return { iflt, iflc };
}

export function consumePendingMfaLink(store: Store, iflt: string, iflc: string): PendingMfaLink | undefined {
  const key = `${iflt}:${iflc}`;
  const map = getPendingMfaLinks(store);
  const record = map.get(key);
  if (!record) return undefined;
  map.delete(key);
  if (Date.now() - record.createdAt > MFA_TTL_MS) return undefined;
  return record;
}

export function createSessionTokenPayload(user: FaireUser, brandId: string) {
  return {
    sub: user.user_id,
    email: user.email,
    brand_token: brandId,
    e: [[brandId]],
    brand_ids: user.brand_ids,
  };
}

export function encodeSessionToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.emulate`;
}

export function decodeSessionToken(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createSession(store: Store, user: FaireUser, brandId: string): FaireSession {
  const sessionToken = encodeSessionToken(createSessionTokenPayload(user, brandId));
  const fs = getFaireStore(store);
  const existing = fs.sessions.findOneBy("session_token", sessionToken);
  if (existing) return existing;
  return fs.sessions.insert({
    session_token: sessionToken,
    user_id: user.user_id,
    current_brand_id: brandId,
    brand_ids: user.brand_ids,
    status: "active",
  });
}

export function issueToken(
  store: Store,
  input: {
    accessToken: string;
    tokenType: FaireTokenType;
    brandId: string;
    scopes: string[];
    applicationToken?: string;
    userId?: string;
  },
): FaireToken {
  const fs = getFaireStore(store);
  const existing = fs.tokens.findOneBy("access_token", input.accessToken);
  if (existing) {
    return fs.tokens.update(existing.id, {
      token_type: input.tokenType,
      brand_id: input.brandId,
      scopes: input.scopes,
      application_token: input.applicationToken,
      user_id: input.userId,
      revoked: false,
    })!;
  }
  return fs.tokens.insert({
    access_token: input.accessToken,
    token_type: input.tokenType,
    brand_id: input.brandId,
    scopes: input.scopes,
    application_token: input.applicationToken,
    user_id: input.userId,
    revoked: false,
  });
}

export function parseAppCredentials(header: string | undefined): { applicationToken: string; applicationSecret: string } | null {
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      applicationToken: decoded.slice(0, separator),
      applicationSecret: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function authError(c: Context, status: number, message: string): Response {
  return c.json({ message }, status as 401 | 403);
}

export function requireOAuthApp(
  store: Store,
  applicationToken: string,
  applicationSecret: string,
): FaireOAuthApp | undefined {
  const app = getFaireStore(store).oauthApps.findOneBy("application_token", applicationToken);
  if (!app || app.application_secret !== applicationSecret) return undefined;
  return app;
}

export function authenticateExternalApiRequest(
  c: Context,
  store: Store,
):
  | { ok: true; brandId: string; token: FaireToken; app?: FaireOAuthApp }
  | { ok: false; response: Response } {
  const fs = getFaireStore(store);
  const apiToken = c.req.header("X-FAIRE-ACCESS-TOKEN");
  if (apiToken) {
    const token = fs.tokens.findOneBy("access_token", apiToken);
    if (!token || token.revoked || token.token_type !== "api_token") {
      return { ok: false, response: authError(c, 401, "Invalid Faire API token") };
    }
    return { ok: true, brandId: token.brand_id, token };
  }

  const oauthToken = c.req.header("X-FAIRE-OAUTH-ACCESS-TOKEN");
  const appCredentials = parseAppCredentials(c.req.header("X-FAIRE-APP-CREDENTIALS"));
  if (!oauthToken || !appCredentials) {
    return { ok: false, response: authError(c, 401, "Faire credentials required") };
  }

  const app = requireOAuthApp(store, appCredentials.applicationToken, appCredentials.applicationSecret);
  if (!app) {
    return { ok: false, response: authError(c, 401, "Invalid Faire application credentials") };
  }

  const token = fs.tokens.findOneBy("access_token", oauthToken);
  if (!token || token.revoked || token.token_type !== "oauth_access") {
    return { ok: false, response: authError(c, 401, "Invalid Faire OAuth access token") };
  }
  if (token.application_token !== app.application_token) {
    return { ok: false, response: authError(c, 401, "OAuth token does not belong to this Faire application") };
  }

  return { ok: true, brandId: token.brand_id, token, app };
}

export function authenticateMessengerSession(
  c: Context,
  store: Store,
):
  | { ok: true; session: FaireSession; user: FaireUser; brandId: string }
  | { ok: false; response: Response } {
  const fs = getFaireStore(store);
  const cookies = parseCookies(c.req.header("cookie") ?? "");
  const sessionToken = cookies.indigofair_session;
  if (!sessionToken) {
    return { ok: false, response: authError(c, 401, "Missing Faire session") };
  }

  const session = fs.sessions.findOneBy("session_token", sessionToken);
  if (!session || session.status !== "active") {
    return { ok: false, response: authError(c, 401, "Faire session expired") };
  }

  const user = fs.users.findOneBy("user_id", session.user_id);
  if (!user) {
    return { ok: false, response: authError(c, 401, "Faire session user not found") };
  }

  const brandId = c.req.header("x-facnt")?.trim() || session.current_brand_id;
  if (!user.brand_ids.includes(brandId)) {
    return { ok: false, response: authError(c, 403, `Faire rejected the session for brand ${brandId}`) };
  }

  return { ok: true, session, user, brandId };
}

export function createPendingAuthCode(store: Store, input: Omit<PendingAuthCode, "code" | "createdAt">): PendingAuthCode {
  const code = makeFaireToken("auth", 18);
  const record: PendingAuthCode = {
    code,
    ...input,
    createdAt: Date.now(),
  };
  getPendingAuthCodes(store).set(code, record);
  return record;
}

export function consumePendingAuthCode(store: Store, code: string): PendingAuthCode | undefined {
  const map = getPendingAuthCodes(store);
  const record = map.get(code);
  if (!record) return undefined;
  map.delete(code);
  if (Date.now() - record.createdAt > AUTH_CODE_TTL_MS) return undefined;
  return record;
}
