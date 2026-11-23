import { describe, expect, it } from "vitest";

import { openReviewPage, reviewLink, reviewPageStatus, reviewStopLink, sendReviewForm, REVIEWS_REGISTRY_RUNTIME_ID, REVIEW_FORM_TEXT } from "../../src/features/review-form/index.js";
import { applySecurityHeaders, evaluatePublicBoundary } from "../../src/features/security/public-boundary.js";

const STORE = "https://store.example.test";
const K = "ab".repeat(32);
const LINK = `${STORE}/review?o=order-1%3Ashipment-1&p=camp-mug&k=${K}`;
const OPEN = { ok: true, state: "open", productId: "camp-mug", productName: "Camp Mug", name: "Sam T.", anonymousName: "Verified buyer", bodyMax: 2000, nameMax: 60 };

type Call = { pluginId: string; method: string; path: string; body: Record<string, unknown>; headers: Headers; url: string };
type Answers = Partial<Record<"write" | "send", unknown>>;

function page(answers: Answers | null, { url = LINK, form = null as string | null, headers = {} as Record<string, string> } = {}) {
  const calls: Call[] = [];
  const locals = (answers === null ? {} : {
    emdash: {
      async handlePublicPluginApiRoute(pluginId: string, method: string, path: string, request: Request) {
        calls.push({ pluginId, method, path, body: await request.json() as Record<string, unknown>, headers: request.headers, url: request.url });
        const answer = answers[path as "write" | "send"];
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  }) as unknown as App.Locals;
  const request = form === null
    ? new Request(url)
    : new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: STORE, "sec-fetch-site": "same-origin", ...headers }, body: form });
  return { ctx: { locals, request, url: new URL(url) }, calls };
}

