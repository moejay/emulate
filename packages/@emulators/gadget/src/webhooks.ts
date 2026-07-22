import type { Store } from "@emulators/core";
import type { GadgetCustomer, GadgetOrder, GadgetProduct, GadgetSampleRequest } from "./entities.js";
import { isoNow, nextEventCounter } from "./helpers.js";
import { getGadgetStore } from "./store.js";

export type GadgetIntegrationModel = "shopifyCustomer" | "shopifyProduct" | "shopifyOrder";
export type GadgetIntegrationOperation = "create" | "update" | "delete";

export interface GadgetIntegrationEventEnvelope {
  event_type: "shopify.integration_event";
  payload:
    | {
        eventKey: string;
        version: 1;
        shopId: string;
        shopDomain: string;
        model: GadgetIntegrationModel;
        operation: "create" | "update";
        recordId: string;
        parentRecordId: string | null;
        sourceUpdatedAt: string;
        observedAt: string;
        triggerType: string;
        triggerMetadata: Record<string, unknown> | null;
        payload: null;
      }
    | {
        eventKey: string;
        version: 1;
        shopId: string;
        shopDomain: string;
        model: GadgetIntegrationModel;
        operation: "delete";
        recordId: string;
        parentRecordId: string | null;
        sourceUpdatedAt: string;
        observedAt: string;
        triggerType: string;
        triggerMetadata: Record<string, unknown> | null;
        payload: { deleted: true };
      };
}

export interface GadgetSampleRequestRejectedEnvelope {
  event_type: "sample_request.rejected";
  payload: {
    sampleRequestId: string;
    activityId: string;
    brandId: number;
    storeId: number;
  };
}

export async function dispatchWebhookEvent(
  store: Store,
  eventType: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<void> {
  const gs = getGadgetStore(store);
  const endpoints = gs.webhookEndpoints
    .all()
    .filter((endpoint) => endpoint.active && (endpoint.event_types.includes("*") || endpoint.event_types.includes(eventType)));

  const body = JSON.stringify(payload);
  for (const endpoint of endpoints) {
    const requestHeaders: Record<string, string> = {
      "content-type": "application/json",
      ...endpoint.headers,
      ...headers,
    };
    let status: number | null = null;
    let error: string | null = null;
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: requestHeaders,
        body,
        signal: AbortSignal.timeout(10000),
      });
      status = response.status;
      if (!response.ok) {
        error = `${response.status} ${response.statusText}`.trim();
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    gs.webhookDeliveries.insert({
      gadget_id: `delivery_${nextEventCounter(store)}`,
      webhook_id: endpoint.gadget_id,
      event_type: eventType,
      status,
      error,
      request_headers: requestHeaders,
      payload,
    });
  }
}

export function buildIntegrationEventEnvelope(
  store: Store,
  input: {
    model: GadgetIntegrationModel;
    operation: GadgetIntegrationOperation;
    shopId: string;
    shopDomain: string;
    recordId: string;
    sourceUpdatedAt: string;
    parentRecordId?: string | null;
    triggerType?: string;
    triggerMetadata?: Record<string, unknown> | null;
  },
): GadgetIntegrationEventEnvelope {
  const observedAt = isoNow();
  const eventKey = `evt_${input.model}_${input.operation}_${nextEventCounter(store)}`;
  const payloadBase = {
    eventKey,
    version: 1 as const,
    shopId: input.shopId,
    shopDomain: input.shopDomain,
    model: input.model,
    recordId: input.recordId,
    parentRecordId: input.parentRecordId ?? null,
    sourceUpdatedAt: input.sourceUpdatedAt,
    observedAt,
    triggerType: input.triggerType ?? "emulator.manual",
    triggerMetadata: input.triggerMetadata ?? null,
  };

  if (input.operation === "delete") {
    return {
      event_type: "shopify.integration_event",
      payload: {
        ...payloadBase,
        operation: "delete",
        payload: { deleted: true },
      },
    };
  }

  return {
    event_type: "shopify.integration_event",
    payload: {
      ...payloadBase,
      operation: input.operation,
      payload: null,
    },
  };
}

export async function dispatchIntegrationEvent(
  store: Store,
  input: {
    model: GadgetIntegrationModel;
    operation: GadgetIntegrationOperation;
    record: GadgetCustomer | GadgetProduct | GadgetOrder;
    triggerType?: string;
    triggerMetadata?: Record<string, unknown> | null;
  },
): Promise<GadgetIntegrationEventEnvelope> {
  const shop = getGadgetStore(store).shops.findOneBy("gadget_id", input.record.shop_id);
  if (!shop) throw new Error(`Shop not found for record ${input.record.gadget_id}`);
  const shopDomain = shop.myshopify_domain ?? shop.domain;
  if (!shopDomain) throw new Error(`Shop ${shop.gadget_id} has no domain for webhook delivery`);

  const envelope = buildIntegrationEventEnvelope(store, {
    model: input.model,
    operation: input.operation,
    shopId: input.record.shop_id,
    shopDomain,
    recordId: input.record.gadget_id,
    sourceUpdatedAt: input.record.updatedAt,
    triggerType: input.triggerType,
    triggerMetadata: input.triggerMetadata,
  });
  await dispatchWebhookEvent(store, envelope.event_type, envelope as unknown as Record<string, unknown>, {
    "x-idempotency-key": envelope.payload.eventKey,
  });
  return envelope;
}

export async function dispatchSampleRequestRejected(
  store: Store,
  sampleRequest: GadgetSampleRequest,
): Promise<GadgetSampleRequestRejectedEnvelope> {
  const envelope: GadgetSampleRequestRejectedEnvelope = {
    event_type: "sample_request.rejected",
    payload: {
      sampleRequestId: sampleRequest.gadget_id,
      activityId: sampleRequest.activity_id,
      brandId: sampleRequest.brand_id,
      storeId: sampleRequest.store_id,
    },
  };
  await dispatchWebhookEvent(store, envelope.event_type, envelope as unknown as Record<string, unknown>);
  return envelope;
}
