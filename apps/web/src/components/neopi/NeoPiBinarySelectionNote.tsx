export function NeoPiBinarySelectionNote({ config }: { readonly config: unknown }) {
  if (config === null || typeof config !== "object") return null;
  if (!("autoSelectedBinaryPath" in config) || typeof config.autoSelectedBinaryPath !== "string")
    return null;
  const binaryPath = "binaryPath" in config ? config.binaryPath : undefined;
  const bundled = !binaryPath || binaryPath === "npi";
  if (!bundled && binaryPath !== config.autoSelectedBinaryPath) return null;
  return (
    <p className="text-xs text-muted-foreground" role="status">
      Automatically selected {bundled ? "bundled desktop " : ""}executable{" "}
      <code>{config.autoSelectedBinaryPath}</code> after confirming session-catalog support.
      {bundled
        ? " The bundled location is resolved again when the desktop app starts."
        : " This path is saved."}{" "}
      Change Binary path to override it, or clear it to select again.
    </p>
  );
}
