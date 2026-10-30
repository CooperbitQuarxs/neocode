export interface NativeSubmissionLayout {
  /** Changes only when content or measured list geometry changes. */
  readonly revision: string;
  readonly measured: boolean;
  readonly atEnd: boolean;
}

/** An accepted local prompt adopts the live end until the user navigates away. */
export function createNativeSubmissionFollow({
  readLayout,
  scrollToEnd,
  scheduleFrame,
  cancelFrame,
}: {
  readLayout: () => NativeSubmissionLayout | null;
  scrollToEnd: () => void;
  scheduleFrame: (callback: () => void) => number;
  cancelFrame: (frame: number) => void;
}) {
  let generation = 0;
  let following = false;
  let frame: number | null = null;
  let pending = false;
  let previousAttempt: string | null = null;

  const cancel = () => {
    const wasActive = pending || following;
    pending = false;
    generation += 1;
    following = false;
    previousAttempt = null;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    return wasActive;
  };
  const changed = () => {
    if (!following || frame !== null) return;
    frame = scheduleFrame(() => {
      frame = null;
      if (!following) return;
      const layout = readLayout();
      if (!layout) return;
      if (layout.atEnd && layout.measured) {
        previousAttempt = null;
        return;
      }
      if (previousAttempt !== layout.revision) {
        previousAttempt = layout.revision;
        scrollToEnd();
      }
      // Measurement/scroll/content callbacks, not a frame loop, drive the next attempt.
    });
  };
  return {
    begin: () => {
      cancel();
      pending = true;
      return generation;
    },
    accept: (ticket: number) => {
      if (ticket !== generation || !pending) return;
      pending = false;
      following = true;
      changed();
    },
    reject: (ticket: number) => {
      if (ticket === generation) cancel();
    },
    changed,
    cancel,
  };
}
