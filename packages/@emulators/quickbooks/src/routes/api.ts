import type { Context, RouteContext, Store } from "@emulators/core";
import type {
  QBOCustomer,
  QBOInvoice,
  QBOItem,
  QBOPayment,
  QBOSalesReceipt,
  QBOVendor,
  QuickBooksResourceName,
  QuickBooksResourcePayloadMap,
} from "../entities.js";
import {
  buildEnvelope,
  deepMerge,
  ensureCompanyPayload,
  ensureCustomerPayload,
  ensureInvoicePayload,
  ensureItemPayload,
  ensurePaymentPayload,
  ensureSalesReceiptPayload,
  ensureVendorPayload,
  filterByConditions,
  paginate,
  parseQuickBooksBody,
  parseQuery,
  qboError,
  recordQuery,
  requireQuickBooksAuth,
  sanitizePatch,
  sortByQboId,
  nowIso,
  nextSyncToken,
  makeMetaData,
} from "../helpers.js";
import { getQuickBooksStore } from "../store.js";

export function apiRoutes({ app, store }: RouteContext): void {
  const qs = () => getQuickBooksStore(store);

  app.get("/v3/company/:realmId/companyinfo/:companyId", (c) => {
    const realmId = c.req.param("realmId");
    const auth = requireQuickBooksAuth(c, store, realmId);
    if (auth instanceof Response) return auth;

    const companyId = c.req.param("companyId");
    if (companyId !== realmId) {
      return qboError(c, 404, "Object Not Found", `Company '${companyId}' was not found in realm '${realmId}'.`, "610");
    }

    const company = qs().companies.findOneBy("realm_id", realmId);
    if (!company) {
      return qboError(c, 404, "Object Not Found", `Company '${companyId}' was not found.`, "610");
    }

    return c.json(buildEnvelope("CompanyInfo", company.payload));
  });

  app.get("/v3/company/:realmId/query", async (c) => {
    return handleQuery(c.req.param("realmId"), c.req.query("query") ?? "", c);
  });

  app.post("/v3/company/:realmId/query", async (c) => {
    const body = await parseQuickBooksBody(c);
    const query = String(body.query ?? body.raw ?? "");
    return handleQuery(c.req.param("realmId"), query, c);
  });

  registerEntityRoutes<QBOCustomer>("Customer", "customer", ensureCustomerPayload);
  registerEntityRoutes<QBOVendor>("Vendor", "vendor", ensureVendorPayload);
  registerEntityRoutes<QBOItem>("Item", "item", ensureItemPayload);
  registerEntityRoutes<QBOInvoice>("Invoice", "invoice", ensureInvoicePayload);
  registerEntityRoutes<QBOSalesReceipt>("SalesReceipt", "salesreceipt", ensureSalesReceiptPayload);
  registerEntityRoutes<QBOPayment>("Payment", "payment", ensurePaymentPayload);

  async function handleQuery(realmId: string, query: string, c: Context) {
    const auth = requireQuickBooksAuth(c, store, realmId);
    if (auth instanceof Response) return auth;
    if (!query.trim()) {
      return qboError(c, 400, "Invalid query", "A QuickBooks SQL query is required.", "4001");
    }

    let parsed;
    try {
      parsed = parseQuery(query);
    } catch (err) {
      return qboError(c, 400, "Invalid query", err instanceof Error ? err.message : String(err), "4001");
    }

    const records = recordsForEntity(parsed.entity, realmId)
      .map((record) => record.payload)
      .filter((payload) => filterByConditions([payload], parsed.conditions).length > 0);

    const page = paginate(records, parsed.startPosition, parsed.maxResults);
    recordQuery(store, auth.token, realmId, parsed.entity, query, page.length);

    const response: Record<string, unknown> = {
      startPosition: parsed.startPosition,
      maxResults: parsed.maxResults,
      totalCount: records.length,
    };

    if (parsed.select === "*") {
      if (page.length > 0) response[parsed.entity] = page;
    }

    return c.json({ QueryResponse: response, time: nowIso() });
  }

  function registerEntityRoutes<T extends QuickBooksResourcePayloadMap[QuickBooksResourceName]>(
    entityName: QuickBooksResourceName,
    pathSegment: string,
    ensurePayload: (store: Store, realmId: string, input: Partial<T>) => T,
  ): void {
    app.get(`/v3/company/:realmId/${pathSegment}/:id`, (c) => {
      const realmId = c.req.param("realmId");
      const auth = requireQuickBooksAuth(c, store, realmId);
      if (auth instanceof Response) return auth;

      const record = findRecord(entityName, realmId, c.req.param("id"));
      if (!record) {
        return qboError(c, 404, "Object Not Found", `${entityName} '${c.req.param("id")}' was not found.`, "610");
      }
      return c.json(buildEnvelope(entityName, record.payload));
    });

    app.post(`/v3/company/:realmId/${pathSegment}`, async (c) => {
      const realmId = c.req.param("realmId");
      const auth = requireQuickBooksAuth(c, store, realmId);
      if (auth instanceof Response) return auth;

      const body = (await parseQuickBooksBody(c)) as Partial<T> & { sparse?: boolean; Id?: string; SyncToken?: string };
      const operation = (c.req.query("operation") ?? "create").toLowerCase();

      if (operation === "update") {
        if (!body.Id) {
          return qboError(c, 400, "Missing required field", `QuickBooks ${entityName} update requires Id.`, "2020");
        }
        const existing = findRecord(entityName, realmId, String(body.Id));
        if (!existing) {
          return qboError(c, 404, "Object Not Found", `${entityName} '${body.Id}' was not found.`, "610");
        }
        if (String(body.SyncToken ?? "") !== existing.payload.SyncToken) {
          return qboError(c, 409, "Stale Object Error", `${entityName} '${body.Id}' has a newer SyncToken.`, "5010");
        }

        const patch = sanitizePatch<T>(body as Partial<T>);
        const merged = deepMerge(existing.payload as T, patch);
        const nextPayload = ensurePayload(store, realmId, {
          ...merged,
          Id: existing.payload.Id,
          SyncToken: nextSyncToken(existing.payload.SyncToken),
          MetaData: makeMetaData(existing.payload.MetaData),
        } as Partial<T>);

        updateRecord(entityName, existing.id, realmId, nextPayload);
        return c.json(buildEnvelope(entityName, nextPayload));
      }

      const nextPayload = ensurePayload(store, realmId, sanitizePatch<T>(body as Partial<T>));
      insertRecord(entityName, realmId, nextPayload);
      return c.json(buildEnvelope(entityName, nextPayload), 200);
    });
  }

  function recordsForEntity(entityName: QuickBooksResourceName, realmId: string): Array<{ id: number; payload: QuickBooksResourcePayloadMap[QuickBooksResourceName] }> {
    switch (entityName) {
      case "Customer":
        return sortByQboId(qs().customers.findBy("realm_id", realmId)).map((record) => ({ id: record.id, payload: record.payload }));
      case "Vendor":
        return sortByQboId(qs().vendors.findBy("realm_id", realmId)).map((record) => ({ id: record.id, payload: record.payload }));
      case "Item":
        return sortByQboId(qs().items.findBy("realm_id", realmId)).map((record) => ({ id: record.id, payload: record.payload }));
      case "Invoice":
        return sortByQboId(qs().invoices.findBy("realm_id", realmId)).map((record) => ({ id: record.id, payload: record.payload }));
      case "SalesReceipt":
        return sortByQboId(qs().salesReceipts.findBy("realm_id", realmId)).map((record) => ({ id: record.id, payload: record.payload }));
      case "Payment":
        return sortByQboId(qs().payments.findBy("realm_id", realmId)).map((record) => ({ id: record.id, payload: record.payload }));
    }
  }

  function findRecord(entityName: QuickBooksResourceName, realmId: string, id: string): { id: number; payload: QuickBooksResourcePayloadMap[QuickBooksResourceName] } | undefined {
    return recordsForEntity(entityName, realmId).find((record) => record.payload.Id === id);
  }

  function insertRecord<T extends QuickBooksResourcePayloadMap[QuickBooksResourceName]>(
    entityName: QuickBooksResourceName,
    realmId: string,
    payload: T,
  ): void {
    switch (entityName) {
      case "Customer":
        qs().customers.insert({
          realm_id: realmId,
          qbo_id: payload.Id,
          display_name: (payload as QBOCustomer).DisplayName,
          active: (payload as QBOCustomer).Active,
          payload: payload as QBOCustomer,
        });
        return;
      case "Vendor":
        qs().vendors.insert({
          realm_id: realmId,
          qbo_id: payload.Id,
          display_name: (payload as QBOVendor).DisplayName,
          active: (payload as QBOVendor).Active,
          payload: payload as QBOVendor,
        });
        return;
      case "Item":
        qs().items.insert({
          realm_id: realmId,
          qbo_id: payload.Id,
          name: (payload as QBOItem).Name,
          item_type: (payload as QBOItem).Type,
          active: (payload as QBOItem).Active,
          payload: payload as QBOItem,
        });
        return;
      case "Invoice":
        qs().invoices.insert({
          realm_id: realmId,
          qbo_id: payload.Id,
          customer_ref: (payload as QBOInvoice).CustomerRef.value,
          txn_date: (payload as QBOInvoice).TxnDate,
          payload: payload as QBOInvoice,
        });
        return;
      case "SalesReceipt":
        qs().salesReceipts.insert({
          realm_id: realmId,
          qbo_id: payload.Id,
          customer_ref: (payload as QBOSalesReceipt).CustomerRef.value,
          txn_date: (payload as QBOSalesReceipt).TxnDate,
          payload: payload as QBOSalesReceipt,
        });
        return;
      case "Payment":
        qs().payments.insert({
          realm_id: realmId,
          qbo_id: payload.Id,
          customer_ref: (payload as QBOPayment).CustomerRef.value,
          txn_date: (payload as QBOPayment).TxnDate,
          payload: payload as QBOPayment,
        });
        return;
    }
  }

  function updateRecord<T extends QuickBooksResourcePayloadMap[QuickBooksResourceName]>(
    entityName: QuickBooksResourceName,
    recordId: number,
    realmId: string,
    payload: T,
  ): void {
    switch (entityName) {
      case "Customer":
        qs().customers.update(recordId, {
          realm_id: realmId,
          qbo_id: payload.Id,
          display_name: (payload as QBOCustomer).DisplayName,
          active: (payload as QBOCustomer).Active,
          payload: payload as QBOCustomer,
        });
        return;
      case "Vendor":
        qs().vendors.update(recordId, {
          realm_id: realmId,
          qbo_id: payload.Id,
          display_name: (payload as QBOVendor).DisplayName,
          active: (payload as QBOVendor).Active,
          payload: payload as QBOVendor,
        });
        return;
      case "Item":
        qs().items.update(recordId, {
          realm_id: realmId,
          qbo_id: payload.Id,
          name: (payload as QBOItem).Name,
          item_type: (payload as QBOItem).Type,
          active: (payload as QBOItem).Active,
          payload: payload as QBOItem,
        });
        return;
      case "Invoice":
        qs().invoices.update(recordId, {
          realm_id: realmId,
          qbo_id: payload.Id,
          customer_ref: (payload as QBOInvoice).CustomerRef.value,
          txn_date: (payload as QBOInvoice).TxnDate,
          payload: payload as QBOInvoice,
        });
        return;
      case "SalesReceipt":
        qs().salesReceipts.update(recordId, {
          realm_id: realmId,
          qbo_id: payload.Id,
          customer_ref: (payload as QBOSalesReceipt).CustomerRef.value,
          txn_date: (payload as QBOSalesReceipt).TxnDate,
          payload: payload as QBOSalesReceipt,
        });
        return;
      case "Payment":
        qs().payments.update(recordId, {
          realm_id: realmId,
          qbo_id: payload.Id,
          customer_ref: (payload as QBOPayment).CustomerRef.value,
          txn_date: (payload as QBOPayment).TxnDate,
          payload: payload as QBOPayment,
        });
        return;
    }
  }
}
