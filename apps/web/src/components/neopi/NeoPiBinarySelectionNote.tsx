export function NeoPiBinarySelectionNote({ config }: { readonly config: unknown }) {
  if (config === null || typeof config !== "object") return null;
  if (!("binaryPath" in config) || !("autoSelectedBinaryPath" in config)) return null;
  if (
    typeof config.binaryPath !== "string" ||
    !config.binaryPath ||
    config.autoSelectedBinaryPath !== config.binaryPath
  ) return null;
  return (
    <p className="text-xs text-muted-foreground" role="status">
      Automatically selected and saved <code>{config.binaryPath}</code> after confirming session-catalog
      support. Change Binary path to override it, or clear it to select again.
    </p>
  );
}
