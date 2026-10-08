/**
 * Host-side copy of the Commerce #57 image contract
 * (`src/features/catalog/media-projection.ts` at e5a918969cf2).
 * Template's source pin stays on the checkout-qualified commit, which does
 * not export these helpers. Do not invent a second preset table.
 */
export const COMMERCE_IMAGE_PRESETS = {
  thumbnail: 300,
  single: 600,
  gallery_thumbnail: 100,
} as const;
export const COMMERCE_IMAGE_SRCSET_WIDTHS = [300, 600, 1200] as const;
export const COMMERCE_IMAGE_ENDPOINT_ROUTE = "/_image";
export const COMMERCE_IMAGE_SIZES =
  `(min-width: ${COMMERCE_IMAGE_PRESETS.single}px) ${COMMERCE_IMAGE_PRESETS.single}px, 100vw`;

export interface PublicCommerceImage {
  id: string;
  alt: string;
  width: number | null;
  height: number | null;
  placeholder: boolean;
}

const MEDIA_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_STORAGE_KEY = /^[A-Za-z0-9._-]+$/;
const GALLERY_LIMIT = 8;

export interface CommerceMediaFile {
  mimeType: string;
  storageKey: string;
  status?: string;
}

export interface ResolvedCommerceImage extends PublicCommerceImage {
  src: string;
  srcset: string;
  sizes: string;
}

export interface CommerceImageResolver {
  origin: string;
  getMedia: (id: string) => Promise<CommerceMediaFile | null>;
  getPublicMediaUrl?: (storageKey: string) => string;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function dimension(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

/** Commerce's public image, or null when the payload cannot be shown safely. */
export function readCommerceImage(value: unknown, productName: string): PublicCommerceImage | null {
  if (value == null) return null;
  if (!object(value) || typeof value.id !== "string" || !MEDIA_ID.test(value.id)) return null;
  if (typeof value.alt !== "string" || value.alt.length > 1024) return null;
  if (typeof value.placeholder !== "boolean") return null;
  const width = dimension(value.width);
  const height = dimension(value.height);
  if (width === undefined || height === undefined) return null;
  const alt = value.alt.trim() || productName.trim();
  if (!alt) return null;
  return { id: value.id, alt, width, height, placeholder: value.placeholder };
}

export function readCommerceGallery(value: unknown, productName: string): PublicCommerceImage[] {
  if (!Array.isArray(value)) return [];
  const images: PublicCommerceImage[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (images.length >= GALLERY_LIMIT) break;
    const image = readCommerceImage(entry, productName);
    if (!image || ids.has(image.id)) continue;
    ids.add(image.id);
    images.push(image);
  }
  return images;
}

function presetWidth(value: number | null | undefined): number | null {
  return typeof value === "number" && value > 0 && Number.isFinite(value) ? Math.round(value) : null;
}

/** Build one EmDash image-endpoint URL for a public media file URL at a preset width. */
export function commerceImageTransformUrl(src: string, width: number, siteUrl?: string): string {
  let href = src;
  if (src.startsWith("/") && !src.startsWith("//") && siteUrl) {
    try {
      href = new URL(src, siteUrl).href;
    } catch {
      href = src;
    }
  }
  return `${COMMERCE_IMAGE_ENDPOINT_ROUTE}?href=${encodeURIComponent(href)}&w=${width}&f=webp`;
}

/** `srcset` for the single preset: 300/600/1200 candidates capped at the original width. */
export function commerceImageSrcset(src: string, originalWidth?: number | null, siteUrl?: string): string {
  const width = presetWidth(originalWidth);
  const candidates = COMMERCE_IMAGE_SRCSET_WIDTHS.filter((candidate) => width === null || candidate <= width);
  const widths = candidates.length ? candidates : [width as number];
  return widths.map((candidate) => `${commerceImageTransformUrl(src, candidate, siteUrl)} ${candidate}w`).join(", ");
}

function safeImageSrc(src: string): boolean {
  if (src.startsWith("/") && !src.startsWith("//") && !src.includes("\\")) return true;
  try {
    const url = new URL(src);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Map one catalog media id to a public file URL. Unresolvable, non-image,
 * or unsafe targets become null so the card can show a placeholder instead
 * of another product's photo or a payload-supplied URL.
 */
export async function resolveCommerceImage(
  image: PublicCommerceImage | null,
  resolver: CommerceImageResolver,
): Promise<ResolvedCommerceImage | null> {
  if (!image) return null;
  let item: CommerceMediaFile | null;
  try {
    item = await resolver.getMedia(image.id);
  } catch {
    return null;
  }
  if (!item || !item.mimeType.startsWith("image/")) return null;
  if (item.status !== undefined && item.status !== "ready") return null;
  if (!SAFE_STORAGE_KEY.test(item.storageKey)) return null;
  const src = resolver.getPublicMediaUrl?.(item.storageKey) || `/_emdash/api/media/file/${item.storageKey}`;
  if (!src || !safeImageSrc(src)) return null;
  return {
    id: image.id,
    alt: image.alt,
    width: image.width,
    height: image.height,
    placeholder: image.placeholder,
    src,
    srcset: commerceImageSrcset(src, image.width, resolver.origin),
    sizes: COMMERCE_IMAGE_SIZES,
  };
}
