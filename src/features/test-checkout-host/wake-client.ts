import type {
  CommercePaymentWake,
  CommercePaymentWakePort,
  TrustedTestCheckoutHostConfig,
} from "./types.js";

const WAKE_KEY_SIGNATURE = "attemptId,bindingRef,deliveryGeneration,eventId,wokeAt";
const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9]+$/;

/** Finite byte limit for GET /v1/checkout/wakes responses (128 KiB). */
export const MAX_WAKE_LIST_RESPONSE_BYTES = 128 * 1024;

/** Finite byte limit for POST /v1/checkout/wakes/ack responses (16 KiB). */
export const MAX_WAKE_ACK_RESPONSE_BYTES = 16 * 1024;

function invalidConfig(message: string): never {
  throw new Error(`Invalid trusted TEST Payments wake client configuration: ${message}`);
}

function validatePaymentsOrigin(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    invalidConfig("paymentsOrigin is required");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalidConfig("paymentsOrigin must be an absolute URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname
  ) {
    invalidConfig("paymentsOrigin must be a bare HTTPS origin");
  }
  return parsed.origin;
}

function validateSiteId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    invalidConfig("siteId is required");
  }
  return value.trim();
}

function validateBindingRef(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    invalidConfig("bindingRef is required");
  }
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    invalidConfig("bindingRef must not exceed 200 characters");
  }
  return trimmed;
}

function validateLimit(value: unknown): number {
  if (value === undefined) {
    return 25;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 100) {
    invalidConfig("limit must be an integer between 1 and 100");
  }
  return value;
}

/**
 * Reads response body chunk by chunk, enforcing an absolute byte cap BEFORE
 * JSON.parse is invoked. Cancels stream reader and throws without logging
 * payload body or credentials.
 */
async function readBoundedUtf8Body(
  response: Response,
  maxBytes: number,
  operation: "list" | "acknowledge",
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      if (response.body) {
        try {
          await response.body.cancel();
        } catch {
          // ignore stream cancellation errors
        }
      }
      throw new Error(
        `Payments wake ${operation} response body exceeded limit of ${maxBytes} bytes`,
      );
    }
  }

  if (!response.body) {
    return "";
  }

  if (typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            try {
              await reader.cancel();
            } catch {
              // ignore
            }
            throw new Error(
              `Payments wake ${operation} response body exceeded limit of ${maxBytes} bytes`,
            );
          }
          chunks.push(value);
        }
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw error;
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8").decode(merged);
  }

  // A non-standard body cannot be bounded before arrayBuffer() allocates it.
  // Fail closed rather than allowing an untrusted transport to bypass the cap.
  throw new Error(
    `Payments wake ${operation} response body is not a bounded readable stream`,
  );
}

/**
 * Validates and extracts an exact 5-field Commerce payment wake snapshot
 * conforming to the reviewed Payments12 public contract.
 * Fails closed on unexpected, missing, or malformed fields.
 */
export function assertValidWakeSnapshot(
  value: unknown,
  expectedBindingRef: string,
): CommercePaymentWake {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Malformed wake snapshot: value must be a non-null object");
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== WAKE_KEY_SIGNATURE) {
    throw new Error(
      `Malformed wake snapshot: expected keys [${WAKE_KEY_SIGNATURE}], got [${keys.join(",")}]`,
    );
  }

  const { attemptId, bindingRef, deliveryGeneration, eventId, wokeAt } = record;

  if (
    typeof attemptId !== "string" ||
    attemptId.length === 0 ||
    attemptId.length > 200
  ) {
    throw new Error(
      "Malformed wake snapshot: attemptId must be an opaque string between 1 and 200 characters",
    );
  }

  if (typeof eventId !== "string" || !EVENT_ID_PATTERN.test(eventId)) {
    throw new Error("Malformed wake snapshot: eventId must match /^evt_[A-Za-z0-9]+$/");
  }

  if (
    typeof bindingRef !== "string" ||
    bindingRef.length === 0 ||
    bindingRef.length > 200
  ) {
    throw new Error(
      "Malformed wake snapshot: bindingRef must be an opaque string between 1 and 200 characters",
    );
  }

  if (bindingRef !== expectedBindingRef) {
    throw new Error(
      `Malformed wake snapshot: bindingRef mismatch (expected "${expectedBindingRef}", got "${String(bindingRef)}")`,
    );
  }

  if (
    typeof deliveryGeneration !== "number" ||
    !Number.isSafeInteger(deliveryGeneration) ||
    deliveryGeneration <= 0
  ) {
    throw new Error("Malformed wake snapshot: deliveryGeneration must be a positive integer >= 1");
  }

  if (typeof wokeAt !== "number" || !Number.isFinite(wokeAt)) {
    throw new Error("Malformed wake snapshot: wokeAt must be a finite number");
  }

  return Object.freeze({
    attemptId,
    bindingRef,
    deliveryGeneration,
    eventId,
    wokeAt,
  });
}

