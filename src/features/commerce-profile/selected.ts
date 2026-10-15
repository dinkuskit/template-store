import { commerceProfile } from "./profiles.mjs";

// Astro/Vite replaces this literal in both targets. Never consult browser input
// or mutable runtime environment to choose a different installed namespace.
declare const __DINKUS_COMMERCE_PROFILE__: string;
export const COMMERCE_PROFILE = commerceProfile(
  typeof __DINKUS_COMMERCE_PROFILE__ === "undefined" ? "stable" : __DINKUS_COMMERCE_PROFILE__,
);
export const COMMERCE_RUNTIME_ID = COMMERCE_PROFILE.runtimeId;
