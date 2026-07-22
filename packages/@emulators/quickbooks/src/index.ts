import type { Context, Hono } from "@emulators/core";
import type { AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import {
  DEFAULT_ACCESS_TOKEN,
  DEFAULT_COMPANY_NAME,
  DEFAULT_REALM_ID,
  DEFAULT_REFRESH_TOKEN,
  type QuickBooksSeedConfig,
  ensureCompanyPayload,
  ensureCustomerPayload,
  ensureInvoicePayload,
  ensureItemPayload,
  ensurePaymentPayload,
  ensureSalesReceiptPayload,
  ensureVendorPayload,
  findAccessToken,
  issueTokenPair,
  parseBearerToken,
  parseScopes,
} from "./helpers.js";
import { oauthRoutes } from "./routes/oauth.js";
import { inspectorRoutes } from "./routes/inspector.js";
import { apiRoutes } from "./routes/api.js";
import { getQuickBooksStore } from "./store.js";
import type {
  QBOCustomer,
  QBOInvoice,
  QBOItem,
  QBOPayment,
  QBOSalesReceipt,
  QBOVendor,
  QuickBooksCompanyRecord,
  QuickBooksResourceName,
  QuickBooksResourcePayloadMap,
} from "./entities.js";

export { getQuickBooksStore, type QuickBooksStore } from "./store.js";
export * from "./entities.js";
export * from "./helpers.js";

function applyQuickBooksTokenAuth(c: Context, store: Store): void {
  const token = parseBearerToken(c);
  const access = findAccessToken(store, token);
  if (!access) return;
  c.set("authToken", access.token);
  c.set("authScopes", access.scopes);
  c.set("authUser", {
    login: access.user_email,
    id: access.id,
    scopes: access.scopes,
  });
}

function insertResource<T extends QuickBooksResourcePayloadMap[QuickBooksResourceName]>(
  store: Store,
  entity: QuickBooksResourceName,
  realmId: string,
  payload: T,
): void {
  const qs = getQuickBooksStore(store);
  switch (entity) {
    case "Customer":
      if (!qs.customers.all().some((record) => record.realm_id === realmId && record.qbo_id === payload.Id)) {
        qs.customers.insert({
          realm_id: realmId,
          qbo_id: payload.Id,
          display_name: (payload as QBOCustomer).DisplayName,
          active: (payload as QBOCustomer).Active,
          payload: payload as QBOCustomer,
        });
      }
      return;
    case "Vendor":
      if (!qs.vendors.all().some((record) => record.realm_id === realmId && record.qbo_id === payload.Id)) {
        qs.vendors.insert({
          realm_id: realmId,
          qbo_id: payload.Id,
          display_name: (payload as QBOVendor).DisplayName,
          active: (payload as QBOVendor).Active,
          payload: payload as QBOVendor,
        });
      }
      return;
    case "Item":
      if (!qs.items.all().some((record) => record.realm_id === realmId && record.qbo_id === payload.Id)) {
        qs.items.insert({
          realm_id: realmId,
          qbo_id: payload.Id,
          name: (payload as QBOItem).Name,
          item_type: (payload as QBOItem).Type,
          active: (payload as QBOItem).Active,
          payload: payload as QBOItem,
        });
      }
      return;
    case "Invoice":
      if (!qs.invoices.all().some((record) => record.realm_id === realmId && record.qbo_id === payload.Id)) {
        qs.invoices.insert({
          realm_id: realmId,
          qbo_id: payload.Id,
          customer_ref: (payload as QBOInvoice).CustomerRef.value,
          txn_date: (payload as QBOInvoice).TxnDate,
          payload: payload as QBOInvoice,
        });
      }
      return;
    case "SalesReceipt":
      if (!qs.salesReceipts.all().some((record) => record.realm_id === realmId && record.qbo_id === payload.Id)) {
        qs.salesReceipts.insert({
          realm_id: realmId,
          qbo_id: payload.Id,
          customer_ref: (payload as QBOSalesReceipt).CustomerRef.value,
          txn_date: (payload as QBOSalesReceipt).TxnDate,
          payload: payload as QBOSalesReceipt,
        });
      }
      return;
    case "Payment":
      if (!qs.payments.all().some((record) => record.realm_id === realmId && record.qbo_id === payload.Id)) {
        qs.payments.insert({
          realm_id: realmId,
          qbo_id: payload.Id,
          customer_ref: (payload as QBOPayment).CustomerRef.value,
          txn_date: (payload as QBOPayment).TxnDate,
          payload: payload as QBOPayment,
        });
      }
      return;
  }
}

function upsertCompany(store: Store, payload: QuickBooksCompanyRecord["payload"]): void {
  const qs = getQuickBooksStore(store);
  const existing = qs.companies.findOneBy("realm_id", payload.Id);
  if (existing) {
    qs.companies.update(existing.id, {
      realm_id: payload.Id,
      company_name: payload.CompanyName,
      payload,
    });
    return;
  }
  qs.companies.insert({
    realm_id: payload.Id,
    company_name: payload.CompanyName,
    payload,
  });
}

function upsertUser(store: Store, email: string, name: string, realmIds: string[]): void {
  const qs = getQuickBooksStore(store);
  const existing = qs.users.findOneBy("email", email);
  const dedupedRealms = [...new Set(realmIds)];
  if (existing) {
    qs.users.update(existing.id, {
      name,
      realm_ids: [...new Set([...existing.realm_ids, ...dedupedRealms])],
    });
    return;
  }
  qs.users.insert({ email, name, realm_ids: dedupedRealms });
}

function seedDefaults(store: Store, _baseUrl: string): void {
  const company = ensureCompanyPayload(DEFAULT_REALM_ID, {
    CompanyName: DEFAULT_COMPANY_NAME,
    LegalName: DEFAULT_COMPANY_NAME,
    Country: "US",
    CompanyStartDate: "2024-01-01",
    CompanyAddr: {
      Line1: "123 Emulator Way",
      City: "San Francisco",
      CountrySubDivisionCode: "CA",
      PostalCode: "94105",
      Country: "US",
    },
    CustomerCommunicationEmailAddr: { Address: "billing@emulate.dev" },
    PrimaryPhone: { FreeFormNumber: "415-555-0100" },
  });
  upsertCompany(store, company);
  upsertUser(store, "admin@emulate.dev", "Emulate Admin", [DEFAULT_REALM_ID]);

  const qs = getQuickBooksStore(store);
  if (!qs.accessTokens.findOneBy("token", DEFAULT_ACCESS_TOKEN)) {
    qs.accessTokens.insert({
      token: DEFAULT_ACCESS_TOKEN,
      realm_id: DEFAULT_REALM_ID,
      user_email: "admin@emulate.dev",
      client_id: "seed",
      scopes: ["com.intuit.quickbooks.accounting"],
      expires_at: Date.now() + 60 * 60 * 1000,
      revoked: false,
    });
  }
  if (!qs.refreshTokens.findOneBy("token", DEFAULT_REFRESH_TOKEN)) {
    qs.refreshTokens.insert({
      token: DEFAULT_REFRESH_TOKEN,
      realm_id: DEFAULT_REALM_ID,
      user_email: "admin@emulate.dev",
      client_id: "seed",
      scopes: ["com.intuit.quickbooks.accounting"],
      expires_at: Date.now() + 100 * 24 * 60 * 60 * 1000,
      revoked: false,
    });
  }

  insertResource(
    store,
    "Customer",
    DEFAULT_REALM_ID,
    ensureCustomerPayload(store, DEFAULT_REALM_ID, {
      Id: "1",
      DisplayName: "Acme Grocery",
      CompanyName: "Acme Grocery",
      PrimaryEmailAddr: { Address: "buyer@acme.example" },
      PrimaryPhone: { FreeFormNumber: "415-555-0111" },
      BillAddr: {
        Line1: "1 Market Street",
        City: "San Francisco",
        CountrySubDivisionCode: "CA",
        PostalCode: "94105",
        Country: "US",
      },
      Balance: 0,
    }),
  );

  insertResource(
    store,
    "Customer",
    DEFAULT_REALM_ID,
    ensureCustomerPayload(store, DEFAULT_REALM_ID, {
      Id: "2",
      DisplayName: "Northwind Retail",
      CompanyName: "Northwind Retail",
      PrimaryEmailAddr: { Address: "ap@northwind.example" },
      PrimaryPhone: { FreeFormNumber: "415-555-0112" },
      Balance: 125.83,
    }),
  );

  insertResource(
    store,
    "Vendor",
    DEFAULT_REALM_ID,
    ensureVendorPayload(store, DEFAULT_REALM_ID, {
      Id: "10",
      DisplayName: "Best Distributor",
      CompanyName: "Best Distributor",
      PrimaryEmailAddr: { Address: "ops@best-distributor.example" },
      PrimaryPhone: { FreeFormNumber: "415-555-0120" },
    }),
  );

  insertResource(
    store,
    "Item",
    DEFAULT_REALM_ID,
    ensureItemPayload(store, DEFAULT_REALM_ID, {
      Id: "100",
      Name: "Sparkling Water 12oz",
      Sku: "SW-12OZ",
      Type: "Inventory",
      UnitPrice: 24.5,
      PurchaseCost: 12,
      QtyOnHand: 150,
      TrackQtyOnHand: true,
    }),
  );

  insertResource(
    store,
    "Item",
    DEFAULT_REALM_ID,
    ensureItemPayload(store, DEFAULT_REALM_ID, {
      Id: "101",
      Name: "Citrus Soda 16oz",
      Sku: "CS-16OZ",
      Type: "NonInventory",
      UnitPrice: 30,
      PurchaseCost: 14,
    }),
  );

  insertResource(
    store,
    "Item",
    DEFAULT_REALM_ID,
    ensureItemPayload(store, DEFAULT_REALM_ID, {
      Id: "102",
      Name: "Mixed 12-pack",
      Type: "Bundle",
      UnitPrice: 54.5,
    }),
  );

  insertResource(
    store,
    "Invoice",
    DEFAULT_REALM_ID,
    ensureInvoicePayload(store, DEFAULT_REALM_ID, {
      Id: "500",
      DocNumber: "306693",
      TxnDate: "2026-02-12",
      DueDate: "2026-03-12",
      CustomerRef: { value: "1", name: "Acme Grocery" },
      CurrencyRef: { value: "USD" },
      Line: [
        {
          Id: "1",
          Amount: 54.5,
          DetailType: "GroupLineDetail",
          GroupLineDetail: {
            GroupItemRef: { value: "102", name: "Mixed 12-pack" },
            Line: [
              {
                Id: "2",
                Amount: 24.5,
                DetailType: "SalesItemLineDetail",
                SalesItemLineDetail: { ItemRef: { value: "100", name: "Sparkling Water 12oz" }, Qty: 1, UnitPrice: 24.5 },
              },
              {
                Id: "3",
                Amount: 30,
                DetailType: "SalesItemLineDetail",
                SalesItemLineDetail: { ItemRef: { value: "101", name: "Citrus Soda 16oz" }, Qty: 1, UnitPrice: 30 },
              },
            ],
          },
        },
        {
          Id: "4",
          Amount: -5,
          DetailType: "DiscountLineDetail",
          DiscountLineDetail: { PercentBased: false },
        },
      ],
      TotalAmt: 49.5,
      Balance: 0,
      PrivateNote: "Seeded sample invoice",
      TxnTaxDetail: { TotalTax: 0 },
    }),
  );

  insertResource(
    store,
    "SalesReceipt",
    DEFAULT_REALM_ID,
    ensureSalesReceiptPayload(store, DEFAULT_REALM_ID, {
      Id: "700",
      DocNumber: "SR-700",
      TxnDate: "2026-02-15",
      CustomerRef: { value: "2", name: "Northwind Retail" },
      CurrencyRef: { value: "USD" },
      Line: [
        {
          Id: "1",
          Amount: 30,
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: { ItemRef: { value: "101", name: "Citrus Soda 16oz" }, Qty: 1, UnitPrice: 30 },
        },
      ],
      TotalAmt: 30,
    }),
  );

  insertResource(
    store,
    "Payment",
    DEFAULT_REALM_ID,
    ensurePaymentPayload(store, DEFAULT_REALM_ID, {
      Id: "900",
      TxnDate: "2026-02-16",
      CustomerRef: { value: "1", name: "Acme Grocery" },
      TotalAmt: 49.5,
      PaymentRefNum: "CHK-1001",
      Line: [{ Amount: 49.5, LinkedTxn: [{ TxnId: "500", TxnType: "Invoice" }] }],
    }),
  );
}

export function seedFromConfig(store: Store, _baseUrl: string, config: QuickBooksSeedConfig): void {
  const qs = getQuickBooksStore(store);

  for (const user of config.users ?? []) {
    upsertUser(store, user.email, user.name ?? user.email, user.realm_ids ?? []);
  }

  for (const oauthApp of config.oauth_apps ?? []) {
    const existing = qs.oauthApps.findOneBy("client_id", oauthApp.client_id);
    const payload = {
      client_id: oauthApp.client_id,
      client_secret: oauthApp.client_secret,
      name: oauthApp.name ?? oauthApp.client_id,
      redirect_uris: oauthApp.redirect_uris,
      scopes: parseScopes(oauthApp.scopes),
    };
    if (existing) {
      qs.oauthApps.update(existing.id, payload);
    } else {
      qs.oauthApps.insert(payload);
    }
  }

  for (const company of config.companies ?? []) {
    const realmId = company.realm_id ?? DEFAULT_REALM_ID;
    upsertCompany(
      store,
      ensureCompanyPayload(realmId, {
        Id: realmId,
        CompanyName: company.company_name,
        LegalName: company.legal_name ?? company.company_name,
        Country: company.country ?? "US",
        CompanyAddr: company.company_addr,
        CustomerCommunicationEmailAddr: company.email ? { Address: company.email } : undefined,
        PrimaryPhone: company.phone ? { FreeFormNumber: company.phone } : undefined,
      }),
    );

    const customerPayloads = (company.customers ?? []).map((payload) => ensureCustomerPayload(store, realmId, payload));
    const vendorPayloads = (company.vendors ?? []).map((payload) => ensureVendorPayload(store, realmId, payload));
    const itemPayloads = (company.items ?? []).map((payload) => ensureItemPayload(store, realmId, payload));
    const invoicePayloads = (company.invoices ?? []).map((payload) => ensureInvoicePayload(store, realmId, payload));
    const salesReceiptPayloads = (company.sales_receipts ?? []).map((payload) => ensureSalesReceiptPayload(store, realmId, payload));
    const paymentPayloads = (company.payments ?? []).map((payload) => ensurePaymentPayload(store, realmId, payload));

    customerPayloads.forEach((payload) => insertResource(store, "Customer", realmId, payload));
    vendorPayloads.forEach((payload) => insertResource(store, "Vendor", realmId, payload));
    itemPayloads.forEach((payload) => insertResource(store, "Item", realmId, payload));
    invoicePayloads.forEach((payload) => insertResource(store, "Invoice", realmId, payload));
    salesReceiptPayloads.forEach((payload) => insertResource(store, "SalesReceipt", realmId, payload));
    paymentPayloads.forEach((payload) => insertResource(store, "Payment", realmId, payload));

    for (const token of company.tokens ?? []) {
      const userEmail = token.user ?? "admin@emulate.dev";
      upsertUser(store, userEmail, userEmail, [realmId]);
      if (!token.access_token || !token.refresh_token) {
        issueTokenPair(store, realmId, userEmail, "seed", parseScopes(token.scopes));
        continue;
      }
      if (!qs.accessTokens.findOneBy("token", token.access_token)) {
        qs.accessTokens.insert({
          token: token.access_token,
          realm_id: realmId,
          user_email: userEmail,
          client_id: "seed",
          scopes: parseScopes(token.scopes),
          expires_at: Date.now() + 60 * 60 * 1000,
          revoked: false,
        });
      }
      if (!qs.refreshTokens.findOneBy("token", token.refresh_token)) {
        qs.refreshTokens.insert({
          token: token.refresh_token,
          realm_id: realmId,
          user_email: userEmail,
          client_id: "seed",
          scopes: parseScopes(token.scopes),
          expires_at: Date.now() + 100 * 24 * 60 * 60 * 1000,
          revoked: false,
        });
      }
    }
  }

  for (const token of config.tokens ?? []) {
    upsertUser(store, token.user, token.user, [token.realm_id]);
    if (!qs.accessTokens.findOneBy("token", token.access_token ?? "")) {
      qs.accessTokens.insert({
        token: token.access_token ?? `${token.realm_id}-access-token`,
        realm_id: token.realm_id,
        user_email: token.user,
        client_id: token.client_id ?? "seed",
        scopes: parseScopes(token.scopes),
        expires_at: Date.now() + 60 * 60 * 1000,
        revoked: false,
      });
    }
    if (token.refresh_token && !qs.refreshTokens.findOneBy("token", token.refresh_token)) {
      qs.refreshTokens.insert({
        token: token.refresh_token,
        realm_id: token.realm_id,
        user_email: token.user,
        client_id: token.client_id ?? "seed",
        scopes: parseScopes(token.scopes),
        expires_at: Date.now() + 100 * 24 * 60 * 60 * 1000,
        revoked: false,
      });
    }
  }
}

export const quickbooksPlugin: ServicePlugin = {
  name: "quickbooks",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    app.use("*", async (c, next) => {
      applyQuickBooksTokenAuth(c, store);
      await next();
    });

    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    inspectorRoutes(ctx);
    oauthRoutes(ctx);
    apiRoutes(ctx);
  },
  seed(store: Store, baseUrl: string): void {
    seedDefaults(store, baseUrl);
  },
};

export default quickbooksPlugin;