describe("the buyer's review page", () => {
  it("asks Reviews inside the server what the emailed link opens and draws the form", async () => {
    const { ctx, calls } = page({ write: { success: true, data: OPEN } });
    const view = await openReviewPage(ctx);
    expect(view).toEqual({
      kind: "form", link: { o: "order-1:shipment-1", p: "camp-mug", k: K }, productName: "Camp Mug", anonymousName: "Verified buyer",
      bodyMax: 2000, nameMax: 60, typed: { stars: "", body: "", name: "Sam T." }, refusal: null,
    });
    expect(reviewPageStatus(view)).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ pluginId: REVIEWS_REGISTRY_RUNTIME_ID, method: "POST", path: "write", body: { o: "order-1:shipment-1", p: "camp-mug", k: K },
      url: `${STORE}/_emdash/api/plugins/${REVIEWS_REGISTRY_RUNTIME_ID}/write` });
    expect(calls[0]!.headers.get("origin")).toBe(STORE);
  });

  it("answers a link that opens nothing as not found, whatever the reason", async () => {
    for (const answers of [
      { write: { ok: false, error: { code: "CLOSED" } } },
      { write: { success: false, error: { code: "NOT_FOUND", message: "Plugin not found" } } },
      { write: new Error("Reviews is down") },
      { write: { ok: true, state: "something-new" } },
      { write: "x".repeat(9000) },
      // A store without Reviews installed, or without EmDash's public dispatcher.
      null,
    ] as (Answers | null)[]) {
      const view = await openReviewPage(page(answers).ctx);
      expect(view).toEqual({ kind: "closed" });
      expect(reviewPageStatus(view)).toBe(404);
    }
  });

  it("never asks Reviews about an address that is not a whole link", async () => {
    for (const url of [`${STORE}/review`, `${STORE}/review?o=a&p=b`, `${STORE}/review?o=a&p=b&k=short`, `${STORE}/review?o=a&p=b&k=${"G".repeat(64)}`, `${STORE}/review?o=${"a".repeat(201)}&p=b&k=${K}`]) {
      const { ctx, calls } = page({ write: OPEN }, { url });
      expect(reviewLink(ctx.url)).toBeNull();
      expect(await openReviewPage(ctx)).toEqual({ kind: "closed" });
      expect(await sendReviewForm(page({ write: OPEN, send: { ok: true, result: "sent" } }, { url, form: "stars=5" }).ctx)).toEqual({ kind: "closed" });
      expect(calls).toHaveLength(0);
    }
  });

  it("says when the item was already reviewed", async () => {
    const view = await openReviewPage(page({ write: { ok: true, state: "done" } }).ctx);
    expect(view).toEqual({ kind: "done", result: "already" });
    expect(reviewPageStatus(view)).toBe(200);
  });

  it("hands the sent form to Reviews with the link from the address, and thanks the buyer", async () => {
    for (const [result, shown] of [["sent", "sent"], ["held", "held"], ["done", "already"]] as const) {
      const { ctx, calls } = page({ send: { success: true, data: { ok: true, result } } }, { form: "stars=4&body=Keeps+coffee+hot.&name=&o=other&k=other" });
      expect(await sendReviewForm(ctx)).toEqual({ kind: "done", result: shown });
      // The link comes from the page's address; a form field of the same name is never used.
      expect(calls).toEqual([expect.objectContaining({ path: "send", body: { o: "order-1:shipment-1", p: "camp-mug", k: K, stars: "4", body: "Keeps coffee hot.", name: "" } })]);
    }
  });

  it("draws the form again with what the buyer typed and why the review was not kept", async () => {
    for (const code of ["STARS", "LONG", "NAME", "CHARS"] as const) {
      const { ctx, calls } = page({ write: OPEN, send: { ok: false, error: { code } } }, { form: "body=Forgot+the+stars&name=Sam" });
      const view = await sendReviewForm(ctx);
      expect(view).toMatchObject({ kind: "form", typed: { stars: "", body: "Forgot the stars", name: "Sam" }, refusal: { code, message: REVIEW_FORM_TEXT[code] } });
      expect(reviewPageStatus(view)).toBe(422);
      expect(calls.map((call) => call.path)).toEqual(["send", "write"]);
    }
  });

  it("keeps the typed review when Reviews cannot be reached, and says to try again", async () => {
    const view = await sendReviewForm(page({ write: OPEN, send: new Error("down") }, { form: "stars=5&body=Great" }).ctx);
    expect(view).toMatchObject({ kind: "form", typed: { stars: "5", body: "Great" }, refusal: { code: "UNAVAILABLE" } });
    expect(reviewPageStatus(view)).toBe(503);
  });

  it("answers a link Reviews closes while the form was open as not found", async () => {
    expect(await sendReviewForm(page({ send: { ok: false, error: { code: "CLOSED" } } }, { form: "stars=5" }).ctx)).toEqual({ kind: "closed" });
  });

  it("does not hand over a form another site sent", async () => {
    const { ctx, calls } = page({ write: OPEN, send: { ok: true, result: "sent" } }, { form: "stars=1", headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
    expect(await sendReviewForm(ctx)).toMatchObject({ kind: "form", refusal: { code: "UNAVAILABLE" } });
    expect(calls.map((call) => call.path)).toEqual(["write"]);
  });
});

