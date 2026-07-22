import { randomUUID } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { Context } from "@emulators/core";
import { parseCookies } from "@emulators/core";
import type { AppEnv, Store } from "@emulators/core";
import type {
  AuthTokenType,
  StytchAuthToken,
  StytchCredentials,
  StytchGoogleIdentity,
  StytchMember,
  StytchOrganization,
  StytchSession,
} from "./entities.js";
import { getGoogleIdentities, getStytchConfig, getStytchStore } from "./store.js";

const keyPairPromise = generateKeyPair("RS256");
const JWT_KID = "emulate-stytch-1";

export interface ResolvedSession {
  session: StytchSession;
  member: StytchMember;
  organization: StytchOrganization;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function requestId(): string {
  return `request-id-${randomUUID()}`;
}

export function generateId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `org-${randomUUID().slice(0, 8)}`;
}

export function defaultCredentials(): StytchCredentials {
  return {
    project_id: "project-test-emulate-stytch",
    secret: "secret-test-emulate-stytch",
    public_token: "public-token-test-emulate-stytch",
    jwt_cookie_name: "stytch_session_jwt",
    session_cookie_name: "stytch_session",
  };
}

export function createDefaultConfig(baseUrl: string) {
  return {
    credentials: defaultCredentials(),
    organizations: [
      {
        organization_name: "Opener Grow Demo",
        organization_slug: "opener-grow-demo",
        organization_logo_url: `${baseUrl}/_emulate/favicon.ico`,
        members: [
          {
            email_address: "owner@example.com",
            name: "Owner Example",
            password: "owner-password",
            roles: ["stytch_admin"],
            is_admin: true,
            status: "active" as const,
          },
          {
            email_address: "member@example.com",
            name: "Member Example",
            password: "member-password",
            roles: [],
            is_admin: false,
            status: "active" as const,
          },
        ],
      },
      {
        organization_name: "Shared Email Org",
        organization_slug: "shared-email-org",
        members: [
          {
            email_address: "owner@example.com",
            name: "Owner Example",
            roles: [],
            is_admin: false,
            status: "active" as const,
          },
        ],
      },
    ],
    google_identities: [
      {
        email_address: "owner@example.com",
        name: "Owner Example",
        picture_url: null,
        hosted_domain: "example.com",
      },
      {
        email_address: "member@example.com",
        name: "Member Example",
        picture_url: null,
        hosted_domain: "example.com",
      },
    ],
  };
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeRoles(roles: string[] | undefined, isAdmin: boolean): string[] {
  const merged = new Set(roles?.filter(Boolean) ?? []);
  if (isAdmin) merged.add("stytch_admin");
  return [...merged];
}

export function isMemberAdmin(member: Pick<StytchMember, "is_admin" | "roles">): boolean {
  return member.is_admin || member.roles.includes("stytch_admin");
}

export function matchServerAuthorization(c: Context<AppEnv>, store: Store): boolean {
  const authHeader = c.req.header("Authorization") ?? "";
  if (!authHeader.startsWith("Basic ")) return false;
  const config = getStytchConfig(store);
  if (!config) return false;
  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  return decoded === `${config.project_id}:${config.secret}`;
}

export function getSessionFromRequest(
  c: Context<AppEnv>,
  store: Store,
  body?: Record<string, unknown>,
): ResolvedSession | null {
  const ss = getStytchStore(store);
  const cookies = parseCookies(c.req.header("Cookie") ?? "");
  const sessionToken =
    headerValue(c.req.header("X-Stytch-Member-Session")) ??
    stringValue(body?.session_token) ??
    cookies[(getStytchConfig(store) ?? defaultCredentials()).session_cookie_name] ??
    null;
  const sessionJwt =
    headerValue(c.req.header("X-Stytch-Member-SessionJWT")) ??
    bearerToken(c.req.header("Authorization")) ??
    stringValue(body?.session_jwt) ??
    cookies[(getStytchConfig(store) ?? defaultCredentials()).jwt_cookie_name] ??
    null;

  const session =
    (sessionToken ? ss.sessions.findOneBy("session_token", sessionToken) : undefined) ??
    (sessionJwt ? ss.sessions.findOneBy("session_jwt", sessionJwt) : undefined);
  if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) return null;

  const member = ss.members.findOneBy("member_id", session.member_id);
  const organization = ss.organizations.findOneBy("organization_id", session.organization_id);
  if (!member || !organization) return null;

  return { session, member, organization };
}

