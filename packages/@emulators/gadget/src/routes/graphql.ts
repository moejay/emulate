import { buildSchema, graphql } from "graphql";
import type { Context, RouteContext } from "@emulators/core";
import { applyGadgetApiKeyAuth } from "../auth.js";
import type {
  GadgetCustomer,
  GadgetCustomerAddress,
  GadgetFulfillment,
  GadgetOrder,
  GadgetOrderLineItem,
  GadgetProduct,
  GadgetProductVariant,
  GadgetSampleRequest,
  GadgetShop,
} from "../entities.js";
import { connectionFromArray, ensureIso, toTagList, type ConnectionArgs } from "../helpers.js";
import { getGadgetStore } from "../store.js";
import { dispatchSampleRequestRejected } from "../webhooks.js";

const schema = buildSchema(`
  scalar JSON
  scalar GadgetID

  enum SortOrder {
    Ascending
    Descending
  }

  input StringFilterInput {
    equals: String
    startsWith: String
    matches: String
    in: [String!]
  }

  input DateTimeFilterInput {
    greaterThanOrEqual: String
  }

  input ShopifySortInput {
    updatedAt: SortOrder
  }

  input ShopifyCustomerFilterInput {
    shopId: StringFilterInput
    updatedAt: DateTimeFilterInput
    tags: StringFilterInput
    id: StringFilterInput
    OR: [ShopifyCustomerFilterInput!]
  }

  input ShopifyProductFilterInput {
    shopId: StringFilterInput
    updatedAt: DateTimeFilterInput
    id: StringFilterInput
  }

  input ShopifyProductVariantFilterInput {
    shopId: StringFilterInput
    updatedAt: DateTimeFilterInput
    id: StringFilterInput
    productId: StringFilterInput
  }

  input ShopifyOrderFilterInput {
    shopId: StringFilterInput
    updatedAt: DateTimeFilterInput
    id: StringFilterInput
    customerId: StringFilterInput
  }

  input ShopifyOrderLineItemFilterInput {
    shopId: StringFilterInput
    updatedAt: DateTimeFilterInput
    id: StringFilterInput
    productId: StringFilterInput
    orderId: StringFilterInput
  }

  input ShopifyFulfillmentFilterInput {
    shopId: StringFilterInput
    updatedAt: DateTimeFilterInput
    id: StringFilterInput
    orderId: StringFilterInput
  }

  input ShopifyShopFilterInput {
    id: StringFilterInput
    domain: StringFilterInput
    myshopifyDomain: StringFilterInput
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type CustomerAddress {
    address1: String
    address2: String
    city: String
    province: String
    provinceCode: String
    zipCode: String
    country: String
    countryCode: String
    company: String
    phone: String
    latitude: Float
    longitude: Float
  }

  type CustomerAddressEdge {
    node: CustomerAddress!
  }

  type CustomerAddressConnection {
    edges: [CustomerAddressEdge!]!
  }

  type FeaturedMediaFile {
    url: String
  }

  type FeaturedMedia {
    file: FeaturedMediaFile
  }

  type ShopifyCustomerRef {
    id: GadgetID!
    legacyResourceId: String
  }

  type ShopifyProductRef {
    id: GadgetID!
  }

  type ShopifyVariantRef {
    id: GadgetID!
  }

  type ShopifyOrderRef {
    id: GadgetID!
  }

  type ShopifyCustomer {
    id: GadgetID!
    legacyResourceId: String
    email: String
    firstName: String
    lastName: String
    phone: String
    tags: JSON
    numberOfOrders: Int
    amountSpent: JSON
    note: String
    defaultAddress: CustomerAddress
    addresses: CustomerAddressConnection!
    updatedAt: String!
  }

  type ShopifyProduct {
    id: GadgetID!
    title: String
    vendor: String
    productType: String
    body: String
    status: String
    tags: JSON
    featuredMedia: FeaturedMedia
    updatedAt: String!
  }

  type ShopifyProductVariant {
    id: GadgetID!
    title: String
    sku: String
    barcode: String
    price: String
    compareAtPrice: String
    inventoryQuantity: Int
    option1: String
    option2: String
    option3: String
    product: ShopifyProductRef
    updatedAt: String!
  }

  type ShopifyOrderLineItem {
    id: GadgetID!
    name: String
    title: String
    sku: String
    quantity: Int
    price: String
    totalDiscountSet: JSON
    discountAllocations: JSON
    taxLines: JSON
    variantTitle: String
    vendor: String
    order: ShopifyOrderRef
    product: ShopifyProductRef
    variant: ShopifyVariantRef
    variantId: GadgetID
    productId: GadgetID
    updatedAt: String
  }

  type ShopifyOrderLineItemEdge {
    node: ShopifyOrderLineItem!
    cursor: String!
  }

  type ShopifyOrderLineItemConnection {
    edges: [ShopifyOrderLineItemEdge!]!
    pageInfo: PageInfo!
  }

  type ShopifyOrder {
    id: GadgetID!
    legacyResourceId: String
    name: String
    email: String
    financialStatus: String
    fulfillmentStatus: String
    cancelledAt: String
    subtotalPriceSet: JSON
    currentSubtotalPriceSet: JSON
    currentTotalPriceSet: JSON
    currentTotalDiscountsSet: JSON
    totalTaxSet: JSON
    totalShippingPriceSet: JSON
    currency: String
    tags: JSON
    note: String
    customerId: GadgetID
    customer: ShopifyCustomerRef
    shippingAddress: JSON
    shopifyCreatedAt: String
    updatedAt: String!
    lineItems: ShopifyOrderLineItemConnection!
  }

  type ShopifyFulfillment {
    id: GadgetID!
    status: String
    shipmentStatus: String
    deliveredAt: String
    order: ShopifyOrderRef
  }

  type ShopifyShop {
    id: GadgetID!
    domain: String
    myshopifyDomain: String
    name: String
  }

  type ShopifyCustomerEdge {
    node: ShopifyCustomer!
    cursor: String!
  }

  type ShopifyCustomerConnection {
    edges: [ShopifyCustomerEdge!]!
    pageInfo: PageInfo!
  }

  type ShopifyProductEdge {
    node: ShopifyProduct!
    cursor: String!
  }

  type ShopifyProductConnection {
    edges: [ShopifyProductEdge!]!
    pageInfo: PageInfo!
  }

  type ShopifyProductVariantEdge {
    node: ShopifyProductVariant!
    cursor: String!
  }

  type ShopifyProductVariantConnection {
    edges: [ShopifyProductVariantEdge!]!
    pageInfo: PageInfo!
  }

  type ShopifyOrderEdge {
    node: ShopifyOrder!
    cursor: String!
  }

  type ShopifyOrderConnection {
    edges: [ShopifyOrderEdge!]!
    pageInfo: PageInfo!
  }

  type ShopifyFulfillmentEdge {
    node: ShopifyFulfillment!
    cursor: String!
  }

  type ShopifyFulfillmentConnection {
    edges: [ShopifyFulfillmentEdge!]!
    pageInfo: PageInfo!
  }

  type ShopifyShopEdge {
    node: ShopifyShop!
    cursor: String!
  }

  type ShopifyShopConnection {
    edges: [ShopifyShopEdge!]!
    pageInfo: PageInfo!
  }

  type SampleRequest {
    id: GadgetID!
    status: String!
    customerName: String
    customerEmail: String
    customerAddress: String
    shippingAddress: JSON
    requestedAt: String
    shippedAt: String
    notes: String
    orderId: GadgetID
    updatedAt: String!
  }

  type UserError {
    message: String!
    code: String!
  }

  input ShippingAddressInput {
    first_name: String
    last_name: String
    address1: String
    address2: String
    city: String
    province: String
    province_code: String
    country: String
    country_code: String
    zip: String
    phone: String
  }

  input UpdateSampleRequestInput {
    status: String
    customerName: String
    customerEmail: String
    customerAddress: String
    shippingAddress: ShippingAddressInput
    requestedAt: String
    shippedAt: String
    notes: String
    orderId: GadgetID
  }

  type UpdateSampleRequestPayload {
    success: Boolean!
    errors: [UserError!]!
    sampleRequest: SampleRequest
  }

  type GlobalActionPayload {
    success: Boolean!
    errors: [UserError!]!
    result: JSON
  }

  type Query {
    shopifyCustomers(first: Int, after: String, filter: ShopifyCustomerFilterInput, sort: ShopifySortInput): ShopifyCustomerConnection!
    shopifyProducts(first: Int, after: String, filter: ShopifyProductFilterInput, sort: ShopifySortInput): ShopifyProductConnection!
    shopifyProductVariants(first: Int, after: String, filter: ShopifyProductVariantFilterInput, sort: ShopifySortInput): ShopifyProductVariantConnection!
    shopifyOrders(first: Int, after: String, filter: ShopifyOrderFilterInput, sort: ShopifySortInput): ShopifyOrderConnection!
    shopifyOrderLineItems(first: Int, after: String, filter: ShopifyOrderLineItemFilterInput, sort: ShopifySortInput): ShopifyOrderLineItemConnection!
    shopifyFulfillments(first: Int, after: String, filter: ShopifyFulfillmentFilterInput, sort: ShopifySortInput): ShopifyFulfillmentConnection!
    shopifyShops(first: Int, after: String, filter: ShopifyShopFilterInput): ShopifyShopConnection!
    sampleRequest(id: GadgetID!): SampleRequest
  }

  type Mutation {
    updateSampleRequest(id: GadgetID!, sampleRequest: UpdateSampleRequestInput!): UpdateSampleRequestPayload!
    listCustomerTagPage(shopId: String!, after: String): GlobalActionPayload!
  }
`);

