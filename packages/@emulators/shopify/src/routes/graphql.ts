import type { RouteContext } from "@emulators/core";
import { getShopifyStore } from "../store.js";
import { resolveAdminAuth } from "../auth.js";
import {
  ensureGid,
  includesAllTerms,
  isoAtLeast,
  normalizeMoney,
  normalizeTopic,
  numberFromGid,
  paginateArray,
  parseSearchQuery,
  randomToken,
  topicToEnum,
} from "../helpers.js";
import { dispatchShopifyWebhook } from "../webhooks.js";

const DEFAULT_API_VERSION = "2026-01";

function shopRecord(ss: ReturnType<typeof getShopifyStore>, shopDomain: string) {
  return ss.shops.findOneBy("myshopify_domain", shopDomain) ?? ss.shops.all()[0];
}

function buildShopGraphql(ss: ReturnType<typeof getShopifyStore>, shopDomain: string) {
  const shop = shopRecord(ss, shopDomain);
  if (!shop) return null;
  return {
    id: shop.shop_gid,
    name: shop.name,
    email: shop.email,
    myshopifyDomain: shop.myshopify_domain,
    currencyCode: shop.currency_code,
    timezoneAbbreviation: shop.timezone,
    primaryDomain: {
      url: shop.primary_domain,
      host: new URL(shop.primary_domain).host,
    },
    plan: {
      displayName: shop.plan_display_name,
      partnerDevelopment: shop.plan_partner_development,
      shopifyPlus: false,
    },
    billingAddress: {
      address1: "123 Market St",
      city: "San Francisco",
      countryCodeV2: "US",
    },
  };
}

function buildCompanyContactProfile(ss: ReturnType<typeof getShopifyStore>, profileGid: string) {
  const profile = ss.companyContactProfiles.findOneBy("profile_gid", profileGid);
  if (!profile) return null;
  const company = ss.companies.findOneBy("company_gid", profile.company_gid);
  const customer = ss.customers.findOneBy("customer_gid", profile.customer_gid);
  return {
    id: profile.profile_gid,
    title: profile.title,
    locale: profile.locale,
    company: company
      ? {
          id: company.company_gid,
          name: company.name,
          externalId: company.external_id,
        }
      : null,
    customer: customer
      ? {
          id: customer.customer_gid,
          email: customer.email,
        }
      : null,
  };
}

function buildCustomerGraphql(ss: ReturnType<typeof getShopifyStore>, customer: ReturnType<typeof getShopifyStore>["customers"]["all"] extends () => Array<infer T> ? T : never) {
  return {
    id: customer.customer_gid,
    email: customer.email,
    firstName: customer.first_name,
    lastName: customer.last_name,
    phone: customer.phone,
    state: customer.state,
    note: customer.note,
    tags: customer.tags,
    numberOfOrders: customer.number_of_orders,
    amountSpent: customer.amount_spent ? { amount: customer.amount_spent } : null,
    defaultAddress: customer.default_address,
    addresses: customer.addresses,
    companyContactProfiles: {
      edges: customer.company_contact_profile_ids
        .map((profileGid) => buildCompanyContactProfile(ss, profileGid))
        .filter(Boolean)
        .map((profile) => ({ node: profile })),
    },
    createdAt: customer.created_at_iso,
    updatedAt: customer.updated_at_iso,
  };
}

function buildCompanyGraphql(ss: ReturnType<typeof getShopifyStore>, company: ReturnType<typeof getShopifyStore>["companies"]["all"] extends () => Array<infer T> ? T : never) {
  const contacts = ss.companyContactProfiles
    .findBy("company_gid", company.company_gid)
    .map((profile) => ({ profile, customer: ss.customers.findOneBy("customer_gid", profile.customer_gid) }))
    .filter((entry) => entry.customer);
  const locations = ss.companyLocations.findBy("company_gid", company.company_gid);
  return {
    id: company.company_gid,
    name: company.name,
    externalId: company.external_id,
    note: company.note,
    createdAt: company.created_at_iso,
    updatedAt: company.updated_at_iso,
    contactsCount: contacts.length,
    customerSince: contacts[0]?.customer?.created_at_iso ?? company.created_at_iso,
    mainContact: company.main_contact_customer_gid
      ? {
          customer: ss.customers.findOneBy("customer_gid", company.main_contact_customer_gid)
            ? {
                id: company.main_contact_customer_gid,
                email: ss.customers.findOneBy("customer_gid", company.main_contact_customer_gid)?.email ?? null,
              }
            : null,
        }
      : null,
    contacts: {
      edges: contacts.map(({ profile, customer }) => ({
        node: {
          id: profile.profile_gid,
          title: profile.title,
          customer: {
            id: customer!.customer_gid,
            email: customer!.email,
            firstName: customer!.first_name,
            lastName: customer!.last_name,
          },
        },
      })),
    },
    locations: {
      edges: locations.map((location) => ({
        node: {
          id: location.location_gid,
          name: location.name,
          shippingAddress: location.shipping_address,
          billingSameAsShipping: location.billing_same_as_shipping,
        },
      })),
    },
  };
}

