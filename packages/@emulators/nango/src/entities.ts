import type { Entity } from "@emulators/core";

export type NangoAuthMode = "oauth2" | "manual" | "none";
export type NangoProxyAuthMode = "oauth2-bearer" | "none" | "static-bearer";

export interface NangoManualField {
  name: string;
  label: string;
  required?: boolean;
  type?: "text" | "url" | "password";
  placeholder?: string;
  help_text?: string;
}

export interface NangoEndUser {
  id: string;
  email?: string;
  display_name?: string;
  tags?: Record<string, string>;
}

export interface NangoProviderConfig extends Entity {
  unique_key: string;
  provider: string;
  display_name: string;
  logo: string;
  auth_mode: NangoAuthMode;
  proxy_auth_mode: NangoProxyAuthMode;
  oauth_authorize_url: string | null;
  oauth_token_url: string | null;
  oauth_client_id: string | null;
  oauth_client_secret: string | null;
  oauth_scope: string | null;
  proxy_base_url: string | null;
  proxy_base_url_mapping_key: string | null;
  static_bearer_token: string | null;
  forward_webhooks: boolean;
  webhook_url: string | null;
  docs_connect: string | null;
  connect_button_label: string | null;
  manual_fields: NangoManualField[];
  default_connection_config: Record<string, unknown> | null;
  connect_metadata_defaults: Record<string, unknown> | null;
}

export type NangoConnectionCredentials =
  | {
      type: "OAUTH2";
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      raw: Record<string, unknown>;
    }
  | {
      type: "STATIC_BEARER";
      access_token: string;
      raw: Record<string, unknown>;
    }
  | {
      type: "NONE";
      raw: Record<string, unknown>;
    };

export interface NangoConnectionError {
  type: string;
  log_id: string;
  message?: string;
}

export interface NangoConnection extends Entity {
  connection_id: string;
  provider_config_key: string;
  provider: string;
  last_fetched_at: string | null;
  metadata: Record<string, unknown> | null;
  errors: NangoConnectionError[];
  end_user: NangoEndUser | null;
  tags: Record<string, string>;
  connection_config: Record<string, unknown> | null;
  credentials: NangoConnectionCredentials;
}

export interface NangoConnectSession extends Entity {
  token: string;
  expires_at: string;
  allowed_integrations: string[];
  end_user: NangoEndUser | null;
  organization: {
    id: string;
    display_name?: string;
  } | null;
  tags: Record<string, string>;
  overrides: Record<string, { docs_connect?: string }>;
  integrations_config_defaults: Record<
    string,
    {
      user_scopes?: string;
      authorization_params?: Record<string, string>;
      connection_config?: Record<string, unknown>;
    }
  >;
  is_reconnecting: boolean;
  reconnect_connection_id: string | null;
  reconnect_integration_id: string | null;
}

export interface NangoOAuthState extends Entity {
  state: string;
  session_token: string;
  provider_config_key: string;
  connection_id: string;
}

export interface NangoProxyLog extends Entity {
  request_id: string;
  provider_config_key: string;
  connection_id: string;
  method: string;
  endpoint: string;
  resolved_url: string;
  synthetic: boolean;
  request_headers: Record<string, string>;
  request_body: string | null;
  response_status: number | null;
  response_headers: Record<string, string>;
  response_body: string | null;
  error: string | null;
}

export interface NangoWebhookDelivery extends Entity {
  event: string;
  provider_config_key: string;
  connection_id: string | null;
  url: string;
  request_body: string;
  request_headers: Record<string, string>;
  response_status: number | null;
  success: boolean;
  error: string | null;
}

export interface NangoTelemetryEvent extends Entity {
  token: string;
  event: string;
  integration: string | null;
}
