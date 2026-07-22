import type { RouteContext } from "@emulators/core";
import { escapeHtml, escapeAttr, renderCardPage, renderErrorPage } from "@emulators/core";
import { getShopifyStore } from "../store.js";
import { callbackHmac, normalizeScopes, randomHex, shopHost } from "../helpers.js";
import { mintSessionToken, resolveAdminAuth } from "../auth.js";

const SERVICE_LABEL = "Shopify";

function resolveRequestedScopes(scopeParam: string, allowedScopes: string[]): { scopes: string[]; invalidScopes: string[] } {
  if (!scopeParam.trim()) {
    return { scopes: [...allowedScopes], invalidScopes: [] };
  }

  const scopes = normalizeScopes(scopeParam);
  const invalidScopes = scopes.filter((scope) => !allowedScopes.includes(scope));
  return { scopes, invalidScopes };
}

export function oauthRoutes({ app, store }: RouteContext): void {
  const ss = () => getShopifyStore(store);

  app.get("/admin/oauth/authorize", (c) => {
    const clientId = c.req.query("client_id") ?? "";
    const redirectUri = c.req.query("redirect_uri") ?? "";
    const shopDomain = c.req.query("shop") ?? ss().shops.all()[0]?.myshopify_domain ?? "";
    const state = c.req.query("state") ?? "";
    const scope = c.req.query("scope") ?? "";
    const host = c.req.query("host") ?? shopHost(shopDomain);

    const appRecord = ss().oauthApps.findOneBy("client_id", clientId);
    if (!appRecord) {
      return c.html(renderErrorPage("Application not found", `Unknown client_id '${clientId}'.`, SERVICE_LABEL), 400);
    }
    if (!redirectUri || !appRecord.redirect_uris.includes(redirectUri)) {
      return c.html(
        renderErrorPage("Redirect URI mismatch", "The redirect_uri is not registered for this application.", SERVICE_LABEL),
        400,
      );
    }

    const shop = ss().shops.findOneBy("myshopify_domain", shopDomain);
    if (!shop) {
      return c.html(renderErrorPage("Unknown shop", `No seeded shop matches '${shopDomain}'.`, SERVICE_LABEL), 400);
    }

    const { scopes, invalidScopes } = resolveRequestedScopes(scope, appRecord.scopes);
    if (invalidScopes.length > 0) {
      return c.html(
        renderErrorPage(
          "Scope mismatch",
          `The requested scopes are not registered for this application: ${invalidScopes.join(", ")}.`,
          SERVICE_LABEL,
        ),
        400,
      );
    }

    const body = `<form method="post" action="/admin/oauth/authorize/confirm">
      <input type="hidden" name="client_id" value="${escapeAttr(clientId)}"/>
      <input type="hidden" name="redirect_uri" value="${escapeAttr(redirectUri)}"/>
      <input type="hidden" name="shop" value="${escapeAttr(shopDomain)}"/>
      <input type="hidden" name="state" value="${escapeAttr(state)}"/>
      <input type="hidden" name="scope" value="${escapeAttr(scopes.join(","))}"/>
      <input type="hidden" name="host" value="${escapeAttr(host)}"/>
      <button type="submit" class="user-btn">
        <span class="user-login">Install on ${escapeHtml(shop.name)}</span>
      </button>
    </form>
    <p class="info-text">${escapeHtml(appRecord.name)} requests: ${escapeHtml(scopes.join(", ") || "no scopes")}</p>`;

    return c.html(
      renderCardPage(
        "Install Shopify App",
        `Install <strong>${escapeHtml(appRecord.name)}</strong> on <strong>${escapeHtml(shop.myshopify_domain)}</strong>.`,
        body,
        SERVICE_LABEL,
      ),
    );
  });

  app.post("/admin/oauth/authorize/confirm", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    const clientId = String(body.client_id ?? "");
    const redirectUri = String(body.redirect_uri ?? "");
    const shopDomain = String(body.shop ?? "");
    const state = String(body.state ?? "");
    const host = String(body.host ?? shopHost(shopDomain));
    const appRecord = ss().oauthApps.findOneBy("client_id", clientId);
    const shop = ss().shops.findOneBy("myshopify_domain", shopDomain);
    const staff = ss().staffUsers.all()[0];

    if (!appRecord || !shop || !staff || !appRecord.redirect_uris.includes(redirectUri)) {
      return c.html(renderErrorPage("Install failed", "Unable to complete the local install flow.", SERVICE_LABEL), 400);
    }

    const { scopes, invalidScopes } = resolveRequestedScopes(String(body.scope ?? ""), appRecord.scopes);
    if (invalidScopes.length > 0) {
      return c.html(
        renderErrorPage(
          "Scope mismatch",
          `The requested scopes are not registered for this application: ${invalidScopes.join(", ")}.`,
          SERVICE_LABEL,
        ),
        400,
      );
    }

    const code = randomHex(16);
    ss().authCodes.insert({
      code,
      client_id: clientId,
      shop_domain: shopDomain,
      redirect_uri: redirectUri,
      staff_gid: staff.staff_gid,
      scopes,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    const sessionToken = mintSessionToken(store, {
      clientId,
      shopDomain,
      staffGid: staff.staff_gid,
    });

    const params = new URLSearchParams({
      code,
      host,
      shop: shopDomain,
      state,
      timestamp: String(Math.floor(Date.now() / 1000)),
      id_token: sessionToken,
    });
    params.set("hmac", callbackHmac(appRecord.client_secret, params));
    const joiner = redirectUri.includes("?") ? "&" : "?";
    return c.redirect(`${redirectUri}${joiner}${params.toString()}`, 302);
  });

  app.post("/admin/oauth/access_token", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    const clientId = String(body.client_id ?? "");
    const clientSecret = String(body.client_secret ?? "");
    const code = String(body.code ?? "");
    const appRecord = ss().oauthApps.findOneBy("client_id", clientId);
    const authCode = ss().authCodes.findOneBy("code", code);

    if (!appRecord || appRecord.client_secret !== clientSecret) {
      return c.json({ error: "invalid_client", error_description: "Unknown Shopify app credentials." }, 401);
    }
    if (!authCode || authCode.client_id !== clientId) {
      return c.json({ error: "invalid_grant", error_description: "Unknown or expired authorization code." }, 400);
    }
    if (new Date(authCode.expires_at).getTime() <= Date.now()) {
      return c.json({ error: "invalid_grant", error_description: "Authorization code has expired." }, 400);
    }

    const existing = ss().accessTokens
      .all()
      .find((token) => token.client_id === clientId && token.shop_domain === authCode.shop_domain && token.staff_gid === authCode.staff_gid && !token.revoked);
    const accessToken = existing?.token ?? `shpat_${randomHex(16)}`;
    if (!existing) {
      ss().accessTokens.insert({
        token: accessToken,
        client_id: clientId,
        shop_domain: authCode.shop_domain,
        staff_gid: authCode.staff_gid,
        scopes: authCode.scopes,
        revoked: false,
      });
    }
    ss().authCodes.delete(authCode.id);

    const staff = ss().staffUsers.findOneBy("staff_gid", existing?.staff_gid ?? authCode.staff_gid);

    return c.json({
      access_token: accessToken,
      scope: authCode.scopes.join(","),
      associated_user_scope: authCode.scopes.join(","),
      associated_user: {
        id: staff?.numeric_id ?? 1,
        first_name: staff?.first_name ?? "Demo",
        last_name: staff?.last_name ?? "Merchant",
        email: staff?.email ?? "merchant@demo-shop.test",
        email_verified: true,
        account_owner: true,
        locale: "en",
        collaborator: false,
      },
    });
  });

  app.get("/auth/session-token", (c) => {
    const auth = resolveAdminAuth(store, c);
    if (!auth) {
      return c.json({ message: "Requires authentication" }, 401);
    }
    const token = mintSessionToken(store, {
      clientId: auth.clientId,
      shopDomain: auth.shopDomain,
      staffGid: auth.staffGid,
    });
    return c.json({ token, shop: auth.shopDomain, client_id: auth.clientId, sub: auth.staffGid });
  });
}
