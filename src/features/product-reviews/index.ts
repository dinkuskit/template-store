import { REVIEWS_REGISTRY_RUNTIME_ID } from "../review-form/index.js";

/**
 * The reviews a product page shows: its rating under the title and its published reviews below the product
 * (template-product-rating-20261122). DinkusKit Reviews keeps both; the page's server reads its public `list`
 * route inside the server, so nothing is drawn by script. A store without Reviews installed, or a product with
 * no published review, shows neither.
 */
const ROUTE = "list";
const MAX_RESPONSE_BYTES = 256 * 1024;
/** Reviews answers 20 reviews a page; more than this in one answer is not a page of reviews. */
const MAX_REVIEWS = 50;
const MAX_CURSOR = 2000;
/** The page's address carries the next page of reviews in this query field. */
export const REVIEWS_CURSOR_PARAM = "reviews";
export const REVIEWS_ANCHOR = "reviews";

export type ProductRatingView = Readonly<{ value: number; max: 5; count: number }>;
export type ProductReviewView = Readonly<{
  id: string;
  stars: number;
  body: string;
  name: string;
  date: string;
  dateText: string;
  reply: string | null;
}>;
export type ProductReviewsView = Readonly<{
  rating: ProductRatingView;
  reviews: readonly ProductReviewView[];
  /** The cursor of the next page of reviews, when there is one. */
  next: string | null;
  /** True when the page shows reviews after the first page. */
  later: boolean;
}>;

/** EmDash dispatches only a plugin's public routes this way, and answers `success: false` for a plugin that is not installed. */
type Runtime = {
  handlePublicPluginApiRoute?(pluginId: string, method: string, path: string, request: Request): Promise<unknown>;
};
export type ProductReviewsContext = Readonly<{ locals: { emdash?: unknown }; request: Request; url: URL }>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const UNSHOWABLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const words = (value: unknown, max: number) => (typeof value === "string" && value.length <= max && !UNSHOWABLE.test(value) ? value : null);
const DATE = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** Reviews' rating as the page shows it; null for anything that is not a rating of at least one review. */
function ratingOf(value: unknown): ProductRatingView | null {
  const rating = record(value);
  if (!rating || rating.scale_min !== 1 || rating.scale_max !== 5) return null;
  const { value: average, count } = rating;
  if (typeof average !== "number" || !(average >= 1 && average <= 5)) return null;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) return null;
  return { value: Math.round(average * 10) / 10, max: 5, count };
}

function reviewOf(value: unknown): ProductReviewView | null {
  const review = record(value);
  if (!review) return null;
  const id = words(review.id, 200), body = words(review.body, 2000), name = words(review.name, 60);
  const stars = review.stars;
  const at = typeof review.createdAt === "string" && review.createdAt.length <= 40 ? Date.parse(review.createdAt) : NaN;
  if (!id || body === null || !name || typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5 || Number.isNaN(at)) return null;
  const reply = words(record(review.reply)?.body, 2000);
  return { id, stars, body, name, date: new Date(at).toISOString(), dateText: DATE.format(at), reply: reply || null };
}

/**
 * What a public plugin route answered, as JSON. Reviews' `list` is a raw route, which EmDash hands back inside
 * its envelope as `{ __emdashPluginResponse, status, body: { kind: "text", value } }`; a standard route's
 * answer is the envelope's data itself.
 */
function bodyOf(answer: unknown): unknown {
  const envelope = record(answer);
  if (envelope?.success !== true) return null;
  const data = record(envelope.data);
  if (data?.__emdashPluginResponse !== true) return data;
  const body = record(data.body);
  if (data.status !== 200 || body?.kind !== "text" || typeof body.value !== "string") return null;
  return new TextEncoder().encode(body.value).byteLength > MAX_RESPONSE_BYTES ? null : JSON.parse(body.value);
}

/**
 * The product's rating and one page of its published reviews, or null when there is nothing to show: Reviews
 * is not installed, the product has no published review, or Reviews did not answer what it promises. A page
 * must never fail because reviews could not be read.
 */
