import { describe, expect, it } from "vitest";

import { createSpotifyEngine } from "./SpotifyEngine";

const engine = createSpotifyEngine();

const track = (name: string) => ({ name, id: name });

describe("SpotifyEngine.findMatch", () => {
  it("matches an exact title", () => {
    const hit = engine.findMatch("always love you", [track("Always Love You")]);
    expect(hit?.name).toBe("Always Love You");
  });

  it("matches across punctuation and case", () => {
    const hit = engine.findMatch("i will", [track("I Will!")]);
    expect(hit?.name).toBe("I Will!");
  });

  it("matches a title with a version suffix", () => {
    const hit = engine.findMatch("always love you", [
      track("Always Love You (Remastered 2011)"),
      track("Always Love You - Radio Edit"),
    ]);
    expect(hit?.name).toBe("Always Love You (Remastered 2011)");
  });

  it("matches across diacritics", () => {
    const hit = engine.findMatch("senorita", [track("Señorita")]);
    expect(hit?.name).toBe("Señorita");
  });

  it("rejects a superset title — exact only, no 'contains'", () => {
    expect(
      engine.findMatch("love you", [track("Love You Baby")]),
    ).toBeUndefined();
  });

  it("rejects a subset title", () => {
    expect(
      engine.findMatch("love you baby", [track("Love You")]),
    ).toBeUndefined();
  });

  it("returns the first matching track", () => {
    const hit = engine.findMatch("you", [
      track("You & Me"),
      track("You"),
      track("YOU"),
    ]);
    expect(hit?.name).toBe("You");
  });

  it("returns undefined when nothing matches", () => {
    expect(engine.findMatch("love you", [track("Hate You")])).toBeUndefined();
    expect(engine.findMatch("love you", [])).toBeUndefined();
  });

  it("never matches a phrase that normalizes to nothing", () => {
    expect(engine.findMatch("!!!", [track("[Live]")])).toBeUndefined();
  });

  it("strips version tails from the title side only", () => {
    // The phrase keeps its words; only the track title loses "(Live)".
    const hit = engine.findMatch("call me maybe", [track("Call Me (Live)")]);
    expect(hit).toBeUndefined();
    const exact = engine.findMatch("call me", [track("Call Me (Live)")]);
    expect(exact?.name).toBe("Call Me (Live)");
  });
});
