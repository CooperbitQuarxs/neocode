import { useEffect } from "react";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { checkForAppUpdateOnLaunch, startAppUpdateForegroundRecheck } from "../updates/app-updates";
import { NativeSessionBrowser } from "../threads/NativeSessionBrowser";

export function HomeRouteScreen() {
  useEffect(() => {
    void checkForAppUpdateOnLaunch();
    startAppUpdateForegroundRecheck();
  }, []);
  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <NativeSessionBrowser />
    </>
  );
}
