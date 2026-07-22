import { type Collection, type Store } from "@emulators/core";
import type {
  QuickBooksAccessTokenRecord,
  QuickBooksCompanyRecord,
  QuickBooksCustomerRecord,
  QuickBooksInvoiceRecord,
  QuickBooksItemRecord,
  QuickBooksOAuthApp,
  QuickBooksPaymentRecord,
  QuickBooksQueryLog,
  QuickBooksRefreshTokenRecord,
  QuickBooksSalesReceiptRecord,
  QuickBooksUser,
  QuickBooksVendorRecord,
} from "./entities.js";

export interface QuickBooksStore {
  users: Collection<QuickBooksUser>;
  oauthApps: Collection<QuickBooksOAuthApp>;
  companies: Collection<QuickBooksCompanyRecord>;
  customers: Collection<QuickBooksCustomerRecord>;
  vendors: Collection<QuickBooksVendorRecord>;
  items: Collection<QuickBooksItemRecord>;
  invoices: Collection<QuickBooksInvoiceRecord>;
  salesReceipts: Collection<QuickBooksSalesReceiptRecord>;
  payments: Collection<QuickBooksPaymentRecord>;
  accessTokens: Collection<QuickBooksAccessTokenRecord>;
  refreshTokens: Collection<QuickBooksRefreshTokenRecord>;
  queryLogs: Collection<QuickBooksQueryLog>;
}

export function getQuickBooksStore(store: Store): QuickBooksStore {
  return {
    users: store.collection<QuickBooksUser>("quickbooks.users", ["email"]),
    oauthApps: store.collection<QuickBooksOAuthApp>("quickbooks.oauthApps", ["client_id"]),
    companies: store.collection<QuickBooksCompanyRecord>("quickbooks.companies", ["realm_id", "company_name"]),
    customers: store.collection<QuickBooksCustomerRecord>("quickbooks.customers", ["realm_id", "qbo_id", "display_name"]),
    vendors: store.collection<QuickBooksVendorRecord>("quickbooks.vendors", ["realm_id", "qbo_id", "display_name"]),
    items: store.collection<QuickBooksItemRecord>("quickbooks.items", ["realm_id", "qbo_id", "name", "item_type"]),
    invoices: store.collection<QuickBooksInvoiceRecord>("quickbooks.invoices", ["realm_id", "qbo_id", "customer_ref"]),
    salesReceipts: store.collection<QuickBooksSalesReceiptRecord>("quickbooks.salesReceipts", [
      "realm_id",
      "qbo_id",
      "customer_ref",
    ]),
    payments: store.collection<QuickBooksPaymentRecord>("quickbooks.payments", ["realm_id", "qbo_id", "customer_ref"]),
    accessTokens: store.collection<QuickBooksAccessTokenRecord>("quickbooks.accessTokens", ["token", "realm_id", "user_email"]),
    refreshTokens: store.collection<QuickBooksRefreshTokenRecord>("quickbooks.refreshTokens", [
      "token",
      "realm_id",
      "user_email",
    ]),
    queryLogs: store.collection<QuickBooksQueryLog>("quickbooks.queryLogs", ["realm_id", "entity"]),
  };
}
