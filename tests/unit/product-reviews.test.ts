import { describe, expect, it } from "vitest";

import { moreReviewsHref, ratingText, readProductReviews, reviewsHeading, reviewsJsonLd, starFill } from "../../src/features/product-reviews/index.js";
import { REVIEWS_REGISTRY_RUNTIME_ID } from "../../src/features/review-form/index.js";

const PAGE = "https://store.example.test/products/camp-mug";
const REVIEW = { id: "review-1", stars: 5, body: "Keeps coffee hot.", name: "Sam T.", createdAt: "2026-11-20T15:04:05.000Z", verifiedBuyer: true };
const LIST = { productId: "prod_1", rating: { value: 4.5, scale_min: 1, scale_max: 5, count: 2 }, reviews: [REVIEW, { ...REVIEW, id: "review-2", stars: 4, body: "", name: "Verified buyer", reply: { body: "Thank you.", createdAt: "2026-11-21T00:00:00.000Z" } }] };

/** A raw plugin route's answer, the way EmDash hands it back to a page's server. */
const raw = (value: unknown, status = 200) => ({ success: true, data: { __emdashPluginResponse: true, status, headers: {}, body: { kind: "text", value: typeof value === "string" ? value : JSON.stringify(value) } } });

type Call = { pluginId: string; method: string; path: string; url: URL; hasBody: boolean };

