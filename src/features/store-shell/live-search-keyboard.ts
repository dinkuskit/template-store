const boundSearches = new WeakSet<HTMLElement>();

/** Continue SDK input navigation after focus moves into its default result links. */
export function bindLiveSearchResultKeyboard(root: HTMLElement): void {
  if (boundSearches.has(root)) return;
  const input = root.querySelector<HTMLInputElement>('input[type="search"]');
  if (!input) return;
  boundSearches.add(root);

  root.addEventListener("keydown", (event) => {
    // EmDash 1.4 listens on the input only. Leave its input handling, native
    // link activation, modified keys and already-handled events untouched.
    if (
      event.defaultPrevented || event.isComposing || event.altKey ||
      event.ctrlKey || event.metaKey || event.shiftKey
    ) return;
    if (!["ArrowDown", "ArrowUp", "Escape"].includes(event.key)) return;
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement) || !target.matches(".emdash-live-search-result")) return;
    const container = root.querySelector<HTMLElement>(".emdash-live-search-results");
    if (!container || container.hidden) return;
    const links = [...root.querySelectorAll<HTMLAnchorElement>(
      ".emdash-live-search-results-list .emdash-live-search-result",
    )];
    const current = links.indexOf(target);
    if (current < 0) return;
    event.preventDefault();

    if (event.key === "Escape") {
      links.forEach((link) => link.classList.remove("focused"));
      // The SDK's input focus listener opens the dropdown; close it afterwards.
      input.focus();
      container.hidden = true;
      return;
    }
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const next = links[(current + direction + links.length) % links.length]!;
    links.forEach((link) => link.classList.toggle("focused", link === next));
    next.focus();
  });
}