function buildProductGraphql(ss: ReturnType<typeof getShopifyStore>, product: ReturnType<typeof getShopifyStore>["products"]["all"] extends () => Array<infer T> ? T : never) {
  const variants = ss.variants.findBy("product_gid", product.product_gid);
  return {
    id: product.product_gid,
    title: product.title,
    vendor: product.vendor,
    productType: product.product_type,
    descriptionHtml: product.description_html,
    status: product.status,
    tags: product.tags,
    featuredImage: product.featured_image_url ? { url: product.featured_image_url } : null,
    images: {
      edges: product.featured_image_url ? [{ node: { url: product.featured_image_url } }] : [],
    },
    variants: {
      edges: variants.map((variant) => ({
        node: {
          id: variant.variant_gid,
          title: variant.title,
          sku: variant.sku,
          price: variant.price,
          compareAtPrice: variant.compare_at_price,
          barcode: variant.barcode,
          inventoryQuantity: variant.inventory_quantity,
          inventoryItem: {
            measurement: {
              weight:
                variant.weight_value != null && variant.weight_unit
                  ? { unit: variant.weight_unit, value: variant.weight_value }
                  : null,
            },
          },
        },
      })),
    },
    updatedAt: product.updated_at_iso,
  };
}

function buildOrderGraphql(ss: ReturnType<typeof getShopifyStore>, order: ReturnType<typeof getShopifyStore>["orders"]["all"] extends () => Array<infer T> ? T : never) {
  const fulfillmentOrders = order.fulfillment_order_gids
    .map((gid) => ss.fulfillmentOrders.findOneBy("fulfillment_order_gid", gid))
    .filter(Boolean);
  const fulfillments = order.fulfillment_gids
    .map((gid) => ss.fulfillments.findOneBy("fulfillment_gid", gid))
    .filter(Boolean);
  return {
    id: order.order_gid,
    name: order.name,
    orderNumber: order.name,
    email: order.email,
    customer: order.customer_gid ? { id: order.customer_gid } : null,
    displayFinancialStatus: order.display_financial_status,
    displayFulfillmentStatus: order.display_fulfillment_status,
    cancelledAt: order.cancelled_at,
    createdAt: order.created_at_iso,
    updatedAt: order.updated_at_iso,
    currencyCode: order.currency_code,
    currentSubtotalPriceSet: order.subtotal_amount ? { shopMoney: { amount: order.subtotal_amount } } : null,
    currentTotalTaxSet: order.total_tax_amount ? { shopMoney: { amount: order.total_tax_amount } } : null,
    currentTotalPriceSet: order.total_price_amount ? { shopMoney: { amount: order.total_price_amount } } : null,
    currentTotalDiscountsSet: order.total_discounts_amount ? { shopMoney: { amount: order.total_discounts_amount } } : null,
    currentShippingPriceSet: order.shipping_price_amount ? { shopMoney: { amount: order.shipping_price_amount } } : null,
    subtotalPriceSet: order.subtotal_amount ? { shopMoney: { amount: order.subtotal_amount } } : null,
    totalTaxSet: order.total_tax_amount ? { shopMoney: { amount: order.total_tax_amount } } : null,
    totalPriceSet: order.total_price_amount ? { shopMoney: { amount: order.total_price_amount } } : null,
    totalDiscountsSet: order.total_discounts_amount ? { shopMoney: { amount: order.total_discounts_amount } } : null,
    totalShippingPriceSet: order.shipping_price_amount ? { shopMoney: { amount: order.shipping_price_amount } } : null,
    lineItems: {
      edges: order.line_items.map((lineItem) => ({
        node: {
          id: lineItem.id,
          variant: lineItem.variant_id ? { id: lineItem.variant_id } : null,
          sku: lineItem.sku,
          name: lineItem.name,
          title: lineItem.title,
          quantity: lineItem.quantity,
          originalUnitPriceSet: lineItem.original_unit_price ? { shopMoney: { amount: lineItem.original_unit_price } } : null,
          totalDiscountSet: lineItem.total_discount ? { shopMoney: { amount: lineItem.total_discount } } : null,
          discountAllocations: lineItem.discount_allocations.map((amount) => ({
            allocatedAmountSet: { shopMoney: { amount } },
          })),
          taxLines: lineItem.tax_rates.map((rate) => ({ rate })),
        },
      })),
    },
    refunds: order.refunds.map((refund) => ({
      id: refund.id,
      createdAt: refund.created_at_iso,
      note: refund.note,
      refundLineItems: {
        edges: refund.refund_line_items.map((lineItem) => ({
          node: {
            lineItem: {
              id: lineItem.line_item.id,
              variant: lineItem.line_item.variant_id ? { id: lineItem.line_item.variant_id } : null,
              sku: lineItem.line_item.sku,
              name: lineItem.line_item.name,
              title: lineItem.line_item.title,
              quantity: lineItem.line_item.quantity,
              originalUnitPriceSet: lineItem.line_item.original_unit_price
                ? { shopMoney: { amount: lineItem.line_item.original_unit_price } }
                : null,
            },
            quantity: lineItem.quantity,
            subtotalSet: lineItem.subtotal ? { shopMoney: { amount: lineItem.subtotal } } : null,
            totalTaxSet: lineItem.total_tax ? { shopMoney: { amount: lineItem.total_tax } } : null,
          },
        })),
      },
    })),
    note: order.note,
    tags: order.tags,
    shippingAddress: order.shipping_address,
    fulfillmentOrders: {
      edges: fulfillmentOrders.map((fulfillmentOrder) => ({
        node: {
          id: fulfillmentOrder!.fulfillment_order_gid,
          status: fulfillmentOrder!.status,
          requestStatus: fulfillmentOrder!.request_status,
          supportedActions: fulfillmentOrder!.supported_actions,
          assignedLocation: { name: fulfillmentOrder!.assigned_location_name },
          lineItems: {
            edges: fulfillmentOrder!.line_items.map((lineItem) => ({
              node: {
                id: lineItem.id,
                lineItem: { id: lineItem.line_item_gid },
                totalQuantity: lineItem.total_quantity,
                remainingQuantity: lineItem.remaining_quantity,
              },
            })),
          },
        },
      })),
    },
    fulfillments: {
      edges: fulfillments.map((fulfillment) => ({
        node: {
          id: fulfillment!.fulfillment_gid,
          status: fulfillment!.status,
          trackingInfo: fulfillment!.tracking_numbers.map((number) => ({
            company: fulfillment!.tracking_company,
            number,
          })),
          createdAt: fulfillment!.created_at_iso,
        },
      })),
    },
  };
}