export function touchSession(store: Store, sessionId: number): StytchSession | undefined {
  const ss = getStytchStore(store);
  return ss.sessions.update(sessionId, { last_accessed_at: nowIso() });
}

export async function signSessionJwt(
  credentials: StytchCredentials,
  member: StytchMember,
  organization: StytchOrganization,
  memberSessionId: string,
  expiresAt: string,
  customClaims: Record<string, unknown>,
): Promise<string> {
  const { privateKey } = await keyPairPromise;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    member_session_id: memberSessionId,
    organization_id: organization.organization_id,
    organization_slug: organization.organization_slug,
    roles: member.roles,
    email_address: member.email_address,
    ...(customClaims ?? {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: JWT_KID, typ: "JWT" })
    .setIssuer(`stytch.com/${credentials.project_id}`)
    .setAudience(credentials.project_id)
    .setSubject(member.member_id)
    .setJti(memberSessionId)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(Math.floor(Date.parse(expiresAt) / 1000))
    .sign(privateKey);
}

export async function jwksResponse() {
  const { publicKey } = await keyPairPromise;
  const jwk = await exportJWK(publicKey);
  return { keys: [{ ...jwk, kid: JWT_KID, alg: "RS256", use: "sig" }] };
}

export async function createSession(
  store: Store,
  member: StytchMember,
  organization: StytchOrganization,
  sessionDurationMinutes = 60 * 24 * 7,
  authenticationTypes: string[] = ["password"],
  customClaims: Record<string, unknown> = {},
): Promise<ResolvedSession> {
  const config = getStytchConfig(store) ?? defaultCredentials();
  const ss = getStytchStore(store);
  const startedAt = nowIso();
  const expiresAt = new Date(Date.now() + sessionDurationMinutes * 60_000).toISOString();
  const memberSessionId = generateId("member-session");
  const sessionToken = generateId("session");
  const sessionJwt = await signSessionJwt(config, member, organization, memberSessionId, expiresAt, customClaims);
  const session = ss.sessions.insert({
    member_session_id: memberSessionId,
    session_token: sessionToken,
    session_jwt: sessionJwt,
    member_id: member.member_id,
    organization_id: organization.organization_id,
    organization_slug: organization.organization_slug,
    roles: [...member.roles],
    started_at: startedAt,
    last_accessed_at: startedAt,
    expires_at: expiresAt,
    authentication_types: authenticationTypes,
    revoked_at: null,
    custom_claims: customClaims,
  });
  return { session, member, organization };
}

export function revokeSessionsForMember(store: Store, memberId: string, organizationId?: string): void {
  const ss = getStytchStore(store);
  const now = nowIso();
  for (const session of ss.sessions.all()) {
    if (session.member_id !== memberId) continue;
    if (organizationId && session.organization_id !== organizationId) continue;
    ss.sessions.update(session.id, { revoked_at: now });
  }
}

export function issueAuthToken(
  store: Store,
  tokenType: AuthTokenType,
  params: {
    provider?: string | null;
    email_address: string;
    organization_id?: string | null;
    member_id?: string | null;
    redirect_url?: string | null;
    ttlMinutes?: number;
    code_challenge?: string | null;
    full_name?: string | null;
  },
): StytchAuthToken {
  const ss = getStytchStore(store);
  const ttlMinutes = params.ttlMinutes ?? (tokenType === "multi_tenant_magic_links" ? 60 * 24 * 7 : 60);
  return ss.authTokens.insert({
    token: generateId(tokenType),
    token_type: tokenType,
    provider: params.provider ?? null,
    email_address: normalizeEmail(params.email_address),
    organization_id: params.organization_id ?? null,
    member_id: params.member_id ?? null,
    redirect_url: params.redirect_url ?? null,
    expires_at: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
    consumed_at: null,
    code_challenge: params.code_challenge ?? null,
    full_name: params.full_name ?? null,
  });
}

export function consumeAuthToken(store: Store, token: string, tokenType?: AuthTokenType): StytchAuthToken | null {
  const ss = getStytchStore(store);
  const record = ss.authTokens.findOneBy("token", token);
  if (!record) return null;
  if (tokenType && record.token_type !== tokenType) return null;
  if (record.consumed_at || Date.parse(record.expires_at) <= Date.now()) return null;
  ss.authTokens.update(record.id, { consumed_at: nowIso() });
  return ss.authTokens.findOneBy("token", token) ?? null;
}

