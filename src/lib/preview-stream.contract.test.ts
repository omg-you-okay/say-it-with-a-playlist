import { describe, expectTypeOf, it } from "vitest";

import type { PreviewEvent as ManagerPreviewEvent } from "@/server/playlist/managers/PlaylistManager";

import type { PreviewEvent as UIPreviewEvent } from "./preview-stream";

// NDJSON wire contract (ADR 0013, follow-up closed by ADR 0015): the event
// shape is declared independently in three places — PlaylistManager's
// PreviewEvent, the preview route's StreamEvent, and this UI-local mirror
// (ADR 0008 pattern, so the ui layer stays ignorant of server types) — with
// nothing linking them. Iteration 6 widened the shape three times without a
// guard; a field added to the Manager's union could type-check on both sides
// while breaking at runtime.
//
// This is a compile-time-only assertion — it has no runtime behavior of its
// own. A mismatch fails `pnpm typecheck` (a real CI step), not `vitest run`.
// The route widens the Manager's union with one local "error" variant
// (StreamEvent = PreviewEvent | error), which the UI mirror already includes,
// so the contract only needs to hold in one direction: every event the
// Manager can actually emit must be a valid UI event.
describe("NDJSON PreviewEvent wire contract", () => {
  it("the UI mirror accepts every event the Manager can emit", () => {
    expectTypeOf<ManagerPreviewEvent>().toExtend<UIPreviewEvent>();
  });
});