describe("the stop link on the buyer's review page", () => {
  const STOP = `${STORE}/review?o=order-1%3Ashipment-1&k=${K}&stop=1`;
  const FIELDS = { o: "order-1:shipment-1", k: K, stop: "1" };

  it("opens one button and stops nothing: opening the link only asks Reviews", async () => {
    const { ctx, calls } = page({ write: { success: true, data: { ok: true, state: "stop", store: "Camp Store" } }, send: { ok: true, result: "stopped", store: "Camp Store" } }, { url: STOP });
    const view = await openReviewPage(ctx);
    expect(view).toEqual({ kind: "stop", store: "Camp Store", failed: false });
    expect(reviewPageStatus(view)).toBe(200);
    expect(calls).toEqual([expect.objectContaining({ method: "POST", path: "write", body: FIELDS })]);
  });

  it("stops review emails when the button's form is posted, and says so", async () => {
    const { ctx, calls } = page({ send: { success: true, data: { ok: true, result: "stopped", store: "Camp Store" } } }, { url: STOP, form: "o=other&k=other&stars=5" });
    const view = await sendReviewForm(ctx);
    expect(view).toEqual({ kind: "stopped", store: "Camp Store" });
    expect(reviewPageStatus(view)).toBe(200);
    // Only the link from the address is handed over; nothing typed into a form field goes with it.
    expect(calls).toEqual([expect.objectContaining({ path: "send", body: FIELDS })]);
  });

  it("says done when the emails were already stopped, and names the store plainly when Reviews gives no name", async () => {
    expect(await openReviewPage(page({ write: { ok: true, state: "stopped", store: "Camp Store" } }, { url: STOP }).ctx)).toEqual({ kind: "stopped", store: "Camp Store" });
    expect(await openReviewPage(page({ write: { ok: true, state: "stop", store: "" } }, { url: STOP }).ctx)).toEqual({ kind: "stop", store: "this store", failed: false });
  });

  it("answers a stop link that opens nothing as not found, and a Reviews without the stop link too", async () => {
    for (const answers of [{ write: { ok: false, error: { code: "CLOSED" } } }, { write: OPEN }, { write: new Error("down") }, null] as (Answers | null)[]) {
      const view = await openReviewPage(page(answers, { url: STOP }).ctx);
      expect(view).toEqual({ kind: "closed" });
      expect(reviewPageStatus(view)).toBe(404);
    }
    expect(await sendReviewForm(page({ send: { ok: false, error: { code: "CLOSED" } } }, { url: STOP, form: "" }).ctx)).toEqual({ kind: "closed" });
  });

  it("does not stop anything for a form another site sent, or when Reviews cannot be reached, and says to try again", async () => {
    const other = page({ write: { ok: true, state: "stop", store: "Camp Store" }, send: { ok: true, result: "stopped" } }, { url: STOP, form: "", headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
    const refused = await sendReviewForm(other.ctx);
    expect(refused).toEqual({ kind: "stop", store: "Camp Store", failed: true });
    expect(reviewPageStatus(refused)).toBe(503);
    expect(other.calls.map((call) => call.path)).toEqual(["write"]);
    const down = await sendReviewForm(page({ write: { ok: true, state: "stop", store: "Camp Store" }, send: new Error("down") }, { url: STOP, form: "" }).ctx);
    expect(down).toEqual({ kind: "stop", store: "Camp Store", failed: true });
  });

  it("is a stop link only with stop=1, an order and a whole secret", () => {
    expect(reviewStopLink(new URL(STOP))).toEqual(FIELDS);
    for (const url of [`${STORE}/review?o=a&k=${K}`, `${STORE}/review?o=a&k=${K}&stop=0`, `${STORE}/review?o=a&k=${K}&stop=true`, `${STORE}/review?k=${K}&stop=1`, `${STORE}/review?o=a&k=short&stop=1`, `${STORE}/review?o=${"a".repeat(201)}&k=${K}&stop=1`]) {
      expect(reviewStopLink(new URL(url))).toBeNull();
    }
  });
});

describe("the review page at the store's public boundary", () => {
  it("lets the page be opened and its form posted, and nothing else at that address", () => {
    const search = `?o=order-1%3Ashipment-1&p=camp-mug&k=${K}`;
    expect(evaluatePublicBoundary("GET", "/review", search).allowed).toBe(true);
    expect(evaluatePublicBoundary("POST", "/review", search).allowed).toBe(true);
    for (const method of ["PUT", "PATCH", "DELETE"]) expect(evaluatePublicBoundary(method, "/review", search).allowed).toBe(false);
  });

  it("keeps the browser away from Reviews' own routes; only the page's server calls them", () => {
    for (const route of ["write", "send", "courier/inbox", "admin"]) {
      expect(evaluatePublicBoundary("POST", `/_emdash/api/plugins/${REVIEWS_REGISTRY_RUNTIME_ID}/${route}`, "").allowed).toBe(false);
    }
  });

  it("keeps the page's no-referrer rule, because its address holds the link's secret", () => {
    const strict = new Headers({ "Referrer-Policy": "no-referrer" });
    applySecurityHeaders(strict, {});
    expect(strict.get("Referrer-Policy")).toBe("no-referrer");
    const usual = new Headers();
    applySecurityHeaders(usual, {});
    expect(usual.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("takes the longest review the form allows in Chinese characters, which a plain form sends as 9 bytes each", async () => {
    const words = "漢".repeat(2000), name = "名".repeat(60);
    const form = new URLSearchParams({ stars: "5", body: words, name }).toString();
    expect(new TextEncoder().encode(form).byteLength).toBeGreaterThan(18_000);
    const { ctx, calls } = page({ write: { success: true, data: OPEN }, send: { success: true, data: { ok: true, result: "sent" } } }, { form });
    expect(await sendReviewForm(ctx)).toEqual({ kind: "done", result: "sent" });
    expect(calls.map((call) => call.path)).toEqual(["send"]);
    expect(calls[0]!.body).toMatchObject({ stars: "5", body: words, name });
  });
});
