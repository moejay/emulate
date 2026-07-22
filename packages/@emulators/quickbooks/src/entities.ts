import type { Entity } from "@emulators/core";

export type QuickBooksScope =
  | "com.intuit.quickbooks.accounting"
  | "openid"
  | "profile"
  | "email"
  | "phone"
  | "address";

export interface QBORef {
  value: string;
  name?: string;
}

export interface QBOMetaData {
  CreateTime: string;
  LastUpdatedTime: string;
}

export interface QBOPhysicalAddress {
  Id?: string;
  Line1?: string;
  Line2?: string;
  Line3?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
  Country?: string;
  Lat?: string;
  Long?: string;
}

export interface QBOTelephoneNumber {
  FreeFormNumber?: string;
}

export interface QBOEmailAddress {
  Address?: string;
}

export interface QBOCompanyInfo {
  CompanyName: string;
  LegalName?: string;
  CompanyAddr?: QBOPhysicalAddress;
  CustomerCommunicationAddr?: QBOPhysicalAddress;
  LegalAddr?: QBOPhysicalAddress;
  CustomerCommunicationEmailAddr?: QBOEmailAddress;
  Email?: { Address?: string };
  PrimaryPhone?: QBOTelephoneNumber;
  CompanyStartDate?: string;
  Country?: string;
  NameValue?: Array<{ Name?: string; Value?: string }>;
  WebAddr?: { URI?: string };
  MetaData: QBOMetaData;
  SyncToken: string;
  Id: string;
}

export interface QBOCustomer {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  Title?: string;
  BillAddr?: QBOPhysicalAddress;
  ShipAddr?: QBOPhysicalAddress;
  PrimaryPhone?: QBOTelephoneNumber;
  Mobile?: QBOTelephoneNumber;
  PrimaryEmailAddr?: QBOEmailAddress;
  Notes?: string;
  Active: boolean;
  Balance?: number;
  BalanceWithJobs?: number;
  PreferredDeliveryMethod?: string;
  MetaData: QBOMetaData;
  SyncToken: string;
}

export interface QBOVendor {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  Active: boolean;
  PrimaryPhone?: QBOTelephoneNumber;
  Mobile?: QBOTelephoneNumber;
  PrimaryEmailAddr?: QBOEmailAddress;
  BillAddr?: QBOPhysicalAddress;
  Balance?: number;
  Vendor1099?: boolean;
  PrintOnCheckName?: string;
  MetaData: QBOMetaData;
  SyncToken: string;
}

export interface QBOItem {
  Id: string;
  Name: string;
  FullyQualifiedName?: string;
  Sku?: string;
  Type: string;
  Description?: string;
  Active: boolean;
  UnitPrice?: number;
  PurchaseCost?: number;
  QtyOnHand?: number;
  TrackQtyOnHand?: boolean;
  IncomeAccountRef?: QBORef;
  ExpenseAccountRef?: QBORef;
  AssetAccountRef?: QBORef;
  MetaData: QBOMetaData;
  SyncToken: string;
}

export interface QBOInvoiceLine {
  Id?: string;
  LineNum?: number;
  Amount: number;
  DetailType:
    | "SalesItemLineDetail"
    | "GroupLineDetail"
    | "DiscountLineDetail"
    | "SubTotalLineDetail"
    | "DescriptionOnly";
  Description?: string;
  SalesItemLineDetail?: {
    ItemRef: QBORef;
    Qty?: number;
    UnitPrice?: number;
    TaxCodeRef?: QBORef;
    DiscountAmt?: number;
    DiscountRate?: number;
  };
  DiscountLineDetail?: {
    PercentBased?: boolean;
    DiscountPercent?: number;
  };
  GroupLineDetail?: {
    Quantity?: number;
    GroupItemRef: QBORef;
    Line?: QBOInvoiceLine[];
  };
}

