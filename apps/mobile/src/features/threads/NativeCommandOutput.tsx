import { nativeCommandTextRuns } from "@t3tools/client-runtime/neopi-command-output";
import { memo, useMemo } from "react";
import { Text as NativeText } from "react-native";
import { AppText as Text } from "../../components/AppText";

export const NativeCommandOutput = memo(function NativeCommandOutput({ text }: { text: string }) {
  const runs = useMemo(() => nativeCommandTextRuns(text), [text]);
  return (
    <Text selectable className="font-mono text-sm text-foreground">
      {runs.map((run, index) => (
        <NativeText
          key={index}
          style={{ color: run.color ?? undefined, fontWeight: run.bold ? "bold" : "normal" }}
        >
          {run.text}
        </NativeText>
      ))}
    </Text>
  );
});
