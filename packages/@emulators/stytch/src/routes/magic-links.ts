import type { RouteContext } from "@emulators/core";
import {
  createSession,
  defaultCredentials,
  discoveredOrganizations,
  issueAuthToken,
  memberResponse,
  memberSessionResponse,
  normalizeEmail,
  organizationResponse,
  withSessionCookies,
} from "../helpers.js";
import { readJsonBody, requireServerAuth, stytchError, success } from "../route-helpers.js";
import { getStytchConfig, getStytchStore } from "../store.js";

export function magicLinkRoutes({ app, store }: RouteContext): void {
  const ss = getStytchStore(store);

  app.post("/v1/b2b/magic_links/email/invite", async (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const body = await readJsonBody<Record<string, unknown>>(c);
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : "";
    const emailAddress = typeof body.email_address === "string" ? normalizeEmail(body.email_address) : "";
    const organization = ss.organizations.findOneBy("organization_id", organizationId);
    if (!organization) return stytchError(c, 404, "organization_not_found", "Organization not found.");
    if (!emailAddress) return stytchError(c, 400, "missing_required_field", "email_address is required.");

    let member = ss
      .members
      .findBy("organization_id", organization.organization_id)
      .find((entry) => entry.email_address === emailAddress);
    if (member?.status === "active") {
      return stytchError(c, 400, "member_already_active", "Active members cannot be invited.");
    }
    if (!member) {
      const roles = Array.isArray(body.roles)
        ? body.roles.filter((value): value is string => typeof value === "string")
        : [];
      member = ss.members.insert({
        organization_id: organization.organization_id,
        member_id: `member-${crypto.randomUUID()}`,
        email_address: emailAddress,
        status: "invited",
        name: typeof body.name === "string" ? body.name : null,
        is_breakglass: false,
        member_password_id: null,
        password: null,
        email_address_verified: false,
        mfa_phone_number_verified: false,
        is_admin: roles.includes("stytch_admin"),
        totp_registration_id: null,
        retired_email_addresses: [],
        is_locked: false,
        mfa_enrolled: false,
        mfa_phone_number: null,
        default_mfa_method: null,
        roles,
        trusted_metadata:
          body.trusted_metadata && typeof body.trusted_metadata === "object"
            ? (body.trusted_metadata as Record<string, unknown>)
            : {},
        untrusted_metadata:
          body.untrusted_metadata && typeof body.untrusted_metadata === "object"
            ? (body.untrusted_metadata as Record<string, unknown>)
            : {},
        external_id: null,
        lock_created_at: null,
        lock_expires_at: null,
      });
    } else {
      ss.members.update(member.id, { status: "invited" });
      member = ss.members.get(member.id)!;
    }

    issueAuthToken(store, "multi_tenant_magic_links", {
      email_address: member.email_address,
      organization_id: organization.organization_id,
      member_id: member.member_id,
      redirect_url: typeof body.invite_redirect_url === "string" ? body.invite_redirect_url : null,
      ttlMinutes: typeof body.invite_expiration_minutes === "number" ? body.invite_expiration_minutes : 60 * 24 * 7,
      full_name: member.name,
    });

    return c.json(success({ member_id: member.member_id, member: memberResponse(member), organization: organizationResponse(organization) }));
  });

  app.post("/b2b/magic_links/email/discovery/send", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    const emailAddress = typeof body.email_address === "string" ? normalizeEmail(body.email_address) : "";
    if (!emailAddress) return stytchError(c, 400, "missing_required_field", "email_address is required.");

    issueAuthToken(store, "discovery", {
      email_address: emailAddress,
      redirect_url: typeof body.discovery_redirect_url === "string" ? body.discovery_redirect_url : null,
      ttlMinutes: typeof body.discovery_expiration_minutes === "number" ? body.discovery_expiration_minutes : 60,
      code_challenge: typeof body.pkce_code_challenge === "string" ? body.pkce_code_challenge : null,
    });

    return c.json(success({}));
  });

  app.post("/b2b/magic_links/discovery/authenticate", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    const token = typeof body.discovery_magic_links_token === "string" ? body.discovery_magic_links_token : "";
    const record = ss.authTokens.findOneBy("token", token);
    if (!record || record.token_type !== "discovery" || record.consumed_at || Date.parse(record.expires_at) <= Date.now()) {
      return stytchError(c, 401, "invalid_token", "Discovery magic link token is invalid or expired.");
    }
    ss.authTokens.update(record.id, { consumed_at: new Date().toISOString() });

    return c.json(
      success({
        intermediate_session_token: `intermediate-${record.token}`,
        email_address: record.email_address,
        discovered_organizations: discoveredOrganizations(store, record.email_address).map(({ organization, member }) => ({
          organization: organizationResponse(organization),
          membership: { type: member.status === "invited" ? "invited_member" : "active_member" },
        })),
      }),
    );
  });

  app.post("/b2b/magic_links/authenticate", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    const token = typeof body.magic_links_token === "string" ? body.magic_links_token : "";
    const record = ss.authTokens.findOneBy("token", token);
    if (!record || record.token_type !== "multi_tenant_magic_links" || record.consumed_at || Date.parse(record.expires_at) <= Date.now()) {
      return stytchError(c, 401, "invalid_token", "Magic link token is invalid or expired.");
    }

    const member = record.member_id ? ss.members.findOneBy("member_id", record.member_id) : undefined;
    const organization = record.organization_id ? ss.organizations.findOneBy("organization_id", record.organization_id) : undefined;
    if (!member || !organization) return stytchError(c, 404, "member_not_found", "Member not found.");

    ss.authTokens.update(record.id, { consumed_at: new Date().toISOString() });
    ss.members.update(member.id, { status: "active", email_address_verified: true });
    const nextMember = ss.members.get(member.id)!;
    const next = await createSession(
      store,
      nextMember,
      organization,
      typeof body.session_duration_minutes === "number" ? body.session_duration_minutes : 60 * 24 * 7,
      ["magic_link"],
      body.session_custom_claims && typeof body.session_custom_claims === "object"
        ? (body.session_custom_claims as Record<string, unknown>)
        : {},
    );

    const response = c.json(
      success({
        member_id: nextMember.member_id,
        method_id: record.token,
        reset_sessions: false,
        organization_id: organization.organization_id,
        member: memberResponse(nextMember),
        session_token: next.session.session_token,
        session_jwt: next.session.session_jwt,
        organization: organizationResponse(organization),
        intermediate_session_token: "",
        member_authenticated: true,
        member_session: memberSessionResponse(next.session),
      }),
    );
    return withSessionCookies(response, getStytchConfig(store) ?? defaultCredentials(), next.session);
  });
}
