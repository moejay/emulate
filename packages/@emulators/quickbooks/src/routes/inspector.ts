import type { InspectorTab, RouteContext } from "@emulators/core";
import { escapeHtml, renderInspectorPage } from "@emulators/core";
import { SERVICE_LABEL, primaryDisplay } from "../helpers.js";
import { getQuickBooksStore } from "../store.js";

const INSPECTOR_TABS: InspectorTab[] = [
  { id: "overview", label: "Overview", href: "/?tab=overview" },
  { id: "customers", label: "Customers", href: "/?tab=customers" },
  { id: "items", label: "Items", href: "/?tab=items" },
  { id: "transactions", label: "Transactions", href: "/?tab=transactions" },
  { id: "auth", label: "Auth", href: "/?tab=auth" },
  { id: "queries", label: "Queries", href: "/?tab=queries" },
];

type TabId = (typeof INSPECTOR_TABS)[number]["id"];

function section(title: string, body: string): string {
  return `<section class="inspector-section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function table(headers: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) return `<p class="inspector-empty">${escapeHtml(empty)}</p>`;
  return `<table class="inspector-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function badge(text: string, tone: "granted" | "requested" | "denied" = "requested"): string {
  return `<span class="badge badge-${tone}">${escapeHtml(text)}</span>`;
}