interface GraphQLContext {
  c: Context;
  store: RouteContext["store"];
}

export function graphqlRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;

  const registerEndpoint = (path: string) => {
    app.get(path, async (c) => {
      const authError = applyGadgetApiKeyAuth(c, store);
      if (authError) return authError;
      const result = await runGraphQL(c.req.query("query") ?? "", {
        variables: parseVariables(c.req.query("variables")),
        operationName: c.req.query("operationName") ?? undefined,
        context: { c, store },
      });
      return c.json(result, result.errors ? 400 : 200);
    });

    app.post(path, async (c) => {
      const authError = applyGadgetApiKeyAuth(c, store);
      if (authError) return authError;
      const body = await readGraphQLBody(c);
      const result = await runGraphQL(body.query, {
        variables: body.variables,
        operationName: body.operationName,
        context: { c, store },
      });
      return c.json(result, result.errors ? 400 : 200);
    });
  };

  registerEndpoint("/graphql");
  registerEndpoint("/api/graphql");
}

async function runGraphQL(
  query: string,
  opts: { variables?: Record<string, unknown>; operationName?: string; context: GraphQLContext },
) {
  if (!query) {
    return { errors: [{ message: "GraphQL query is required" }] };
  }
  return graphql({
    schema,
    source: query,
    rootValue: createRoot(opts.context),
    contextValue: opts.context,
    variableValues: opts.variables,
    operationName: opts.operationName,
  });
}

