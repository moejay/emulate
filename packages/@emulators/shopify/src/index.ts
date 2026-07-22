import type { Hono, AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import { getShopifyStore, type ShopifyStore } from "./store.js";
import {
  ensureGid,
  normalizeMoney,
  normalizeScopes,
  normalizeStringList,
  numberFromGid,
  toIsoDate,
  todayMinusDays,
} from "./helpers.js";
import type {
  ShopifyAddress,
  ShopifyCompany,
  ShopifyCompanyContactProfile,
  ShopifyCompanyLocation,
  ShopifyCustomer,
  ShopifyFulfillmentOrder,
  ShopifyOrder,
  ShopifyProduct,
  ShopifyShippingAddressSummary,
  ShopifyVariant,
} from "./entities.js";
import { graphqlRoutes } from "./routes/graphql.js";
import { oauthRoutes } from "./routes/oauth.js";
import { inspectorRoutes } from "./routes/inspector.js";

export { getShopifyStore, type ShopifyStore } from "./store.js";
export * from "./entities.js";
export * from "./auth.js";
export * from "./webhooks.js";

export interface ShopifySeedConfig {
  port?: number;
  baseUrl?: string;
  shop?: {
    id?: string | number;
    name?: string;
    email?: string;
    myshopify_domain?: string;
    primary_domain?: string;
    currency_code?: string;
    timezone?: string;
    plan_display_name?: string;
    plan_partner_development?: boolean;
  };
  staff_users?: Array<{
    id?: string | number;
    email: string;
    first_name?: string;
    last_name?: string;
  }>;
  oauth_apps?: Array<{
    client_id: string;
    client_secret: string;
    name?: string;
    redirect_uris: string[];
    scopes?: string[] | string;
    embedded?: boolean;
  }>;
  access_tokens?: Array<{
    token: string;
    client_id?: string;
    shop?: string;
    scopes?: string[] | string;
    staff_id?: string | number;
  }>;
  webhook_subscriptions?: Array<{
    topic: string;
    uri: string;
    client_id?: string;
    shop?: string;
    api_version?: string;
    include_fields?: string[] | string;
  }>;
  customers?: Array<{
    id?: string | number;
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    state?: string;
    note?: string;
    tags?: string[] | string;
    number_of_orders?: number;
    amount_spent?: string | number;
    company?: string;
    default_address?: Partial<ShopifyAddress>;
    addresses?: Array<Partial<ShopifyAddress>>;
    created_at?: string;
    updated_at?: string;
  }>;
  companies?: Array<{
    id?: string | number;
    name: string;
    external_id?: string;
    note?: string;
    tags?: string[] | string;
    main_contact_customer_id?: string | number;
    locations?: Array<{
      id?: string | number;
      name?: string;
      shipping_address?: Partial<ShopifyAddress>;
    }>;
    contacts?: Array<{
      id?: string | number;
      customer_id: string | number;
      title?: string;
      locale?: string;
    }>;
  }>;
  products?: Array<{
    id?: string | number;
    title: string;
    vendor?: string;
    product_type?: string;
    description_html?: string;
    status?: string;
    tags?: string[] | string;
    image_url?: string;
    updated_at?: string;
    variants?: Array<{
      id?: string | number;
      title?: string;
      sku?: string;
      price?: string | number;
      compare_at_price?: string | number;
      barcode?: string;
      inventory_quantity?: number;
      weight_value?: number;
      weight_unit?: string;
    }>;
  }>;
  orders?: Array<{
    id?: string | number;
    name?: string;
    email?: string;
    customer_id?: string | number;
    display_financial_status?: string;
    display_fulfillment_status?: string;
    cancelled_at?: string;
    created_at?: string;
    updated_at?: string;
    currency_code?: string;
    subtotal?: string | number;
    total_tax?: string | number;
    total_price?: string | number;
    total_discounts?: string | number;
    shipping_price?: string | number;
    note?: string;
    tags?: string[] | string;
    shipping_address?: Partial<ShopifyShippingAddressSummary>;
    line_items: Array<{
      id?: string | number;
      variant_id?: string | number;
      sku?: string;
      name?: string;
      title?: string;
      quantity: number;
      original_unit_price?: string | number;
      total_discount?: string | number;
      tax_rates?: number[];
    }>;
    refunds?: Array<{
      id?: string | number;
      created_at?: string;
      note?: string;
      refund_line_items?: Array<{
        line_item_id: string | number;
        quantity: number;
        subtotal?: string | number;
        total_tax?: string | number;
      }>;
    }>;
    fulfillment_orders?: Array<{
      id?: string | number;
      status?: string;
      request_status?: string;
      assigned_location_name?: string;
      line_items?: Array<{
        id?: string | number;
        line_item_id: string | number;
        total_quantity?: number;
        remaining_quantity?: number;
      }>;
    }>;
  }>;
}

const DEFAULT_SCOPES = ["read_customers", "read_products", "read_orders", "write_draft_orders", "write_fulfillments"];

function defaultAddress(input?: Partial<ShopifyAddress>, company?: string | null): ShopifyAddress {
  return {
    company: input?.company ?? company ?? null,
    address1: input?.address1 ?? "123 Market St",
    address2: input?.address2 ?? null,
    city: input?.city ?? "San Francisco",
    province: input?.province ?? "California",
    provinceCode: input?.provinceCode ?? "CA",
    zip: input?.zip ?? "94105",
    country: input?.country ?? "United States",
    countryCodeV2: input?.countryCodeV2 ?? "US",
    phone: input?.phone ?? null,
  };
}

function defaultShippingAddress(input?: Partial<ShopifyShippingAddressSummary>, company?: string | null): ShopifyShippingAddressSummary {
  return {
    company: input?.company ?? company ?? null,
    firstName: input?.firstName ?? null,
    lastName: input?.lastName ?? null,
  };
}

function firstShop(ss: ShopifyStore) {
  return ss.shops.all()[0];
}

function firstApp(ss: ShopifyStore) {
  return ss.oauthApps.all()[0];
}

function firstStaffUser(ss: ShopifyStore) {
  return ss.staffUsers.all()[0];
}

function resolveCustomer(ss: ShopifyStore, ref: string | number | undefined | null) {
  if (!ref) return undefined;
  const gid = ensureGid("Customer", ref);
  return ss.customers.findOneBy("customer_gid", gid) ?? ss.customers.findOneBy("email", String(ref));
}

function resolveCompany(ss: ShopifyStore, ref: string | number | undefined | null) {
  if (!ref) return undefined;
  const gid = ensureGid("Company", ref);
  return ss.companies.findOneBy("company_gid", gid) ?? ss.companies.findOneBy("name", String(ref));
}

function resolveVariant(ss: ShopifyStore, ref: string | number | undefined | null) {
  if (!ref) return undefined;
  const gid = ensureGid("ProductVariant", ref);
  return ss.variants.findOneBy("variant_gid", gid) ?? ss.variants.findOneBy("sku", String(ref));
}

function ensureDefaultFulfillmentOrder(ss: ShopifyStore, order: ShopifyOrder): ShopifyFulfillmentOrder {
  const existing = order.fulfillment_order_gids
    .map((gid) => ss.fulfillmentOrders.findOneBy("fulfillment_order_gid", gid))
    .find(Boolean);
  if (existing) return existing;

  const fulfillmentOrderGid = ensureGid("FulfillmentOrder", order.numeric_id + 5000);
  const lineItems = order.line_items.map((lineItem, index) => ({
    id: ensureGid("FulfillmentOrderLineItem", order.numeric_id * 100 + index + 1),
    line_item_gid: lineItem.id,
    total_quantity: lineItem.quantity,
    remaining_quantity: lineItem.quantity,
  }));
  const fulfillmentOrder = ss.fulfillmentOrders.insert({
    fulfillment_order_gid: fulfillmentOrderGid,
    numeric_id: numberFromGid(fulfillmentOrderGid),
    order_gid: order.order_gid,
    status: order.display_fulfillment_status?.toLowerCase() === "fulfilled" ? "closed" : "open",
    request_status: "unsubmitted",
    supported_actions: ["create_fulfillment"],
    assigned_location_name: "Main Warehouse",
    line_items: lineItems,
  });
  ss.orders.update(order.id, {
    fulfillment_order_gids: [...order.fulfillment_order_gids, fulfillmentOrderGid],
  });
  return fulfillmentOrder;
}

function attachCustomerToCompany(
  ss: ShopifyStore,
  company: ShopifyCompany,
  customer: ShopifyCustomer,
  profileInput?: { id?: string | number; title?: string; locale?: string },
): ShopifyCompanyContactProfile {
  const existing = ss.companyContactProfiles
    .findBy("company_gid", company.company_gid)
    .find((profile) => profile.customer_gid === customer.customer_gid);
  if (existing) return existing;
  const profileGid = ensureGid("CompanyContactProfile", profileInput?.id ?? company.numeric_id * 100 + customer.numeric_id);
  const profile = ss.companyContactProfiles.insert({
    profile_gid: profileGid,
    numeric_id: numberFromGid(profileGid),
    company_gid: company.company_gid,
    customer_gid: customer.customer_gid,
    title: profileInput?.title ?? null,
    locale: profileInput?.locale ?? "en",
  });
  const nextProfiles = [...customer.company_contact_profile_ids, profile.profile_gid];
  ss.customers.update(customer.id, {
    company_id: company.company_gid,
    company_contact_profile_ids: nextProfiles,
  });
  if (!company.main_contact_customer_gid) {
    ss.companies.update(company.id, { main_contact_customer_gid: customer.customer_gid });
  }
  return profile;
}

function ensureCompanyForCustomer(ss: ShopifyStore, customer: ShopifyCustomer): ShopifyCompany | undefined {
  const companyName = customer.default_address?.company ?? customer.addresses.find((address) => address.company)?.company;
  if (!companyName) return undefined;
  const existing = resolveCompany(ss, companyName);
  if (existing) {
    attachCustomerToCompany(ss, existing, customer);
    return existing;
  }
  const companyGid = ensureGid("Company", customer.numeric_id + 2000);
  const company = ss.companies.insert({
    company_gid: companyGid,
    numeric_id: numberFromGid(companyGid),
    name: companyName,
    external_id: null,
    note: null,
    main_contact_customer_gid: customer.customer_gid,
    tags: customer.tags.filter((tag) => /b2b|wholesale|retail|company/i.test(tag)),
    created_at_iso: customer.created_at_iso,
    updated_at_iso: customer.updated_at_iso,
  });
  ss.companyLocations.insert({
    location_gid: ensureGid("CompanyLocation", company.numeric_id + 3000),
    numeric_id: company.numeric_id + 3000,
    company_gid: company.company_gid,
    name: `${company.name} HQ`,
    shipping_address: customer.default_address ?? defaultAddress(undefined, company.name),
    billing_same_as_shipping: true,
  });
  attachCustomerToCompany(ss, company, customer);
  return company;
}

function seedDefaults(store: Store, baseUrl: string): void {
  const ss = getShopifyStore(store);
  if (!firstShop(ss)) {
    ss.shops.insert({
      shop_gid: ensureGid("Shop", 1),
      numeric_id: 1,
      name: "Demo Shop",
      email: "owner@demo-shop.test",
      myshopify_domain: "demo-shop.myshopify.com",
      primary_domain: baseUrl.replace(/\/$/, ""),
      currency_code: "USD",
      timezone: "America/Los_Angeles",
      plan_display_name: "Development",
      plan_partner_development: true,
    });
  }

  if (!firstStaffUser(ss)) {
    ss.staffUsers.insert({
      staff_gid: ensureGid("User", 1),
      numeric_id: 1,
      email: "merchant@demo-shop.test",
      first_name: "Demo",
      last_name: "Merchant",
    });
  }

  if (!firstApp(ss)) {
    ss.oauthApps.insert({
      client_id: "shopify-client-id",
      client_secret: "shopify-client-secret",
      name: "Local Shopify App",
      redirect_uris: ["http://localhost:3000/api/auth/callback/shopify"],
      scopes: DEFAULT_SCOPES,
      embedded: true,
    });
  }

  if (ss.accessTokens.all().length === 0) {
    const shop = firstShop(ss)!;
    const app = firstApp(ss)!;
    const staff = firstStaffUser(ss)!;
    ss.accessTokens.insert({
      token: "shpat_test_admin",
      client_id: app.client_id,
      shop_domain: shop.myshopify_domain,
      staff_gid: staff.staff_gid,
      scopes: app.scopes,
      revoked: false,
    });
  }

  if (ss.customers.all().length === 0) {
    const customerGid = ensureGid("Customer", 1001);
    const customer = ss.customers.insert({
      customer_gid: customerGid,
      numeric_id: 1001,
      email: "buyer@corner-store.test",
      first_name: "Taylor",
      last_name: "Buyer",
      phone: "+1 415 555 0101",
      state: "enabled",
      note: "Wholesale account",
      tags: ["b2b", "wholesale"],
      number_of_orders: 3,
      amount_spent: "2450.00",
      default_address: defaultAddress(undefined, "Corner Store"),
      addresses: [defaultAddress(undefined, "Corner Store")],
      company_id: null,
      company_contact_profile_ids: [],
      created_at_iso: todayMinusDays(120),
      updated_at_iso: todayMinusDays(2),
    });
    ensureCompanyForCustomer(ss, customer);
  }

  if (ss.products.all().length === 0) {
    const productGid = ensureGid("Product", 2001);
    ss.products.insert({
      product_gid: productGid,
      numeric_id: 2001,
      title: "Demo Granola",
      vendor: "Opener Foods",
      product_type: "Snack",
      description_html: "<p>Crisp granola for wholesale buyers.</p>",
      status: "ACTIVE",
      tags: ["breakfast", "b2b"],
      featured_image_url: `${baseUrl.replace(/\/$/, "")}/images/granola.png`,
      updated_at_iso: todayMinusDays(1),
    });
    ss.variants.insert({
      variant_gid: ensureGid("ProductVariant", 3001),
      numeric_id: 3001,
      product_gid: productGid,
      title: "12-pack",
      sku: "GRANOLA-12",
      price: "48.00",
      compare_at_price: null,
      barcode: "123456789012",
      inventory_quantity: 240,
      weight_value: 6,
      weight_unit: "POUNDS",
    });
  }

  if (ss.orders.all().length === 0) {
    const customer = ss.customers.all()[0]!;
    const variant = ss.variants.all()[0]!;
    const product = ss.products.findOneBy("product_gid", variant.product_gid)!;
    const orderGid = ensureGid("Order", 4001);
    const order = ss.orders.insert({
      order_gid: orderGid,
      numeric_id: 4001,
      name: "#1001",
      email: customer.email,
      customer_gid: customer.customer_gid,
      display_financial_status: "PAID",
      display_fulfillment_status: "UNFULFILLED",
      cancelled_at: null,
      created_at_iso: todayMinusDays(14),
      updated_at_iso: todayMinusDays(1),
      currency_code: "USD",
      subtotal_amount: "96.00",
      total_tax_amount: "8.00",
      total_price_amount: "104.00",
      total_discounts_amount: "0.00",
      shipping_price_amount: "0.00",
      note: "First wholesale reorder",
      tags: ["wholesale", "priority"],
      shipping_address: defaultShippingAddress({ firstName: customer.first_name ?? undefined, lastName: customer.last_name ?? undefined }, "Corner Store"),
      line_items: [
        {
          id: ensureGid("LineItem", 5001),
          variant_id: variant.variant_gid,
          sku: variant.sku,
          name: `${product.title} - ${variant.title}`,
          title: product.title,
          quantity: 2,
          original_unit_price: "48.00",
          total_discount: "0.00",
          discount_allocations: ["0.00"],
          tax_rates: [0.0833],
        },
      ],
      refunds: [],
      fulfillment_order_gids: [],
      fulfillment_gids: [],
    });
    ensureDefaultFulfillmentOrder(ss, order);
  }
}

export function seedFromConfig(store: Store, baseUrl: string, config: ShopifySeedConfig, _webhooks?: WebhookDispatcher): void {
  const ss = getShopifyStore(store);

  if (config.shop) {
    const existing = firstShop(ss);
    const numericId = numberFromGid(config.shop.id ?? existing?.numeric_id ?? 1);
    const values = {
      shop_gid: ensureGid("Shop", config.shop.id ?? numericId),
      numeric_id: numericId,
      name: config.shop.name ?? existing?.name ?? "Demo Shop",
      email: config.shop.email ?? existing?.email ?? "owner@demo-shop.test",
      myshopify_domain: config.shop.myshopify_domain ?? existing?.myshopify_domain ?? "demo-shop.myshopify.com",
      primary_domain: config.shop.primary_domain ?? existing?.primary_domain ?? baseUrl.replace(/\/$/, ""),
      currency_code: config.shop.currency_code ?? existing?.currency_code ?? "USD",
      timezone: config.shop.timezone ?? existing?.timezone ?? "America/Los_Angeles",
      plan_display_name: config.shop.plan_display_name ?? existing?.plan_display_name ?? "Development",
      plan_partner_development: config.shop.plan_partner_development ?? existing?.plan_partner_development ?? true,
    };
    if (existing) ss.shops.update(existing.id, values);
    else ss.shops.insert(values);
  }

  if (config.staff_users) {
    for (const staffConfig of config.staff_users) {
      const gid = ensureGid("User", staffConfig.id ?? ss.staffUsers.all().length + 1);
      const existing = ss.staffUsers.findOneBy("email", staffConfig.email) ?? ss.staffUsers.findOneBy("staff_gid", gid);
      const values = {
        staff_gid: gid,
        numeric_id: numberFromGid(gid),
        email: staffConfig.email,
        first_name: staffConfig.first_name ?? null,
        last_name: staffConfig.last_name ?? null,
      };
      if (existing) ss.staffUsers.update(existing.id, values);
      else ss.staffUsers.insert(values);
    }
  }

  if (config.oauth_apps) {
    for (const appConfig of config.oauth_apps) {
      const existing = ss.oauthApps.findOneBy("client_id", appConfig.client_id);
      const values = {
        client_id: appConfig.client_id,
        client_secret: appConfig.client_secret,
        name: appConfig.name ?? existing?.name ?? appConfig.client_id,
        redirect_uris: appConfig.redirect_uris,
        scopes: normalizeScopes(appConfig.scopes, existing?.scopes ?? DEFAULT_SCOPES),
        embedded: appConfig.embedded ?? existing?.embedded ?? true,
      };
      if (existing) ss.oauthApps.update(existing.id, values);
      else ss.oauthApps.insert(values);
    }
  }

  if (config.access_tokens) {
    const shop = firstShop(ss);
    const app = firstApp(ss);
    const staff = firstStaffUser(ss);
    for (const tokenConfig of config.access_tokens) {
      const existing = ss.accessTokens.findOneBy("token", tokenConfig.token);
      const clientId = tokenConfig.client_id ?? app?.client_id ?? "shopify-client-id";
      const staffGid = ensureGid("User", tokenConfig.staff_id ?? staff?.numeric_id ?? 1);
      const values = {
        token: tokenConfig.token,
        client_id: clientId,
        shop_domain: tokenConfig.shop ?? shop?.myshopify_domain ?? "demo-shop.myshopify.com",
        staff_gid: staffGid,
        scopes: normalizeScopes(tokenConfig.scopes, app?.scopes ?? DEFAULT_SCOPES),
        revoked: false,
      };
      if (existing) ss.accessTokens.update(existing.id, values);
      else ss.accessTokens.insert(values);
    }
  }

  if (config.customers) {
    for (const customerConfig of config.customers) {
      const gid = ensureGid("Customer", customerConfig.id ?? 1000 + ss.customers.all().length + 1);
      const companyName = customerConfig.company ?? customerConfig.default_address?.company ?? null;
      const addresses = (customerConfig.addresses?.length
        ? customerConfig.addresses.map((address) => defaultAddress(address, companyName))
        : [defaultAddress(customerConfig.default_address, companyName)]) as ShopifyAddress[];
      const defaultAddr = addresses[0] ?? null;
      const existing = ss.customers.findOneBy("customer_gid", gid) ?? (customerConfig.email ? ss.customers.findOneBy("email", customerConfig.email) : undefined);
      const values: Omit<ShopifyCustomer, "id" | "created_at" | "updated_at"> = {
        customer_gid: gid,
        numeric_id: numberFromGid(gid),
        email: customerConfig.email ?? null,
        first_name: customerConfig.first_name ?? null,
        last_name: customerConfig.last_name ?? null,
        phone: customerConfig.phone ?? null,
        state: customerConfig.state ?? "enabled",
        note: customerConfig.note ?? null,
        tags: normalizeStringList(customerConfig.tags),
        number_of_orders: customerConfig.number_of_orders ?? 0,
        amount_spent: normalizeMoney(customerConfig.amount_spent, "0.00"),
        default_address: defaultAddr,
        addresses,
        company_id: existing?.company_id ?? null,
        company_contact_profile_ids: existing?.company_contact_profile_ids ?? [],
        created_at_iso: toIsoDate(customerConfig.created_at, existing?.created_at_iso),
        updated_at_iso: toIsoDate(customerConfig.updated_at, existing?.updated_at_iso),
      };
      const customer = existing ? (ss.customers.update(existing.id, values)! as ShopifyCustomer) : ss.customers.insert(values);
      ensureCompanyForCustomer(ss, customer);
    }
  }

  if (config.companies) {
    for (const companyConfig of config.companies) {
      const gid = ensureGid("Company", companyConfig.id ?? 2000 + ss.companies.all().length + 1);
      const existing = ss.companies.findOneBy("company_gid", gid) ?? ss.companies.findOneBy("name", companyConfig.name);
      const values: Omit<ShopifyCompany, "id" | "created_at" | "updated_at"> = {
        company_gid: gid,
        numeric_id: numberFromGid(gid),
        name: companyConfig.name,
        external_id: companyConfig.external_id ?? null,
        note: companyConfig.note ?? null,
        main_contact_customer_gid: companyConfig.main_contact_customer_id
          ? ensureGid("Customer", companyConfig.main_contact_customer_id)
          : existing?.main_contact_customer_gid ?? null,
        tags: normalizeStringList(companyConfig.tags),
        created_at_iso: existing?.created_at_iso ?? new Date().toISOString(),
        updated_at_iso: new Date().toISOString(),
      };
      const company = existing ? (ss.companies.update(existing.id, values)! as ShopifyCompany) : ss.companies.insert(values);

      if (companyConfig.locations) {
        for (const locationConfig of companyConfig.locations) {
          const locationGid = ensureGid("CompanyLocation", locationConfig.id ?? company.numeric_id + ss.companyLocations.all().length + 1);
          const locationExisting = ss.companyLocations.findOneBy("location_gid", locationGid);
          const locationValues: Omit<ShopifyCompanyLocation, "id" | "created_at" | "updated_at"> = {
            location_gid: locationGid,
            numeric_id: numberFromGid(locationGid),
            company_gid: company.company_gid,
            name: locationConfig.name ?? `${company.name} Location`,
            shipping_address: defaultAddress(locationConfig.shipping_address, company.name),
            billing_same_as_shipping: true,
          };
          if (locationExisting) ss.companyLocations.update(locationExisting.id, locationValues);
          else ss.companyLocations.insert(locationValues);
        }
      }

      if (companyConfig.contacts) {
        for (const contact of companyConfig.contacts) {
          const customer = resolveCustomer(ss, contact.customer_id);
          if (!customer) continue;
          attachCustomerToCompany(ss, company, customer, { id: contact.id, title: contact.title, locale: contact.locale });
        }
      }
    }
  }

  if (config.products) {
    for (const productConfig of config.products) {
      const productGid = ensureGid("Product", productConfig.id ?? 2000 + ss.products.all().length + 1);
      const existing = ss.products.findOneBy("product_gid", productGid) ?? ss.products.findOneBy("title", productConfig.title);
      const productValues: Omit<ShopifyProduct, "id" | "created_at" | "updated_at"> = {
        product_gid: productGid,
        numeric_id: numberFromGid(productGid),
        title: productConfig.title,
        vendor: productConfig.vendor ?? null,
        product_type: productConfig.product_type ?? null,
        description_html: productConfig.description_html ?? null,
        status: productConfig.status ?? "ACTIVE",
        tags: normalizeStringList(productConfig.tags),
        featured_image_url: productConfig.image_url ?? null,
        updated_at_iso: toIsoDate(productConfig.updated_at),
      };
      const product = existing ? (ss.products.update(existing.id, productValues)! as ShopifyProduct) : ss.products.insert(productValues);

      const variants = productConfig.variants?.length ? productConfig.variants : [{ title: "Default Title", price: "0.00" }];
      for (let index = 0; index < variants.length; index++) {
        const variantConfig = variants[index]!;
        const variantGid = ensureGid("ProductVariant", variantConfig.id ?? product.numeric_id * 10 + index + 1);
        const variantExisting = ss.variants.findOneBy("variant_gid", variantGid);
        const variantValues: Omit<ShopifyVariant, "id" | "created_at" | "updated_at"> = {
          variant_gid: variantGid,
          numeric_id: numberFromGid(variantGid),
          product_gid: product.product_gid,
          title: variantConfig.title ?? "Default Title",
          sku: variantConfig.sku ?? null,
          price: normalizeMoney(variantConfig.price, "0.00"),
          compare_at_price: variantConfig.compare_at_price != null ? normalizeMoney(variantConfig.compare_at_price) : null,
          barcode: variantConfig.barcode ?? null,
          inventory_quantity: variantConfig.inventory_quantity ?? 0,
          weight_value: variantConfig.weight_value ?? null,
          weight_unit: variantConfig.weight_unit ?? null,
        };
        if (variantExisting) ss.variants.update(variantExisting.id, variantValues);
        else ss.variants.insert(variantValues);
      }
    }
  }

  if (config.orders) {
    for (const orderConfig of config.orders) {
      const orderGid = ensureGid("Order", orderConfig.id ?? 4000 + ss.orders.all().length + 1);
      const customer = resolveCustomer(ss, orderConfig.customer_id);
      const existing = ss.orders.findOneBy("order_gid", orderGid) ?? ss.orders.findOneBy("name", orderConfig.name ?? "");
      const lineItems = orderConfig.line_items.map((lineItemConfig, index) => {
        const variant = resolveVariant(ss, lineItemConfig.variant_id ?? lineItemConfig.sku);
        const product = variant ? ss.products.findOneBy("product_gid", variant.product_gid) : undefined;
        const lineItemId = ensureGid("LineItem", lineItemConfig.id ?? numberFromGid(orderGid) * 100 + index + 1);
        return {
          id: lineItemId,
          variant_id: variant?.variant_gid ?? (lineItemConfig.variant_id ? ensureGid("ProductVariant", lineItemConfig.variant_id) : null),
          sku: lineItemConfig.sku ?? variant?.sku ?? null,
          name: lineItemConfig.name ?? (product && variant ? `${product.title} - ${variant.title}` : null),
          title: lineItemConfig.title ?? product?.title ?? null,
          quantity: lineItemConfig.quantity,
          original_unit_price: normalizeMoney(lineItemConfig.original_unit_price ?? variant?.price ?? "0.00"),
          total_discount: normalizeMoney(lineItemConfig.total_discount, "0.00"),
          discount_allocations: [normalizeMoney(lineItemConfig.total_discount, "0.00")],
          tax_rates: lineItemConfig.tax_rates ?? [],
        };
      });
      const refunds = (orderConfig.refunds ?? []).map((refundConfig, refundIndex) => ({
        id: ensureGid("Refund", refundConfig.id ?? numberFromGid(orderGid) * 100 + refundIndex + 1),
        created_at_iso: toIsoDate(refundConfig.created_at),
        note: refundConfig.note ?? null,
        refund_line_items:
          refundConfig.refund_line_items?.map((lineItem) => {
            const match = lineItems.find((candidate) => candidate.id === ensureGid("LineItem", lineItem.line_item_id));
            return {
              line_item: {
                id: match?.id ?? ensureGid("LineItem", lineItem.line_item_id),
                variant_id: match?.variant_id ?? null,
                sku: match?.sku ?? null,
                name: match?.name ?? null,
                title: match?.title ?? null,
                quantity: match?.quantity ?? lineItem.quantity,
                original_unit_price: match?.original_unit_price ?? null,
              },
              quantity: lineItem.quantity,
              subtotal: normalizeMoney(lineItem.subtotal, "0.00"),
              total_tax: normalizeMoney(lineItem.total_tax, "0.00"),
            };
          }) ?? [],
      }));
      const orderValues: Omit<ShopifyOrder, "id" | "created_at" | "updated_at"> = {
        order_gid: orderGid,
        numeric_id: numberFromGid(orderGid),
        name: orderConfig.name ?? `#${numberFromGid(orderGid)}`,
        email: orderConfig.email ?? customer?.email ?? null,
        customer_gid: customer?.customer_gid ?? (orderConfig.customer_id ? ensureGid("Customer", orderConfig.customer_id) : null),
        display_financial_status: orderConfig.display_financial_status ?? "PAID",
        display_fulfillment_status: orderConfig.display_fulfillment_status ?? "UNFULFILLED",
        cancelled_at: orderConfig.cancelled_at ?? null,
        created_at_iso: toIsoDate(orderConfig.created_at),
        updated_at_iso: toIsoDate(orderConfig.updated_at),
        currency_code: orderConfig.currency_code ?? "USD",
        subtotal_amount: normalizeMoney(orderConfig.subtotal, "0.00"),
        total_tax_amount: normalizeMoney(orderConfig.total_tax, "0.00"),
        total_price_amount: normalizeMoney(orderConfig.total_price, "0.00"),
        total_discounts_amount: normalizeMoney(orderConfig.total_discounts, "0.00"),
        shipping_price_amount: normalizeMoney(orderConfig.shipping_price, "0.00"),
        note: orderConfig.note ?? null,
        tags: normalizeStringList(orderConfig.tags),
        shipping_address: defaultShippingAddress(orderConfig.shipping_address, customer?.default_address?.company ?? null),
        line_items: lineItems,
        refunds,
        fulfillment_order_gids: existing?.fulfillment_order_gids ?? [],
        fulfillment_gids: existing?.fulfillment_gids ?? [],
      };
      const order = existing ? (ss.orders.update(existing.id, orderValues)! as ShopifyOrder) : ss.orders.insert(orderValues);
      const fulfillmentOrders = orderConfig.fulfillment_orders?.length ? orderConfig.fulfillment_orders : [{}];
      for (const fulfillmentOrderConfig of fulfillmentOrders) {
        const fulfillmentOrder = ensureDefaultFulfillmentOrder(ss, order);
        if (fulfillmentOrderConfig.id || fulfillmentOrderConfig.status || fulfillmentOrderConfig.line_items) {
          const lineItemsForFulfillment = (fulfillmentOrderConfig.line_items ?? fulfillmentOrder.line_items).map((lineItem, index) => ({
            id: ensureGid("FulfillmentOrderLineItem", (lineItem as any).id ?? fulfillmentOrder.numeric_id * 100 + index + 1),
            line_item_gid: ensureGid("LineItem", (lineItem as any).line_item_id ?? (lineItem as any).line_item_gid ?? order.line_items[index]?.id ?? 1),
            total_quantity: (lineItem as any).total_quantity ?? order.line_items[index]?.quantity ?? 1,
            remaining_quantity: (lineItem as any).remaining_quantity ?? (lineItem as any).total_quantity ?? order.line_items[index]?.quantity ?? 1,
          }));
          ss.fulfillmentOrders.update(fulfillmentOrder.id, {
            fulfillment_order_gid: fulfillmentOrderConfig.id
              ? ensureGid("FulfillmentOrder", fulfillmentOrderConfig.id)
              : fulfillmentOrder.fulfillment_order_gid,
            numeric_id: fulfillmentOrderConfig.id ? numberFromGid(fulfillmentOrderConfig.id) : fulfillmentOrder.numeric_id,
            order_gid: order.order_gid,
            status: fulfillmentOrderConfig.status ?? fulfillmentOrder.status,
            request_status: fulfillmentOrderConfig.request_status ?? fulfillmentOrder.request_status,
            supported_actions: fulfillmentOrder.supported_actions,
            assigned_location_name: fulfillmentOrderConfig.assigned_location_name ?? fulfillmentOrder.assigned_location_name,
            line_items: lineItemsForFulfillment,
          });
        }
      }
    }
  }

  if (config.webhook_subscriptions) {
    for (const subscriptionConfig of config.webhook_subscriptions) {
      const clientId = subscriptionConfig.client_id ?? firstApp(ss)?.client_id ?? "shopify-client-id";
      const shopDomain = subscriptionConfig.shop ?? firstShop(ss)?.myshopify_domain ?? "demo-shop.myshopify.com";
      const topic = subscriptionConfig.topic.toLowerCase();
      const existing = ss.webhookSubscriptions
        .all()
        .find((subscription) => subscription.uri === subscriptionConfig.uri && subscription.topic === topic);
      const subscriptionGid = ensureGid("WebhookSubscription", existing?.numeric_id ?? 9000 + ss.webhookSubscriptions.all().length + 1);
      const values = {
        subscription_gid: subscriptionGid,
        numeric_id: numberFromGid(subscriptionGid),
        topic,
        uri: subscriptionConfig.uri,
        client_id: clientId,
        shop_domain: shopDomain,
        format: "JSON" as const,
        api_version: subscriptionConfig.api_version ?? "2026-01",
        include_fields: normalizeStringList(subscriptionConfig.include_fields),
        metafield_namespaces: [],
        active: true,
      };
      if (existing) ss.webhookSubscriptions.update(existing.id, values);
      else ss.webhookSubscriptions.insert(values);
    }
  }
}

export const shopifyPlugin: ServicePlugin = {
  name: "shopify",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    oauthRoutes(ctx);
    graphqlRoutes(ctx);
    inspectorRoutes(ctx);
  },
  seed(store: Store, baseUrl: string): void {
    seedDefaults(store, baseUrl);
  },
};

export default shopifyPlugin;
