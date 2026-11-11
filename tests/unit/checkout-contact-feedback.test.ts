import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCheckoutContactFeedback } from "../../src/features/guest-cart/contact-feedback.js";

class Feedback {
  hidden = true;
  textContent = "";
  focus = vi.fn();
}
const root = (feedback: unknown) => ({ querySelector: () => feedback }) as unknown as Element;

beforeEach(() => vi.stubGlobal("HTMLElement", Feedback));
afterEach(() => vi.unstubAllGlobals());

describe("local checkout contact feedback", () => {
  it("shows plain text and focuses the contact summary after an explicit invalid submission", () => {
    const feedback = new Feedback();
    const message = 'Enter an email address. <not markup>';
    setCheckoutContactFeedback(root(feedback), message);
    expect(feedback.hidden).toBe(false);
    expect(feedback.textContent).toBe(message);
    expect(feedback.focus).toHaveBeenCalledTimes(1);
  });
  it("clears old messages while editing without moving keyboard focus", () => {
    const feedback = new Feedback();
    feedback.hidden = false;
    feedback.textContent = 'Previous correction';
    setCheckoutContactFeedback(root(feedback), null);
    expect(feedback.hidden).toBe(true);
    expect(feedback.textContent).toBe('');
    expect(feedback.focus).not.toHaveBeenCalled();
  });
  it("does not affect a cart or custom surface without checkout contact feedback", () => {
    expect(() => setCheckoutContactFeedback(root(null), 'Correction')).not.toThrow();
    expect(() => setCheckoutContactFeedback(root({}), null)).not.toThrow();
  });
});