async function readGraphQLBody(c: Context): Promise<{
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}> {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    query: typeof body.query === "string" ? body.query : "",
    variables: isRecord(body.variables) ? body.variables : undefined,
    operationName: typeof body.operationName === "string" ? body.operationName : undefined,
  };
}

function createRoot(context: GraphQLContext) {
  const gs = () => getGadgetStore(context.store);

  return {
    shopifyCustomers: (args: ConnectionArgs & { filter?: Record<string, unknown>; sort?: Record<string, unknown> }) => {
      const rows = sortRows(
        gs()
          .customers.all()
          .filter((row) => matchesCustomerFilter(row, args.filter)),
        args.sort,
      );
      return connect(rows, args, formatCustomer);
    },

    shopifyProducts: (args: ConnectionArgs & { filter?: Record<string, unknown>; sort?: Record<string, unknown> }) => {
      const rows = sortRows(
        gs()
          .products.all()
          .filter((row) => matchesProductFilter(row, args.filter)),
        args.sort,
      );
      return connect(rows, args, formatProduct);
    },

    shopifyProductVariants: (
      args: ConnectionArgs & { filter?: Record<string, unknown>; sort?: Record<string, unknown> },
    ) => {
      const rows = sortRows(
        gs()
          .productVariants.all()
          .filter((row) => matchesProductVariantFilter(row, args.filter)),
        args.sort,
      );
      return connect(rows, args, (row) => formatProductVariant(context, row));
    },

    shopifyOrders: (args: ConnectionArgs & { filter?: Record<string, unknown>; sort?: Record<string, unknown> }) => {
      const rows = sortRows(
        gs()
          .orders.all()
          .filter((row) => matchesOrderFilter(row, args.filter)),
        args.sort,
      );
      return connect(rows, args, (row) => formatOrder(context, row));
    },

    shopifyOrderLineItems: (
      args: ConnectionArgs & { filter?: Record<string, unknown>; sort?: Record<string, unknown> },
    ) => {
      const rows = sortRows(
        gs()
          .orderLineItems.all()
          .filter((row) => matchesOrderLineItemFilter(row, args.filter)),
        args.sort,
      );
      return connect(rows, args, formatOrderLineItem);
    },

    shopifyFulfillments: (
      args: ConnectionArgs & { filter?: Record<string, unknown>; sort?: Record<string, unknown> },
    ) => {
      const rows = sortRows(
        gs()
          .fulfillments.all()
          .filter((row) => matchesFulfillmentFilter(row, args.filter)),
        args.sort,
      );
      return connect(rows, args, formatFulfillment);
    },

    shopifyShops: (args: ConnectionArgs & { filter?: Record<string, unknown> }) => {
      const rows = gs().shops.all().filter((row) => matchesShopFilter(row, args.filter));
      return connect(rows, args, formatShop);
    },

    sampleRequest: ({ id }: { id: string }) => {
      const row = gs().sampleRequests.findOneBy("gadget_id", id);
      return row ? formatSampleRequest(row) : null;
    },

    listCustomerTagPage: ({ shopId, after }: { shopId: string; after?: string | null }) => {
      const shop = gs().shops.findOneBy("gadget_id", shopId);
      if (!shop) {
        return {
          success: false,
          errors: [{ message: `Shopify shop not found: ${shopId}`, code: "NOT_FOUND" }],
          result: null,
        };
      }
      const rows = gs()
        .customers.all()
        .filter((row) => row.shop_id === shopId)
        .sort((left, right) =>
          (left.legacy_resource_id ?? left.gadget_id).localeCompare(
            right.legacy_resource_id ?? right.gadget_id,
            undefined,
            { numeric: true },
          ),
        );
      const page = connectionFromArray(rows, { first: 250, after: after ?? undefined });
      const tags = new Map<string, string>();
      for (const edge of page.edges) {
        for (const value of toTagList(edge.node.tags)) {
          const display = value.trim();
          if (!display) continue;
          const normalized = display.toLocaleLowerCase("en-US");
          if (!tags.has(normalized)) tags.set(normalized, display);
        }
      }
      return {
        success: true,
        errors: [],
        result: {
          tags: [...tags.values()].sort((left, right) => left.localeCompare(right)),
          customersScanned: page.edges.length,
          pageInfo: page.pageInfo,
        },
      };
    },

    updateSampleRequest: async ({ id, sampleRequest }: { id: string; sampleRequest: Record<string, unknown> }) => {
      const row = gs().sampleRequests.findOneBy("gadget_id", id);
      if (!row) {
        return {
          success: false,
          errors: [{ message: `Sample request not found: ${id}`, code: "NOT_FOUND" }],
          sampleRequest: null,
        };
      }

      const nextStatus = nullableString(sampleRequest.status) ?? row.status;
      const wasRejected = row.status === "rejected";
      const updated = gs().sampleRequests.update(row.id, {
        status: nextStatus,
        customer_name: nullableString(sampleRequest.customerName) ?? row.customer_name,
        customer_email: nullableString(sampleRequest.customerEmail) ?? row.customer_email,
        customer_address: nullableString(sampleRequest.customerAddress) ?? row.customer_address,
        shipping_address: isRecord(sampleRequest.shippingAddress)
          ? (sampleRequest.shippingAddress as Record<string, unknown>)
          : row.shipping_address,
        requested_at: nullableString(sampleRequest.requestedAt) ?? row.requested_at,
        shipped_at: nullableString(sampleRequest.shippedAt) ?? row.shipped_at,
        notes: nullableString(sampleRequest.notes) ?? row.notes,
        order_id: nullableString(sampleRequest.orderId) ?? row.order_id,
        updatedAt: ensureIso(undefined),
      });
      if (!updated) {
        return {
          success: false,
          errors: [{ message: `Sample request not found: ${id}`, code: "NOT_FOUND" }],
          sampleRequest: null,
        };
      }

      if (!wasRejected && nextStatus === "rejected") {
        await dispatchSampleRequestRejected(context.store, updated);
      }

      return {
        success: true,
        errors: [],
        sampleRequest: formatSampleRequest(updated),
      };
    },
  };
}

