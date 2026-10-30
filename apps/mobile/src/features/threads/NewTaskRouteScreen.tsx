import type { StaticScreenProps } from "@react-navigation/native";
import { NativeSessionBrowser } from "./NativeSessionBrowser";

export function NewTaskRouteScreen(
  _props: StaticScreenProps<{ incomingShareId?: string | string[] } | undefined>,
) {
  return <NativeSessionBrowser />;
}
