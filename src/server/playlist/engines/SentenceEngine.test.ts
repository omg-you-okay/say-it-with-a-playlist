import { describe, expect, it } from "vitest";

import { createSentenceEngine } from "./SentenceEngine";

const engine = createSentenceEngine();

describe("SentenceEngine.tokenize", () => {
  it("splits into normalized words", () => {
    expect(engine.tokenize("I Will Always Love You!")).toEqual([
      "i",
      "will",
      "always",
      "love",
      "you",
    ]);
  });

  it("returns no words for empty or whitespace input", () => {
    expect(engine.tokenize("")).toEqual([]);
    expect(engine.tokenize("   ")).toEqual([]);
  });

  it("keeps apostrophized words whole", () => {
    expect(engine.tokenize("don't stop")).toEqual(["dont", "stop"]);
  });

  it("keeps every word — no title-style tail stripping on sentences", () => {
    expect(engine.tokenize("call me (maybe)")).toEqual(["call", "me", "maybe"]);
    expect(engine.tokenize("wait - for me now")).toEqual([
      "wait",
      "for",
      "me",
      "now",
    ]);
  });
});

describe("SentenceEngine.candidatesAt", () => {
  it("yields groupings longest-first", () => {
    const candidates = engine.candidatesAt(["always", "love", "you"], 0);
    expect(candidates.map((c) => c.phrase)).toEqual([
      "always love you",
      "always love",
      "always",
    ]);
    expect(candidates.map((c) => c.wordCount)).toEqual([3, 2, 1]);
  });

  it("starts groupings at the given index", () => {
    const candidates = engine.candidatesAt(["always", "love", "you"], 2);
    expect(candidates.map((c) => c.phrase)).toEqual(["you"]);
  });

  it("caps the span at maxGroupingWords", () => {
    const small = createSentenceEngine({ maxGroupingWords: 2 });
    const candidates = small.candidatesAt(["a", "b", "c", "d"], 0);
    expect(candidates.map((c) => c.phrase)).toEqual(["a b", "a"]);
  });

  it("caps the span at the default of 5 words", () => {
    const words = ["a", "b", "c", "d", "e", "f", "g"];
    const candidates = engine.candidatesAt(words, 0);
    expect(candidates[0].phrase).toBe("a b c d e");
  });

  it("returns no candidates past the end of the sentence", () => {
    expect(engine.candidatesAt(["a"], 1)).toEqual([]);
  });
});

describe("SentenceEngine substitution variants (ADR 0003)", () => {
  it.each([
    ["to", "2"],
    ["you", "u"],
    ["for", "4"],
    ["are", "r"],
    ["one", "1"],
    ["two", "2"],
    ["three", "3"],
    ["four", "4"],
    ["five", "5"],
    ["six", "6"],
    ["seven", "7"],
    ["eight", "8"],
    ["nine", "9"],
    ["ten", "10"],
    ["and", "&"],
    ["too", "2"],
    ["be", "b"],
    ["see", "c"],
    ["why", "y"],
    ["oh", "o"],
    ["ex", "x"],
  ])("substitutes %s → %s", (word, sub) => {
    const [candidate] = engine.candidatesAt([word], 0);
    expect(candidate.variants).toEqual([word, sub]);
  });

  it("puts the original phrase first, fully-substituted last", () => {
    const [candidate] = engine.candidatesAt(["to", "you"], 0);
    expect(candidate.variants).toEqual(["to you", "2 you", "to u", "2 u"]);
  });

  it("leaves unsubstitutable words as a single variant", () => {
    const [candidate] = engine.candidatesAt(["love"], 0);
    expect(candidate.variants).toEqual(["love"]);
  });

  it("substitutes mid-phrase words", () => {
    const [candidate] = engine.candidatesAt(["nothing", "compares", "to"], 0);
    expect(candidate.variants).toEqual([
      "nothing compares to",
      "nothing compares 2",
    ]);
  });

  it("honors a configured substitution map", () => {
    const custom = createSentenceEngine({ substitutions: { love: "<3" } });
    const [candidate] = custom.candidatesAt(["love", "you"], 0);
    expect(candidate.variants).toEqual(["love you", "<3 you"]);
  });
});