function filterCustomers(ss: ReturnType<typeof getShopifyStore>, rawQuery: string | undefined | null) {
  const search = parseSearchQuery(rawQuery);
  return ss.customers
    .all()
    .filter((customer) => isoAtLeast(customer.updated_at_iso, search.updatedAtGte))
    .filter((customer) => isoAtLeast(customer.created_at_iso, search.createdAtGte))
    .filter((customer) => {
      if (search.tag && !customer.tags.some((tag) => tag.toLowerCase() === search.tag!.toLowerCase())) return false;
      return true;
    })
    .filter((customer) =>
      includesAllTerms(
        [
          customer.email,
          customer.first_name,
          customer.last_name,
          customer.default_address?.company,
          customer.tags.join(" "),
        ],
        search.freeText,
      ),
    )
    .sort((a, b) => a.updated_at_iso.localeCompare(b.updated_at_iso));
}

function filterProducts(ss: ReturnType<typeof getShopifyStore>, rawQuery: string | undefined | null) {
  const search = parseSearchQuery(rawQuery);
  return ss.products
    .all()
    .filter((product) => isoAtLeast(product.updated_at_iso, search.updatedAtGte))
    .filter((product) => {
      if (search.status && product.status.toLowerCase() !== search.status.toLowerCase()) return false;
      if (search.vendor && product.vendor?.toLowerCase() !== search.vendor.toLowerCase()) return false;
      if (search.tag && !product.tags.some((tag) => tag.toLowerCase() === search.tag!.toLowerCase())) return false;
      return true;
    })
    .filter((product) => includesAllTerms([product.title, product.vendor, product.product_type, product.tags.join(" ")], search.freeText))
    .sort((a, b) => a.updated_at_iso.localeCompare(b.updated_at_iso));
}

function filterOrders(ss: ReturnType<typeof getShopifyStore>, rawQuery: string | undefined | null) {
  const search = parseSearchQuery(rawQuery);
  return ss.orders
    .all()
    .filter((order) => isoAtLeast(order.updated_at_iso, search.updatedAtGte))
    .filter((order) => isoAtLeast(order.created_at_iso, search.createdAtGte))
    .filter((order) => {
      if (search.tag && !order.tags.some((tag) => tag.toLowerCase() === search.tag!.toLowerCase())) return false;
      return true;
    })
    .filter((order) => {
      const customer = order.customer_gid ? ss.customers.findOneBy("customer_gid", order.customer_gid) : undefined;
      return includesAllTerms(
        [order.name, order.email, order.shipping_address?.company, order.tags.join(" "), customer?.email],
        search.freeText,
      );
    })
    .sort((a, b) => a.updated_at_iso.localeCompare(b.updated_at_iso));
}

function inferBulkModel(query: string): string | null {
  if (/\bcustomers\b/i.test(query)) return "customers";
  if (/\bproducts\b/i.test(query)) return "products";
  if (/\borders\b/i.test(query)) return "orders";
  return null;
}

function extractBulkSearchQuery(query: string, model: string): string | null {
  const match = query.match(new RegExp(`${model}\\s*\\(\\s*query\\s*:\\s*"([^"]*)"`, "i"));
  return match?.[1] ?? null;
}

