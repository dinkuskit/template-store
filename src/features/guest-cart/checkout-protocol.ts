import { parseGuestCartIntent, type GuestCartIntent, type GuestCartLine } from "./intent.js";

export const GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY = "dinkus.guest-checkout.v1";
export const GUEST_CHECKOUT_CAPABILITY_HEADER = "x-commerce-guest-capability";
export const COMMERCE_REGISTRY_RUNTIME_ID = "r_gshdrqaldna3r7sn";
export const GUEST_CHECKOUT_PREPARE_ENDPOINT =
  `/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/checkout/guest/prepare`;
export const GUEST_CHECKOUT_START_ENDPOINT =
  `/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/checkout/guest/start`;
export const GUEST_CHECKOUT_STATUS_ENDPOINT =
  `/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/checkout/guest/status`;
export const GUEST_CHECKOUT_PROJECTION_SCHEMA =
  "dinkuskit.commerce.guest-checkout-projection/v1";

const MAX_CAPABILITY_LENGTH = 512;
const MAX_ATTEMPT_ID_LENGTH = 256;
const MAX_COUPON_LENGTH = 128;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
export const MAX_GUEST_CHECKOUT_STATUS_CHECKS = 5;

export type GuestCheckoutProjection = Readonly<{
  schema: typeof GUEST_CHECKOUT_PROJECTION_SCHEMA;
  state: "pending" | "paid" | "recoverable-failure" | "released-retry";
  attemptId: string | null;
  redirectUrl: string | null;
  order: Readonly<{ orderId: string; receiptId: string; lines: readonly GuestCartLine[] }> | null;
  retryAfter: string | null;
  [key: string]: unknown;
}>;

export type GuestCheckoutWireResult =
  | Readonly<{
      ok: true;
      capabilityId: string;
      capability?: Readonly<{
        capabilityId: string;
        capability: string;
        retention: "json-body";
        header: typeof GUEST_CHECKOUT_CAPABILITY_HEADER;
      }>;
      checkout: GuestCheckoutProjection;
    }>
  | Readonly<{ ok: false; error: { code: string; message: string } }>;

export type GuestCheckoutRetention = Readonly<{
  capabilityId: string;
  capability: string;
  attemptId: string | null;
  awaitingStart?: true;
  cartSettlement?: Readonly<{ orderId: string; fingerprint: string; pending: boolean }>;
}>;

