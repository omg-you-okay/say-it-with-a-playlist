import { afterEach, describe, expect, it } from "vitest";

import { requireEnv } from "./env";

describe("requireEnv", () => {
  afterEach(() => {
    delete process.env.TEST_VAR;
  });

  it("returns the value when the variable is set", () => {
    process.env.TEST_VAR = "hello";
    expect(requireEnv("TEST_VAR")).toBe("hello");
  });

  it("throws when the variable is missing", () => {
    expect(() => requireEnv("TEST_VAR")).toThrow(/TEST_VAR/);
  });

  it("throws when the variable is empty", () => {
    process.env.TEST_VAR = "";
    expect(() => requireEnv("TEST_VAR")).toThrow(/TEST_VAR/);
  });
});
