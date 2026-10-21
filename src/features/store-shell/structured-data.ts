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