export async function readProductReviews(ctx: ProductReviewsContext, productId: string): Promise<ProductReviewsView | null> {
  const runtime = ctx.locals.emdash as Runtime | undefined;
  if (!productId || productId.length > 200 || typeof runtime?.handlePublicPluginApiRoute !== "function") return null;
  const asked = ctx.url.searchParams.get(REVIEWS_CURSOR_PARAM) ?? "";
  const cursor = asked && asked.length <= MAX_CURSOR && !UNSHOWABLE.test(asked) ? asked : "";
  const address = new URL(`/_emdash/api/plugins/${REVIEWS_REGISTRY_RUNTIME_ID}/${ROUTE}`, ctx.url);
  address.searchParams.set("product", productId);
  if (cursor) address.searchParams.set("cursor", cursor);
  try {
    const answer = record(bodyOf(await runtime.handlePublicPluginApiRoute(REVIEWS_REGISTRY_RUNTIME_ID, "GET", ROUTE,
      new Request(address, { method: "GET", headers: { accept: "application/json" } }))));
    if (!answer || answer.productId !== productId) return null;
    const rating = ratingOf(answer.rating);
    if (!rating || !Array.isArray(answer.reviews) || answer.reviews.length > MAX_REVIEWS) return null;
    const reviews = answer.reviews.map(reviewOf).filter((review): review is ProductReviewView => review !== null);
    const next = words(answer.cursor, MAX_CURSOR);
    return { rating, reviews, next: next || null, later: Boolean(cursor) };
  } catch {
    return null;
  }
}

/**
 * Whole, half and empty stars for an average, rounded as Shopify's Dawn theme draws them: a decimal part from
 * 0.3 to 0.7 is a half star, above 0.7 the next whole star, below 0.3 none.
 */
export function starFill(value: number): Readonly<{ full: number; half: 0 | 1; empty: number }> {
  const whole = Math.floor(value), decimal = Math.round((value - whole) * 10) / 10;
  const full = Math.min(5, Math.max(0, decimal > 0.7 ? whole + 1 : whole));
  const half = full < 5 && decimal >= 0.3 && decimal <= 0.7 ? 1 : 0;
  return { full, half, empty: 5 - full - half };
}

/** "4.5" for 4.5 and "4.0" for 4, the way a rating reads beside "/ 5". */
export const ratingText = (value: number) => value.toFixed(1);

/** "1 review for Camp mug" or "12 reviews for Camp mug", WooCommerce's reviews heading. */
export const reviewsHeading = (count: number, productName: string) => `${count} ${count === 1 ? "review" : "reviews"} for ${productName}`;

/** The same page's address showing the next page of reviews. */
export function moreReviewsHref(url: URL, next: string): string {
  const address = new URL(url);
  address.searchParams.set(REVIEWS_CURSOR_PARAM, next);
  return `${address.pathname}${address.search}#${REVIEWS_ANCHOR}`;
}

/** Reviews written into a product's data for search engines, as WooCommerce marks its 5 most recent. */
const JSON_LD_REVIEWS = 5;

/**
 * The product's rating and newest reviews for its schema.org data (template-product-rating-jsonld-20261122),
 * the fields WooCommerce's structured data writes: `aggregateRating` with the average and the count, and
 * the newest reviews, which are the ones the page shows. On a later page of reviews only the rating is written,
 * because the newest reviews are not on that page.
 */
export function reviewsJsonLd(view: ProductReviewsView) {
  const reviews = view.later ? [] : view.reviews.slice(0, JSON_LD_REVIEWS);
  return {
    aggregateRating: { "@type": "AggregateRating", ratingValue: view.rating.value, bestRating: 5, worstRating: 1, reviewCount: view.rating.count },
    ...(reviews.length > 0 ? { review: reviews.map((review) => ({
      "@type": "Review",
      author: { "@type": "Person", name: review.name },
      datePublished: review.date.slice(0, 10),
      reviewRating: { "@type": "Rating", ratingValue: review.stars, bestRating: 5, worstRating: 1 },
      ...(review.body ? { reviewBody: review.body } : {}),
    })) } : {}),
  };
}