/**
 * Type guard for exact 5-field Commerce payment wake snapshots.
 */
export function isValidWakeSnapshot(
  value: unknown,
  expectedBindingRef: string,
): value is CommercePaymentWake {
  try {
    assertValidWakeSnapshot(value, expectedBindingRef);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a trusted exact-origin wake list and ACK HTTP client matching
 * the Payments wake transport contract and Commerce TEST host configuration.
 */
export function createTestPaymentsWakeClient(
  config: TrustedTestCheckoutHostConfig,
): CommercePaymentWakePort {
  const paymentsOrigin = validatePaymentsOrigin(config.paymentsOrigin);
  const siteId = validateSiteId(config.siteId);
  const bindingRef = validateBindingRef(config.bindingRef);
  const limit = validateLimit(config.limit);

  if (typeof config.credentialResolver !== "function") {
    invalidConfig("credentialResolver must be a function");
  }
  const credentialResolver = config.credentialResolver;

  const fetchFn = config.fetch;
  if (typeof fetchFn !== "function") {
    invalidConfig("fetch must be a function");
  }

  async function resolveCredential(): Promise<string> {
    const token = await credentialResolver();
    if (typeof token !== "string" || !token.trim()) {
      throw new Error("Payments credential unavailable");
    }
    return token.trim();
  }

  return Object.freeze({
    async list(): Promise<readonly CommercePaymentWake[]> {
      const credential = await resolveCredential();
      const url = new URL("/v1/checkout/wakes", paymentsOrigin);
      url.searchParams.set("bindingRef", bindingRef);
      url.searchParams.set("limit", String(limit));

      const response = await fetchFn(url.toString(), {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credential}`,
          "x-dinkus-site": siteId,
        },
        cache: "no-store",
        redirect: "error",
      });

      if (!response.ok) {
        if (response.body) {
          try {
            await response.body.cancel();
          } catch {
            // ignore
          }
        }
        throw new Error(`Payments wake list failed with HTTP status ${response.status}`);
      }

      const bodyText = await readBoundedUtf8Body(
        response,
        MAX_WAKE_LIST_RESPONSE_BYTES,
        "list",
      );

      let data: unknown;
      try {
        data = JSON.parse(bodyText);
      } catch {
        throw new Error("Malformed Payments wake list response: invalid JSON");
      }

      if (!Array.isArray(data)) {
        throw new Error("Malformed Payments wake list response: expected JSON array");
      }

      if (data.length > limit) {
        throw new Error(`Payments wake list exceeded requested limit of ${limit}`);
      }

      return Object.freeze(
        data.map((item) => assertValidWakeSnapshot(item, bindingRef)),
      );
    },

    async acknowledge(wake: CommercePaymentWake): Promise<boolean> {
      let snapshot: CommercePaymentWake;
      try {
        snapshot = assertValidWakeSnapshot(wake, bindingRef);
      } catch {
        return false;
      }

      let credential: string;
      try {
        credential = await resolveCredential();
      } catch {
        return false;
      }

      const body = {
        attemptId: snapshot.attemptId,
        bindingRef: snapshot.bindingRef,
        deliveryGeneration: snapshot.deliveryGeneration,
        eventId: snapshot.eventId,
        wokeAt: snapshot.wokeAt,
      };

      const url = new URL("/v1/checkout/wakes/ack", paymentsOrigin);

      try {
        const response = await fetchFn(url.toString(), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${credential}`,
            "x-dinkus-site": siteId,
          },
          body: JSON.stringify(body),
          cache: "no-store",
          redirect: "error",
        });

        if (!response.ok) {
          if (response.body) {
            try {
              await response.body.cancel();
            } catch {
              // ignore
            }
          }
          return false;
        }

        const bodyText = await readBoundedUtf8Body(
          response,
          MAX_WAKE_ACK_RESPONSE_BYTES,
          "acknowledge",
        );

        let result: unknown;
        try {
          result = JSON.parse(bodyText);
        } catch {
          return false;
        }

        return Boolean(
          result &&
            typeof result === "object" &&
            !Array.isArray(result) &&
            (result as { acknowledged?: unknown }).acknowledged === true,
        );
      } catch {
        return false;
      }
    },
  });
}
