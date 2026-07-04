import { describe, expect, it } from "vitest";

import { normalize } from "./normalize";

describe("normalize", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalize("I Will Always Love You!")).toBe("i will always love you");
  });

  it("strips diacritics", () => {
    expect(normalize("Beyoncé señorita")).toBe("beyonce senorita");
  });

  it("strips a parenthetical version tail", () => {
    expect(normalize("Always Love You (Remastered 2011)")).toBe(
      "always love you",
    );
  });

  it("strips a bracketed version tail", () => {
    expect(normalize("Always Love You [Live]")).toBe("always love you");
  });

  it("strips stacked version tails", () => {
    expect(normalize("Always Love You (Remastered 2011) [Live]")).toBe(
      "always love you",
    );
  });

  it("strips a dash version tail", () => {
    expect(normalize("Always Love You - Radio Edit")).toBe("always love you");
  });

  it("strips a dash tail hiding behind a parenthetical tail", () => {
    expect(normalize("Always Love You - Radio Edit (Remastered)")).toBe(
      "always love you",
    );
  });

  it("keeps a leading parenthetical — only tails are version suffixes", () => {
    expect(normalize("(Don't Fear) The Reaper")).toBe("dont fear the reaper");
  });

  it("keeps hyphenated words — only space-delimited dashes are tails", () => {
    expect(normalize("T-Shirt")).toBe("t shirt");
  });

  it("removes apostrophes without splitting the word", () => {
    expect(normalize("Don't Stop Believin'")).toBe("dont stop believin");
    expect(normalize("don’t")).toBe("dont"); // curly apostrophe too
  });

  it("keeps & and digits (substitution targets)", () => {
    expect(normalize("Me & You")).toBe("me & you");
    expect(normalize("2 Become 1")).toBe("2 become 1");
  });

  it("collapses whitespace", () => {
    expect(normalize("  love   you  ")).toBe("love you");
  });

  it("returns empty string when only a version tail remains", () => {
    expect(normalize("(Live)")).toBe("");
  });
});