function buildBulkJsonl(
  ss: ReturnType<typeof getShopifyStore>,
  model: string,
  _shopDomain: string,
  rawQuery: string | null,
): { lines: string[]; objectCount: number } {
  if (model === "customers") {
    const customers = filterCustomers(ss, rawQuery);
    const lines = customers.map((customer) => JSON.stringify(buildCustomerGraphql(ss, customer)));
    return { lines, objectCount: customers.length };
  }
  if (model === "products") {
    const products = filterProducts(ss, rawQuery);
    const lines: string[] = [];
    for (const product of products) {
      const variants = ss.variants.findBy("product_gid", product.product_gid);
      lines.push(
        JSON.stringify({
          id: product.product_gid,
          title: product.title,
          vendor: product.vendor,
          productType: product.product_type,
          descriptionHtml: product.description_html,
          status: product.status,
          tags: product.tags,
          featuredImage: product.featured_image_url ? { url: product.featured_image_url } : null,
          updatedAt: product.updated_at_iso,
        }),
      );
      for (const variant of variants) {
        lines.push(
          JSON.stringify({
            __parentId: product.product_gid,
            id: variant.variant_gid,
            title: variant.title,
            sku: variant.sku,
            price: variant.price,
            compareAtPrice: variant.compare_at_price,
            barcode: variant.barcode,
            inventoryQuantity: variant.inventory_quantity,
            inventoryItem: {
              measurement: {
                weight:
                  variant.weight_value != null && variant.weight_unit
                    ? { unit: variant.weight_unit, value: variant.weight_value }
                    : null,
              },
            },
          }),
        );
      }
    }
    return { lines, objectCount: products.length };
  }

  const orders = filterOrders(ss, rawQuery);
  const lines: string[] = [];
  for (const order of orders) {
    lines.push(
      JSON.stringify({
        id: order.order_gid,
        name: order.name,
        email: order.email,
        customer: order.customer_gid ? { id: order.customer_gid } : null,
        displayFinancialStatus: order.display_financial_status,
        displayFulfillmentStatus: order.display_fulfillment_status,
        cancelledAt: order.cancelled_at,
        createdAt: order.created_at_iso,
        updatedAt: order.updated_at_iso,
        currencyCode: order.currency_code,
        currentSubtotalPriceSet: order.subtotal_amount ? { shopMoney: { amount: order.subtotal_amount } } : null,
        currentTotalTaxSet: order.total_tax_amount ? { shopMoney: { amount: order.total_tax_amount } } : null,
        currentTotalPriceSet: order.total_price_amount ? { shopMoney: { amount: order.total_price_amount } } : null,
        currentTotalDiscountsSet: order.total_discounts_amount ? { shopMoney: { amount: order.total_discounts_amount } } : null,
        currentShippingPriceSet: order.shipping_price_amount ? { shopMoney: { amount: order.shipping_price_amount } } : null,
        subtotalPriceSet: order.subtotal_amount ? { shopMoney: { amount: order.subtotal_amount } } : null,
        totalTaxSet: order.total_tax_amount ? { shopMoney: { amount: order.total_tax_amount } } : null,
        totalPriceSet: order.total_price_amount ? { shopMoney: { amount: order.total_price_amount } } : null,
        totalDiscountsSet: order.total_discounts_amount ? { shopMoney: { amount: order.total_discounts_amount } } : null,
        totalShippingPriceSet: order.shipping_price_amount ? { shopMoney: { amount: order.shipping_price_amount } } : null,
        refunds: order.refunds.map((refund) => ({
          id: refund.id,
          createdAt: refund.created_at_iso,
          note: refund.note,
          refundLineItems: {
            edges: refund.refund_line_items.map((lineItem) => ({
              node: {
                lineItem: {
                  id: lineItem.line_item.id,
                  variant: lineItem.line_item.variant_id ? { id: lineItem.line_item.variant_id } : null,
                  sku: lineItem.line_item.sku,
                  name: lineItem.line_item.name,
                  title: lineItem.line_item.title,
                  quantity: lineItem.line_item.quantity,
                  originalUnitPriceSet: lineItem.line_item.original_unit_price
                    ? { shopMoney: { amount: lineItem.line_item.original_unit_price } }
                    : null,
                },
                quantity: lineItem.quantity,
                subtotalSet: lineItem.subtotal ? { shopMoney: { amount: lineItem.subtotal } } : null,
                totalTaxSet: lineItem.total_tax ? { shopMoney: { amount: lineItem.total_tax } } : null,
              },
            })),
          },
        })),
        note: order.note,
        tags: order.tags,
        shippingAddress: order.shipping_address,
      }),
    );
    for (const lineItem of order.line_items) {
      lines.push(
        JSON.stringify({
          __parentId: order.order_gid,
          id: lineItem.id,
          variant: lineItem.variant_id ? { id: lineItem.variant_id } : null,
          sku: lineItem.sku,
          name: lineItem.name,
          title: lineItem.title,
          quantity: lineItem.quantity,
          originalUnitPriceSet: lineItem.original_unit_price ? { shopMoney: { amount: lineItem.original_unit_price } } : null,
          totalDiscountSet: lineItem.total_discount ? { shopMoney: { amount: lineItem.total_discount } } : null,
          discountAllocations: lineItem.discount_allocations.map((amount) => ({
            allocatedAmountSet: { shopMoney: { amount } },
          })),
          taxLines: lineItem.tax_rates.map((rate) => ({ rate })),
        }),
      );
    }
  }
  return { lines, objectCount: orders.length };
}

