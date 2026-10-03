import { describe, expect, it } from "vitest";
import {
  assertValidWakeSnapshot,
  createTestPaymentsWakeClient,
  isValidWakeSnapshot,
  MAX_WAKE_ACK_RESPONSE_BYTES,
  MAX_WAKE_LIST_RESPONSE_BYTES,
} from "../../src/features/test-checkout-host/index.js";

const VALID_CONFIG = {
  paymentsOrigin: "https://payments.example.test",
  commerceOrigin: "https://shop.example.test",
  siteId: "test-site-001",
  bindingRef: "stripe-test-binding",
  providerId: "stripe" as const,
  stripeAccountId: "acct_test_123",
  credentialResolver: async () => "test-token-jwt",
  fetch: (async () => new Response("[]", { status: 200 })) as typeof fetch,
};

const VALID_WAKE = {
  eventId: "evt_123456",
  attemptId: "att_abcdef",
  bindingRef: "stripe-test-binding",
  deliveryGeneration: 1,
  wokeAt: 1727800000000,
};

describe("Payments 11 Wake Snapshot Validation Contract", () => {
  it("validates exact 5-field wake snapshot", () => {
    const validated = assertValidWakeSnapshot(VALID_WAKE, "stripe-test-binding");
    expect(validated).toEqual(VALID_WAKE);
    expect(isValidWakeSnapshot(VALID_WAKE, "stripe-test-binding")).toBe(true);
  });

  it("admits opaque string attemptId and bindingRef up to 200 characters", () => {
    const opaqueAttempt = "attempt:custom/opaque_identifier.with-chars:12345#token";
    const opaqueBinding = "binding:opaque-ref_42";
    const wake200 = {
      ...VALID_WAKE,
      attemptId: "a".repeat(200),
      bindingRef: "b".repeat(200),
    };
    expect(assertValidWakeSnapshot(wake200, "b".repeat(200))).toEqual(wake200);

    const wakeWithOpaque = {
      ...VALID_WAKE,
      attemptId: opaqueAttempt,
      bindingRef: opaqueBinding,
    };
    expect(assertValidWakeSnapshot(wakeWithOpaque, opaqueBinding)).toEqual(wakeWithOpaque);
  });

  it("fails closed on attemptId or bindingRef exceeding 200 characters or empty", () => {
    expect(() =>
      assertValidWakeSnapshot({ ...VALID_WAKE, attemptId: "" }, "stripe-test-binding"),
    ).toThrow(/attemptId must be an opaque string between 1 and 200 characters/);

    expect(() =>
      assertValidWakeSnapshot({ ...VALID_WAKE, attemptId: "a".repeat(201) }, "stripe-test-binding"),
    ).toThrow(/attemptId must be an opaque string between 1 and 200 characters/);

    expect(() =>
      assertValidWakeSnapshot({ ...VALID_WAKE, bindingRef: "" }, ""),
    ).toThrow(/bindingRef must be an opaque string between 1 and 200 characters/);

    expect(() =>
      assertValidWakeSnapshot(
        { ...VALID_WAKE, bindingRef: "b".repeat(201) },
        "b".repeat(201),
      ),
    ).toThrow(/bindingRef must be an opaque string between 1 and 200 characters/);
  });

  it("enforces eventId matches /^evt_[A-Za-z0-9]+$/", () => {
    for (const validId of ["evt_1", "evt_abc123XYZ", "evt_9999999999"]) {
      const wake = { ...VALID_WAKE, eventId: validId };
      expect(assertValidWakeSnapshot(wake, "stripe-test-binding").eventId).toBe(validId);
    }

    for (const invalidId of ["", "evt_", "evt-123", "ev_123", "evt_with spaces", "evt_!*#"]) {
      const wake = { ...VALID_WAKE, eventId: invalidId };
      expect(() => assertValidWakeSnapshot(wake, "stripe-test-binding")).toThrow(
        /eventId must match/,
      );
    }
  });

  it("fails closed on bindingRef mismatch", () => {
    expect(() => assertValidWakeSnapshot(VALID_WAKE, "other-binding")).toThrow(
      /bindingRef mismatch/,
    );
    expect(isValidWakeSnapshot(VALID_WAKE, "other-binding")).toBe(false);
  });

  it("fails closed on unexpected extraneous fields or missing fields", () => {
    const extraneous = { ...VALID_WAKE, extraField: "malicious" };
    expect(() => assertValidWakeSnapshot(extraneous, "stripe-test-binding")).toThrow(
      /expected keys/,
    );
    expect(isValidWakeSnapshot(extraneous, "stripe-test-binding")).toBe(false);

    const missing = {
      eventId: "evt_123456",
      attemptId: "att_abcdef",
      bindingRef: "stripe-test-binding",
      deliveryGeneration: 1,
    };
    expect(() => assertValidWakeSnapshot(missing, "stripe-test-binding")).toThrow(
      /expected keys/,
    );
    expect(isValidWakeSnapshot(missing, "stripe-test-binding")).toBe(false);
  });

  it("fails closed on non-positive or float deliveryGeneration", () => {
    for (const badGen of [0, -1, 1.5, NaN, Infinity]) {
      const bad = { ...VALID_WAKE, deliveryGeneration: badGen };
      expect(() => assertValidWakeSnapshot(bad, "stripe-test-binding")).toThrow(
        /deliveryGeneration must be a positive integer >= 1/,
      );
      expect(isValidWakeSnapshot(bad, "stripe-test-binding")).toBe(false);
    }
  });

  it("admits finite number wokeAt timestamps including zero or negative without inventing restrictions", () => {
    for (const validTime of [1727800000000, 0, -500, 12345.67]) {
      const wake = { ...VALID_WAKE, wokeAt: validTime };
      expect(assertValidWakeSnapshot(wake, "stripe-test-binding").wokeAt).toBe(validTime);
    }

    for (const badTime of [NaN, Infinity, -Infinity, "1727800000000"]) {
      const bad = { ...VALID_WAKE, wokeAt: badTime };
      expect(() => assertValidWakeSnapshot(bad, "stripe-test-binding")).toThrow(
        /wokeAt must be a finite number/,
      );
    }
  });
});

