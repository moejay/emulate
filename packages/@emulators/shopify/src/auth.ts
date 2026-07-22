import type { Context, Store } from "@emulators/core";
import { getShopifyStore } from "./store.js";
import { jwtId, signHs256Jwt, verifyHs256Jwt } from "./helpers.js";

export interface ShopifyAuthContext {
  token: string;
  clientId: string;
  shopDomain: string;
  staffGid: string;
  scopes: string[];
}

export function requestShopifyToken(c: Context): string | null {
  const header = c.req.header("X-Shopify-Access-Token") ?? c.req.header("Authorization");
  if (!header) return null;
  if (header.startsWith("Bearer ")) return header.slice(7).trim() || null;
  return header.trim() || null;
}

export function resolveAdminAuth(store: Store, c: Context): ShopifyAuthContext | null {
  const token = requestShopifyToken(c);
  if (!token) return null;
  const record = getShopifyStore(store).accessTokens.findOneBy("token", token);
  if (!record || record.revoked) return null;
  return {
    token: record.token,
    clientId: record.client_id,
    shopDomain: record.shop_domain,
    staffGid: record.staff_gid,
    scopes: record.scopes,
  };
}

export function mintSessionToken(store: Store, opts: { clientId: string; shopDomain: string; staffGid: string }): string {
  const ss = getShopifyStore(store);
  const app = ss.oauthApps.findOneBy("client_id", opts.clientId);
  if (!app) throw new Error(`Unknown Shopify app: ${opts.clientId}`);

  const now = Math.floor(Date.now() / 1000);
  return signHs256Jwt(
    {
      iss: `https://${opts.shopDomain}/admin`,
      dest: `https://${opts.shopDomain}/admin`,
      aud: opts.clientId,
      sub: opts.staffGid,
      exp: now + 60,
      nbf: now - 5,
      iat: now,
      jti: jwtId(),
      sid: jwtId(),
    },
    app.client_secret,
  );
}

export function verifySessionToken(
  store: Store,
  token: string,
  opts: { clientId: string; shopDomain: string },
): Record<string, unknown> | null {
  const ss = getShopifyStore(store);
  const app = ss.oauthApps.findOneBy("client_id", opts.clientId);
  if (!app) return null;
  const payload = verifyHs256Jwt(token, app.client_secret);
  if (!payload) return null;
  if (payload.aud !== opts.clientId) return null;
  if (payload.iss !== `https://${opts.shopDomain}/admin`) return null;
  if (payload.dest !== `https://${opts.shopDomain}/admin`) return null;
  return payload;
}
