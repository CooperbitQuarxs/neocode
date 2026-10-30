import { describe, expect, it } from "vite-plus/test";
import {
  createNativeSubmissionFollow,
  type NativeSubmissionLayout,
} from "./neopiSubmissionFollow.ts";

function harness() {
  const frames = new Map<number, () => void>();
  let nextFrame = 0;
  let scrolls = 0;
  let layout: NativeSubmissionLayout = {
    revision: "old-history",
    measured: true,
    atEnd: false,
  };
  const follow = createNativeSubmissionFollow({
    readLayout: () => layout,
    scrollToEnd: () => {
      scrolls += 1;
    },
    scheduleFrame: (callback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
  });
  return {
    follow,
    update: (next: Partial<NativeSubmissionLayout>) => {
      layout = { ...layout, ...next };
      follow.changed();
    },
    frame: () => {
      const next = frames.entries().next().value;
      if (!next) throw new Error("No follow frame was scheduled");
      frames.delete(next[0]);
      next[1]();
    },
    get scrolls() {
      return scrolls;
    },
    get frames() {
      return frames.size;
    },
  };
}

describe("native own-submission live-end intent", () => {
  it("adopts the end on acceptance and corrects delayed command insertion and large measurement", () => {
    const h = harness();
    h.follow.accept(h.follow.begin());
    h.frame();
    expect(h.scrolls).toBe(1);
    expect(h.frames).toBe(0);

    h.update({ revision: "old-end", atEnd: true });
    h.frame();
    expect(h.scrolls).toBe(1);

    h.update({ revision: "command-estimate-160", measured: false, atEnd: false });
    h.frame();
    expect(h.scrolls).toBe(2);
    h.update({ revision: "command-measured-8400", measured: true });
    h.frame();
    expect(h.scrolls).toBe(3);
    h.update({ revision: "at-measured-end", atEnd: true });
    h.frame();
    expect(h.frames).toBe(0);
  });

  it("keeps live-end intent after a no-output command without waiting for a matching result", () => {
    const h = harness();
    h.follow.accept(h.follow.begin());
    h.frame();
    h.update({ revision: "idle-at-end", atEnd: true });
    h.frame();
    expect(h.frames).toBe(0);

    // Later remote updates are normal while the user intentionally remains live.
    h.update({ revision: "remote-turn", atEnd: false });
    h.frame();
    expect(h.scrolls).toBe(2);
    h.follow.cancel();
    h.update({ revision: "another-remote-turn", atEnd: false });
    expect(h.frames).toBe(0);
  });

  it("coalesces callbacks and never retries an unchanged estimate in a frame loop", () => {
    const h = harness();
    h.update({ revision: "estimated-end", measured: false });
    h.follow.accept(h.follow.begin());
    h.follow.changed();
    h.follow.changed();
    expect(h.frames).toBe(1);
    h.frame();
    for (let index = 0; index < 4; index += 1) {
      h.follow.changed();
      h.frame();
      expect(h.frames).toBe(0);
    }
    expect(h.scrolls).toBe(1);
  });

  it("does not mistake the estimated DOM end for a measured response end", () => {
    const h = harness();
    h.update({ atEnd: true, measured: false });
    h.follow.accept(h.follow.begin());
    h.frame();
    expect(h.scrolls).toBe(1);
    h.update({ revision: "row-expanded", measured: true, atEnd: false });
    h.frame();
    expect(h.scrolls).toBe(2);
  });

  it("never arms a passive reader just because remote content changes", () => {
    const h = harness();
    h.update({ revision: "remote-user" });
    h.update({ revision: "remote-assistant" });
    expect(h.frames).toBe(0);
    expect(h.scrolls).toBe(0);
  });

  it("invalidates an in-flight acceptance and queued positioning when the user navigates", () => {
    const h = harness();
    const beforeNavigation = h.follow.begin();
    expect(h.follow.cancel()).toBe(true);
    h.follow.accept(beforeNavigation);
    expect(h.frames).toBe(0);

    h.follow.accept(h.follow.begin());
    expect(h.frames).toBe(1);
    h.follow.cancel();
    expect(h.frames).toBe(0);
    h.update({ revision: "later-command-output" });
    expect(h.frames).toBe(0);
    expect(h.scrolls).toBe(0);
  });

  it("does not scroll rejected sends or let an older rejection cancel a newer submission", () => {
    const h = harness();
    const rejected = h.follow.begin();
    h.follow.reject(rejected);
    h.follow.accept(rejected);
    h.update({ revision: "remote-update" });
    expect(h.frames).toBe(0);
    const older = h.follow.begin();
    const current = h.follow.begin();
    h.follow.reject(older);
    h.follow.accept(older);
    expect(h.frames).toBe(0);
    h.follow.accept(current);
    h.frame();
    expect(h.scrolls).toBe(1);
  });
});