export interface QBOInvoice {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  DueDate?: string;
  CustomerRef: QBORef;
  CurrencyRef?: QBORef;
  ShipAddr?: QBOPhysicalAddress;
  Line: QBOInvoiceLine[];
  TotalAmt: number;
  Balance?: number;
  TxnTaxDetail?: { TotalTax?: number };
  EmailStatus?: "NotSet" | "NeedToSend" | "EmailSent";
  PrivateNote?: string;
  CustomerMemo?: { value: string };
  MetaData: QBOMetaData;
  SyncToken: string;
}

export interface QBOSalesReceipt {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  CustomerRef: QBORef;
  CurrencyRef?: QBORef;
  ShipAddr?: QBOPhysicalAddress;
  Line: QBOInvoiceLine[];
  TotalAmt: number;
  PrivateNote?: string;
  CustomerMemo?: { value: string };
  MetaData: QBOMetaData;
  SyncToken: string;
}

export interface QBOPayment {
  Id: string;
  TxnDate: string;
  CustomerRef: QBORef;
  CurrencyRef?: QBORef;
  TotalAmt: number;
  PaymentRefNum?: string;
  PrivateNote?: string;
  UnappliedAmt?: number;
  Line?: Array<{
    Amount?: number;
    LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
  }>;
  MetaData: QBOMetaData;
  SyncToken: string;
}

export interface QuickBooksUser extends Entity {
  email: string;
  name: string;
  realm_ids: string[];
}

export interface QuickBooksOAuthApp extends Entity {
  client_id: string;
  client_secret: string;
  name: string;
  redirect_uris: string[];
  scopes: QuickBooksScope[];
}

export interface QuickBooksCompanyRecord extends Entity {
  realm_id: string;
  company_name: string;
  payload: QBOCompanyInfo;
}

export interface QuickBooksCustomerRecord extends Entity {
  realm_id: string;
  qbo_id: string;
  display_name: string;
  active: boolean;
  payload: QBOCustomer;
}

export interface QuickBooksVendorRecord extends Entity {
  realm_id: string;
  qbo_id: string;
  display_name: string;
  active: boolean;
  payload: QBOVendor;
}

export interface QuickBooksItemRecord extends Entity {
  realm_id: string;
  qbo_id: string;
  name: string;
  item_type: string;
  active: boolean;
  payload: QBOItem;
}

export interface QuickBooksInvoiceRecord extends Entity {
  realm_id: string;
  qbo_id: string;
  customer_ref: string;
  txn_date: string;
  payload: QBOInvoice;
}

export interface QuickBooksSalesReceiptRecord extends Entity {
  realm_id: string;
  qbo_id: string;
  customer_ref: string;
  txn_date: string;
  payload: QBOSalesReceipt;
}

export interface QuickBooksPaymentRecord extends Entity {
  realm_id: string;
  qbo_id: string;
  customer_ref: string;
  txn_date: string;
  payload: QBOPayment;
}

export interface QuickBooksAccessTokenRecord extends Entity {
  token: string;
  realm_id: string;
  user_email: string;
  client_id: string;
  scopes: QuickBooksScope[];
  expires_at: number;
  revoked: boolean;
}

export interface QuickBooksRefreshTokenRecord extends Entity {
  token: string;
  realm_id: string;
  user_email: string;
  client_id: string;
  scopes: QuickBooksScope[];
  expires_at: number;
  revoked: boolean;
}

export interface QuickBooksQueryLog extends Entity {
  realm_id: string;
  token: string;
  entity: string;
  query: string;
  result_count: number;
}

export type QuickBooksResourceName = "Customer" | "Vendor" | "Item" | "Invoice" | "SalesReceipt" | "Payment";

export type QuickBooksResourcePayloadMap = {
  Customer: QBOCustomer;
  Vendor: QBOVendor;
  Item: QBOItem;
  Invoice: QBOInvoice;
  SalesReceipt: QBOSalesReceipt;
  Payment: QBOPayment;
};
