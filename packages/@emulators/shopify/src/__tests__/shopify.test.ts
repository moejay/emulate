import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "@emulators/core";
import { Store, WebhookDispatcher, createApiErrorHandler, createErrorHandler } from "@emulators/core";
import { shopifyPlugin, seedFromConfig, verifySessionToken } from "../index.js";

const base = "http://localhost:4014";

const PRODUCTS_QUERY = `
  query Products($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          vendor
          productType
          descriptionHtml
          status
          tags
          featuredImage { url }
          images(first: 1) { edges { node { url } } }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                price
                compareAtPrice
                barcode
                inventoryQuantity
                inventoryItem {
                  measurement {
                    weight { unit value }
                  }
                }
              }
            }
          }
          updatedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const CUSTOMERS_QUERY = `
  query Customers($first: Int!, $after: String, $query: String) {
    customers(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          email
          firstName
          lastName
          phone
          state
          note
          tags
          numberOfOrders
          amountSpent { amount }
          defaultAddress {
            company
            address1
            address2
            city
            province
            provinceCode
            zip
            country
            countryCodeV2
            phone
          }
          addresses {
            company
            address1
            address2
            city
            province
            provinceCode
            zip
            country
            countryCodeV2
            phone
          }
          createdAt
          updatedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ORDERS_QUERY = `
  query Orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          name
          orderNumber: name
          email
          customer { id }
          displayFinancialStatus
          displayFulfillmentStatus
          cancelledAt
          createdAt
          updatedAt
          currencyCode
          currentSubtotalPriceSet { shopMoney { amount } }
          currentTotalTaxSet { shopMoney { amount } }
          currentTotalPriceSet { shopMoney { amount } }
          currentTotalDiscountsSet { shopMoney { amount } }
          currentShippingPriceSet { shopMoney { amount } }
          lineItems(first: 100) {
            edges {
              node {
                id
                variant { id }
                sku
                name
                title
                quantity
                originalUnitPriceSet { shopMoney { amount } }
                totalDiscountSet { shopMoney { amount } }
                discountAllocations { allocatedAmountSet { shopMoney { amount } } }
                taxLines { rate }
              }
            }
          }
          refunds {
            id
            createdAt
            note
            refundLineItems(first: 100) {
              edges {
                node {
                  lineItem {
                    id
                    variant { id }
                    sku
                    name
                    title
                    quantity
                    originalUnitPriceSet { shopMoney { amount } }
                  }
                  quantity
                  subtotalSet { shopMoney { amount } }
                  totalTaxSet { shopMoney { amount } }
                }
              }
            }
          }
          note
          tags
          shippingAddress {
            company
            firstName
            lastName
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const DRAFT_ORDER_CREATE_MUTATION = `
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        status
        totalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        lineItems(first: 100) {
          edges {
            node {
              id
              title
              quantity
              originalUnitPriceSet { shopMoney { amount } }
            }
          }
        }
        createdAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const BULK_OPERATION_MUTATION = `
  mutation BulkOperation($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const BULK_PRODUCTS_QUERY = `
    {
      products {
        edges {
          node {
            id
            title
            vendor
            productType
            descriptionHtml
            status
            tags
            featuredImage { url }
            variants {
              edges {
                node {
                  id title sku price compareAtPrice
                  barcode inventoryQuantity
                  inventoryItem {
                    measurement {
                      weight { unit value }
                    }
                  }
                }
              }
            }
            updatedAt
          }
        }
      }
    }
  `;

const BULK_ORDERS_QUERY = `
    {
      orders(query: "created_at:>='2026-01-01'") {
        edges {
          node {
            id
            name
            email
            customer { id }
            displayFinancialStatus
            displayFulfillmentStatus
            cancelledAt
            createdAt
            updatedAt
            currencyCode
            currentSubtotalPriceSet { shopMoney { amount } }
            currentTotalTaxSet { shopMoney { amount } }
            currentTotalPriceSet { shopMoney { amount } }
            currentTotalDiscountsSet { shopMoney { amount } }
            currentShippingPriceSet { shopMoney { amount } }
            subtotalPriceSet { shopMoney { amount } }
            totalTaxSet { shopMoney { amount } }
            totalPriceSet { shopMoney { amount } }
            totalDiscountsSet { shopMoney { amount } }
            totalShippingPriceSet { shopMoney { amount } }
            lineItems {
              edges {
                node {
                  id
                  variant { id }
                  sku name title quantity
                  originalUnitPriceSet { shopMoney { amount } }
                  totalDiscountSet { shopMoney { amount } }
                  discountAllocations { allocatedAmountSet { shopMoney { amount } } }
                  taxLines { rate }
                }
              }
            }
            refunds {
              id createdAt note
              refundLineItems {
                edges {
                  node {
                    lineItem {
                      id variant { id } sku name title quantity
                      originalUnitPriceSet { shopMoney { amount } }
                    }
                    quantity
                    subtotalSet { shopMoney { amount } }
                    totalTaxSet { shopMoney { amount } }
                  }
                }
              }
            }
            note
            tags
            shippingAddress { company firstName lastName }
          }
        }
      }
    }
  `;

function createTestApp() {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const app = new Hono();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  shopifyPlugin.register(app as any, store, webhooks, base, new Map());
  shopifyPlugin.seed?.(store, base);
  seedFromConfig(store, base, {
    products: [
      {
        id: 2002,
        title: "Demo Bars",
        vendor: "Opener Foods",
        status: "ACTIVE",
        tags: ["snack"],
        variants: [{ id: 3002, title: "24-pack", sku: "BARS-24", price: "72.00", inventory_quantity: 100 }],
        updated_at: "2026-01-10T00:00:00.000Z",
      },
      {
        id: 2003,
        title: "Retail Crackers",
        vendor: "Opener Foods",
        status: "ACTIVE",
        tags: ["b2b", "cracker"],
        variants: [{ id: 3003, title: "6-pack", sku: "CRACKER-6", price: "18.00", inventory_quantity: 80 }],
        updated_at: "2026-01-11T00:00:00.000Z",
      },
    ],
    customers: [
      {
        id: 1002,
        email: "buyer2@north-market.test",
        first_name: "Jordan",
        last_name: "Smith",
        company: "North Market",
        tags: ["retail", "b2b"],
        number_of_orders: 5,
        amount_spent: "890.00",
        updated_at: "2026-01-09T00:00:00.000Z",
      },
      {
        id: 1003,
        email: "consumer@example.test",
        first_name: "Alex",
        last_name: "Consumer",
        tags: ["d2c"],
        updated_at: "2026-01-12T00:00:00.000Z",
      },
    ],
    orders: [
      {
        id: 4002,
        name: "#1002",
        customer_id: 1002,
        email: "buyer2@north-market.test",
        display_financial_status: "PAID",
        display_fulfillment_status: "PARTIAL",
        updated_at: "2026-01-11T00:00:00.000Z",
        subtotal: "72.00",
        total_tax: "6.00",
        total_price: "78.00",
        total_discounts: "0.00",
        shipping_price: "0.00",
        line_items: [{ variant_id: 3002, quantity: 1 }],
        refunds: [
          {
            id: 1,
            refund_line_items: [{ line_item_id: 400201, quantity: 1, subtotal: "12.00", total_tax: "1.00" }],
          },
        ],
      },
      {
        id: 4003,
        name: "#1003",
        customer_id: 1003,
        email: "consumer@example.test",
        display_financial_status: "PENDING",
        display_fulfillment_status: "UNFULFILLED",
        updated_at: "2026-01-12T00:00:00.000Z",
        subtotal: "18.00",
        total_tax: "1.50",
        total_price: "19.50",
        total_discounts: "0.00",
        shipping_price: "0.00",
        line_items: [{ variant_id: 3003, quantity: 1 }],
      },
    ],
  });
  return { app, store };
}

function adminHeaders(token = "shpat_test_admin"): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };
}

describe("Shopify emulator", () => {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "ok" });

  beforeEach(() => {
    mockFetch.mockClear();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("completes the OAuth install flow and mints verifiable session tokens", async () => {
    const { app, store } = createTestApp();

    const authorize = await app.request(
      `${base}/admin/oauth/authorize?client_id=shopify-client-id&redirect_uri=${encodeURIComponent("http://localhost:3000/api/auth/callback/shopify")}&scope=read_products,read_orders&shop=demo-shop.myshopify.com&state=abc`,
    );
    expect(authorize.status).toBe(200);
    expect(await authorize.text()).toContain("Install Shopify App");

    const confirm = await app.request(`${base}/admin/oauth/authorize/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `client_id=shopify-client-id&redirect_uri=${encodeURIComponent("http://localhost:3000/api/auth/callback/shopify")}&shop=demo-shop.myshopify.com&state=abc&scope=read_products,read_orders`,
    });
    expect(confirm.status).toBe(302);
    const redirect = confirm.headers.get("Location");
    expect(redirect).toContain("code=");
    expect(redirect).toContain("hmac=");
    expect(redirect).toContain("id_token=");

    const callbackUrl = new URL(redirect!);
    const code = callbackUrl.searchParams.get("code")!;
    const idToken = callbackUrl.searchParams.get("id_token")!;
    const payload = verifySessionToken(store, idToken, {
      clientId: "shopify-client-id",
      shopDomain: "demo-shop.myshopify.com",
    });
    expect(payload?.aud).toBe("shopify-client-id");
    expect(payload?.dest).toBe("https://demo-shop.myshopify.com/admin");

    const exchange = await app.request(`${base}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "shopify-client-id",
        client_secret: "shopify-client-secret",
        code,
      }),
    });
    expect(exchange.status).toBe(200);
    const tokenBody = (await exchange.json()) as { access_token: string; associated_user: { email: string } };
    expect(tokenBody.access_token).toMatch(/^shpat_/);
    expect(tokenBody.associated_user.email).toBe("merchant@demo-shop.test");

    const minted = await app.request(`${base}/auth/session-token`, {
      headers: { "X-Shopify-Access-Token": tokenBody.access_token },
    });
    expect(minted.status).toBe(200);
    const mintedBody = (await minted.json()) as { token: string };
    const mintedPayload = verifySessionToken(store, mintedBody.token, {
      clientId: "shopify-client-id",
      shopDomain: "demo-shop.myshopify.com",
    });
    expect(mintedPayload?.sub).toContain("gid://shopify/User/");
  });

  it("serves Grow product, customer, and order documents with cursor pagination", async () => {
    const { app } = createTestApp();

    const productsPage1 = await app.request(`${base}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ query: PRODUCTS_QUERY, variables: { first: 2, after: null, query: null } }),
    });
    expect(productsPage1.status).toBe(200);
    const products1 = (await productsPage1.json()) as any;
    expect(products1.data.products.edges).toHaveLength(2);
    expect(products1.data.products.pageInfo.hasNextPage).toBe(true);
    expect(products1.data.products.edges[0].node.variants.edges[0].node.inventoryItem.measurement).toBeTruthy();

    const productsPage2 = await app.request(`${base}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        query: PRODUCTS_QUERY,
        variables: { first: 2, after: products1.data.products.pageInfo.endCursor, query: null },
      }),
    });
    const products2 = (await productsPage2.json()) as any;
    expect(products2.data.products.edges.length).toBeGreaterThanOrEqual(1);

    const customers = await app.request(`${base}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        query: CUSTOMERS_QUERY,
        variables: { first: 10, after: null, query: "tag:b2b" },
      }),
    });
    const customerBody = (await customers.json()) as any;
    expect(customerBody.data.customers.edges.length).toBe(2);
    expect(customerBody.data.customers.edges[0].node.defaultAddress.company).toBeTruthy();

    const orders = await app.request(`${base}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        query: ORDERS_QUERY,
        variables: { first: 10, after: null, query: "updated_at:>='2026-01-11T00:00:00.000Z'" },
      }),
    });
    const orderBody = (await orders.json()) as any;
    expect(orderBody.data.orders.edges.length).toBeGreaterThanOrEqual(2);
    expect(orderBody.data.orders.edges[0].node.lineItems.edges[0].node.quantity).toBeGreaterThan(0);
    expect(orderBody.data.orders.edges[0].node.refunds[0].refundLineItems.edges[0].node.totalTaxSet.shopMoney.amount).toBe("1.00");
  });

  it("creates draft orders from the exact Grow mutation", async () => {
    const { app } = createTestApp();
    const draftOrder = await app.request(`${base}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        query: DRAFT_ORDER_CREATE_MUTATION,
        variables: {
          input: {
            customerId: "gid://shopify/Customer/1001",
            lineItems: [{ variantId: "gid://shopify/ProductVariant/3001", quantity: 2 }],
            note: "Send a wholesale invoice",
          },
        },
      }),
    });
    expect(draftOrder.status).toBe(200);
    const body = (await draftOrder.json()) as any;
    expect(body.data.draftOrderCreate.userErrors).toEqual([]);
    expect(body.data.draftOrderCreate.draftOrder.id).toBe("gid://shopify/DraftOrder/7001");
    expect(body.data.draftOrderCreate.draftOrder.totalPriceSet.shopMoney.amount).toBe("96.00");
    expect(body.data.draftOrderCreate.draftOrder.invoiceUrl).toContain("draft_orders/7001/invoice");
  });

  it("runs bulk operations with Grow query documents, exposes JSONL, and signs finish webhooks", async () => {
    const { app } = createTestApp();

    await app.request(`${base}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        query: `mutation WebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
            userErrors { field message }
            webhookSubscription { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
          }
        }`,
        variables: {
          topic: "BULK_OPERATIONS_FINISH",
          webhookSubscription: { callbackUrl: "https://example.test/shopify-webhook" },
        },
      }),
    });

    const bulk = await app.request(`${base}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ query: BULK_OPERATION_MUTATION, variables: { query: BULK_PRODUCTS_QUERY } }),
    });
    expect(bulk.status).toBe(200);
    const bulkBody = (await bulk.json()) as any;
    expect(bulkBody.data.bulkOperationRunQuery.bulkOperation.status).toBe("CREATED");

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockFetch).toHaveBeenCalled();
    const [targetUrl, init] = mockFetch.mock.calls[0]!;
    expect(targetUrl).toBe("https://example.test/shopify-webhook");
    const headers = (init as RequestInit).headers as Record<string, string>;
    const body = (init as RequestInit).body as string;
    const expectedHmac = createHmac("sha256", "shopify-client-secret").update(body).digest("base64");
    expect(headers["X-Shopify-Topic"]).toBe("bulk_operations/finish");
    expect(headers["X-Shopify-Shop-Domain"]).toBe("demo-shop.myshopify.com");
    expect(headers["X-Shopify-Hmac-Sha256"]).toBe(expectedHmac);

    const payload = JSON.parse(body) as { url: string; status: string; object_count: string };
    expect(payload.status).toBe("completed");
    expect(Number(payload.object_count)).toBeGreaterThan(0);

    vi.unstubAllGlobals();
    const jsonl = await app.request(payload.url);
    expect(jsonl.status).toBe(200);
    const text = await jsonl.text();
    expect(text).toContain("gid://shopify/Product/");
    expect(text).toContain("__parentId");

    expect(text.split("\n").length).toBeGreaterThan(1);

    vi.stubGlobal("fetch", mockFetch);
    const orderBulk = await app.request(`${base}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ query: BULK_OPERATION_MUTATION, variables: { query: BULK_ORDERS_QUERY } }),
    });
    expect(orderBulk.status).toBe(200);
  });

  it("supports webhook subscriptions, GDPR topics, fulfillment mutations, and the inspector", async () => {
    const { app } = createTestApp();

    const subRes = await app.request(`${base}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        query: `mutation WebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
            userErrors { field message }
            webhookSubscription { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
          }
        }`,
        variables: {
          topic: "CUSTOMERS_REDACT",
          webhookSubscription: { callbackUrl: "https://example.test/gdpr" },
        },
      }),
    });
    const subBody = (await subRes.json()) as any;
    expect(subBody.data.webhookSubscriptionCreate.userErrors).toEqual([]);

    const emit = await app.request(`${base}/_inspector/webhooks/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "topic=customers/redact",
    });
    expect(emit.status).toBe(302);
    expect(mockFetch).toHaveBeenCalled();
    const gdprBody = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string) as any;
    expect(gdprBody.customer.id).toBeTruthy();
    expect(Array.isArray(gdprBody.orders_to_redact)).toBe(true);

    mockFetch.mockClear();
    await app.request(`${base}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        query: `mutation WebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
            userErrors { field message }
            webhookSubscription { id topic }
          }
        }`,
        variables: {
          topic: "ORDERS_UPDATED",
          webhookSubscription: { callbackUrl: "https://example.test/orders" },
        },
      }),
    });

    const fulfillment = await app.request(`${base}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        query: `mutation FulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
          fulfillmentCreateV2(fulfillment: $fulfillment) {
            fulfillment { id status trackingInfo { company number } createdAt }
            userErrors { field message }
          }
        }`,
        variables: {
          fulfillment: {
            lineItemsByFulfillmentOrder: [
              {
                fulfillmentOrderId: "gid://shopify/FulfillmentOrder/9002",
              },
            ],
            trackingInfo: { company: "UPS", number: "1Z999" },
            notifyCustomer: true,
          },
        },
      }),
    });
    expect(fulfillment.status).toBe(200);
    const fulfillmentBody = (await fulfillment.json()) as any;
    expect(fulfillmentBody.data.fulfillmentCreateV2.userErrors).toEqual([]);
    expect(fulfillmentBody.data.fulfillmentCreateV2.fulfillment.status).toBe("SUCCESS");
    expect(mockFetch).toHaveBeenCalled();

    const inspector = await app.request(`${base}/?tab=webhooks`);
    expect(inspector.status).toBe(200);
    const html = await inspector.text();
    expect(html).toContain("Shopify Inspector");
    expect(html).toContain("customers/redact");
  });
});
