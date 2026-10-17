/**
 * Phone menu toggle and dropdowns for the store header. Without this script
 * the header still works: phones show the full menu stacked and desktop
 * dropdowns open on hover and keyboard focus. With it, every open dropdown is
 * one this script opened, so aria-expanded always matches what is shown.
 */
const DESKTOP = "(min-width: 48rem)";

export function hydrateStoreMenu(root: ParentNode = document): void {
  const desktop = window.matchMedia(DESKTOP);
  for (const header of root.querySelectorAll<HTMLElement>("[data-store-header]")) {
    if (header.dataset.menuReady) continue;
    header.dataset.menuReady = "true";
    const toggle = header.querySelector<HTMLButtonElement>("[data-store-menu-toggle]");
    const parents = [...header.querySelectorAll<HTMLElement>("[data-store-menu-parent]")];
    // Dropdowns opened by a desktop mouse hover close when the mouse leaves;
    // a click on the chevron keeps them open until dismissed.
    const hovered = new Set<HTMLElement>();

    const setParent = (parent: HTMLElement, open: boolean) => {
      parent.toggleAttribute("data-open", open);
      parent.querySelector("[data-store-menu-expand]")?.setAttribute("aria-expanded", String(open));
      if (!open) hovered.delete(parent);
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
        if (hovered.has(parent)) {
          hovered.delete(parent);
          return;
        }
        const open = !parent.hasAttribute("data-open");
        closeParents(parent);
        setParent(parent, open);
      });
      parent.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "mouse" || !desktop.matches || parent.hasAttribute("data-open")) return;
        closeParents(parent);
        setParent(parent, true);
        hovered.add(parent);
      });
      parent.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "mouse" && hovered.has(parent)) setParent(parent, false);
      });
      parent.addEventListener("focusout", (event) => {
        if (desktop.matches && !(event.relatedTarget instanceof Node && parent.contains(event.relatedTarget))) {
          setParent(parent, false);
        }
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
