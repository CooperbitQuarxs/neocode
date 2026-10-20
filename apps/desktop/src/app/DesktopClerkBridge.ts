import { createClerkBridge } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import * as Electron from "electron";
import { DESKTOP_HOST } from "../electron/ElectronProtocol.ts";
import type { DesktopUrlRegistration } from "./DesktopUrlRegistration.ts";

export function createDesktopClerkBridge(stateDir: string, registration: DesktopUrlRegistration) {
  const create = () => createClerkBridge({
    storage: storage({ path: stateDir }),
    passkeys: true,
    renderer: { scheme: registration.scheme, host: DESKTOP_HOST },
  });
  if (registration.platform !== "linux") return create();

  // Clerk 0.0.44 registers synchronously and offers no opt-out. Keep its OAuth
  // listeners, IPC and lock intact, but leave Linux ownership to our desktop
  // entry/default transaction. This override never spans asynchronous work.
  const nativeRegister = Electron.app.setAsDefaultProtocolClient;
  Electron.app.setAsDefaultProtocolClient = function (scheme, ...args) {
    return scheme === registration.scheme
      ? false
      : nativeRegister.call(Electron.app, scheme, ...args);
  };
  try {
    return create();
  } finally {
    Electron.app.setAsDefaultProtocolClient = nativeRegister;
  }
}