function page(answer: unknown, url = PAGE) {
  const calls: Call[] = [];
  const locals = answer === undefined ? {} : {
    emdash: {
      async handlePublicPluginApiRoute(pluginId: string, method: string, path: string, request: Request) {
        calls.push({ pluginId, method, path, url: new URL(request.url), hasBody: request.body !== null });
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
  return { ctx: { locals, request: new Request(url), url: new URL(url) }, calls };
}

describe("a product page's rating and reviews", () => {
  it("reads Reviews' list inside the server under the product's Commerce id", async () => {
    const { ctx, calls } = page(raw(LIST));
    expect(await readProductReviews(ctx, "prod_1")).toEqual({
      rating: { value: 4.5, max: 5, count: 2 },
      reviews: [
        { id: "review-1", stars: 5, body: "Keeps coffee hot.", name: "Sam T.", date: "2026-11-20T15:04:05.000Z", dateText: "November 20, 2026", reply: null },
        { id: "review-2", stars: 4, body: "", name: "Verified buyer", date: "2026-11-20T15:04:05.000Z", dateText: "November 20, 2026", reply: "Thank you." },
      ],
      next: null,
      later: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ pluginId: REVIEWS_REGISTRY_RUNTIME_ID, method: "GET", path: "list", hasBody: false });
    expect(calls[0]?.url.pathname).toBe(`/_emdash/api/plugins/${REVIEWS_REGISTRY_RUNTIME_ID}/list`);
    expect([...calls[0]!.url.searchParams]).toEqual([["product", "prod_1"]]);
  });

  it("asks for the next page with the cursor in the page's address and offers the page after it", async () => {
    const { ctx, calls } = page(raw({ ...LIST, cursor: "next-2" }), `${PAGE}?reviews=next-1`);
    const view = await readProductReviews(ctx, "prod_1");
    expect(view).toMatchObject({ next: "next-2", later: true });
    expect(calls[0]?.url.searchParams.get("cursor")).toBe("next-1");
    expect(moreReviewsHref(ctx.url, "next-2")).toBe("/products/camp-mug?reviews=next-2#reviews");
    expect(moreReviewsHref(new URL(`${PAGE}?variant=v1`), "a b&c")).toBe("/products/camp-mug?variant=v1&reviews=a+b%26c#reviews");
    // A cursor no page of ours made is not passed on.
    const hostile = page(raw(LIST), `${PAGE}?reviews=${"x".repeat(2001)}`);
    await readProductReviews(hostile.ctx, "prod_1");
    expect(hostile.calls[0]?.url.searchParams.has("cursor")).toBe(false);
  });

  it("shows nothing when Reviews is not installed, has no review, or does not answer what it promises", async () => {
    const nothing: unknown[] = [
      undefined,
      { success: false, error: { code: "NOT_FOUND", message: "Plugin not found" } },
      raw({ productId: "prod_1", rating: null, reviews: [] }),
      raw(LIST, 500),
      raw("not json"),
      raw({ ...LIST, productId: "another-product" }),
      raw({ ...LIST, rating: { ...LIST.rating, scale_max: 10 } }),
      raw({ ...LIST, rating: { ...LIST.rating, value: 6 } }),
      raw({ ...LIST, rating: { ...LIST.rating, count: 0 } }),
      raw({ ...LIST, reviews: "many" }),
      raw({ ...LIST, reviews: Array.from({ length: 51 }, () => REVIEW) }),
      raw(`{"pad":"${"x".repeat(256 * 1024)}"}`),
      { success: true, data: { __emdashPluginResponse: true, status: 200, body: { kind: "bytes", value: "AA==" } } },
      new Error("Reviews is down"),
    ];
    for (const answer of nothing) expect(await readProductReviews(page(answer).ctx, "prod_1")).toBeNull();
    const unasked = page(raw(LIST));
    expect(await readProductReviews(unasked.ctx, "")).toBeNull();
    expect(await readProductReviews(unasked.ctx, "p".repeat(201))).toBeNull();
    expect(unasked.calls).toHaveLength(0);
  });

  it("leaves out a review it cannot show and keeps the rest", async () => {
    const broken = [
      { ...REVIEW, id: "no-stars", stars: 0 },
      { ...REVIEW, id: "half-stars", stars: 4.5 },
      { ...REVIEW, id: "no-name", name: "" },
      { ...REVIEW, id: "no-date", createdAt: "yesterday" },
      { ...REVIEW, id: "long", body: "x".repeat(2001) },
      { ...REVIEW, id: "control", body: "a\u0000b" },
      "review",
    ];
    const view = await readProductReviews(page(raw({ ...LIST, reviews: [...broken, REVIEW] })).ctx, "prod_1");
    expect(view?.reviews.map((review) => review.id)).toEqual(["review-1"]);
    expect(view?.rating).toEqual({ value: 4.5, max: 5, count: 2 });
  });

  it("draws stars with Shopify Dawn's rounding", () => {
    const cases: [number, number, number, number][] = [
      [5, 5, 0, 0], [4.8, 5, 0, 0], [4.7, 4, 1, 0], [4.5, 4, 1, 0], [4.3, 4, 1, 0], [4.2, 4, 0, 1], [4, 4, 0, 1], [1, 1, 0, 4], [2.9, 3, 0, 2],
    ];
    for (const [value, full, half, empty] of cases) expect(starFill(value), String(value)).toEqual({ full, half, empty });
    expect(ratingText(4)).toBe("4.0");
    expect(ratingText(4.5)).toBe("4.5");
    expect(reviewsHeading(1, "Camp Mug")).toBe("1 review for Camp Mug");
    expect(reviewsHeading(12, "Camp Mug")).toBe("12 reviews for Camp Mug");
  });

  it("writes the rating and the 5 newest reviews into the product's data for search engines", async () => {
    const many = Array.from({ length: 7 }, (_, index) => ({ ...REVIEW, id: `review-${index}`, body: index === 1 ? "" : `Words ${index}` }));
    const view = await readProductReviews(page(raw({ ...LIST, rating: { ...LIST.rating, count: 7 }, reviews: many })).ctx, "prod_1");
    const data = reviewsJsonLd(view!);
    expect(data.aggregateRating).toEqual({ "@type": "AggregateRating", ratingValue: 4.5, bestRating: 5, worstRating: 1, reviewCount: 7 });
    expect(data.review).toHaveLength(5);
    expect(data.review?.[0]).toEqual({
      "@type": "Review", author: { "@type": "Person", name: "Sam T." }, datePublished: "2026-11-20",
      reviewRating: { "@type": "Rating", ratingValue: 5, bestRating: 5, worstRating: 1 }, reviewBody: "Words 0",
    });
    // A review with no words has no reviewBody.
    expect(data.review?.[1]).not.toHaveProperty("reviewBody");
    // A later page of reviews, or a page of reviews that could not be shown, keeps the rating alone.
    const later = await readProductReviews(page(raw(LIST), `${PAGE}?reviews=next-1`).ctx, "prod_1");
    expect(reviewsJsonLd(later!)).toEqual({ aggregateRating: { "@type": "AggregateRating", ratingValue: 4.5, bestRating: 5, worstRating: 1, reviewCount: 2 } });
    expect(reviewsJsonLd({ ...view!, reviews: [] })).not.toHaveProperty("review");
  });
});
