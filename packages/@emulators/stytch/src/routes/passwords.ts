import type { RouteContext } from "@emulators/core";
import {
  createSession,
  defaultCredentials,
  discoveredOrganizations,
  generateId,
  getSessionFromRequest,
  issueAuthToken,
  memberResponse,
  memberSessionResponse,
  normalizeEmail,
  organizationResponse,
  withSessionCookies,
} from "../helpers.js";
import { readJsonBody, requireServerAuth, stytchError, success } from "../route-helpers.js";
import { getStytchConfig, getStytchStore } from "../store.js";

export function passwordRoutes({ app, store }: RouteContext): void {
  const ss = getStytchStore(store);

  app.post("/v1/b2b/passwords/strength_check", async (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;
    const body = await readJsonBody<Record<string, unknown>>(c);
    return c.json(success(strengthCheck(body.password)));
  });

  app.post("/b2b/passwords/strength_check", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    return c.json(success(strengthCheck(body.password)));
  });

  app.post("/b2b/passwords/authenticate", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : "";
    const emailAddress = typeof body.email_address === "string" ? normalizeEmail(body.email_address) : "";
    const password = typeof body.password === "string" ? body.password : "";

    const organization = ss.organizations.findOneBy("organization_id", organizationId);
    if (!organization) return stytchError(c, 404, "organization_not_found", "Organization not found.");

    const member = ss
      .members
      .findBy("organization_id", organization.organization_id)
      .find((entry) => entry.email_address === emailAddress);
    if (!member) return stytchError(c, 404, "member_not_found", "Member not found.");
    if (!member.member_password_id || !member.password) {
      return stytchError(c, 400, "member_password_not_found", "Member does not have a password.");
    }
    if (member.password !== password) {
      return stytchError(c, 401, "invalid_password", "Incorrect password.");
    }

    const next = await createSession(
      store,
      member,
      organization,
      typeof body.session_duration_minutes === "number" ? body.session_duration_minutes : 60 * 24 * 7,
      ["password"],
      body.session_custom_claims && typeof body.session_custom_claims === "object"
        ? (body.session_custom_claims as Record<string, unknown>)
        : {},
    );
    ss.members.update(member.id, { status: "active", email_address_verified: true });

    const response = c.json(
      success({
        member_id: member.member_id,
        organization_id: organization.organization_id,
        member: memberResponse(next.member),
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

  app.post("/v1/b2b/passwords/email/reset/start", async (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const body = await readJsonBody<Record<string, unknown>>(c);
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : "";
    const emailAddress = typeof body.email_address === "string" ? normalizeEmail(body.email_address) : "";
    const organization = ss.organizations.findOneBy("organization_id", organizationId);
    if (!organization) return stytchError(c, 404, "organization_not_found", "Organization not found.");

    const member = ss
      .members
      .findBy("organization_id", organization.organization_id)
      .find((entry) => entry.email_address === emailAddress);
    if (!member) return stytchError(c, 404, "member_not_found", "Member not found.");

    issueAuthToken(store, "multi_tenant_passwords", {
      email_address: member.email_address,
      organization_id: organization.organization_id,
      member_id: member.member_id,
      redirect_url: typeof body.reset_password_redirect_url === "string" ? body.reset_password_redirect_url : null,
      code_challenge: typeof body.code_challenge === "string" ? body.code_challenge : null,
      ttlMinutes: typeof body.reset_password_expiration_minutes === "number" ? body.reset_password_expiration_minutes : 30,
      full_name: member.name,
    });

    return c.json(success({}));
  });

  app.post("/b2b/passwords/email/reset", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    const token = typeof body.password_reset_token === "string" ? body.password_reset_token : "";
    const password = typeof body.password === "string" ? body.password : "";
    const record = ss.authTokens.findOneBy("token", token);
    if (!record || record.token_type !== "multi_tenant_passwords" || record.consumed_at || Date.parse(record.expires_at) <= Date.now()) {
      return stytchError(c, 401, "invalid_token", "Password reset token is invalid or expired.");
    }

    const member = record.member_id ? ss.members.findOneBy("member_id", record.member_id) : undefined;
    const organization = record.organization_id ? ss.organizations.findOneBy("organization_id", record.organization_id) : undefined;
    if (!member || !organization) return stytchError(c, 404, "member_not_found", "Member not found.");

    ss.authTokens.update(record.id, { consumed_at: new Date().toISOString() });
    ss.members.update(member.id, {
      password,
      member_password_id: member.member_password_id ?? generateId("member-password"),
      status: "active",
      email_address_verified: true,
    });

    const nextMember = ss.members.get(member.id)!;
    const next = await createSession(
      store,
      nextMember,
      organization,
      typeof body.session_duration_minutes === "number" ? body.session_duration_minutes : 60 * 24 * 7,
      ["password_reset"],
      body.session_custom_claims && typeof body.session_custom_claims === "object"
        ? (body.session_custom_claims as Record<string, unknown>)
        : {},
    );

    const response = c.json(
      success({
        member_id: nextMember.member_id,
        member_email_id: `member-email-${nextMember.member_id}`,
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

  app.post("/b2b/passwords/session/reset", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    const resolved = getSessionFromRequest(c, store, body);
    if (!resolved) return stytchError(c, 401, "session_not_found", "Session not found.");

    const password = typeof body.password === "string" ? body.password : "";
    ss.members.update(resolved.member.id, {
      password,
      member_password_id: resolved.member.member_password_id ?? generateId("member-password"),
      status: "active",
      email_address_verified: true,
    });

    return c.json(success({ member_id: resolved.member.member_id, member: memberResponse(ss.members.get(resolved.member.id)!) }));
  });

  function strengthCheck(rawPassword: unknown) {
    const password = typeof rawPassword === "string" ? rawPassword : "";
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasDigit = /\d/.test(password);
    const hasSymbol = /[^A-Za-z0-9]/.test(password);
    const missingComplexity = [hasLower, hasUpper, hasDigit, hasSymbol].filter((value) => !value).length;
    const missingCharacters = Math.max(0, 8 - password.length);
    const score = Math.max(0, Math.min(4, 4 - missingComplexity - (missingCharacters > 0 ? 1 : 0)));
    return {
      valid_password: missingComplexity <= 1 && missingCharacters === 0,
      score,
      breached_password: false,
      strength_policy: "luds",
      zxcvbn_feedback: {
        warning: missingCharacters > 0 ? "Add more characters." : "",
        suggestions: [
          !hasLower ? "Add a lowercase letter." : null,
          !hasUpper ? "Add an uppercase letter." : null,
          !hasDigit ? "Add a number." : null,
          !hasSymbol ? "Add a symbol." : null,
        ].filter((value): value is string => Boolean(value)),
      },
      luds_feedback: {
        has_lower_case: hasLower,
        has_upper_case: hasUpper,
        has_digit: hasDigit,
        has_symbol: hasSymbol,
        missing_complexity: missingComplexity,
        missing_characters: missingCharacters,
      },
    };
  }
}
