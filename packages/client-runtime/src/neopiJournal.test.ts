import { describe, expect, it } from "vite-plus/test";
import { nativeJournalImageSource } from "./neopiJournal.ts";

// A one-pixel PNG keeps the producer/renderer boundary realistic without private media.
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVp0AAAAASUVORK5CYII=";

describe("native journal inline images", () => {
  it("renders canonical inline image bytes as a media source", () => {
    const block = { type: "image", data: png, mimeType: "image/png" };
    const expected = `data:image/png;base64,${png}`;
    expect(nativeJournalImageSource(block)).toBe(expected);
  });

  it("does not reinterpret the malformed undiscriminated user block as an image", () => {
    const malformed = { data: png, mimeType: "image/png" };
    expect(nativeJournalImageSource(malformed)).toBeNull();
    expect(malformed).not.toHaveProperty("type");
    expect(nativeJournalImageSource({ ...malformed, type: "text" })).toBeNull();
  });

  it.each([
    { type: "image", mimeType: "image/png" },
    { type: "image", data: "", mimeType: "image/png" },
    { type: "image", data: png },
    { type: "image", data: png, mimeType: "text/html" },
    { type: "image", data: png, mimeType: "image/svg+xml" },
    { type: "image", path: "/workspace/image.png", mimeType: "image/png" },
  ])("leaves unavailable or unsupported canonical media explicit: %j", (block) => {
    expect(nativeJournalImageSource(block)).toBeNull();
  });
});