export function inspectorRoutes({ app, store }: RouteContext): void {
  const qs = () => getQuickBooksStore(store);

  app.get("/", (c) => {
    const requestedTab = c.req.query("tab") ?? "overview";
    const activeTab = INSPECTOR_TABS.some((tab) => tab.id === requestedTab) ? (requestedTab as TabId) : "overview";

    const body =
      activeTab === "customers"
        ? renderCustomers()
        : activeTab === "items"
          ? renderItems()
          : activeTab === "transactions"
            ? renderTransactions()
            : activeTab === "auth"
              ? renderAuth()
              : activeTab === "queries"
                ? renderQueries()
                : renderOverview();

    return c.html(renderInspectorPage("QuickBooks Inspector", INSPECTOR_TABS, activeTab, body, SERVICE_LABEL));
  });

  function renderOverview(): string {
    const companies = qs().companies.all();
    const rows = companies.map((company) => [
      escapeHtml(company.realm_id),
      escapeHtml(company.company_name),
      escapeHtml(String(qs().customers.findBy("realm_id", company.realm_id).length)),
      escapeHtml(String(qs().items.findBy("realm_id", company.realm_id).length)),
      escapeHtml(
        String(
          qs().invoices.findBy("realm_id", company.realm_id).length +
            qs().salesReceipts.findBy("realm_id", company.realm_id).length +
            qs().payments.findBy("realm_id", company.realm_id).length,
        ),
      ),
    ]);

    const recentQueries = qs().queryLogs
      .all()
      .sort((a, b) => b.id - a.id)
      .slice(0, 10)
      .map((query) => [
        escapeHtml(query.realm_id),
        escapeHtml(query.entity),
        escapeHtml(query.query),
        escapeHtml(String(query.result_count)),
      ]);

    return [
      section("Companies", table(["Realm", "Name", "Customers", "Items", "Transactions"], rows, "No companies seeded.")),
      section("Recent Queries", table(["Realm", "Entity", "Query", "Rows"], recentQueries, "No QuickBooks queries recorded yet.")),
    ].join("\n");
  }

  function renderCustomers(): string {
    const customerRows = qs().customers
      .all()
      .sort((a, b) => a.realm_id.localeCompare(b.realm_id) || a.qbo_id.localeCompare(b.qbo_id))
      .map((customer) => [
        escapeHtml(customer.realm_id),
        escapeHtml(customer.payload.Id),
        escapeHtml(customer.payload.DisplayName),
        escapeHtml(customer.payload.PrimaryEmailAddr?.Address ?? ""),
        escapeHtml(customer.payload.PrimaryPhone?.FreeFormNumber ?? ""),
        customer.payload.Active ? badge("active", "granted") : badge("inactive", "denied"),
      ]);

    const vendorRows = qs().vendors
      .all()
      .sort((a, b) => a.realm_id.localeCompare(b.realm_id) || a.qbo_id.localeCompare(b.qbo_id))
      .map((vendor) => [
        escapeHtml(vendor.realm_id),
        escapeHtml(vendor.payload.Id),
        escapeHtml(vendor.payload.DisplayName),
        escapeHtml(vendor.payload.PrimaryEmailAddr?.Address ?? ""),
        escapeHtml(vendor.payload.PrimaryPhone?.FreeFormNumber ?? ""),
        vendor.payload.Active ? badge("active", "granted") : badge("inactive", "denied"),
      ]);

    return [
      section("Customers", table(["Realm", "ID", "Display Name", "Email", "Phone", "State"], customerRows, "No customers seeded.")),
      section("Vendors", table(["Realm", "ID", "Display Name", "Email", "Phone", "State"], vendorRows, "No vendors seeded.")),
    ].join("\n");
  }

  function renderItems(): string {
    const rows = qs().items
      .all()
      .sort((a, b) => a.realm_id.localeCompare(b.realm_id) || a.qbo_id.localeCompare(b.qbo_id))
      .map((item) => [
        escapeHtml(item.realm_id),
        escapeHtml(item.payload.Id),
        escapeHtml(item.payload.Name),
        escapeHtml(item.payload.Type),
        escapeHtml(item.payload.Sku ?? ""),
        escapeHtml(String(item.payload.UnitPrice ?? "")),
        item.payload.Active ? badge("active", "granted") : badge("inactive", "denied"),
      ]);

    return section("Items", table(["Realm", "ID", "Name", "Type", "SKU", "Price", "State"], rows, "No items seeded."));
  }

  function renderTransactions(): string {
    const invoiceRows = qs().invoices
      .all()
      .sort((a, b) => a.realm_id.localeCompare(b.realm_id) || a.qbo_id.localeCompare(b.qbo_id))
      .map((invoice) => [
        escapeHtml(invoice.realm_id),
        escapeHtml(invoice.payload.Id),
        escapeHtml(invoice.payload.DocNumber ?? invoice.payload.Id),
        escapeHtml(primaryDisplay(invoice.payload.CustomerRef)),
        escapeHtml(invoice.payload.TxnDate),
        escapeHtml(String(invoice.payload.TotalAmt)),
        escapeHtml(String(invoice.payload.Line.length)),
      ]);

    const receiptRows = qs().salesReceipts
      .all()
      .sort((a, b) => a.realm_id.localeCompare(b.realm_id) || a.qbo_id.localeCompare(b.qbo_id))
      .map((receipt) => [
        escapeHtml(receipt.realm_id),
        escapeHtml(receipt.payload.Id),
        escapeHtml(receipt.payload.DocNumber ?? receipt.payload.Id),
        escapeHtml(primaryDisplay(receipt.payload.CustomerRef)),
        escapeHtml(receipt.payload.TxnDate),
        escapeHtml(String(receipt.payload.TotalAmt)),
      ]);

    const paymentRows = qs().payments
      .all()
      .sort((a, b) => a.realm_id.localeCompare(b.realm_id) || a.qbo_id.localeCompare(b.qbo_id))
      .map((payment) => [
        escapeHtml(payment.realm_id),
        escapeHtml(payment.payload.Id),
        escapeHtml(primaryDisplay(payment.payload.CustomerRef)),
        escapeHtml(payment.payload.TxnDate),
        escapeHtml(String(payment.payload.TotalAmt)),
        escapeHtml(payment.payload.PaymentRefNum ?? ""),
      ]);

    return [
      section("Invoices", table(["Realm", "ID", "Doc #", "Customer", "Txn Date", "Total", "Lines"], invoiceRows, "No invoices seeded.")),
      section("Sales Receipts", table(["Realm", "ID", "Doc #", "Customer", "Txn Date", "Total"], receiptRows, "No sales receipts seeded.")),
      section("Payments", table(["Realm", "ID", "Customer", "Txn Date", "Total", "Reference"], paymentRows, "No payments seeded.")),
    ].join("\n");
  }

  function renderAuth(): string {
    const appRows = qs().oauthApps.all().map((oauthApp) => [
      escapeHtml(oauthApp.client_id),
      escapeHtml(oauthApp.name),
      escapeHtml(oauthApp.redirect_uris.join(", ")),
      escapeHtml(oauthApp.scopes.join(", ")),
    ]);

    const userRows = qs().users.all().map((user) => [
      escapeHtml(user.email),
      escapeHtml(user.name),
      escapeHtml(user.realm_ids.join(", ")),
    ]);

    const accessRows = qs().accessTokens
      .all()
      .sort((a, b) => b.id - a.id)
      .map((token) => [
        escapeHtml(mask(token.token)),
        escapeHtml(token.realm_id),
        escapeHtml(token.user_email),
        escapeHtml(token.client_id),
        token.revoked ? badge("revoked", "denied") : badge("active", "granted"),
      ]);

    const refreshRows = qs().refreshTokens
      .all()
      .sort((a, b) => b.id - a.id)
      .map((token) => [
        escapeHtml(mask(token.token)),
        escapeHtml(token.realm_id),
        escapeHtml(token.user_email),
        token.revoked ? badge("revoked", "denied") : badge("active", "granted"),
      ]);

    return [
      section("OAuth Apps", table(["Client ID", "Name", "Redirect URIs", "Scopes"], appRows, "No OAuth apps configured.")),
      section("Users", table(["Email", "Name", "Realm Access"], userRows, "No QuickBooks users seeded.")),
      section("Access Tokens", table(["Token", "Realm", "User", "Client ID", "State"], accessRows, "No access tokens issued.")),
      section("Refresh Tokens", table(["Token", "Realm", "User", "State"], refreshRows, "No refresh tokens issued.")),
    ].join("\n");
  }

  function renderQueries(): string {
    const rows = qs().queryLogs
      .all()
      .sort((a, b) => b.id - a.id)
      .map((query) => [
        escapeHtml(query.realm_id),
        escapeHtml(query.entity),
        escapeHtml(query.query),
        escapeHtml(String(query.result_count)),
        escapeHtml(query.created_at),
      ]);
    return section("Query Log", table(["Realm", "Entity", "Query", "Rows", "At"], rows, "No QuickBooks queries recorded yet."));
  }
}

function mask(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 10)}...${value.slice(-4)}`;
}