function connect<T, O>(rows: T[], args: ConnectionArgs, format: (row: T) => O) {
  const connected = connectionFromArray(rows.map(format), args);
  return {
    edges: connected.edges,
    pageInfo: connected.pageInfo,
  };
}

function sortRows<T extends { updatedAt?: string | null }>(rows: T[], sort?: Record<string, unknown>) {
  const direction = sort?.updatedAt;
  if (direction !== "Ascending" && direction !== "Descending") return rows;
  return [...rows].sort((left, right) => {
    const diff = new Date(left.updatedAt ?? 0).getTime() - new Date(right.updatedAt ?? 0).getTime();
    return direction === "Ascending" ? diff : -diff;
  });
}

function formatCustomerAddress(address: GadgetCustomerAddress) {
  return { ...address };
}

function formatCustomer(row: GadgetCustomer) {
  return {
    id: row.gadget_id,
    legacyResourceId: row.legacy_resource_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    tags: row.tags,
    numberOfOrders: row.number_of_orders,
    amountSpent: row.amount_spent,
    note: row.note,
    defaultAddress: row.default_address ? formatCustomerAddress(row.default_address) : null,
    addresses: {
      edges: row.addresses.map((address) => ({ node: formatCustomerAddress(address) })),
    },
    updatedAt: row.updatedAt,
  };
}

