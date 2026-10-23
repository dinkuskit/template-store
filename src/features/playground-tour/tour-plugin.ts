/**
 * The playground tour card (GrillTrack playground-guided-tour-20261023): the
 * dashboard widget and the Playground tour admin page, built from EmDash's own
 * Block Kit. It shows one next step at a time with a Take me there button,
 * ticks steps off as the visitor does them and says well done once for each.
 * Real stores never install it; it costs Commerce nothing.
 */
import { definePlugin } from "emdash";
import { getRequestContext } from "emdash/request-context";
import type { TourCopy } from "./copy.js";
import {
  newlyDoneSteps, nextTourStep, TOUR_ADMIN_PAGE, TOUR_PLUGIN_ID, TOUR_SHOP_PATH, TOUR_WIDGET,
  tourSteps, type TourState, type TourStep, type TourStepId,
} from "./state.js";
import { loadTourView } from "./view.js";

type Db = Parameters<typeof newlyDoneSteps>[0];
type Block = Record<string, unknown>;
export const TOUR_REFRESH_ACTION = "tour_check_progress";

function target(origin: string, step: TourStep) {
  return { kind: "external", url: step.href.startsWith("/") ? `${origin}${step.href}` : step.href };
}

/** The tour as Block Kit, for the dashboard card and the Playground tour page alike. */
export function tourBlocks(origin: string, state: TourState, copy: TourCopy, justDone: readonly TourStepId[] = []): Block[] {
  const steps = tourSteps(state);
  const next = nextTourStep(steps);
  const goals = steps.filter((step) => step.id !== "real-store");
  const done = goals.filter((step) => step.done).length;
  const finished = done === goals.length;
  const titles = (ids: readonly TourStepId[]) => steps.filter((step) => ids.includes(step.id)).map((step) => copy[step.copy].title).join(", ");
  const opening = justDone.length > 0
    ? { type: "banner", variant: "default", title: `Done: ${titles(justDone)} ✓`, description: finished ? "That's the whole tour. Your store is ready for real." : `Nice work. Next: ${copy[next.copy].title}.` }
    : { type: "banner", variant: "default", title: copy.intro.title, description: copy.intro.text };
  return [
    opening,
    { type: "meter", label: `${done} of ${goals.length} steps done`, value: done, max: goals.length, custom_value: `${done}/${goals.length}` },
    { type: "header", text: finished ? copy[next.copy].title : `Next: ${copy[next.copy].title}` },
    { type: "section", text: copy[next.copy].text },
    {
      type: "actions",
      elements: [
        { type: "link", label: next.id === "real-store" ? next.button : "Take me there", target: target(origin, next), appearance: "primary" },
        ...(finished ? [] : [{ type: "button", action_id: TOUR_REFRESH_ACTION, label: "Check my progress", style: "secondary" }]),
      ],
    },
    ...(finished ? [] : [{ type: "context", text: "Take me there opens a new tab. Come back here when you're done; the step ticks itself off." }]),
    { type: "divider" },
    ...steps.flatMap((step) => {
      const mark = step.done ? "✓" : step === next ? "→" : "○";
      const status = step.done ? " (done)" : step === next ? " (next)" : "";
      return [
        { type: "section", text: `${mark} ${copy[step.copy].title}${status}`, accessory: { type: "link", label: step.button, target: target(origin, step), appearance: "secondary" } },
        { type: "context", text: copy[step.copy].text },
      ];
    }),
    { type: "actions", elements: [{ type: "link", label: "See the tour in your shop", target: { kind: "external", url: `${origin}${TOUR_SHOP_PATH}` }, appearance: "secondary" }] },
  ];
}

export function createPlugin() {
  return definePlugin({
    id: TOUR_PLUGIN_ID,
    version: "1.0.0",
    capabilities: [],
    admin: { widgets: [TOUR_WIDGET], pages: [TOUR_ADMIN_PAGE] },
    routes: {
      admin: {
        handler: async (ctx) => {
          const origin = new URL(ctx.request.url).origin;
          const input = (ctx.input ?? {}) as { type?: string; page?: string; action_id?: string };
          const db = getRequestContext()?.db as Db | undefined;
          const view = await loadTourView(db);
          const justDone = db ? await newlyDoneSteps(db, view.steps) : [];
          const blocks = tourBlocks(origin, view.state, view.copy, justDone);
          const checked = input.type === "block_action" && input.action_id === TOUR_REFRESH_ACTION;
          if (!checked) return { blocks };
          const toast = justDone.length > 0
            ? { message: "Step done. Nice work!", type: "success" as const }
            : { message: `Still to do: ${view.copy[view.next.copy].title}.`, type: "info" as const };
          return { blocks, toast };
        },
      },
    },
  });
}

export default createPlugin;
