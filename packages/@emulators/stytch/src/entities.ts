import type { Entity } from "@emulators/core";

export interface StytchOrganization extends Entity {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  organization_logo_url: string | null;
  trusted_metadata: Record<string, unknown>;
  sso_jit_provisioning: boolean;
  email_allowed_domains: string[];
}

export type MemberStatus = "active" | "invited" | "pending";

export interface StytchMember extends Entity {
  organization_id: string;
  member_id: string;
  email_address: string;
  status: MemberStatus;
  name: string | null;
  is_breakglass: boolean;
  member_password_id: string | null;
  password: string | null;
  email_address_verified: boolean;
  mfa_phone_number_verified: boolean;
  is_admin: boolean;
  totp_registration_id: string | null;
  retired_email_addresses: string[];
  is_locked: boolean;
  mfa_enrolled: boolean;
  mfa_phone_number: string | null;
  default_mfa_method: string | null;
  roles: string[];
  trusted_metadata: Record<string, unknown>;
  untrusted_metadata: Record<string, unknown>;
  external_id: string | null;
  lock_created_at: string | null;
  lock_expires_at: string | null;
}

export interface StytchSession extends Entity {
  member_session_id: string;
  session_token: string;
  session_jwt: string;
  member_id: string;
  organization_id: string;
  organization_slug: string;
  roles: string[];
  started_at: string;
  last_accessed_at: string;
  expires_at: string;
  authentication_types: string[];
  revoked_at: string | null;
  custom_claims: Record<string, unknown>;
}

export type AuthTokenType =
  | "discovery"
  | "discovery_oauth"
  | "multi_tenant_magic_links"
  | "multi_tenant_passwords";

export interface StytchAuthToken extends Entity {
  token: string;
  token_type: AuthTokenType;
  provider: string | null;
  email_address: string;
  organization_id: string | null;
  member_id: string | null;
  redirect_url: string | null;
  expires_at: string;
  consumed_at: string | null;
  code_challenge: string | null;
  full_name: string | null;
}

export interface StytchGoogleIdentity {
  email_address: string;
  name: string | null;
  picture_url: string | null;
  hosted_domain: string | null;
}

export interface StytchCredentials {
  project_id: string;
  secret: string;
  public_token: string;
  jwt_cookie_name: string;
  session_cookie_name: string;
}

export interface StytchSeedMember {
  member_id?: string;
  email_address: string;
  name?: string;
  status?: MemberStatus;
  password?: string;
  roles?: string[];
  is_admin?: boolean;
  mfa_phone_number?: string;
  trusted_metadata?: Record<string, unknown>;
  untrusted_metadata?: Record<string, unknown>;
  external_id?: string;
}

export interface StytchSeedOrganization {
  organization_id?: string;
  organization_name: string;
  organization_slug?: string;
  organization_logo_url?: string;
  trusted_metadata?: Record<string, unknown>;
  sso_jit_provisioning?: boolean;
  email_allowed_domains?: string[];
  members?: StytchSeedMember[];
}

export interface StytchSeedConfig {
  credentials?: Partial<StytchCredentials>;
  organizations?: StytchSeedOrganization[];
  google_identities?: StytchGoogleIdentity[];
}