describe("TestPaymentsWakeClient Configuration", () => {
  it("normalizes bare HTTPS origin and rejects non-https, subpaths, and query strings", () => {
    // Normalizes trailing slash on bare origin
    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      paymentsOrigin: "https://payments.example.test/",
    });
    expect(client).toBeDefined();

    for (const badOrigin of [
      "http://payments.example.test",
      "https://payments.example.test/path",
      "https://payments.example.test?query=1",
      "https://payments.example.test#hash",
      "https://user:pass@payments.example.test",
      "not-a-url",
      "",
    ]) {
      expect(() =>
        createTestPaymentsWakeClient({
          ...VALID_CONFIG,
          paymentsOrigin: badOrigin,
        }),
      ).toThrow(/Invalid trusted TEST Payments wake client configuration/);
    }
  });

  it("rejects invalid siteId, bindingRef, or limit", () => {
    expect(() =>
      createTestPaymentsWakeClient({
        ...VALID_CONFIG,
        siteId: "   ",
      }),
    ).toThrow(/siteId is required/);

    expect(() =>
      createTestPaymentsWakeClient({
        ...VALID_CONFIG,
        bindingRef: "",
      }),
    ).toThrow(/bindingRef is required/);

    expect(() =>
      createTestPaymentsWakeClient({
        ...VALID_CONFIG,
        bindingRef: "a".repeat(201),
      }),
    ).toThrow(/bindingRef must not exceed 200 characters/);

    for (const badLimit of [0, 101, -5, 1.5, NaN]) {
      expect(() =>
        createTestPaymentsWakeClient({
          ...VALID_CONFIG,
          limit: badLimit,
        }),
      ).toThrow(/limit must be an integer between 1 and 100/);
    }
  });
});

