/** Canonical URL using the same origin the product page uses for `link rel=canonical`. */
export function canonicalUrl(
  path: string,
  site: URL | undefined | null,
  requestUrl: URL | string,
): string {
  return new URL(path, site ?? requestUrl).href;
}

/** Error and redirect pages must not describe a product as a successful page. */
export function allowsProductJsonLd(responseStatus: number): boolean {
  return responseStatus >= 200 && responseStatus < 300;
}

/**
 * JSON-LD embedded with `set:html` must not be able to close the script tag.
 * `<` is the character that starts `</script>`. The result stays valid JSON.
 */
export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/**
 * The store-wide return policy a published returns page names, by link only (GrillTrack
 * policy-pages-content-20261031): an OnlineStore whose MerchantReturnPolicy is that page. The page's own text is
 * the policy, so no terms are restated; Google reads a store-wide return policy from `merchantReturnLink` alone,
 * and a merchant's Search Console or Merchant Center settings take precedence over markup.
 */
export function storeReturnPolicyJsonLd(input: { storeName: string; storeUrl: string; returnsUrl: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    name: input.storeName,
    url: input.storeUrl,
    hasMerchantReturnPolicy: {
      "@type": "MerchantReturnPolicy",
      merchantReturnLink: input.returnsUrl,
    },
  };
}