function formatProduct(row: GadgetProduct) {
  return {
    id: row.gadget_id,
    title: row.title,
    vendor: row.vendor,
    productType: row.product_type,
    body: row.body,
    status: row.status,
    tags: row.tags,
    featuredMedia: row.featured_media,
    updatedAt: row.updatedAt,
  };
}

function formatProductVariant(context: GraphQLContext, row: GadgetProductVariant) {
  return {
    id: row.gadget_id,
    title: row.title,
    sku: row.sku,
    barcode: row.barcode,
    price: row.price,
    compareAtPrice: row.compare_at_price,
    inventoryQuantity: row.inventory_quantity,
    option1: row.option1,
    option2: row.option2,
    option3: row.option3,
    product: row.product_id ? formatProductRef(context, row.product_id) : null,
    updatedAt: row.updatedAt,
  };
}

function formatOrder(context: GraphQLContext, row: GadgetOrder) {
  const gs = getGadgetStore(context.store);
  const lineItems = gs.orderLineItems.all().filter((lineItem) => lineItem.order_id === row.gadget_id);
  return {
    id: row.gadget_id,
    legacyResourceId: row.legacy_resource_id,
    name: row.name,
    email: row.email,
    financialStatus: row.financial_status,
    fulfillmentStatus: row.fulfillment_status,
    cancelledAt: row.cancelled_at,
    subtotalPriceSet: row.subtotal_price_set,
    currentSubtotalPriceSet: row.current_subtotal_price_set,
    currentTotalPriceSet: row.current_total_price_set,
    currentTotalDiscountsSet: row.current_total_discounts_set,
    totalTaxSet: row.total_tax_set,
    totalShippingPriceSet: row.total_shipping_price_set,
    currency: row.currency,
    tags: row.tags,
    note: row.note,
    customerId: row.customer_id,
    customer: row.customer_id ? formatCustomerRef(context, row.customer_id) : null,
    shippingAddress: row.shipping_address,
    shopifyCreatedAt: row.shopify_created_at,
    updatedAt: row.updatedAt,
    lineItems: connect(lineItems, { first: lineItems.length }, formatOrderLineItem),
  };
}

function formatOrderLineItem(row: GadgetOrderLineItem) {
  return {
    id: row.gadget_id,
    name: row.name,
    title: row.title,
    sku: row.sku,
    quantity: row.quantity,
    price: row.price,
    totalDiscountSet: row.total_discount_set,
    discountAllocations: row.discount_allocations,
    taxLines: row.tax_lines,
    variantTitle: row.variant_title,
    vendor: row.vendor,
    order: row.order_id ? { id: row.order_id } : null,
    product: row.product_id ? { id: row.product_id } : null,
    variant: row.variant_id ? { id: row.variant_id } : null,
    variantId: row.variant_id,
    productId: row.product_id,
    updatedAt: row.updatedAt,
  };
}

function formatFulfillment(row: GadgetFulfillment) {
  return {
    id: row.gadget_id,
    status: row.status,
    shipmentStatus: row.shipment_status,
    deliveredAt: row.delivered_at,
    order: row.order_id ? { id: row.order_id } : null,
  };
}

