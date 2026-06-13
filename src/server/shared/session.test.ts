import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSessionToken, readSessionToken } from "./session";

describe("session token", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-at-least-32-bytes-long-xx";
  });

  afterEach(() => {
    delete process.env.SESSION_SECRET;
  });

  it("round-trips the app user id through sign and verify", async () => {
    const token = await createSessionToken("user-123");
    expect(await readSessionToken(token)).toBe("user-123");
  });

  it("returns null for an undefined token", async () => {
    expect(await readSessionToken(undefined)).toBeNull();
  });

  it("returns null for a malformed token", async () => {
    expect(await readSessionToken("not-a-jwt")).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken("user-123");
    process.env.SESSION_SECRET = "a-totally-different-secret-key-value!!";
    expect(await readSessionToken(token)).toBeNull();
  });

  it("throws when signing without a configured secret", async () => {
    delete process.env.SESSION_SECRET;
    await expect(createSessionToken("user-123")).rejects.toThrow(
      /SESSION_SECRET/,
    );
  });

  it("rejects a SESSION_SECRET shorter than 32 characters", async () => {
    process.env.SESSION_SECRET = "too-short";
    await expect(createSessionToken("user-123")).rejects.toThrow(
      /at least 32 characters/,
    );
  });
});