export interface GuestCheckoutRetentionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface GuestCheckoutTransport {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export type GuestCheckoutCall =
  | Readonly<{ kind: "prepare" }>
  | Readonly<{ kind: "start"; intent: GuestCartIntent; couponCode?: string; contact?: GuestCheckoutContact }>
  | Readonly<{ kind: "status"; attemptId?: string }>;

export type GuestCheckoutDelivery = Readonly<{
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
}>;

export type GuestCheckoutContact = Readonly<{
  email: string;
  delivery?: GuestCheckoutDelivery;
}>;

export type GuestCheckoutCallResult = Readonly<{
  result: GuestCheckoutWireResult | null;
  failure:
    | "storage-unavailable"
    | "storage-invalid"
    | "timeout"
    | "network"
    | "http"
    | "response-too-large"
    | "association"
    | "attempt-active"
    | "wrong-shape"
    | null;
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeToken(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CAPABILITY_LENGTH &&
    /^[A-Za-z0-9._~-]+\.[A-Za-z0-9._~-]+$/u.test(value);
}

function safeId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ATTEMPT_ID_LENGTH &&
    /^[A-Za-z0-9._~-]+$/u.test(value);
}

function safeCanonicalValue(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ATTEMPT_ID_LENGTH &&
    /^[A-Za-z0-9._~:-]+$/u.test(value);
}

function projectCheckout(value: unknown): GuestCheckoutProjection | null {
  if (!isObject(value) ||
      value.schema !== GUEST_CHECKOUT_PROJECTION_SCHEMA ||
      !["pending", "paid", "recoverable-failure", "released-retry"].includes(String(value.state)) ||
      (value.attemptId !== null && !safeId(value.attemptId)) ||
      (value.retryAfter !== null && !safeId(value.retryAfter)) ||
      (value.redirectUrl !== null && typeof value.redirectUrl !== "string")) {
    return null;
  }
  let order: GuestCheckoutProjection["order"] = null;
  if (value.order !== null) {
    if (!isObject(value.order) ||
        !safeCanonicalValue(value.order.orderId) ||
        !safeCanonicalValue(value.order.receiptId)) return null;
    if (!Array.isArray(value.order.lines)) return null;
    const purchased = parseGuestCartIntent({ version: 1, lines: value.order.lines.map((line) =>
      isObject(line) ? { id: line.catalogItemId, quantity: line.quantity } : null) });
    if (!purchased || purchased.lines.length === 0) return null;
    order = { orderId: value.order.orderId, receiptId: value.order.receiptId, lines: purchased.lines };
  }
  if (value.state === "paid" && !order) return null;
  if (value.state === "released-retry" &&
      (!value.attemptId || value.retryAfter !== value.attemptId)) return null;
  return {
    ...value,
    schema: GUEST_CHECKOUT_PROJECTION_SCHEMA,
    state: value.state as GuestCheckoutProjection["state"],
    attemptId: value.attemptId as string | null,
    redirectUrl: value.redirectUrl as string | null,
    order,
    retryAfter: value.retryAfter as string | null,
  };
}

function unwrap(body: unknown): unknown {
  return isObject(body) && body.success === true ? body.data : body;
}

export function parseGuestCheckoutWireResult(body: unknown): GuestCheckoutWireResult | null {
  if (isObject(body) && body.success === false && isObject(body.error) &&
      typeof body.error.code === "string" && typeof body.error.message === "string") {
    return {
      ok: false,
      error: { code: body.error.code, message: body.error.message },
    };
  }
  const value = unwrap(body);
  if (!isObject(value) || typeof value.ok !== "boolean") return null;
  if (!value.ok) {
    if (!isObject(value.error) ||
        typeof value.error.code !== "string" ||
        typeof value.error.message !== "string") return null;
    return { ok: false, error: { code: value.error.code, message: value.error.message } };
  }
  if (typeof value.capabilityId !== "string" || !safeId(value.capabilityId)) return null;
  const checkout = projectCheckout(value.checkout);
  if (!checkout) return null;
  if (value.capability !== undefined) {
    if (!isObject(value.capability) ||
        value.capability.capabilityId !== value.capabilityId ||
        !safeToken(value.capability.capability) ||
        !value.capability.capability.startsWith(`${value.capabilityId}.`) ||
        value.capability.retention !== "json-body" ||
        value.capability.header !== GUEST_CHECKOUT_CAPABILITY_HEADER) return null;
    return {
      ok: true,
      capabilityId: value.capabilityId,
      capability: {
        capabilityId: value.capabilityId,
        capability: value.capability.capability,
        retention: "json-body",
        header: GUEST_CHECKOUT_CAPABILITY_HEADER,
      },
      checkout,
    };
  }
  return { ok: true, capabilityId: value.capabilityId, checkout };
}

export function readGuestCheckoutRetention(
  storage: GuestCheckoutRetentionStorage | null,
): GuestCheckoutRetention | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY);
    if (!raw || raw.length > 2048) return null;
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) ||
        !safeId(value.capabilityId) ||
        !safeToken(value.capability) ||
        !value.capability.startsWith(`${value.capabilityId}.`) ||
        (value.awaitingStart !== undefined && typeof value.awaitingStart !== "boolean") ||
        (value.cartSettlement !== undefined && (!isObject(value.cartSettlement) ||
          !safeCanonicalValue(value.cartSettlement.orderId) ||
          typeof value.cartSettlement.fingerprint !== "string" ||
          !/^[a-f0-9]{64}$/u.test(value.cartSettlement.fingerprint) ||
          typeof value.cartSettlement.pending !== "boolean")) ||
        (value.attemptId !== null && !safeId(value.attemptId))) return null;
    return {
      capabilityId: value.capabilityId,
      capability: value.capability,
      attemptId: value.attemptId as string | null,
      ...(value.awaitingStart === true ? { awaitingStart: true as const } : {}),
      ...(isObject(value.cartSettlement) ? { cartSettlement: value.cartSettlement as GuestCheckoutRetention["cartSettlement"] } : {}),
    };
  } catch {
    return null;
  }
}

export function retainGuestCheckoutCapability(
  storage: GuestCheckoutRetentionStorage | null,
  result: GuestCheckoutWireResult,
): GuestCheckoutRetention | null {
  if (!storage || !result.ok || !result.capability) return null;
  const retained = {
    capabilityId: result.capabilityId,
    capability: result.capability.capability,
    attemptId: result.checkout.attemptId,
  } satisfies GuestCheckoutRetention;
  try {
    storage.setItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, JSON.stringify(retained));
    return readGuestCheckoutRetention(storage)?.capability === retained.capability ? retained : null;
  } catch {
    return null;
  }
}

