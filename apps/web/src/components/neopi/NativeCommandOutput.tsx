import { nativeCommandTextRuns } from "@t3tools/client-runtime/neopi-command-output";
import { memo, useMemo } from "react";

export const NativeCommandOutput = memo(function NativeCommandOutput({ text }: { text: string }) {
  const runs = useMemo(() => nativeCommandTextRuns(text), [text]);
  return (
    <pre className="whitespace-pre-wrap break-words text-sm">
      {runs.map((run, index) => (
        <span
          key={index}
          style={{ color: run.color ?? undefined, fontWeight: run.bold ? "bold" : "normal" }}
        >
          {run.text}
        </span>
      ))}
    </pre>
  );
});