export function discoveredOrganizations(store: Store, emailAddress: string): Array<{
  organization: StytchOrganization;
  member: StytchMember;
}> {
  const ss = getStytchStore(store);
  const target = normalizeEmail(emailAddress);
  return ss.members
    .all()
    .filter((member) => member.email_address === target && member.status !== "pending")
    .map((member) => ({ member, organization: ss.organizations.findOneBy("organization_id", member.organization_id)! }))
    .filter((entry) => Boolean(entry.organization));
}

export function deriveGoogleIdentities(store: Store): StytchGoogleIdentity[] {
  const explicit = getGoogleIdentities(store);
  if (explicit.length > 0) return explicit;

  const byEmail = new Map<string, StytchGoogleIdentity>();
  for (const member of getStytchStore(store).members.all()) {
    if (byEmail.has(member.email_address)) continue;
    const domain = member.email_address.split("@")[1] ?? null;
    byEmail.set(member.email_address, {
      email_address: member.email_address,
      name: member.name,
      picture_url: null,
      hosted_domain: domain,
    });
  }
  return [...byEmail.values()].sort((a, b) => a.email_address.localeCompare(b.email_address));
}

export function memberResponse(member: StytchMember) {
  return {
    organization_id: member.organization_id,
    member_id: member.member_id,
    email_address: member.email_address,
    status: member.status,
    name: member.name ?? "",
    sso_registrations: [],
    is_breakglass: member.is_breakglass,
    member_password_id: member.member_password_id ?? "",
    oauth_registrations: [],
    email_address_verified: member.email_address_verified,
    mfa_phone_number_verified: member.mfa_phone_number_verified,
    is_admin: member.is_admin,
    totp_registration_id: member.totp_registration_id ?? "",
    retired_email_addresses: member.retired_email_addresses.map((email_address) => ({ email_address })),
    is_locked: member.is_locked,
    mfa_enrolled: member.mfa_enrolled,
    mfa_phone_number: member.mfa_phone_number ?? "",
    default_mfa_method: member.default_mfa_method ?? "",
    roles: member.roles.map((role_id) => ({ role_id, sources: [{ type: "direct_assignment" }] })),
    trusted_metadata: member.trusted_metadata,
    untrusted_metadata: member.untrusted_metadata,
    created_at: member.created_at,
    updated_at: member.updated_at,
    external_id: member.external_id ?? undefined,
    lock_created_at: member.lock_created_at ?? undefined,
    lock_expires_at: member.lock_expires_at ?? undefined,
  };
}

export function organizationResponse(organization: StytchOrganization) {
  return {
    organization_id: organization.organization_id,
    organization_name: organization.organization_name,
    organization_slug: organization.organization_slug,
    organization_logo_url: organization.organization_logo_url ?? "",
    trusted_metadata: organization.trusted_metadata,
    sso_jit_provisioning: organization.sso_jit_provisioning,
    email_allowed_domains: organization.email_allowed_domains,
    auth_methods: "all_allowed",
    allowed_auth_methods: ["magic_link", "password", "google_oauth"],
    mfa_policy: "OPTIONAL",
    default_mfa_method: "",
    created_at: organization.created_at,
    updated_at: organization.updated_at,
  };
}

export function memberSessionResponse(session: StytchSession) {
  return {
    member_session_id: session.member_session_id,
    member_id: session.member_id,
    started_at: session.started_at,
    last_accessed_at: session.last_accessed_at,
    expires_at: session.expires_at,
    authentication_factors: session.authentication_types.map((type) => ({
      type,
      delivery_method: type.includes("oauth") ? "oauth" : "email",
      last_authenticated_at: session.last_accessed_at,
    })),
    organization_id: session.organization_id,
    roles: session.roles,
    organization_slug: session.organization_slug,
    custom_claims: session.custom_claims,
  };
}

export function withSessionCookies(response: Response, credentials: StytchCredentials, session: StytchSession): Response {
  response.headers.append("Set-Cookie", `${credentials.session_cookie_name}=${encodeURIComponent(session.session_token)}; Path=/; SameSite=Lax`);
  response.headers.append("Set-Cookie", `${credentials.jwt_cookie_name}=${encodeURIComponent(session.session_jwt)}; Path=/; SameSite=Lax`);
  return response;
}

export function clearSessionCookies(response: Response, credentials: StytchCredentials): Response {
  response.headers.append("Set-Cookie", `${credentials.session_cookie_name}=; Path=/; Max-Age=0; SameSite=Lax`);
  response.headers.append("Set-Cookie", `${credentials.jwt_cookie_name}=; Path=/; Max-Age=0; SameSite=Lax`);
  return response;
}

function headerValue(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

function bearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim() || null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
