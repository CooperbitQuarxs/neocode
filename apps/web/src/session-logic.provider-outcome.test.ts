import { EventId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { deriveWorkLogEntries } from "./session-logic";

it("keeps provider acceptance bookkeeping out of the web and desktop work log without hiding failures", () => {
  const accepted: OrchestrationThreadActivity = {
    id: EventId.make("provider-accepted"),
    kind: "provider.turn.start.succeeded",
    summary: "Provider accepted prompt",
    tone: "info",
    payload: { requestId: "message", timelineBypass: true },
    turnId: null,
    createdAt: "2026-10-30T10:00:00.000Z",
  };
  expect(deriveWorkLogEntries([accepted])).toEqual([]);
  expect(
    deriveWorkLogEntries([
      accepted,
      {
        ...accepted,
        id: EventId.make("provider-failed"),
        kind: "provider.turn.start.failed",
        summary: "Provider turn start failed",
        tone: "error",
        payload: { requestId: "failed-message", detail: "Unavailable native session" },
      },
    ]),
  ).toMatchObject([{ sourceActivityKind: "provider.turn.start.failed" }]);
});