function formatShop(row: GadgetShop) {
  return {
    id: row.gadget_id,
    domain: row.domain,
    myshopifyDomain: row.myshopify_domain,
    name: row.name,
  };
}

function formatSampleRequest(row: GadgetSampleRequest) {
  return {
    id: row.gadget_id,
    status: row.status,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerAddress: row.customer_address,
    shippingAddress: row.shipping_address,
    requestedAt: row.requested_at,
    shippedAt: row.shipped_at,
    notes: row.notes,
    orderId: row.order_id,
    updatedAt: row.updatedAt,
  };
}

function formatCustomerRef(context: GraphQLContext, customerId: string) {
  const row = getGadgetStore(context.store).customers.findOneBy("gadget_id", customerId);
  return {
    id: customerId,
    legacyResourceId: row?.legacy_resource_id ?? null,
  };
}

function formatProductRef(context: GraphQLContext, productId: string) {
  const row = getGadgetStore(context.store).products.findOneBy("gadget_id", productId);
  return row ? { id: row.gadget_id } : null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value : String(value);
}

function matchesCustomerFilter(row: GadgetCustomer, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  return matchesFilter(
    {
      id: row.gadget_id,
      shopId: row.shop_id,
      updatedAt: row.updatedAt,
      tags: row.tags,
    },
    filter,
  );
}

function matchesProductFilter(row: GadgetProduct, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  return matchesFilter({ id: row.gadget_id, shopId: row.shop_id, updatedAt: row.updatedAt }, filter);
}

function matchesProductVariantFilter(row: GadgetProductVariant, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  return matchesFilter(
    { id: row.gadget_id, shopId: row.shop_id, productId: row.product_id, updatedAt: row.updatedAt },
    filter,
  );
}

function matchesOrderFilter(row: GadgetOrder, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  return matchesFilter(
    { id: row.gadget_id, shopId: row.shop_id, customerId: row.customer_id, updatedAt: row.updatedAt },
    filter,
  );
}

function matchesOrderLineItemFilter(row: GadgetOrderLineItem, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  return matchesFilter(
    { id: row.gadget_id, shopId: row.shop_id, productId: row.product_id, orderId: row.order_id, updatedAt: row.updatedAt },
    filter,
  );
}

function matchesFulfillmentFilter(row: GadgetFulfillment, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  return matchesFilter({ id: row.gadget_id, shopId: row.shop_id, updatedAt: row.updatedAt }, filter);
}

function matchesShopFilter(row: GadgetShop, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  return matchesFilter(
    { id: row.gadget_id, domain: row.domain, myshopifyDomain: row.myshopify_domain },
    filter,
  );
}

function matchesFilter(values: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  const orRaw = filter.OR;
  const childFilters = Array.isArray(orRaw) ? orRaw.filter(isRecord) : [];
  for (const [key, comparator] of Object.entries(filter)) {
    if (key === "OR") continue;
    if (!isRecord(comparator)) continue;
    if (!matchComparator(values[key], comparator)) return false;
  }
  if (childFilters.length === 0) return true;
  return childFilters.some((child) => matchesFilter(values, child));
}

function matchComparator(value: unknown, comparator: Record<string, unknown>) {
  if ("greaterThanOrEqual" in comparator) {
    const threshold = comparator.greaterThanOrEqual;
    if (typeof threshold !== "string") return true;
    const left = typeof value === "string" ? new Date(value).getTime() : Number.NaN;
    const right = new Date(threshold).getTime();
    return Number.isFinite(left) && Number.isFinite(right) && left >= right;
  }

  if ("equals" in comparator) {
    return String(value ?? "") === String(comparator.equals ?? "");
  }
  if ("startsWith" in comparator) {
    return typeof value === "string" && typeof comparator.startsWith === "string"
      ? value.startsWith(comparator.startsWith)
      : false;
  }
  if ("in" in comparator) {
    return Array.isArray(comparator.in) && comparator.in.map(String).includes(String(value ?? ""));
  }
  if ("matches" in comparator) {
    if (typeof comparator.matches !== "string") return false;
    const tags = toTagList(value).map((entry) => entry.toLowerCase());
    return tags.includes(comparator.matches.toLowerCase());
  }
  return true;
}

function parseVariables(raw: string | null | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
