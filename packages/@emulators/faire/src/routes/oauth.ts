import type { RouteContext } from "@emulators/core";
import {
  bodyStr,
  constantTimeSecretEqual,
  escapeHtml,
  matchesRedirectUri,
  renderCardPage,
  renderErrorPage,
  renderUserButton,
} from "@emulators/core";
import { createPendingAuthCode, createSession, issueToken, normalizeScopes, consumePendingAuthCode } from "../auth.js";
import { makeFaireToken } from "../ids.js";
import { brandResponse } from "../helpers.js";
import { getFaireStore } from "../store.js";

const SERVICE_LABEL = "Faire";

function parseBody(rawText: string, contentType: string): Record<string, unknown> {
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(rawText));
}

export function oauthRoutes({ app, store }: RouteContext): void {
  const fs = () => getFaireStore(store);

  app.get("/oauth2/authorize", (c) => {
    const url = new URL(c.req.url);
    const applicationId = url.searchParams.get("applicationId") ?? "";
    const redirectUrl = url.searchParams.get("redirectUrl") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const scopes = url.searchParams.getAll("scope");

    const oauthApp = fs().oauthApps.findOneBy("application_token", applicationId);
    if (!oauthApp) {
      return c.html(
        renderErrorPage("Application not found", `The application '${escapeHtml(applicationId)}' is not registered.`, SERVICE_LABEL),
        400,
      );
    }
    if (!redirectUrl) {
      return c.html(
        renderErrorPage("Redirect URL missing", "The redirectUrl parameter is required for OAuth authorization.", SERVICE_LABEL),
        400,
      );
    }
    if (!matchesRedirectUri(redirectUrl, oauthApp.redirect_urls)) {
      return c.html(
        renderErrorPage("Redirect URL mismatch", "The redirectUrl is not registered for this application.", SERVICE_LABEL),
        400,
      );
    }

    const buttons = fs()
      .users.all()
      .flatMap((user) => {
        return user.brand_ids.map((brandId) => {
          const brand = fs().brands.findOneBy("brand_id", brandId);
          return renderUserButton({
            letter: (user.email[0] ?? "?").toUpperCase(),
            login: user.email,
            name: brand ? `${user.name} · ${brand.name}` : user.name,
            email: user.email,
            formAction: "/oauth2/authorize/callback",
            hiddenFields: {
              user_id: user.user_id,
              brand_id: brandId,
              application_id: applicationId,
              redirect_url: redirectUrl,
              state,
              scopes: scopes.join(","),
            },
          });
        });
      })
      .join("\n");

    const scopeSummary = scopes.length > 0 ? `<p class="muted">Scopes: ${escapeHtml(scopes.join(", "))}</p>` : "";
    return c.html(
      renderCardPage(
        "Sign in to Faire",
        `Authorize <strong>${escapeHtml(oauthApp.name)}</strong> to access your Faire brand.${scopeSummary}`,
        buttons || '<p class="empty">No Faire users are seeded.</p>',
        SERVICE_LABEL,
      ),
    );
  });

  app.post("/oauth2/authorize/callback", async (c) => {
    const body = await c.req.parseBody();
    const userId = bodyStr(body.user_id);
    const brandId = bodyStr(body.brand_id);
    const applicationId = bodyStr(body.application_id);
    const redirectUrl = bodyStr(body.redirect_url);
    const state = bodyStr(body.state);
    const scopes = normalizeScopes(bodyStr(body.scopes));

    const appRecord = fs().oauthApps.findOneBy("application_token", applicationId);
    if (!appRecord) {
      return c.html(renderErrorPage("Authorization failed", "The selected application is invalid.", SERVICE_LABEL), 400);
    }
    if (!redirectUrl) {
      return c.html(renderErrorPage("Authorization failed", "Missing redirect_url.", SERVICE_LABEL), 400);
    }
    if (!matchesRedirectUri(redirectUrl, appRecord.redirect_urls)) {
      return c.html(renderErrorPage("Authorization failed", "The selected redirect_url is invalid.", SERVICE_LABEL), 400);
    }

    const user = fs().users.findOneBy("user_id", userId);
    if (!user || !user.brand_ids.includes(brandId)) {
      return c.html(renderErrorPage("Authorization failed", "The selected user or brand is invalid.", SERVICE_LABEL), 400);
    }

    const pending = createPendingAuthCode(store, {
      applicationToken: applicationId,
      redirectUrl,
      scopes,
      state,
      userId,
      brandId,
    });

    const target = new URL(redirectUrl);
    target.searchParams.set("authorization_code", pending.code);
    if (state) target.searchParams.set("state", state);
    return c.redirect(target.toString(), 302);
  });

  app.post("/api/external-api-oauth2/token", async (c) => {
    const raw = await c.req.text();
    const body = parseBody(raw, c.req.header("Content-Type") ?? "");
    const grantType = typeof body.grant_type === "string" ? body.grant_type : "";
    const applicationToken = typeof body.application_token === "string" ? body.application_token : "";
    const applicationSecret = typeof body.application_secret === "string" ? body.application_secret : "";
    const redirectUrl = typeof body.redirect_url === "string" ? body.redirect_url : "";
    const authorizationCode = typeof body.authorization_code === "string" ? body.authorization_code : "";
    const requestedScopes = normalizeScopes((body.scope as string[] | string | undefined) ?? []);

    if (grantType !== "AUTHORIZATION_CODE") {
      return c.json({ message: "Unsupported grant_type" }, 400);
    }
    if (!redirectUrl) {
      return c.json({ message: "Missing redirect_url" }, 400);
    }

    const appRecord = fs().oauthApps.findOneBy("application_token", applicationToken);
    if (!appRecord || !constantTimeSecretEqual(applicationSecret, appRecord.application_secret)) {
      return c.json({ message: "Invalid Faire application credentials" }, 401);
    }
    if (!matchesRedirectUri(redirectUrl, appRecord.redirect_urls)) {
      return c.json({ message: "redirect_url mismatch" }, 400);
    }

    const pending = consumePendingAuthCode(store, authorizationCode);
    if (!pending) {
      return c.json({ message: "Invalid authorization code" }, 400);
    }
    if (pending.applicationToken !== applicationToken) {
      return c.json({ message: "Authorization code application mismatch" }, 400);
    }
    if (pending.redirectUrl !== redirectUrl) {
      return c.json({ message: "redirect_url mismatch" }, 400);
    }

    const user = fs().users.findOneBy("user_id", pending.userId);
    const brand = fs().brands.findOneBy("brand_id", pending.brandId);
    if (!user || !brand) {
      return c.json({ message: "User or brand not found" }, 400);
    }

    const session = createSession(store, user, pending.brandId);
    const scopes = requestedScopes.length > 0 ? requestedScopes : pending.scopes;
    const tokenValue = makeFaireToken("faire_oauth", 24);
    issueToken(store, {
      accessToken: tokenValue,
      tokenType: "oauth_access",
      brandId: pending.brandId,
      applicationToken,
      userId: user.user_id,
      scopes,
    });

    return c.json({
      access_token: tokenValue,
      token_type: "Bearer",
      scope: scopes.join(","),
      brand_id: brand.brand_id,
      session_token: session.session_token,
      brand_profile: brandResponse(brand),
    });
  });
}
