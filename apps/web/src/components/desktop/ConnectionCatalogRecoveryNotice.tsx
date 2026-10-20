import { Link } from "@tanstack/react-router";
import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useCatalogRecovery } from "../../connection/catalogRecovery";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { InlineButton } from "../ui/button";

export function ConnectionCatalogRecoveryNotice({ children }: { children: ReactNode }) {
  const recovery = useCatalogRecovery((state) => state.recovery);
  if (recovery === null) return children;

  const blocked = recovery.status === "blocked";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pb-2 pt-12">
        <Alert variant={blocked ? "error" : "warning"} role="alert">
          <InfoIcon />
          <AlertTitle>Saved connections could not be unlocked</AlertTitle>
          <AlertDescription>
            <p>
              Your local workspace is still available. Your previous saved connections have not been
              restored.
            </p>
            {blocked ? (
              <p>
                Recovery could not preserve the encrypted catalog. Saved-connection changes are
                blocked to protect the original at{" "}
                <code className="break-all">{recovery.catalogPath}</code>. Check this directory’s
                permissions and available space, then restart.
              </p>
            ) : (
              <p>
                The original encrypted file is preserved at{" "}
                <code className="break-all">{recovery.preservedPath}</code>.
              </p>
            )}
            {recovery.reason === "encryption-unavailable" ? (
              <p>
                Secure storage is unavailable. Restore access to your password store and restart
                before saving connections.
              </p>
            ) : null}
            <InlineButton render={<Link to="/settings/connections" />}>
              {blocked ? "Open connection settings" : "Re-add saved connections"}
            </InlineButton>
          </AlertDescription>
        </Alert>
      </div>
      {children}
    </div>
  );
}
