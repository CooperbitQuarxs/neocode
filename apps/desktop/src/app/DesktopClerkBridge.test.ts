import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { assert, describe, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  app: undefined as unknown as EventEmitter & {
    setAsDefaultProtocolClient: ReturnType<typeof vi.fn<(scheme: string) => boolean>>;
    hasSingleInstanceLock: () => boolean;
  },
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  registerUnrelated: false,
  window: { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), focus: vi.fn() },
}));

vi.mock("electron", () => ({
  get app() {
    return fixture.app;
  },
}));
vi.mock("@clerk/electron/storage", () => ({
  storage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));
vi.mock("@clerk/electron", () => {
  // Execute the installed SDK, not a reimplementation of its callback matcher.
  // Its CJS module gets only the Electron facade replaced, so no native process,
  // storage, browser or default-handler operation can escape this fixture.
  const require = createRequire(import.meta.url);
  const sdkPath = require.resolve("@clerk/electron");
  const sdkRequire = createRequire(sdkPath);
  const exports = {};
  runInNewContext(readFileSync(sdkPath, "utf8"), {
    exports,
    require: (id: string) =>
      id === "electron"
        ? {
            get app() {
              return fixture.app;
            },
            ipcMain: {
              handle: (name: string, callback: (...args: unknown[]) => unknown) =>
                fixture.handlers.set(name, callback),
              removeHandler: (name: string) => fixture.handlers.delete(name),
            },
            protocol: {
              registerSchemesAsPrivileged: () => {
                if (fixture.registerUnrelated) fixture.app.setAsDefaultProtocolClient("unrelated");
              },
            },
            shell: { openExternal: async () => {} },
            BrowserWindow: { fromWebContents: () => fixture.window },
          }
        : sdkRequire(id),
    process,
    URL,
    setTimeout,
    clearTimeout,
    console: { warn: () => {} },
  });
  return exports;
});

import { createDesktopClerkBridge } from "./DesktopClerkBridge.ts";
import { resolveDesktopUrlRegistration } from "./DesktopUrlRegistration.ts";

const reset = () => {
  fixture.handlers.clear();
  fixture.registerUnrelated = false;
  fixture.window.restore.mockClear();
  fixture.window.focus.mockClear();
  fixture.app = Object.assign(new EventEmitter(), {
    setAsDefaultProtocolClient: vi.fn<(scheme: string) => boolean>(() => true),
    hasSingleInstanceLock: () => true,
  });
};

const registration = (packaged: boolean, explicit: boolean, development = false) =>
  resolveDesktopUrlRegistration({
    platform: "linux",
    isPackaged: packaged,
    explicitRegistration: explicit,
    isDevelopment: development,
    execPath: "/electron",
    appPath: "/app/main.cjs",
  });

describe("DesktopClerkBridge Linux ownership", () => {
  for (const [packaged, explicit] of [
    [false, false],
    [false, true],
    [true, false],
  ] as const) {
    it(`leaves native registration to the shared decision for packaged=${packaged}, explicit=${explicit}`, () => {
      reset();
      const nativeRegister = fixture.app.setAsDefaultProtocolClient;
      const bridge = createDesktopClerkBridge("/unused", registration(packaged, explicit));
      try {
        assert.equal(nativeRegister.mock.calls.length, 0);
        assert.strictEqual(fixture.app.setAsDefaultProtocolClient, nativeRegister);
        assert.equal(fixture.app.listenerCount("open-url"), 1);
        assert.equal(fixture.app.listenerCount("second-instance"), 1);
      } finally {
        bridge.cleanup();
      }
      assert.equal(fixture.app.listenerCount("open-url"), 0);
      assert.equal(fixture.app.listenerCount("second-instance"), 0);
      assert.equal(fixture.handlers.size, 0);
    });
  }

  for (const event of ["open-url", "second-instance"] as const) {
    it(`keeps pending OAuth delivery through ${event} exactly once`, async () => {
      reset();
      const bridge = createDesktopClerkBridge("/unused", registration(false, false));
      try {
        const redirectHandler = [...fixture.handlers].find(([key]) =>
          key.includes("redirect"),
        )?.[1];
        const openHandler = [...fixture.handlers].find(([key]) => key.endsWith(":open"))?.[1];
        assert.isDefined(redirectHandler);
        assert.isDefined(openHandler);
        const senderFrame = {};
        const ipcEvent = {
          sender: { getType: () => "window", mainFrame: senderFrame },
          senderFrame,
        };
        const pending = openHandler!(ipcEvent, "https://accounts.example/oauth");
        const url = "t3code://app/?code=disposable%20callback&state=one";
        const emit = () =>
          event === "open-url"
            ? fixture.app.emit(event, { preventDefault() {} }, url)
            : fixture.app.emit(event, {}, ["electron", "/app/main.cjs", url]);
        emit();
        assert.deepEqual(await pending, { callbackUrl: url });
        emit();
        assert.equal(fixture.window.focus.mock.calls.length, 1);
        assert.equal(fixture.window.restore.mock.calls.length, 1);
      } finally {
        bridge.cleanup();
      }
    });
  }

  it("restores native registration even if SDK initialization throws", () => {
    reset();
    const nativeRegister = fixture.app.setAsDefaultProtocolClient;
    fixture.app.hasSingleInstanceLock = () => {
      throw new Error("lock failed");
    };
    assert.throws(
      () => createDesktopClerkBridge("/unused", registration(false, false)),
      /lock failed/,
    );
    assert.strictEqual(fixture.app.setAsDefaultProtocolClient, nativeRegister);
  });

  it("keeps unrelated native scheme registration intact", () => {
    reset();
    fixture.registerUnrelated = true;
    const nativeRegister = fixture.app.setAsDefaultProtocolClient;
    const bridge = createDesktopClerkBridge("/unused", registration(false, false));
    try {
      assert.deepEqual(nativeRegister.mock.calls, [["unrelated"]]);
    } finally {
      bridge.cleanup();
    }
  });

  it("leaves non-Linux SDK registration unchanged", () => {
    reset();
    const nativeRegister = fixture.app.setAsDefaultProtocolClient;
    const bridge = createDesktopClerkBridge("/unused", {
      ...registration(false, false),
      platform: "darwin",
    });
    try {
      assert.deepEqual(nativeRegister.mock.calls, [["t3code"]]);
    } finally {
      bridge.cleanup();
    }
  });
});