async function completeBulkOperation(
  ctx: RouteContext,
  auth: NonNullable<ReturnType<typeof resolveAdminAuth>>,
  operationGid: string,
  model: string,
): Promise<void> {
  const ss = getShopifyStore(ctx.store);
  const operation = ss.bulkOperations.findOneBy("bulk_operation_gid", operationGid);
  if (!operation) return;
  const result = buildBulkJsonl(ss, model, auth.shopDomain, extractBulkSearchQuery(operation.query, model));
  const apiVersion = DEFAULT_API_VERSION;
  const url = `${ctx.baseUrl.replace(/\/$/, "")}/admin/api/${apiVersion}/bulk/${numberFromGid(operationGid)}.jsonl`;
  ss.bulkOperations.update(operation.id, {
    status: "COMPLETED",
    url,
    object_count: result.objectCount,
    completed_at: new Date().toISOString(),
  });
  ctx.store.setData(`shopify.bulk.result.${operationGid}`, result.lines.join("\n"));
  await dispatchShopifyWebhook(ctx.store, ctx.baseUrl, {
    shopDomain: auth.shopDomain,
    topic: "bulk_operations/finish",
    payload: {
      admin_graphql_api_id: operationGid,
      status: "completed",
      type: "query",
      object_count: String(result.objectCount),
      url,
      partial_data_url: null,
      created_at: operation.created_at,
      completed_at: new Date().toISOString(),
      error_code: null,
    },
  });
}

function webhookEndpoint(subscription: ReturnType<typeof getShopifyStore>["webhookSubscriptions"]["all"] extends () => Array<infer T> ? T : never) {
  return {
    __typename: "WebhookHttpEndpoint",
    callbackUrl: subscription.uri,
    uri: subscription.uri,
  };
}

function maybeTopicEnum(value: unknown): string {
  return topicToEnum(String(value ?? ""));
}

function graphQLError(message: string, code = "BAD_REQUEST") {
  return { errors: [{ message, extensions: { code } }] };
}

