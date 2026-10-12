import { describe, expect, it } from "vitest";
import {
  CLEAR_PLAYGROUND_COOKIE,
  isPlaygroundInitFailure,
  isUsablePlaygroundSession,
  readPlaygroundSession,
  recoverFromPlaygroundInitFailure,
  withoutPlaygroundSession,
} from "../../src/features/playground/contract.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulidAt(ms: number): string {
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[ms % 32] + time;
    ms = Math.floor(ms / 32);
  }
  return `${time}0000000000000000`;
}

const initError = () =>
  Response.json(
    { error: { code: "PLAYGROUND_INIT_ERROR", message: "Failed to initialize playground" } },
    { status: 500 },
  );

describe("playground session recovery", () => {
  const now = Date.parse("2026-10-12T14:00:00Z");

  it("accepts a fresh ULID session and rejects made-up or expired ones", () => {
    expect(isUsablePlaygroundSession(ulidAt(now - 60_000), now)).toBe(true);
    expect(isUsablePlaygroundSession("madeup-zzz-123", now)).toBe(false);
    expect(isUsablePlaygroundSession(ulidAt(now - 3_600_000), now)).toBe(false);
    expect(isUsablePlaygroundSession(ulidAt(now + 3_600_000), now)).toBe(false);
  });

  it("strips only the playground cookie from the request", () => {
    const request = new Request("https://playground.dinkuskit.com/", {
      headers: { cookie: "a=1; emdash_playground=stale; emdash-edit-mode=true" },
    });
    expect(readPlaygroundSession(request)).toBe("stale");
    const stripped = withoutPlaygroundSession(request);
    expect(readPlaygroundSession(stripped)).toBeUndefined();
    expect(stripped.headers.get("cookie")).toBe("a=1; emdash-edit-mode=true");
  });

  it("detects init failures without consuming the body", async () => {
    const response = initError();
    expect(await isPlaygroundInitFailure(response)).toBe(true);
    expect(await response.json()).toHaveProperty("error.code", "PLAYGROUND_INIT_ERROR");
    expect(await isPlaygroundInitFailure(Response.json({ ok: true }, { status: 500 }))).toBe(false);
  });

  it("sends a failed GET to a fresh session and clears the cookie on other methods", async () => {
    const get = recoverFromPlaygroundInitFailure(
      new Request("https://playground.dinkuskit.com/"),
      initError(),
    );
    expect(get.status).toBe(302);
    expect(get.headers.get("location")).toBe("/playground?retry=1");
    expect(get.headers.get("set-cookie")).toBe(CLEAR_PLAYGROUND_COOKIE);

    const post = recoverFromPlaygroundInitFailure(
      new Request("https://playground.dinkuskit.com/_playground/init", { method: "POST" }),
      initError(),
    );
    expect(post.status).toBe(500);
    expect(post.headers.get("set-cookie")).toBe(CLEAR_PLAYGROUND_COOKIE);
  });

  it("stops after one retry with a no-store 503 page that clears the cookie", async () => {
    const retry = recoverFromPlaygroundInitFailure(
      new Request("https://playground.dinkuskit.com/playground?retry=1"),
      initError(),
    );
    expect(retry.status).toBe(503);
    expect(retry.headers.get("location")).toBeNull();
    expect(retry.headers.get("set-cookie")).toBe(CLEAR_PLAYGROUND_COOKIE);
    expect(retry.headers.get("cache-control")).toBe("no-store");
    const html = await retry.text();
    expect(html).toContain('content="noindex, nofollow"');
    expect(html).toContain('href="/playground"');
  });

  it("leaves a failed POST as a 500 even with retry=1", () => {
    const post = recoverFromPlaygroundInitFailure(
      new Request("https://playground.dinkuskit.com/_playground/init?retry=1", { method: "POST" }),
      initError(),
    );
    expect(post.status).toBe(500);
    expect(post.headers.get("location")).toBeNull();
    expect(post.headers.get("set-cookie")).toBe(CLEAR_PLAYGROUND_COOKIE);
  });
});