export function updateGuestCheckoutAttempt(
  storage: GuestCheckoutRetentionStorage | null,
  result: GuestCheckoutWireResult,
): GuestCheckoutRetention | null {
  if (!storage || !result.ok) return null;
  const current = readGuestCheckoutRetention(storage);
  if (!current || current.capabilityId !== result.capabilityId) return null;
  // A response without an attempt is not permission to discard a previously
  // retained recovery locator (for example, an ambiguous return).
  const { awaitingStart: _awaitingStart, ...stable } = current;
  const next = {
    ...stable,
    attemptId: result.checkout.attemptId ?? current.attemptId,
  };
  try {
    storage.setItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, JSON.stringify(next));
    return readGuestCheckoutRetention(storage);
  } catch {
    return null;
  }
}

function requestFor(call: GuestCheckoutCall, retention: GuestCheckoutRetention | null): {
  endpoint: string;
  body: unknown;
  capability: string | null;
} | null {
  if (call.kind === "prepare") return { endpoint: GUEST_CHECKOUT_PREPARE_ENDPOINT, body: {}, capability: null };
  if (!retention) return null;
  if (call.kind === "status") {
    return {
      endpoint: GUEST_CHECKOUT_STATUS_ENDPOINT,
      body: call.attemptId ? { attemptId: call.attemptId } : {},
      capability: retention.capability,
    };
  }
  const lines = call.intent.lines.map((line) => ({
    catalogItemId: line.id,
    quantity: line.quantity,
  }));
  const body = call.couponCode
    ? { lines, couponCode: call.couponCode, ...(call.contact ? { contact: call.contact } : {}) }
    : { lines, ...(call.contact ? { contact: call.contact } : {}) };
  return { endpoint: GUEST_CHECKOUT_START_ENDPOINT, body, capability: retention.capability };
}

async function readBoundedResponseBody(response: Response): Promise<string | null> {
  if (response.headers.has("content-length")) {
    const length = Number(response.headers.get("content-length"));
    if (!Number.isFinite(length) || length < 0 || length > MAX_RESPONSE_BYTES) return null;
  }
  if (!response.body) {
    const text = await response.text();
    return text.length <= MAX_RESPONSE_BYTES ? text : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function callGuestCheckout(
  call: GuestCheckoutCall,
  retention: GuestCheckoutRetention | null,
  transport: GuestCheckoutTransport,
): Promise<GuestCheckoutCallResult> {
  const request = requestFor(call, retention);
  if (!request) return { result: null, failure: "storage-unavailable" };
  const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
  if (request.capability) headers.set(GUEST_CHECKOUT_CAPABILITY_HEADER, request.capability);
  try {
    const response = await transport.fetch(request.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(request.body),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const rawBody = await readBoundedResponseBody(response);
    if (rawBody === null) {
      return { result: null, failure: "response-too-large" };
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { result: null, failure: response.ok ? "wrong-shape" : "http" };
    }
    const result = parseGuestCheckoutWireResult(body);
    if (!result) return { result: null, failure: response.ok ? "wrong-shape" : "http" };
    if (!response.ok) return { result, failure: null };
    if (retention && result.ok && result.capabilityId !== retention.capabilityId) {
      return { result: null, failure: "association" };
    }
    if (call.kind === "status" && call.attemptId &&
        result.ok && result.checkout.attemptId !== call.attemptId) {
      return { result: null, failure: "association" };
    }
    return { result, failure: null };
  } catch (error) {
    return {
      result: null,
      failure: error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network",
    };
  }
}

export function checkoutCanConfirm(result: GuestCheckoutWireResult | null): boolean {
  return Boolean(
    result?.ok &&
    result.checkout.state === "paid" &&
    result.checkout.attemptId &&
    result.checkout.order,
  );
}

export function canRetryGuestCheckoutStatus(checks: number): boolean {
  return Number.isInteger(checks) && checks >= 0 && checks < MAX_GUEST_CHECKOUT_STATUS_CHECKS;
}

export function strictStripeCheckoutUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
        url.hostname !== "checkout.stripe.com") return null;
    return url.href;
  } catch {
    return null;
  }
}

export type GuestCheckoutController = Readonly<{
  prepare(): Promise<GuestCheckoutCallResult>;
  start(intent: GuestCartIntent, couponCode?: string, contact?: GuestCheckoutContact): Promise<GuestCheckoutCallResult>;
  status(): Promise<GuestCheckoutCallResult>;
  canStart(): boolean;
  canPrepareNew(): boolean;
}>;