describe("Streaming Bounded Responses (Finding 1)", () => {
  it("fails closed for a non-standard body without getReader", async () => {
    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": "application/json" }),
          body: { arrayBuffer: async () => new ArrayBuffer(0) },
        }) as unknown as Response,
    });

    await expect(client.list()).rejects.toThrow(/not a bounded readable stream/);
  });

  it("rejects chunked oversized list response before JSON.parse with no Content-Length", async () => {
    let cancelCalled = false;
    let chunksPushed = 0;
    const chunk = new Uint8Array(32 * 1024); // 32 KiB chunk
    chunk.fill(65); // 'A'

    const stream = new ReadableStream({
      pull(controller) {
        if (chunksPushed < 10) {
          controller.enqueue(chunk);
          chunksPushed++;
        } else {
          controller.close();
        }
      },
      cancel() {
        cancelCalled = true;
      },
    });

    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () =>
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "application/json" },
          // Notice: NO Content-Length header provided!
        }),
    });

    await expect(client.list()).rejects.toThrow(
      /response body exceeded limit of 131072 bytes/,
    );
    expect(cancelCalled).toBe(true);
  });

  it("rejects list response and cancels stream when Content-Length header exceeds 128 KiB cap", async () => {
    let cancelCalled = false;
    const stream = new ReadableStream({
      cancel() {
        cancelCalled = true;
      },
    });

    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () =>
        new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(MAX_WAKE_LIST_RESPONSE_BYTES + 1),
          },
        }),
    });

    await expect(client.list()).rejects.toThrow(
      /response body exceeded limit of 131072 bytes/,
    );
    expect(cancelCalled).toBe(true);
  });

  it("fails closed (returns false) and cancels reader on chunked oversized ACK response with no Content-Length", async () => {
    let cancelCalled = false;
    let chunksPushed = 0;
    const chunk = new Uint8Array(8 * 1024); // 8 KiB chunk
    chunk.fill(65);

    const stream = new ReadableStream({
      pull(controller) {
        if (chunksPushed < 10) {
          controller.enqueue(chunk);
          chunksPushed++;
        } else {
          controller.close();
        }
      },
      cancel() {
        cancelCalled = true;
      },
    });

    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () =>
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    const ack = await client.acknowledge(VALID_WAKE);
    expect(ack).toBe(false);
    expect(cancelCalled).toBe(true);
  });

  it("fails closed on ACK response when Content-Length header exceeds 16 KiB cap", async () => {
    let cancelCalled = false;
    const stream = new ReadableStream({
      cancel() {
        cancelCalled = true;
      },
    });

    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () =>
        new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(MAX_WAKE_ACK_RESPONSE_BYTES + 1),
          },
        }),
    });

    const ack = await client.acknowledge(VALID_WAKE);
    expect(ack).toBe(false);
    expect(cancelCalled).toBe(true);
  });

  it("admits normal payloads within documented finite caps", async () => {
    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/ack")) {
          return new Response(JSON.stringify({ acknowledged: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify([VALID_WAKE]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const list = await client.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(VALID_WAKE);

    const ack = await client.acknowledge(VALID_WAKE);
    expect(ack).toBe(true);
  });
});

describe("TestPaymentsWakeClient HTTP Transport", () => {
  it("lists wakes with exact query, scoped headers, and bounded response", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify([VALID_WAKE]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      limit: 10,
      fetch: mockFetch as typeof fetch,
    });

    const wakes = await client.list();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toEqual(VALID_WAKE);

    expect(capturedUrl).toBe(
      "https://payments.example.test/v1/checkout/wakes?bindingRef=stripe-test-binding&limit=10",
    );
    expect(capturedInit?.method).toBe("GET");
    expect(capturedInit?.cache).toBe("no-store");
    expect(capturedInit?.redirect).toBe("error");

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["accept"]).toBe("application/json");
    expect(headers["authorization"]).toBe("Bearer test-token-jwt");
    expect(headers["x-dinkus-site"]).toBe("test-site-001");
  });

  it("fails closed on non-200 HTTP status", async () => {
    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () => new Response("Unauthorized", { status: 401 }),
    });

    await expect(client.list()).rejects.toThrow(/HTTP status 401/);
  });

  it("fails closed on malformed JSON response or non-array", async () => {
    const clientBadJson = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () =>
        new Response("not json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    await expect(clientBadJson.list()).rejects.toThrow(/invalid JSON/);

    const clientNotArray = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () =>
        new Response(JSON.stringify({ wakes: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    await expect(clientNotArray.list()).rejects.toThrow(/expected JSON array/);
  });

  it("fails closed when response exceeds requested limit", async () => {
    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      limit: 1,
      fetch: async () =>
        new Response(JSON.stringify([VALID_WAKE, { ...VALID_WAKE, eventId: "evt_2" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    await expect(client.list()).rejects.toThrow(/exceeded requested limit of 1/);
  });

  it("fails closed if credential is unavailable or empty", async () => {
    const clientEmptyCred = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      credentialResolver: async () => "   ",
      fetch: async () => new Response("[]", { status: 200 }),
    });
    await expect(clientEmptyCred.list()).rejects.toThrow(/credential unavailable/);
  });

  it("acknowledges wake with exact 5-key payload and returns true on success", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ acknowledged: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: mockFetch as typeof fetch,
    });

    const ack = await client.acknowledge(VALID_WAKE);
    expect(ack).toBe(true);

    expect(capturedUrl).toBe("https://payments.example.test/v1/checkout/wakes/ack");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.cache).toBe("no-store");
    expect(capturedInit?.redirect).toBe("error");

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["accept"]).toBe("application/json");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["authorization"]).toBe("Bearer test-token-jwt");
    expect(headers["x-dinkus-site"]).toBe("test-site-001");

    const parsedBody = JSON.parse(String(capturedInit?.body));
    expect(parsedBody).toEqual(VALID_WAKE);
    expect(Object.keys(parsedBody).sort().join(",")).toBe(
      "attemptId,bindingRef,deliveryGeneration,eventId,wokeAt",
    );
  });

  it("fails closed (returns false) on acknowledge failure, malformed ACK body, or non-200 response", async () => {
    const client400 = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () => new Response(JSON.stringify({ error: "invalid_wake" }), { status: 400 }),
    });
    expect(await client400.acknowledge(VALID_WAKE)).toBe(false);

    const clientAckFalse = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () => new Response(JSON.stringify({ acknowledged: false }), { status: 200 }),
    });
    expect(await clientAckFalse.acknowledge(VALID_WAKE)).toBe(false);

    const clientMalformedAck = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () => new Response("malformed", { status: 200 }),
    });
    expect(await clientMalformedAck.acknowledge(VALID_WAKE)).toBe(false);

    const clientNetworkError = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () => {
        throw new Error("Network unreachable");
      },
    });
    expect(await clientNetworkError.acknowledge(VALID_WAKE)).toBe(false);
  });

  it("fails closed (returns false) when acknowledging invalid wake snapshot", async () => {
    let fetchCalled = false;
    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      fetch: async () => {
        fetchCalled = true;
        return new Response(JSON.stringify({ acknowledged: true }), { status: 200 });
      },
    });

    const invalidWake = { ...VALID_WAKE, bindingRef: "mismatched-binding" };
    expect(await client.acknowledge(invalidWake)).toBe(false);
    expect(fetchCalled).toBe(false);
  });

  it("posts the validated ACK snapshot captured before credential resolution", async () => {
    let releaseCredential!: () => void;
    const credentialReady = new Promise<void>((resolve) => {
      releaseCredential = resolve;
    });
    let capturedBody = "";
    const mutableWake = { ...VALID_WAKE };
    const client = createTestPaymentsWakeClient({
      ...VALID_CONFIG,
      credentialResolver: async () => {
        await credentialReady;
        return "test-token-jwt";
      },
      fetch: async (_input, init) => {
        capturedBody = String(init?.body);
        return new Response(JSON.stringify({ acknowledged: true }), { status: 200 });
      },
    });

    const pending = client.acknowledge(mutableWake);
    mutableWake.eventId = "evt_mutated";
    releaseCredential();

    expect(await pending).toBe(true);
    expect(JSON.parse(capturedBody)).toEqual(VALID_WAKE);
  });
});
