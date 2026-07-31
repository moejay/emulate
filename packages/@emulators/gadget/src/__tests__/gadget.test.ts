import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "@emulators/core";
import { gadgetPlugin, getGadgetStore, seedFromConfig } from "../index.js";

const base = "http://localhost:4317";

function createTestApp() {
  const server = createServer(gadgetPlugin, { baseUrl: base, docsUrl: "https://emulate.dev/gadget" });
  gadgetPlugin.seed?.(server.store, base);
  return server;
}

async function gql(app: ReturnType<typeof createServer>["app"], query: string, variables?: Record<string, unknown>) {
  return app.request(`${base}/api/graphql`, {
    method: "POST",
    headers: {
      Authorization: "Bearer gadget_test_api_key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
}

describe("Gadget emulator", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("serves Grow's shop lookup query with the exact response envelope", async () => {
    const { app } = createTestApp();
    const query = `
      query GadgetShopByDomain {
        shopifyShops(first: 5, filter: { myshopifyDomain: { equals: "acme-snacks.myshopify.com" } }) {
          edges { node { id domain myshopifyDomain name } }
        }
      }
    `;

    const res = await gql(app, query);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        shopifyShops: {
          edges: [
            {
              node: {
                id: "gid://shopify/Shop/1",
                domain: null,
                myshopifyDomain: "acme-snacks.myshopify.com",
                name: "Acme Snacks",
              },
            },
          ],
        },
      },
    });
  });

  it("serves the granted Shopify scopes used by Grow attention checks", async () => {
    const { app } = createTestApp();
    const res = await gql(app, `
      query GadgetShopScopes($id: GadgetID!) {
        shopifyShop(id: $id) { grantedScopes }
      }
    `, { id: "gid://shopify/Shop/1" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        shopifyShop: {
          grantedScopes: ["read_customers", "read_orders", "read_products"],
        },
      },
    });
  });

  it("serves the pre-sync customer tag page action", async () => {
    const { app } = createTestApp();
    const mutation = `
      mutation CustomerTags($shopId: String!, $after: String) {
        listCustomerTagPage(shopId: $shopId, after: $after) {
          success
          errors { message code }
          result
        }
      }
    `;

    const res = await gql(app, mutation, {
      shopId: "gid://shopify/Shop/1",
      after: null,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        listCustomerTagPage: {
          success: true,
          errors: [],
          result: {
            tags: ["b2b", "east-coast"],
            tagsTruncated: false,
            customersScanned: 1,
            pageInfo: {
              hasNextPage: false,
              endCursor: "MA",
            },
          },
        },
      },
    });
  });

  it("paginates customer tags in Shopify ID order", async () => {
    const { app, store } = createTestApp();
    const customers = getGadgetStore(store).customers;
    const template = customers.all()[0];
    for (let id = 351; id >= 102; id -= 1) {
      customers.insert({
        ...template,
        id: `customer-${id}`,
        gadget_id: `gid://shopify/Customer/${id}`,
        legacy_resource_id: String(id),
        email: `buyer-${id}@example.test`,
        tags: [`tag-${id}`],
      });
    }

    const mutation = `
      mutation CustomerTags($shopId: String!, $after: String) {
        listCustomerTagPage(shopId: $shopId, after: $after) {
          success
          result
        }
      }
    `;
    const first = await gql(app, mutation, {
      shopId: "gid://shopify/Shop/1",
      after: null,
    });
    const firstBody = await first.json() as {
      data: { listCustomerTagPage: { result: { tags: string[]; pageInfo: { endCursor: string } } } };
    };
    expect(firstBody.data.listCustomerTagPage.result.tags).toHaveLength(251);
    expect(firstBody.data.listCustomerTagPage.result.tags).not.toContain("tag-351");

    const second = await gql(app, mutation, {
      shopId: "gid://shopify/Shop/1",
      after: firstBody.data.listCustomerTagPage.result.pageInfo.endCursor,
    });
    const secondBody = await second.json() as {
      data: { listCustomerTagPage: { result: { tags: string[]; customersScanned: number } } };
    };
    expect(secondBody.data.listCustomerTagPage.result).toEqual({
      tags: ["tag-351"],
      tagsTruncated: false,
      customersScanned: 1,
      pageInfo: { hasNextPage: false, endCursor: "MjUw" },
    });
  });

  it("caps large customer tag pages without normalizing exact values", async () => {
    const { app, store } = createTestApp();
    const customers = getGadgetStore(store).customers;
    const template = customers.all()[0];
    customers.insert({
      ...template,
      id: "tag-heavy-customer",
      gadget_id: "gid://shopify/Customer/0",
      legacy_resource_id: "0",
      email: "tag-heavy@example.test",
      tags: ["Case", "case", ...Array.from({ length: 500 }, (_, index) => `tag-${index + 1}`)],
    });

    const mutation = `
      mutation CustomerTags($shopId: String!) {
        listCustomerTagPage(shopId: $shopId) {
          success
          result
        }
      }
    `;
    const res = await gql(app, mutation, { shopId: "gid://shopify/Shop/1" });
    const body = await res.json() as {
      data: { listCustomerTagPage: { result: { tags: string[]; tagsTruncated: boolean } } };
    };
    expect(body.data.listCustomerTagPage.result.tags).toHaveLength(500);
    expect(body.data.listCustomerTagPage.result.tags).toContain("Case");
    expect(body.data.listCustomerTagPage.result.tags).toContain("case");
    expect(body.data.listCustomerTagPage.result.tagsTruncated).toBe(true);
  });

  it("rejects customer tag pages for an unknown shop", async () => {
    const { app } = createTestApp();
    const mutation = `
      mutation CustomerTags($shopId: String!) {
        listCustomerTagPage(shopId: $shopId) {
          success
          errors { message code }
          result
        }
      }
    `;

    const res = await gql(app, mutation, { shopId: "gid://shopify/Shop/missing" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        listCustomerTagPage: {
          success: false,
          errors: [{
            message: "Shopify shop not found: gid://shopify/Shop/missing",
            code: "NOT_FOUND",
          }],
          result: null,
        },
      },
    });
  });

  it("serves Grow's customer page query with addresses and pagination", async () => {
    const { app } = createTestApp();
    const query = `
      query GadgetCustomers {
        shopifyCustomers(first: 250, filter: { shopId: { equals: "gid://shopify/Shop/1" } }, sort: { updatedAt: Ascending }) {
          edges {
            node {
              id
              legacyResourceId
              email
              firstName
              lastName
              phone
              tags
              numberOfOrders
              amountSpent
              note
              defaultAddress {
                address1
                address2
                city
                province
                provinceCode
                zipCode
                country
                countryCode
                company
                phone
                latitude
                longitude
              }
              addresses {
                edges {
                  node {
                    company
                    address1
                    address2
                    city
                    province
                    provinceCode
                    zipCode
                    country
                    countryCode
                    phone
                    latitude
                    longitude
                  }
                }
              }
              updatedAt
            }
            cursor
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const res = await gql(app, query);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        shopifyCustomers: {
          edges: [
            {
              node: {
                id: "gid://shopify/Customer/101",
                legacyResourceId: "101",
                email: "buyer@harbormarket.example",
                firstName: "Harper",
                lastName: "Lee",
                phone: "+1 617-555-0101",
                tags: ["b2b", "east-coast"],
                numberOfOrders: 3,
                amountSpent: { amount: "245.50", currencyCode: "USD" },
                note: "Top wholesale account",
                defaultAddress: {
                  address1: "179 Commercial St",
                  address2: "Suite 4",
                  city: "Boston",
                  province: "Massachusetts",
                  provinceCode: "MA",
                  zipCode: "02109",
                  country: "United States",
                  countryCode: "US",
                  company: "Harbor Market",
                  phone: "+1 617-555-0101",
                  latitude: 42.3631,
                  longitude: -71.0537,
                },
                addresses: {
                  edges: [
                    {
                      node: {
                        company: "Harbor Market",
                        address1: "179 Commercial St",
                        address2: "Suite 4",
                        city: "Boston",
                        province: "Massachusetts",
                        provinceCode: "MA",
                        zipCode: "02109",
                        country: "United States",
                        countryCode: "US",
                        phone: "+1 617-555-0101",
                        latitude: 42.3631,
                        longitude: -71.0537,
                      },
                    },
                  ],
                },
                updatedAt: "2026-07-21T12:00:00.000Z",
              },
              cursor: "MA",
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: "MA",
          },
        },
      },
    });
  });

  it("serves Grow's order query with inline line items and JSON fields", async () => {
    const { app } = createTestApp();
    const query = `
      query GadgetOrdersWithLineItems {
        shopifyOrders(first: 250, filter: { shopId: { equals: "gid://shopify/Shop/1" } }, sort: { updatedAt: Ascending }) {
          edges {
            node {
              id
              legacyResourceId
              name
              email
              financialStatus
              fulfillmentStatus
              cancelledAt
              subtotalPriceSet
              currentSubtotalPriceSet
              currentTotalPriceSet
              currentTotalDiscountsSet
              totalTaxSet
              totalShippingPriceSet
              currency
              tags
              note
              customerId
              customer { id legacyResourceId }
              shippingAddress
              shopifyCreatedAt
              updatedAt
              lineItems {
                edges {
                  node {
                    id
                    name
                    title
                    sku
                    quantity
                    price
                    totalDiscountSet
                    discountAllocations
                    taxLines
                    variantId
                    variantTitle
                    vendor
                    product { id }
                    productId
                    variant { id }
                  }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
            cursor
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const res = await gql(app, query);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        shopifyOrders: {
          edges: [
            {
              node: {
                id: "gid://shopify/Order/301",
                legacyResourceId: "301",
                name: "#301",
                email: "buyer@harbormarket.example",
                financialStatus: "paid",
                fulfillmentStatus: "fulfilled",
                cancelledAt: null,
                subtotalPriceSet: { shopMoney: { amount: "24.00", currencyCode: "USD" } },
                currentSubtotalPriceSet: { shopMoney: { amount: "24.00", currencyCode: "USD" } },
                currentTotalPriceSet: { shopMoney: { amount: "29.48", currencyCode: "USD" } },
                currentTotalDiscountsSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
                totalTaxSet: { shopMoney: { amount: "1.48", currencyCode: "USD" } },
                totalShippingPriceSet: { shopMoney: { amount: "4.00", currencyCode: "USD" } },
                currency: "USD",
                tags: ["wholesale", "sample_followup"],
                note: "Leave at receiving",
                customerId: "gid://shopify/Customer/101",
                customer: {
                  id: "gid://shopify/Customer/101",
                  legacyResourceId: "101",
                },
                shippingAddress: {
                  firstName: "Harper",
                  lastName: "Lee",
                  company: "Harbor Market",
                  address1: "179 Commercial St",
                  address2: "Suite 4",
                  city: "Boston",
                  province: "Massachusetts",
                  provinceCode: "MA",
                  country: "United States",
                  countryCode: "US",
                  zip: "02109",
                  phone: "+1 617-555-0101",
                },
                shopifyCreatedAt: "2026-07-20T09:30:00.000Z",
                updatedAt: "2026-07-21T12:07:00.000Z",
                lineItems: {
                  edges: [
                    {
                      node: {
                        id: "gid://shopify/LineItem/501",
                        name: "Sea Salt Granola Bites",
                        title: "Sea Salt Granola Bites",
                        sku: "GRANOLA-12",
                        quantity: 1,
                        price: "24.00",
                        totalDiscountSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
                        discountAllocations: [],
                        taxLines: [{ rate: 0.06125 }],
                        variantId: "gid://shopify/ProductVariant/401",
                        variantTitle: "12 pack",
                        vendor: "Acme Snacks",
                        product: { id: "gid://shopify/Product/201" },
                        productId: "gid://shopify/Product/201",
                        variant: { id: "gid://shopify/ProductVariant/401" },
                      },
                    },
                  ],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: "MA",
                  },
                },
              },
              cursor: "MA",
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: "MA",
          },
        },
      },
    });
  });

  it("serves Grow's line item and fulfillment queries", async () => {
    const { app } = createTestApp();
    const lineItemQuery = `
      query GadgetOrderLineItems {
        shopifyOrderLineItems(first: 250, filter: { shopId: { equals: "gid://shopify/Shop/1" } }, sort: { updatedAt: Ascending }) {
          edges {
            node {
              id
              name
              title
              sku
              quantity
              price
              totalDiscountSet
              discountAllocations
              taxLines
              variantTitle
              vendor
              order { id }
              product { id }
              variant { id }
              updatedAt
            }
            cursor
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    const fulfillmentQuery = `
      query GadgetFulfillments {
        shopifyFulfillments(first: 250, filter: { shopId: { equals: "gid://shopify/Shop/1" } }) {
          edges {
            node {
              id
              status
              shipmentStatus
              deliveredAt
              order { id }
            }
            cursor
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const lineItemRes = await gql(app, lineItemQuery);
    expect(lineItemRes.status).toBe(200);
    expect(await lineItemRes.json()).toEqual({
      data: {
        shopifyOrderLineItems: {
          edges: [
            {
              node: {
                id: "gid://shopify/LineItem/501",
                name: "Sea Salt Granola Bites",
                title: "Sea Salt Granola Bites",
                sku: "GRANOLA-12",
                quantity: 1,
                price: "24.00",
                totalDiscountSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
                discountAllocations: [],
                taxLines: [{ rate: 0.06125 }],
                variantTitle: "12 pack",
                vendor: "Acme Snacks",
                order: { id: "gid://shopify/Order/301" },
                product: { id: "gid://shopify/Product/201" },
                variant: { id: "gid://shopify/ProductVariant/401" },
                updatedAt: "2026-07-21T12:08:00.000Z",
              },
              cursor: "MA",
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: "MA",
          },
        },
      },
    });

    const fulfillmentRes = await gql(app, fulfillmentQuery);
    expect(fulfillmentRes.status).toBe(200);
    expect(await fulfillmentRes.json()).toEqual({
      data: {
        shopifyFulfillments: {
          edges: [
            {
              node: {
                id: "gid://shopify/Fulfillment/601",
                status: "success",
                shipmentStatus: "delivered",
                deliveredAt: "2026-07-22T15:00:00.000Z",
                order: { id: "gid://shopify/Order/301" },
              },
              cursor: "MA",
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: "MA",
          },
        },
      },
    });
  });

  it("supports the real sample request query and mutation used by Grow workflows", async () => {
    const { app } = createTestApp();
    const query = `query($id:GadgetID!){
      sampleRequest(id:$id){
        id status customerName customerEmail customerAddress
        shippingAddress requestedAt shippedAt notes orderId updatedAt
      }
    }`;
    const mutation = `mutation($id:GadgetID!,$sampleRequest:UpdateSampleRequestInput!){
      updateSampleRequest(id:$id,sampleRequest:$sampleRequest){
        success
        errors { message code }
        sampleRequest { id status customerAddress shippingAddress updatedAt }
      }
    }`;

    const readRes = await gql(app, query, { id: "sample_request_1" });
    expect(readRes.status).toBe(200);
    expect(await readRes.json()).toEqual({
      data: {
        sampleRequest: {
          id: "sample_request_1",
          status: "pending",
          customerName: "Harper Lee",
          customerEmail: "buyer@harbormarket.example",
          customerAddress: "179 Commercial St, Boston, MA 02109, Canada",
          shippingAddress: {
            first_name: "Harper",
            last_name: "Lee",
            address1: "179 Commercial St",
            address2: "Suite 4",
            city: "Boston",
            province: "Massachusetts",
            province_code: "MA",
            country: "Canada",
            country_code: "CA",
            zip: "02109",
          },
          requestedAt: "2026-07-21T11:00:00.000Z",
          shippedAt: null,
          notes: "Pending address correction",
          orderId: null,
          updatedAt: "2026-07-21T11:05:00.000Z",
        },
      },
    });

    const updateRes = await gql(app, mutation, {
      id: "sample_request_1",
      sampleRequest: {
        customerAddress: "179 Commercial St, Boston, MA 02109, United States",
        shippingAddress: {
          first_name: "Harper",
          last_name: "Lee",
          address1: "179 Commercial St",
          address2: "Suite 4",
          city: "Boston",
          province: "Massachusetts",
          province_code: "MA",
          country: "United States",
          country_code: "US",
          zip: "02109",
        },
      },
    });
    expect(updateRes.status).toBe(200);
    const body = (await updateRes.json()) as any;
    expect(body.data.updateSampleRequest.success).toBe(true);
    expect(body.data.updateSampleRequest.errors).toEqual([]);
    expect(body.data.updateSampleRequest.sampleRequest).toEqual({
      id: "sample_request_1",
      status: "pending",
      customerAddress: "179 Commercial St, Boston, MA 02109, United States",
      shippingAddress: {
        first_name: "Harper",
        last_name: "Lee",
        address1: "179 Commercial St",
        address2: "Suite 4",
        city: "Boston",
        province: "Massachusetts",
        province_code: "MA",
        country: "United States",
        country_code: "US",
        zip: "02109",
      },
      updatedAt: body.data.updateSampleRequest.sampleRequest.updatedAt,
    });
  });

  it("serves Grow's exact /api/graphql route and keeps /graphql as a compatibility alias", async () => {
    const { app } = createTestApp();
    const query = "{ shopifyShops(first: 1) { edges { node { id } } } }";

    const primary = await app.request(`${base}/api/graphql`, {
      method: "POST",
      headers: {
        Authorization: "Bearer gadget_test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    expect(primary.status).toBe(200);
    expect(await primary.json()).toEqual({
      data: {
        shopifyShops: {
          edges: [{ node: { id: "gid://shopify/Shop/1" } }],
        },
      },
    });

    const legacy = await app.request(`${base}/graphql`, {
      method: "POST",
      headers: {
        Authorization: "Bearer gadget_test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toEqual({
      data: {
        shopifyShops: {
          edges: [{ node: { id: "gid://shopify/Shop/1" } }],
        },
      },
    });
  });

  it("requires API key auth", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${base}/api/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ shopifyShops(first: 1) { edges { node { id } } } }" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      errors: [{ message: "Missing Gadget API key." }],
    });
  });

  it("dispatches Grow-shaped integration and sample rejection webhooks and records deliveries", async () => {
    const { app, store } = createTestApp();
    seedFromConfig(store, base, {
      webhooks: [
        {
          id: "grow-webhook",
          label: "Grow local",
          url: "http://grow.local/api/webhooks/gadget",
          headers: { "x-internal-service-token": "local-test-token" },
        },
      ],
    });

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const integrationRes = await app.request(`${base}/inspector/integration-event`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        model: "shopifyOrder",
        operation: "update",
        recordId: "gid://shopify/Order/301",
      }),
    });
    expect(integrationRes.status).toBe(303);

    const sampleRes = await app.request(`${base}/inspector/sample-requests/sample_request_1/reject`, {
      method: "POST",
    });
    expect(sampleRes.status).toBe(303);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const integrationCall = fetchMock.mock.calls[0]!;
    const integrationInit = integrationCall[1] as RequestInit;
    expect(integrationCall[0]).toBe("http://grow.local/api/webhooks/gadget");
    expect(integrationInit.method).toBe("POST");
    expect(integrationInit.headers).toMatchObject({
      "content-type": "application/json",
      "x-internal-service-token": "local-test-token",
    });
    const integrationBody = JSON.parse(String(integrationInit.body));
    expect(integrationBody).toMatchObject({
      event_type: "shopify.integration_event",
      payload: {
        version: 1,
        shopId: "gid://shopify/Shop/1",
        shopDomain: "acme-snacks.myshopify.com",
        model: "shopifyOrder",
        operation: "update",
        recordId: "gid://shopify/Order/301",
        parentRecordId: null,
        triggerType: "emulator.inspector",
        triggerMetadata: { source: "inspector" },
        payload: null,
      },
    });
    expect((integrationInit.headers as Record<string, string>)["x-idempotency-key"]).toBe(integrationBody.payload.eventKey);

    const sampleCall = fetchMock.mock.calls[1]!;
    const sampleBody = JSON.parse(String((sampleCall[1] as RequestInit).body));
    expect(sampleBody).toEqual({
      event_type: "sample_request.rejected",
      payload: {
        sampleRequestId: "sample_request_1",
        activityId: "activity_abc",
        brandId: 42,
        storeId: 7,
      },
    });

    const deliveries = getGadgetStore(store).webhookDeliveries.all();
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((delivery) => ({ event: delivery.event_type, status: delivery.status, error: delivery.error }))).toEqual([
      { event: "shopify.integration_event", status: 202, error: null },
      { event: "sample_request.rejected", status: 202, error: null },
    ]);
  });
});