export function graphqlRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ss = () => getShopifyStore(store);

  app.get("/admin/api/:version/bulk/:id{\\d+}.jsonl", (c) => {
    const id = c.req.param("id");
    const operationGid = ensureGid("BulkOperation", id);
    const data = store.getData<string>(`shopify.bulk.result.${operationGid}`);
    if (!data) return c.text("Not Found", 404);
    return c.body(data, 200, { "Content-Type": "application/jsonl; charset=UTF-8" });
  });

  app.post("/admin/api/:version/graphql.json", async (c) => {
    const auth = resolveAdminAuth(store, c);
    if (!auth) return c.json(graphQLError("Access denied", "ACCESS_DENIED"), 401);

    const body = (await c.req.json().catch(() => null)) as { query?: string; variables?: Record<string, unknown> } | null;
    const query = body?.query ?? "";
    const variables = body?.variables ?? {};
    const version = c.req.param("version") || DEFAULT_API_VERSION;

    if (!query) return c.json(graphQLError("Query is required"), 400);

    if (query.includes("shop {") || query.includes("shop{")) {
      return c.json({ data: { shop: buildShopGraphql(ss(), auth.shopDomain) } });
    }

    if (/\bcompanies\s*\(/.test(query)) {
      const companies = ss().companies.all().sort((a, b) => a.name.localeCompare(b.name));
      const page = paginateArray("companies", companies, Number(variables.first ?? 50), (variables.after as string | null | undefined) ?? null);
      return c.json({
        data: {
          companies: {
            edges: page.items.map((company) => ({ node: buildCompanyGraphql(ss(), company) })),
            pageInfo: page.pageInfo,
          },
        },
      });
    }

    if (/\bcustomers\s*\(/.test(query) && !query.includes("data_request")) {
      const customers = filterCustomers(ss(), variables.query as string | undefined);
      const page = paginateArray("customers", customers, Number(variables.first ?? 50), (variables.after as string | null | undefined) ?? null);
      return c.json({
        data: {
          customers: {
            edges: page.items.map((customer) => ({ node: buildCustomerGraphql(ss(), customer) })),
            pageInfo: page.pageInfo,
          },
        },
      });
    }

    if (/\bproducts\s*\(/.test(query) && !query.includes("bulkOperationRunQuery")) {
      const products = filterProducts(ss(), variables.query as string | undefined);
      const page = paginateArray("products", products, Number(variables.first ?? 50), (variables.after as string | null | undefined) ?? null);
      return c.json({
        data: {
          products: {
            edges: page.items.map((product) => ({ node: buildProductGraphql(ss(), product) })),
            pageInfo: page.pageInfo,
          },
        },
      });
    }

    if (/\border\s*\(/.test(query) && query.includes("fulfillmentOrders")) {
      const id = String(variables.id ?? "");
      const order = ss().orders.findOneBy("order_gid", id);
      return c.json({ data: { order: order ? buildOrderGraphql(ss(), order) : null } });
    }

    if (/\borders\s*\(/.test(query) && !query.includes("draftOrderCreate")) {
      const orders = filterOrders(ss(), variables.query as string | undefined);
      const page = paginateArray("orders", orders, Number(variables.first ?? 50), (variables.after as string | null | undefined) ?? null);
      return c.json({
        data: {
          orders: {
            edges: page.items.map((order) => ({ node: buildOrderGraphql(ss(), order) })),
            pageInfo: page.pageInfo,
          },
        },
      });
    }

    if (query.includes("currentBulkOperation")) {
      const current = ss()
        .bulkOperations
        .all()
        .filter((operation) => operation.client_id === auth.clientId && operation.shop_domain === auth.shopDomain)
        .sort((a, b) => b.numeric_id - a.numeric_id)[0];
      return c.json({
        data: {
          currentBulkOperation: current
            ? {
                id: current.bulk_operation_gid,
                status: current.status,
                errorCode: current.error_code,
                objectCount: String(current.object_count),
                url: current.url,
              }
            : null,
        },
      });
    }

    if (query.includes("bulkOperationRunQuery")) {
      const bulkQuery = String(variables.query ?? "");
      const model = inferBulkModel(bulkQuery);
      if (!model) {
        return c.json({
          data: {
            bulkOperationRunQuery: {
              bulkOperation: null,
              userErrors: [{ field: ["query"], message: "Unsupported bulk query." }],
            },
          },
        });
      }

      const operationGid = ensureGid("BulkOperation", 8000 + ss().bulkOperations.all().length + 1);
      ss().bulkOperations.insert({
        bulk_operation_gid: operationGid,
        numeric_id: numberFromGid(operationGid),
        shop_domain: auth.shopDomain,
        client_id: auth.clientId,
        status: "CREATED",
        type: "QUERY",
        model,
        query: bulkQuery,
        object_count: 0,
        url: null,
        error_code: null,
        completed_at: null,
      });
      queueMicrotask(() => {
        void completeBulkOperation(ctx, auth, operationGid, model);
      });
      return c.json({
        data: {
          bulkOperationRunQuery: {
            bulkOperation: { id: operationGid, status: "CREATED" },
            userErrors: [],
          },
        },
      });
    }

    if (query.includes("draftOrderCreate")) {
      const input = (variables.input ?? {}) as {
        customerId?: string;
        lineItems?: Array<{ variantId?: string; quantity?: number }>;
        note?: string;
      };
      const customer = input.customerId ? ss().customers.findOneBy("customer_gid", input.customerId) : undefined;
      if (!customer) {
        return c.json({
          data: {
            draftOrderCreate: {
              draftOrder: null,
              userErrors: [{ field: ["customerId"], message: "Customer not found." }],
            },
          },
        });
      }
      const lineItems = (input.lineItems ?? []).map((lineItem, index) => {
        const variant = lineItem.variantId ? ss().variants.findOneBy("variant_gid", lineItem.variantId) : undefined;
        const product = variant ? ss().products.findOneBy("product_gid", variant.product_gid) : undefined;
        if (!variant || !product || !lineItem.quantity) {
          return null;
        }
        return {
          id: ensureGid("DraftOrderLineItem", 9000 + ss().draftOrders.all().length * 10 + index + 1),
          variant_gid: variant.variant_gid,
          title: product.title,
          quantity: lineItem.quantity,
          original_unit_price: variant.price,
        };
      });
      if (lineItems.some((lineItem) => !lineItem)) {
        return c.json({
          data: {
            draftOrderCreate: {
              draftOrder: null,
              userErrors: [{ field: ["lineItems"], message: "One or more variants could not be resolved." }],
            },
          },
        });
      }
      const subtotal = lineItems.reduce(
        (sum, lineItem) => sum + Number.parseFloat(lineItem!.original_unit_price ?? "0") * lineItem!.quantity,
        0,
      );
      const draftOrderGid = ensureGid("DraftOrder", 7000 + ss().draftOrders.all().length + 1);
      const draftOrder = ss().draftOrders.insert({
        draft_order_gid: draftOrderGid,
        numeric_id: numberFromGid(draftOrderGid),
        customer_gid: customer.customer_gid,
        line_items: lineItems as NonNullable<typeof lineItems[number]>[],
        note: input.note ?? null,
        invoice_url: `https://${auth.shopDomain}/draft_orders/${numberFromGid(draftOrderGid)}/invoice`,
        status: "INVOICE_SENT",
        total_price_amount: normalizeMoney(subtotal),
        subtotal_price_amount: normalizeMoney(subtotal),
        total_tax_amount: "0.00",
        created_at_iso: new Date().toISOString(),
      });
      return c.json({
        data: {
          draftOrderCreate: {
            draftOrder: {
              id: draftOrder.draft_order_gid,
              name: `#D${draftOrder.numeric_id}`,
              invoiceUrl: draftOrder.invoice_url,
              status: draftOrder.status,
              totalPriceSet: { shopMoney: { amount: draftOrder.total_price_amount, currencyCode: shopRecord(ss(), auth.shopDomain)?.currency_code ?? "USD" } },
              subtotalPriceSet: { shopMoney: { amount: draftOrder.subtotal_price_amount, currencyCode: shopRecord(ss(), auth.shopDomain)?.currency_code ?? "USD" } },
              totalTaxSet: { shopMoney: { amount: draftOrder.total_tax_amount, currencyCode: shopRecord(ss(), auth.shopDomain)?.currency_code ?? "USD" } },
              lineItems: {
                edges: draftOrder.line_items.map((lineItem) => ({
                  node: {
                    id: randomToken("doli"),
                    title: lineItem.title,
                    quantity: lineItem.quantity,
                    originalUnitPriceSet: lineItem.original_unit_price ? { shopMoney: { amount: lineItem.original_unit_price } } : null,
                  },
                })),
              },
              createdAt: draftOrder.created_at_iso,
            },
            userErrors: [],
          },
        },
      });
    }

    if (query.includes("webhookSubscriptionCreate")) {
      const topic = normalizeTopic(String(variables.topic ?? maybeTopicEnum(variables.topic)));
      const webhookSubscription = (variables.webhookSubscription ?? {}) as {
        callbackUrl?: string;
        uri?: string;
        includeFields?: string[];
      };
      const uri = webhookSubscription.callbackUrl ?? webhookSubscription.uri;
      if (!uri) {
        return c.json({
          data: {
            webhookSubscriptionCreate: {
              userErrors: [{ field: ["webhookSubscription", "callbackUrl"], message: "Callback URL is required." }],
              webhookSubscription: null,
            },
          },
        });
      }
      const existing = ss()
        .webhookSubscriptions
        .all()
        .find((subscription) => subscription.topic === topic && subscription.uri === uri && subscription.shop_domain === auth.shopDomain);
      const subscription =
        existing ??
        ss().webhookSubscriptions.insert({
          subscription_gid: ensureGid("WebhookSubscription", 6000 + ss().webhookSubscriptions.all().length + 1),
          numeric_id: 6000 + ss().webhookSubscriptions.all().length + 1,
          topic,
          uri,
          client_id: auth.clientId,
          shop_domain: auth.shopDomain,
          format: "JSON",
          api_version: version,
          include_fields: webhookSubscription.includeFields ?? [],
          metafield_namespaces: [],
          active: true,
        });
      return c.json({
        data: {
          webhookSubscriptionCreate: {
            userErrors: [],
            webhookSubscription: {
              id: subscription.subscription_gid,
              topic: maybeTopicEnum(subscription.topic),
              format: subscription.format,
              endpoint: webhookEndpoint(subscription),
              includeFields: subscription.include_fields,
            },
          },
        },
      });
    }

    if (query.includes("webhookSubscriptions")) {
      const subscriptions = ss()
        .webhookSubscriptions
        .all()
        .filter((subscription) => subscription.shop_domain === auth.shopDomain && subscription.client_id === auth.clientId)
        .sort((a, b) => a.numeric_id - b.numeric_id);
      const page = paginateArray("webhookSubscriptions", subscriptions, Number(variables.first ?? 50), (variables.after as string | null | undefined) ?? null);
      return c.json({
        data: {
          webhookSubscriptions: {
            edges: page.items.map((subscription) => ({
              node: {
                id: subscription.subscription_gid,
                topic: maybeTopicEnum(subscription.topic),
                format: subscription.format,
                endpoint: webhookEndpoint(subscription),
                includeFields: subscription.include_fields,
              },
            })),
            pageInfo: page.pageInfo,
          },
        },
      });
    }

    if (query.includes("webhookSubscriptionDelete")) {
      const id = String(variables.id ?? "");
      const subscription = ss().webhookSubscriptions.findOneBy("subscription_gid", id);
      if (!subscription) {
        return c.json({
          data: {
            webhookSubscriptionDelete: {
              deletedWebhookSubscriptionId: null,
              userErrors: [{ field: ["id"], message: "Webhook subscription not found." }],
            },
          },
        });
      }
      ss().webhookSubscriptions.delete(subscription.id);
      return c.json({
        data: {
          webhookSubscriptionDelete: {
            deletedWebhookSubscriptionId: id,
            userErrors: [],
          },
        },
      });
    }

    if (query.includes("fulfillmentCreate") || query.includes("fulfillmentCreateV2")) {
      const mutationField = query.includes("fulfillmentCreateV2") ? "fulfillmentCreateV2" : "fulfillmentCreate";
      const fulfillmentInput = ((variables.fulfillment ?? variables.input ?? {}) as {
        lineItemsByFulfillmentOrder?: Array<{
          fulfillmentOrderId?: string;
          fulfillmentOrderLineItems?: Array<{ id?: string; quantity?: number }>;
        }>;
        trackingInfo?: { company?: string; number?: string; numbers?: string[] };
        notifyCustomer?: boolean;
      }) ?? { lineItemsByFulfillmentOrder: [] };
      const requestedGroups = fulfillmentInput.lineItemsByFulfillmentOrder ?? [];
      const fulfillmentOrders = requestedGroups
        .map((item) => item.fulfillmentOrderId ? ss().fulfillmentOrders.findOneBy("fulfillment_order_gid", item.fulfillmentOrderId) : undefined)
        .filter(Boolean);
      if (fulfillmentOrders.length === 0) {
        return c.json({
          data: {
            [mutationField]: {
              fulfillment: null,
              userErrors: [{ field: ["lineItemsByFulfillmentOrder"], message: "No fulfillment orders found." }],
            },
          },
        });
      }
      const order = ss().orders.findOneBy("order_gid", fulfillmentOrders[0]!.order_gid);
      if (!order) {
        return c.json({
          data: {
            [mutationField]: {
              fulfillment: null,
              userErrors: [{ field: ["order"], message: "Order not found." }],
            },
          },
        });
      }

      const requestedQuantitiesByFulfillmentOrder = new Map<string, Map<string, number>>();
      for (const group of requestedGroups) {
        if (!group.fulfillmentOrderId) continue;
        const fulfillmentOrder = ss().fulfillmentOrders.findOneBy("fulfillment_order_gid", group.fulfillmentOrderId);
        if (!fulfillmentOrder) continue;

        const quantities = new Map<string, number>();
        if ((group.fulfillmentOrderLineItems?.length ?? 0) > 0) {
          for (const lineItem of group.fulfillmentOrderLineItems ?? []) {
            if (!lineItem.id) continue;
            quantities.set(lineItem.id, Math.max(0, lineItem.quantity ?? 0));
          }
        } else {
          for (const lineItem of fulfillmentOrder.line_items) {
            quantities.set(lineItem.id, lineItem.remaining_quantity);
          }
        }
        requestedQuantitiesByFulfillmentOrder.set(group.fulfillmentOrderId, quantities);
      }

      const fulfilledLineItemGids = new Set<string>();
      let anyQuantityFulfilled = false;

      for (const fulfillmentOrder of fulfillmentOrders) {
        const requestedQuantities = requestedQuantitiesByFulfillmentOrder.get(fulfillmentOrder!.fulfillment_order_gid) ?? new Map<string, number>();
        const nextLineItems = fulfillmentOrder!.line_items.map((lineItem) => {
          const requestedQuantity = requestedQuantities.get(lineItem.id) ?? 0;
          if (requestedQuantity <= 0) return lineItem;

          const fulfilledQuantity = Math.min(lineItem.remaining_quantity, requestedQuantity);
          if (fulfilledQuantity > 0) {
            anyQuantityFulfilled = true;
            fulfilledLineItemGids.add(lineItem.line_item_gid);
          }

          return {
            ...lineItem,
            remaining_quantity: Math.max(0, lineItem.remaining_quantity - fulfilledQuantity),
          };
        });
        const isClosed = nextLineItems.every((lineItem) => lineItem.remaining_quantity === 0);
        ss().fulfillmentOrders.update(fulfillmentOrder!.id, {
          status: isClosed ? "closed" : "open",
          request_status: "accepted",
          supported_actions: isClosed ? [] : ["create_fulfillment"],
          line_items: nextLineItems,
        });
      }

      if (!anyQuantityFulfilled) {
        return c.json({
          data: {
            [mutationField]: {
              fulfillment: null,
              userErrors: [{ field: ["lineItemsByFulfillmentOrder"], message: "No fulfillment quantities were available to fulfill." }],
            },
          },
        });
      }

      const fulfillmentGid = ensureGid("Fulfillment", 6100 + ss().fulfillments.all().length + 1);
      const trackingNumbers = fulfillmentInput.trackingInfo?.numbers ?? (fulfillmentInput.trackingInfo?.number ? [fulfillmentInput.trackingInfo.number] : []);
      const fulfillment = ss().fulfillments.insert({
        fulfillment_gid: fulfillmentGid,
        numeric_id: numberFromGid(fulfillmentGid),
        order_gid: order.order_gid,
        status: "SUCCESS",
        tracking_company: fulfillmentInput.trackingInfo?.company ?? null,
        tracking_numbers: trackingNumbers,
        line_item_gids: [...fulfilledLineItemGids],
        notify_customer: fulfillmentInput.notifyCustomer ?? false,
        created_at_iso: new Date().toISOString(),
      });

      const updatedFulfillmentOrders = order.fulfillment_order_gids
        .map((gid) => ss().fulfillmentOrders.findOneBy("fulfillment_order_gid", gid))
        .filter(Boolean);
      const displayFulfillmentStatus = updatedFulfillmentOrders.every((fulfillmentOrder) =>
        fulfillmentOrder!.line_items.every((lineItem) => lineItem.remaining_quantity === 0),
      )
        ? "FULFILLED"
        : "PARTIAL";

      ss().orders.update(order.id, {
        display_fulfillment_status: displayFulfillmentStatus,
        updated_at_iso: new Date().toISOString(),
        fulfillment_gids: [...order.fulfillment_gids, fulfillment.fulfillment_gid],
      });
      await dispatchShopifyWebhook(store, ctx.baseUrl, {
        shopDomain: auth.shopDomain,
        topic: "orders/updated",
        payload: {
          id: order.numeric_id,
          admin_graphql_api_id: order.order_gid,
          name: order.name,
          updated_at: new Date().toISOString(),
        },
      });
      return c.json({
        data: {
          [mutationField]: {
            fulfillment: {
              id: fulfillment.fulfillment_gid,
              status: fulfillment.status,
              trackingInfo: fulfillment.tracking_numbers.map((number) => ({ company: fulfillment.tracking_company, number })),
              createdAt: fulfillment.created_at_iso,
            },
            userErrors: [],
          },
        },
      });
    }

    return c.json(graphQLError("Unsupported Shopify Admin GraphQL document."), 400);
  });
}
