import type { RouteContext } from "@emulators/core";
import {
  escapeHtml,
  renderCardPage,
  renderErrorPage,
  renderUserButton,
} from "@emulators/core";
import {
  createAuthCodeValue,
  getPendingCode,
  getPendingCodes,
  issueTokenPair,
  matchesRedirectUri,
  parseScopes,
  parseQuickBooksBody,
  qboError,
  resolveClientId,
  revokeToken,
  rotateRefreshToken,
  validateClientCredentials,
  buildEnvelope,
  SERVICE_LABEL,
} from "../helpers.js";
import { getQuickBooksStore } from "../store.js";

export function oauthRoutes({ app, store }: RouteContext): void {
  const qs = () => getQuickBooksStore(store);

  app.get("/connect/oauth2", (c) => {
    const clientId = c.req.query("client_id") ?? "";
    const redirectUri = c.req.query("redirect_uri") ?? "";
    const state = c.req.query("state") ?? "";
    const scopes = parseScopes(c.req.query("scope") ?? "com.intuit.quickbooks.accounting");

    let appName = "QuickBooks App";
    if (qs().oauthApps.all().length > 0) {
      const oauthApp = qs().oauthApps.findOneBy("client_id", clientId);
      if (!oauthApp) {
        return c.html(
          renderErrorPage("Application not found", `The client_id '${clientId}' is not registered.`, SERVICE_LABEL),
          400,
        );
      }
      if (redirectUri && !matchesRedirectUri(redirectUri, oauthApp.redirect_uris)) {
        return c.html(
          renderErrorPage("Redirect URI mismatch", "The redirect_uri is not registered for this app.", SERVICE_LABEL),
          400,
        );
      }
      appName = oauthApp.name;
    }

    const users = qs().users
      .all()
      .flatMap((user) =>
        user.realm_ids.map((realmId) => {
          const company = qs().companies.findOneBy("realm_id", realmId);
          return { user, realmId, companyName: company?.company_name ?? realmId };
        }),
      );

    const body =
      users.length === 0
        ? '<p class="empty">No QuickBooks users have access to seeded companies.</p>'
        : users
            .map(({ user, realmId, companyName }) =>
              renderUserButton({
                letter: (companyName[0] ?? "Q").toUpperCase(),
                login: companyName,
                name: user.name,
                email: user.email,
                formAction: "/connect/oauth2/callback",
                hiddenFields: {
                  client_id: clientId,
                  redirect_uri: redirectUri,
                  state,
                  scope: scopes.join(" "),
                  user_email: user.email,
                  realm_id: realmId,
                },
              }),
            )
            .join("\n");

    const subtitle = `Authorize <strong>${escapeHtml(appName)}</strong> to access one of your seeded QuickBooks companies.`;
    return c.html(renderCardPage("Connect to QuickBooks", subtitle, body, SERVICE_LABEL));
  });

  app.post("/connect/oauth2/callback", async (c) => {
    const body = await c.req.parseBody();
    const clientId = String(body.client_id ?? "");
    const redirectUri = String(body.redirect_uri ?? "");
    const state = String(body.state ?? "");
    const userEmail = String(body.user_email ?? "");
    const realmId = String(body.realm_id ?? "");
    const scopes = parseScopes(String(body.scope ?? ""));

    const code = createAuthCodeValue();
    getPendingCodes(store).set(code, {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      realm_id: realmId,
      user_email: userEmail,
      created_at: Date.now(),
    });

    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    url.searchParams.set("state", state);
    url.searchParams.set("realmId", realmId);
    return c.redirect(url.toString(), 302);
  });

  app.post("/oauth2/v1/tokens/bearer", async (c) => {
    const body = await parseQuickBooksBody(c);
    if (!validateClientCredentials(store, c, body)) {
      return qboError(c, 401, "invalid_client", "The client credentials are invalid.", "401", "AuthenticationFault");
    }

    const grantType = String(body.grant_type ?? "");
    const clientId = resolveClientId(c, body);

    if (grantType === "authorization_code") {
      const code = String(body.code ?? "");
      const redirectUri = String(body.redirect_uri ?? "");
      const pending = getPendingCode(store, code);
      if (!pending) {
        return c.json({ error: "invalid_grant", error_description: "The authorization code is invalid or expired." }, 400);
      }
      if (pending.client_id !== clientId) {
        return c.json({ error: "invalid_grant", error_description: "The authorization code was not issued to this client." }, 400);
      }
      if (pending.redirect_uri !== redirectUri) {
        return c.json({ error: "invalid_grant", error_description: "The redirect_uri does not match the authorization request." }, 400);
      }
      getPendingCodes(store).delete(code);

      const user = qs().users.findOneBy("email", pending.user_email);
      if (!user) {
        return c.json({ error: "invalid_grant", error_description: "The selected user is unavailable." }, 400);
      }

      const tokens = issueTokenPair(store, pending.realm_id, user.email, clientId, pending.scope);
      return c.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: "bearer",
        expires_in: 3600,
        x_refresh_token_expires_in: 8640000,
      });
    }

    if (grantType === "refresh_token") {
      const currentRefreshToken = String(body.refresh_token ?? "");
      const rotated = rotateRefreshToken(store, currentRefreshToken, clientId);
      if (!rotated) {
        return c.json({ error: "invalid_grant", error_description: "The refresh token is invalid, expired, or belongs to another client." }, 400);
      }
      return c.json({
        access_token: rotated.accessToken,
        refresh_token: rotated.refreshToken,
        token_type: "bearer",
        expires_in: 3600,
        x_refresh_token_expires_in: 8640000,
      });
    }

    return c.json({ error: "unsupported_grant_type" }, 400);
  });

  app.post("/oauth2/v1/tokens/revoke", async (c) => {
    const body = await parseQuickBooksBody(c);
    const token = String(body.token ?? body.refresh_token ?? "");
    revokeToken(store, token);
    return c.body(null, 200);
  });

  app.get("/v3/company/:realmId/openid_connect/userinfo", (c) => {
    const realmId = c.req.param("realmId");
    const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "").trim();
    const access = token ? qs().accessTokens.findOneBy("token", token) : undefined;
    if (!access || access.revoked || access.realm_id !== realmId) {
      return qboError(c, 401, "AuthenticationFailed", "A valid QuickBooks bearer token is required.", "3200", "AuthenticationFault");
    }
    const user = qs().users.findOneBy("email", access.user_email);
    if (!user) {
      return qboError(c, 404, "Object Not Found", `User '${access.user_email}' was not found.`, "610");
    }
    return c.json(
      buildEnvelope("UserInfo", {
        sub: user.email,
        email: user.email,
        emailVerified: true,
        name: user.name,
        realmId,
      }),
    );
  });
}
