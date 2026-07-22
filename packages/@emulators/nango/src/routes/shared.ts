import { signWebhookBody, toFullConnectionShape } from "../helpers.js";
import type { NangoConnection, NangoConnectionCredentials, NangoEndUser, NangoProviderConfig } from "../entities.js";
import { getNangoStore } from "../store.js";
import type { Store } from "@emulators/core";
import { getRuntimeConfig } from "../helpers.js";

export function upsertConnection(
  store: Store,
  input: {
    existingConnectionId?: string | null;
    providerConfigKey: string;
    provider: string;
    connectionId: string;
    connectionConfig: Record<string, unknown> | null;
    credentials: NangoConnectionCredentials;
    endUser: NangoEndUser | null;
    tags: Record<string, string>;
    metadata: Record<string, unknown> | null;
  },
): NangoConnection {
  const ns = getNangoStore(store);
  const existing = input.existingConnectionId
    ? ns.connections.findOneBy("connection_id", input.existingConnectionId)
    : ns.connections
        .all()
        .find((connection) => connection.provider_config_key === input.providerConfigKey && connection.connection_id === input.connectionId);

  if (existing) {
    return ns.connections.update(existing.id, {
      provider_config_key: input.providerConfigKey,
      provider: input.provider,
      connection_id: input.connectionId,
      connection_config: input.connectionConfig,
      credentials: input.credentials,
      end_user: input.endUser,
      tags: input.tags,
      metadata: input.metadata,
      errors: [],
      last_fetched_at: existing.last_fetched_at,
    })!;
  }

  return ns.connections.insert({
    provider_config_key: input.providerConfigKey,
    provider: input.provider,
    connection_id: input.connectionId,
    connection_config: input.connectionConfig,
    credentials: input.credentials,
    end_user: input.endUser,
    tags: input.tags,
    metadata: input.metadata,
    errors: [],
    last_fetched_at: null,
  });
}

export async function dispatchConnectionWebhook(
  store: Store,
  integration: NangoProviderConfig,
  connection: NangoConnection,
  event: string,
): Promise<void> {
  if (!integration.forward_webhooks || !integration.webhook_url) return;

  const payload = JSON.stringify({
    event,
    provider_config_key: integration.unique_key,
    connection_id: connection.connection_id,
    connection: toFullConnectionShape(connection),
  });
  const signature = signWebhookBody(getRuntimeConfig(store).secret_key, payload);
  const headers = {
    "Content-Type": "application/json",
    "X-Nango-Hmac-Sha256": signature,
  };

  let responseStatus: number | null = null;
  let success = false;
  let error: string | null = null;
  try {
    const res = await fetch(integration.webhook_url, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = res.status;
    success = res.ok;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  getNangoStore(store).webhookDeliveries.insert({
    event,
    provider_config_key: integration.unique_key,
    connection_id: connection.connection_id,
    url: integration.webhook_url,
    request_body: payload,
    request_headers: headers,
    response_status: responseStatus,
    success,
    error,
  });
}
