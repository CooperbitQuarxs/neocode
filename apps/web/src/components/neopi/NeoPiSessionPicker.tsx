import type { ScopedProjectRef } from "@t3tools/contracts";
import { useState } from "react";
import { useEnvironments } from "../../state/environments";
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { NativeEnvironmentSessions } from "./NativeSessionSidebar";

export function NeoPiSessionPicker({
  target,
  onClose,
}: {
  target?: ScopedProjectRef;
  onClose: () => void;
}) {
  const { environments } = useEnvironments();
  const [query, setQuery] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Native sessions</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-3">
          <Input
            aria-label="Search native sessions"
            placeholder="Search sessions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="max-h-96 overflow-auto px-4 pb-4">
          {environments
            .filter((environment) => !target || environment.environmentId === target.environmentId)
            .map((environment) => (
              <NativeEnvironmentSessions
                key={environment.environmentId}
                environmentId={environment.environmentId}
                label={environment.label}
                query={query}
                onSelect={onClose}
              />
            ))}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
