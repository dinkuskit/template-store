/**
 * Phone menu toggle and tap-to-open dropdowns for the store header. Without
 * this script the header still works: phones show the full menu stacked and
 * desktop dropdowns open on hover and keyboard focus.
 */
export function hydrateStoreMenu(root: ParentNode = document): void {
  for (const header of root.querySelectorAll<HTMLElement>("[data-store-header]")) {
    if (header.dataset.menuReady) continue;
    header.dataset.menuReady = "true";
    const toggle = header.querySelector<HTMLButtonElement>("[data-store-menu-toggle]");
    const parents = [...header.querySelectorAll<HTMLElement>("[data-store-menu-parent]")];

    const setParent = (parent: HTMLElement, open: boolean) => {
      parent.toggleAttribute("data-open", open);
      parent.querySelector("[data-store-menu-expand]")?.setAttribute("aria-expanded", String(open));
    };
    const closeParents = (except?: HTMLElement) => {
      for (const parent of parents) if (parent !== except) setParent(parent, false);
    };
    const setMenu = (open: boolean) => {
      header.toggleAttribute("data-menu-open", open);
      toggle?.setAttribute("aria-expanded", String(open));
      if (!open) closeParents();
    };

    if (toggle) {
      toggle.hidden = false;
      toggle.addEventListener("click", () => setMenu(!header.hasAttribute("data-menu-open")));
    }
    for (const parent of parents) {
      parent.querySelector("[data-store-menu-expand]")?.addEventListener("click", () => {
        const open = !parent.hasAttribute("data-open");
        closeParents(parent);
        setParent(parent, open);
      });
    }
    header.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const open = parents.find((parent) => parent.hasAttribute("data-open"));
      if (open) {
        setParent(open, false);
        open.querySelector<HTMLElement>("[data-store-menu-expand]")?.focus();
      } else if (header.hasAttribute("data-menu-open")) {
        setMenu(false);
        toggle?.focus();
      }
    });
    document.addEventListener("click", (event) => {
      if (event.target instanceof Node && !header.contains(event.target)) closeParents();
    });
  }
}