export function createGuestCheckoutController(options: {
  storage: GuestCheckoutRetentionStorage | null;
  transport: GuestCheckoutTransport;
  admitted: boolean;
}): GuestCheckoutController {
  // This permission is deliberately not persisted. A reload checks the original
  // capability's authoritative status before it can issue another start.
  let startAllowed = false;
  let busy = false;
  let confirmedOrderId: string | null = null;
  const canPrepareNew = () => !busy && confirmedOrderId !== null &&
    readGuestCheckoutRetention(options.storage)?.cartSettlement?.orderId === confirmedOrderId &&
    readGuestCheckoutRetention(options.storage)?.cartSettlement?.pending === false;
  const active = (): GuestCheckoutCallResult => ({ result: null, failure: "attempt-active" });
  const prepare = async (): Promise<GuestCheckoutCallResult> => {
    if (!options.admitted) return { result: null, failure: "storage-unavailable" };
    if (busy) return active();
    try {
      if (!options.storage) return { result: null, failure: "storage-unavailable" };
      if (options.storage.getItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY) !== null && !canPrepareNew()) return active();
    } catch {
      return { result: null, failure: "storage-unavailable" };
    }
    busy = true;
    try {
      const response = await callGuestCheckout({ kind: "prepare" }, null, options.transport);
      if (response.failure || !response.result || !response.result.ok) return response;
      if (!retainGuestCheckoutCapability(options.storage, response.result)) {
        return { result: null, failure: "storage-unavailable" };
      }
      startAllowed = response.result.checkout.attemptId === null;
      confirmedOrderId = null;
      return response;
    } finally { busy = false; }
  };
  const status = async (): Promise<GuestCheckoutCallResult> => {
    if (busy) return active();
    const retention = readGuestCheckoutRetention(options.storage);
    if (!retention) return { result: null, failure: "storage-unavailable" };
    busy = true;
    startAllowed = false;
    confirmedOrderId = null;
    try {
      const response = await callGuestCheckout(
        { kind: "status", ...(!retention.awaitingStart && retention.attemptId ? { attemptId: retention.attemptId } : {}) },
        retention,
        options.transport,
      );
      if (response.failure || !response.result || !response.result.ok) return response;
      if (!updateGuestCheckoutAttempt(options.storage, response.result)) {
        return { result: null, failure: "association" };
      }
      startAllowed = (response.result.checkout.state === "pending" &&
        retention.attemptId === null && response.result.checkout.attemptId === null) ||
        (response.result.checkout.state === "released-retry" &&
          response.result.checkout.retryAfter === response.result.checkout.attemptId);
      if (checkoutCanConfirm(response.result)) confirmedOrderId = response.result.checkout.order!.orderId;
      return response;
    } finally { busy = false; }
  };
  return {
    prepare,
    status,
    canStart: () => startAllowed && !busy,
    canPrepareNew,
    start: async (intent, couponCode, contact) => {
      const retention = readGuestCheckoutRetention(options.storage);
      if (!options.admitted) return { result: null, failure: "storage-unavailable" };
      if (!retention) return { result: null, failure: "storage-unavailable" };
      if (busy || !startAllowed) return active();
      const start = checkoutStartIntent(intent, couponCode);
      if (!start) return { result: null, failure: "wrong-shape" };
      startAllowed = false;
      busy = true;
      try {
        // Persist before the request: a lost successor response must recover the
        // capability's CURRENT attempt rather than re-query its released parent.
        if (!options.storage) return { result: null, failure: "storage-unavailable" };
        try {
          options.storage.setItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, JSON.stringify({ ...retention, awaitingStart: true }));
          if (!readGuestCheckoutRetention(options.storage)?.awaitingStart) {
            return { result: null, failure: "storage-unavailable" };
          }
        } catch { return { result: null, failure: "storage-unavailable" }; }
        const response = await callGuestCheckout(
          contact === undefined
            ? start
            : {
                kind: "start",
                intent,
                ...(couponCode ? { couponCode } : {}),
                contact,
              },
          retention,
          options.transport,
        );
        if (response.failure || !response.result || !response.result.ok) return response;
        if (!updateGuestCheckoutAttempt(options.storage, response.result)) {
          return { result: null, failure: "association" };
        }
        return response;
      } finally { busy = false; }
    },
  };
}

export function checkoutStartIntent(
  intent: GuestCartIntent,
  couponCode?: string,
): GuestCheckoutCall | null {
  if (!parseGuestCartIntent(intent) || intent.lines.length === 0) return null;
  if (couponCode !== undefined &&
      (couponCode.trim().length === 0 || couponCode.length > MAX_COUPON_LENGTH)) return null;
  return { kind: "start", intent, ...(couponCode ? { couponCode } : {}) };
}
