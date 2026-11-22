import { readBoundedForm, sameStoreRequest, trustedStoreOrigin, type ServerCartContext } from "../guest-cart/server-cart.js";

/**
 * The buyer's review page at /review, reached from a link in the review request email that DinkusKit Reviews
 * sends after an order ships (dinkuskit/reviews, reviews-review-page-on-store-20261122). EmDash does not let a
 * plugin serve a web page, so the store draws it: a plain form that posts to its own page, which asks Reviews'
 * `write` and `send` routes inside the server, so the page needs no script. The link's secret proves the
 * purchase. A store without Reviews installed answers every link as one that does not work.
 */
export const REVIEW_PAGE_PATH = "/review";
/** DinkusKit Reviews' Registry identity, derived by EmDash from its publisher and the slug `dinkus-reviews`. */
export const REVIEWS_REGISTRY_RUNTIME_ID = "r_t7rmn7qidmbmuyge";
/** Stars, 2,000 characters of words and a name fit well under 16 KB; a longer body is never parsed. */
const MAX_FORM_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024;

export const REVIEW_FORM_TEXT = Object.freeze({
  STARS: "Choose a rating from 1 to 5 stars.",
  LONG: "Your review is too long. Shorten it and send again.",
  NAME: "That name is too long. Shorten it and send again.",
  CHARS: "Your review holds characters that cannot be shown. Remove them and send again.",
  UNAVAILABLE: "Your review could not be sent right now. Try again in a moment.",
});
type RefusalCode = keyof typeof REVIEW_FORM_TEXT;

export type ReviewLink = Readonly<{ o: string; p: string; k: string }>;
export type ReviewTyped = Readonly<{ stars: string; body: string; name: string | null }>;

export type ReviewPageView =
  /** The link opens nothing: wrong, used up for good, older than its 60 days, or Reviews is not installed. */
  | Readonly<{ kind: "closed" }>
  | Readonly<{ kind: "done"; result: "sent" | "held" | "already" }>
  | Readonly<{
      kind: "form";
      link: ReviewLink;
      productName: string;
      anonymousName: string;
      bodyMax: number;
      nameMax: number;
      typed: ReviewTyped;
      refusal: Readonly<{ code: RefusalCode; message: string }> | null;
    }>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function unwrap(body: unknown): Record<string, unknown> | null {
  const raw = record(body);
  return record(raw?.success === true ? raw.data : body);
}

/** The link in the page's address; null when one of its three parts is missing or misshapen. */
export function reviewLink(url: URL): ReviewLink | null {
  const o = url.searchParams.get("o") ?? "", p = url.searchParams.get("p") ?? "", k = url.searchParams.get("k") ?? "";
  return o && p && o.length <= 200 && p.length <= 200 && /^[0-9a-f]{64}$/u.test(k) ? { o, p, k } : null;
}

type PublicDispatcher = (pluginId: string, method: string, path: string, request: Request) => Promise<unknown>;
type PageContext = Pick<ServerCartContext, "locals" | "request" | "url">;

/** Ask Reviews inside the server; null when Reviews is not installed, fails, or answers something else. */
async function ask(ctx: PageContext, route: "write" | "send", body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const runtime = ctx.locals.emdash as unknown as { handlePublicPluginApiRoute?: PublicDispatcher } | undefined;
  if (typeof runtime?.handlePublicPluginApiRoute !== "function") return null;
  const origin = trustedStoreOrigin(ctx);
  try {
    const raw = await runtime.handlePublicPluginApiRoute(REVIEWS_REGISTRY_RUNTIME_ID, "POST", route,
      new Request(new URL(`/_emdash/api/plugins/${REVIEWS_REGISTRY_RUNTIME_ID}/${route}`, origin), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", origin, "sec-fetch-site": "same-origin" },
        body: JSON.stringify(body),
      }));
    const text = JSON.stringify(raw);
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) return null;
    const answer = unwrap(JSON.parse(text));
    return typeof answer?.ok === "boolean" ? answer : null;
  } catch {
    return null;
  }
}

const bounded = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 10_000 ? value : fallback;
const shortText = (value: unknown, max: number) => (typeof value === "string" && value.length <= max ? value : "");

/** What the link opens, as Reviews says it: the form, "already reviewed", or closed. */
async function opened(ctx: PageContext, link: ReviewLink, typed: ReviewTyped | null, refusal: RefusalCode | null): Promise<ReviewPageView> {
  const answer = await ask(ctx, "write", link);
  if (answer?.ok !== true) return { kind: "closed" };
  if (answer.state === "done") return { kind: "done", result: "already" };
  if (answer.state !== "open") return { kind: "closed" };
  return {
    kind: "form",
    link,
    productName: shortText(answer.productName, 300) || "your item",
    anonymousName: shortText(answer.anonymousName, 60) || "Verified buyer",
    bodyMax: bounded(answer.bodyMax, 2000),
    nameMax: bounded(answer.nameMax, 60),
    typed: typed ?? { stars: "", body: "", name: shortText(answer.name, 60) },
    refusal: refusal ? { code: refusal, message: REVIEW_FORM_TEXT[refusal] } : null,
  };
}

/** The page for a link someone opened. */
export async function openReviewPage(ctx: PageContext): Promise<ReviewPageView> {
  const link = reviewLink(ctx.url);
  return link ? opened(ctx, link, null, null) : { kind: "closed" };
}

/** The page after the buyer sent the form: thanks, or the form again with what they typed and why it was not kept. */
export async function sendReviewForm(ctx: PageContext): Promise<ReviewPageView> {
  const link = reviewLink(ctx.url);
  if (!link) return { kind: "closed" };
  const posted = sameStoreRequest(ctx) ? await readBoundedForm(ctx.request, MAX_FORM_BYTES) : null;
  const field = (name: string) => {
    const value = posted?.get(name);
    return typeof value === "string" ? value : "";
  };
  const typed: ReviewTyped = { stars: /^[1-5]$/u.test(field("stars")) ? field("stars") : "", body: field("body").slice(0, 10_000), name: field("name").slice(0, 200) };
  if (!posted) return opened(ctx, link, typed, "UNAVAILABLE");
  const answer = await ask(ctx, "send", { ...link, stars: typed.stars, body: typed.body, name: typed.name });
  if (answer?.ok === true) {
    return { kind: "done", result: answer.result === "sent" ? "sent" : answer.result === "held" ? "held" : "already" };
  }
  const code = record(answer?.error)?.code;
  if (code === "CLOSED") return { kind: "closed" };
  return opened(ctx, link, typed, typeof code === "string" && code in REVIEW_FORM_TEXT ? code as RefusalCode : "UNAVAILABLE");
}

/** The page's HTTP status: a link that opens nothing is not found, and a refused form is unprocessable. */
export function reviewPageStatus(view: ReviewPageView): number {
  if (view.kind === "closed") return 404;
  if (view.kind === "form" && view.refusal) return view.refusal.code === "UNAVAILABLE" ? 503 : 422;
  return 200;
}
