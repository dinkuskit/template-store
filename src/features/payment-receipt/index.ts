export type PaymentReceiptStatus = "paid" | "pending" | "failed";

export interface PaymentReceiptItem {
  name: string;
  variant?: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

export interface PaymentReceiptAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface PaymentReceipt {
  orderNumber: number;
  test: boolean;
  status: PaymentReceiptStatus;
  items: readonly PaymentReceiptItem[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  shipTo: PaymentReceiptAddress;
  email: string;
}

export type PaymentReceiptResult =
  | { kind: "paid"; receipt: PaymentReceipt }
  | { kind: "pending" }
  | { kind: "not-found" };

export interface PaymentReceiptFetcher {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export interface PaymentReceiptEnvironment {
  PAYMENTS_BASE_URL?: string;
  PAYMENTS_STORE_KEY?: string;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_:-]{1,256}$/u;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/u;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max = 1024): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function cents(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function address(value: unknown): value is PaymentReceiptAddress {
  return record(value) &&
    text(value.name) &&
    text(value.line1) &&
    (value.line2 === undefined || text(value.line2)) &&
    text(value.city) &&
    text(value.state) &&
    text(value.postalCode) &&
    text(value.country);
}

function item(value: unknown): value is PaymentReceiptItem {
  return record(value) &&
    text(value.name) &&
    (value.variant === undefined || text(value.variant)) &&
    Number.isSafeInteger(value.quantity) &&
    (value.quantity as number) > 0 &&
    cents(value.unitCents) &&
    cents(value.totalCents);
}

export function parsePaymentReceipt(value: unknown): PaymentReceipt | null {
  if (!record(value) ||
      !Number.isSafeInteger(value.orderNumber) ||
      (value.orderNumber as number) < 1001 ||
      typeof value.test !== "boolean" ||
      value.status !== "paid" ||
      !Array.isArray(value.items) ||
      value.items.length === 0 ||
      !value.items.every(item) ||
      !cents(value.subtotalCents) ||
      !cents(value.shippingCents) ||
      !cents(value.taxCents) ||
      !cents(value.totalCents) ||
      !text(value.currency, 3) ||
      !CURRENCY_PATTERN.test(value.currency) ||
      !address(value.shipTo) ||
      !text(value.email, 320)) {
    return null;
  }
  return {
    orderNumber: value.orderNumber as number,
    test: value.test as boolean,
    status: "paid",
    items: value.items as PaymentReceiptItem[],
    subtotalCents: value.subtotalCents as number,
    shippingCents: value.shippingCents as number,
    taxCents: value.taxCents as number,
    totalCents: value.totalCents as number,
    currency: value.currency as string,
    shipTo: value.shipTo as PaymentReceiptAddress,
    email: value.email as string,
  };
}

function environmentValue(
  environment: PaymentReceiptEnvironment = process.env,
): { baseUrl: string; storeKey: string } | null {
  const baseUrl = environment.PAYMENTS_BASE_URL?.trim();
  const storeKey = environment.PAYMENTS_STORE_KEY?.trim();
  if (!baseUrl || !storeKey) return null;
  try {
    const parsed = new URL(baseUrl);
    const localTestOrigin = parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
    if ((!localTestOrigin && parsed.protocol !== "https:") ||
        parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return { baseUrl: parsed.href.replace(/\/$/u, ""), storeKey };
  } catch {
    return null;
  }
}

export async function loadPaymentReceipt(
  sessionId: string | null,
  options: {
    environment?: PaymentReceiptEnvironment;
    fetcher?: PaymentReceiptFetcher;
  } = {},
): Promise<PaymentReceiptResult> {
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return { kind: "not-found" };
  const config = environmentValue(options.environment);
  if (!config) return { kind: "not-found" };
  const fetcher = options.fetcher ?? globalThis;
  const endpoint = `${config.baseUrl}/v1/checkout/receipt?session_id=${encodeURIComponent(sessionId)}`;
  try {
    const response = await fetcher.fetch(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.storeKey}`,
      },
      cache: "no-store",
      redirect: "error",
    });
    if (response.status === 404 || response.status === 400) return { kind: "not-found" };
    if (!response.ok) return response.status === 202 ? { kind: "pending" } : { kind: "not-found" };
    const body: unknown = await response.json();
    if (!record(body) || !("status" in body)) return { kind: "not-found" };
    if (body.status === "pending") return { kind: "pending" };
    const receipt = parsePaymentReceipt(body);
    return receipt ? { kind: "paid", receipt } : { kind: "not-found" };
  } catch {
    return { kind: "not-found" };
  }
}
