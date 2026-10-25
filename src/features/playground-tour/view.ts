/** What the tour shows right now, read once for the admin card, the tour page or the shop guide. */
import { getEmDashEntry, type PortableTextBlock } from "emdash";
import { playgroundCheckoutConfigured } from "../playground-checkout/index.js";
import { readTourCopy, TOUR_PAGE_SLUG, type TourCopy } from "./copy.js";
import { EMPTY_TOUR_STATE, nextTourStep, readTourState, tourSteps, type TourState, type TourStep } from "./state.js";

type Db = Parameters<typeof readTourState>[0];

export function tourCheckoutOpen(): boolean {
  const env = (globalThis as { __dinkusPlaygroundEnv?: Record<string, unknown> }).__dinkusPlaygroundEnv ?? process.env;
  return playgroundCheckoutConfigured(env);
}

/** The tour's words from the CMS page, or the built-in words when the page can't be read. */
export async function loadTourCopy(): Promise<TourCopy> {
  try {
    const { entry } = await getEmDashEntry("pages", TOUR_PAGE_SLUG);
    return readTourCopy(Array.isArray(entry?.data?.content) ? (entry.data.content as PortableTextBlock[]) : undefined);
  } catch {
    return readTourCopy(undefined);
  }
}

export interface TourView {
  state: TourState;
  steps: TourStep[];
  next: TourStep;
  /** The next step's place in the tour, counting from 1. */
  nextNumber: number;
  copy: TourCopy;
}

export async function loadTourView(db: Db | undefined): Promise<TourView> {
  const state = db ? await readTourState(db, tourCheckoutOpen()) : { ...EMPTY_TOUR_STATE, checkoutOpen: tourCheckoutOpen() };
  const steps = tourSteps(state);
  const next = nextTourStep(steps);
  return { state, steps, next, nextNumber: steps.indexOf(next) + 1, copy: await loadTourCopy() };
}
