import type { RouteContext } from "@emulators/core";
import { escapeHtml, renderCardPage, renderErrorPage, renderUserButton } from "@emulators/core";
import {
  createSession,
  defaultCredentials,
  deriveGoogleIdentities,
  discoveredOrganizations,
  issueAuthToken,
  memberResponse,
  memberSessionResponse,
  normalizeEmail,
  organizationResponse,
  withSessionCookies,
} from "../helpers.js";
import { publicTokenMatches, readJsonBody, renderInvalidPublicToken, stytchError, success } from "../route-helpers.js";
import { getStytchConfig, getStytchStore } from "../store.js";

const SERVICE_LABEL = "Stytch";

export function oauthRoutes({ app, store }: RouteContext): void {
  const ss = getStytchStore(store);

  app.get("/v1/b2b/public/oauth/google/discovery/start", (c) => {
    if (!publicTokenMatches(store, c.req.query("public_token") ?? undefined)) {
      return renderInvalidPublicToken("The supplied public_token is not configured for this emulator.");
    }

    const redirectUrl = c.req.query("discovery_redirect_url") ?? "";
    if (!redirectUrl) {
      return new Response(renderErrorPage("Missing redirect URL", "discovery_redirect_url is required.", SERVICE_LABEL), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const identities = deriveGoogleIdentities(store);
    const body =
      identities.length === 0
        ? '<p class="empty">No Google identities in the emulator store.</p>'
        : identities
            .map((identity) =>
              renderUserButton({
                letter: (identity.email_address[0] ?? "?").toUpperCase(),
                login: identity.email_address,
                name: identity.name ?? undefined,
                email: identity.email_address,
                formAction: "/v1/b2b/public/oauth/google/discovery/callback",
                hiddenFields: {
                  email_address: identity.email_address,
                  name: identity.name ?? "",
                  discovery_redirect_url: redirectUrl,
                },
              }),
            )
            .join("\n");

    return c.html(
      renderCardPage(
        "Continue with Google",
        `Select a seeded Google identity to continue into <strong>${escapeHtml(redirectUrl)}</strong>.`,
        body,
        SERVICE_LABEL,
      ),
    );
  });

  app.post("/v1/b2b/public/oauth/google/discovery/callback", async (c) => {
    const form = await c.req.parseBody();
    const emailAddress = typeof form.email_address === "string" ? normalizeEmail(form.email_address) : "";
    const redirectUrl = typeof form.discovery_redirect_url === "string" ? form.discovery_redirect_url : "";
    if (!emailAddress || !redirectUrl) {
      return c.html(renderErrorPage("Invalid request", "Identity selection is missing required fields.", SERVICE_LABEL), 400);
    }

    const identity = deriveGoogleIdentities(store).find((entry) => entry.email_address === emailAddress);
    if (!identity) {
      return c.html(renderErrorPage("Unknown account", "The selected Google account is not available.", SERVICE_LABEL), 400);
    }

    const token = issueAuthToken(store, "discovery_oauth", {
      provider: "google",
      email_address: identity.email_address,
      redirect_url: redirectUrl,
      full_name: identity.name,
    });

    const location = new URL(redirectUrl);
    location.searchParams.set("token", token.token);
    location.searchParams.set("stytch_token_type", "discovery_oauth");
    return c.redirect(location.toString(), 302);
  });

  app.post("/b2b/oauth/discovery/authenticate", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    const token = typeof body.discovery_oauth_token === "string" ? body.discovery_oauth_token : "";
    const record = ss.authTokens.findOneBy("token", token);
    if (!record || record.token_type !== "discovery_oauth" || record.consumed_at || Date.parse(record.expires_at) <= Date.now()) {
      return stytchError(c, 401, "invalid_token", "Discovery OAuth token is invalid or expired.");
    }

    ss.authTokens.update(record.id, { consumed_at: new Date().toISOString() });
    const discovered = discoveredOrganizations(store, record.email_address);

    return c.json(
      success({
        intermediate_session_token: `intermediate-${token}`,
        email_address: record.email_address,
        provider_type: "google",
        provider_tenant_id: record.email_address.split("@")[1] ?? "",
        provider_tenant_ids: [record.email_address.split("@")[1] ?? ""].filter(Boolean),
        full_name: record.full_name ?? record.email_address,
        discovered_organizations: discovered.map(({ organization, member }) => ({
          organization: {
            organization_id: organization.organization_id,
            organization_name: organization.organization_name,
            organization_slug: organization.organization_slug,
            organization_logo_url: organization.organization_logo_url ?? "",
          },
          membership: { type: member.status === "invited" ? "invited_member" : "active_member" },
        })),
      }),
    );
  });

  app.post("/b2b/discovery/intermediate_sessions/exchange", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    const intermediateSessionToken = typeof body.intermediate_session_token === "string" ? body.intermediate_session_token : "";
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : "";
    if (!intermediateSessionToken.startsWith("intermediate-")) {
      return stytchError(c, 401, "invalid_token", "Intermediate session token is invalid.");
    }
    const rawToken = intermediateSessionToken.replace(/^intermediate-/, "");
    const authToken = ss.authTokens.findOneBy("token", rawToken);
    if (!authToken) {
      return stytchError(c, 401, "invalid_token", "Intermediate session token is invalid.");
    }

    const organization = ss.organizations.findOneBy("organization_id", organizationId);
    const member = ss
      .members
      .findBy("organization_id", organizationId)
      .find((entry) => entry.email_address === authToken.email_address);
    if (!organization || !member) {
      return stytchError(c, 404, "member_not_found", "Member not found for requested organization.");
    }

    ss.members.update(member.id, { status: "active", email_address_verified: true });
    const refreshedMember = ss.members.get(member.id)!;
    const next = await createSession(
      store,
      refreshedMember,
      organization,
      typeof body.session_duration_minutes === "number" ? body.session_duration_minutes : 60 * 24 * 7,
      [authToken.token_type === "discovery_oauth" ? "oauth_google" : "magic_link"],
      body.session_custom_claims && typeof body.session_custom_claims === "object"
        ? (body.session_custom_claims as Record<string, unknown>)
        : {},
    );

    const response = c.json(
      success({
        member_id: refreshedMember.member_id,
        session_token: next.session.session_token,
        session_jwt: next.session.session_jwt,
        member: memberResponse(refreshedMember),
        organization: organizationResponse(organization),
        member_authenticated: true,
        intermediate_session_token: "",
        member_session: memberSessionResponse(next.session),
      }),
    );
    return withSessionCookies(response, getStytchConfig(store) ?? defaultCredentials(), next.session);
  });
}
