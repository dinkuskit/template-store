import {
  PRESET_COOKIE_NAME,
  THEME_COOKIE_NAME,
  isStorePresetName,
  isStoreThemeMode,
  type StorePresetName,
  type StoreThemeMode,
} from "./store-menu.js";

function readCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, "u"),
  );
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function applyThemeMode(mode: StoreThemeMode): void {
  document.documentElement.dataset.theme = mode;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")) {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === mode));
  }
}

function applyPresetName(preset: StorePresetName): void {
  document.documentElement.dataset.preset = preset;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset-choice]")) {
    button.setAttribute("aria-pressed", String(button.dataset.presetChoice === preset));
  }
}

export function hydrateStoreTheme(): void {
  const initialThemeRaw = document.documentElement.dataset.theme ?? readCookie(THEME_COOKIE_NAME);
  const initialTheme: StoreThemeMode = isStoreThemeMode(initialThemeRaw) ? initialThemeRaw : "light";
  applyThemeMode(initialTheme);

  const initialPresetRaw = document.documentElement.dataset.preset ?? readCookie(PRESET_COOKIE_NAME);
  const initialPreset: StorePresetName = isStorePresetName(initialPresetRaw) ? initialPresetRaw : "aizome";
  applyPresetName(initialPreset);

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")) {
    if (button.dataset.themeBound === "true") continue;
    button.dataset.themeBound = "true";
    button.addEventListener("click", () => {
      const choice = button.dataset.themeChoice;
      if (!isStoreThemeMode(choice)) return;
      writeCookie(THEME_COOKIE_NAME, choice);
      applyThemeMode(choice);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset-choice]")) {
    if (button.dataset.presetBound === "true") continue;
    button.dataset.presetBound = "true";
    button.addEventListener("click", () => {
      const choice = button.dataset.presetChoice;
      if (!isStorePresetName(choice)) return;
      writeCookie(PRESET_COOKIE_NAME, choice);
      applyPresetName(choice);
    });
  }
}
