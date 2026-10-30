import { ExternalLinkIcon } from "lucide-react";

import { Button } from "../ui/button";

export function NeoPiInstallHelp({ environmentLabel }: { readonly environmentLabel: string }) {
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <p>
        Install NeoPi on {environmentLabel}, the connected computer that runs your sessions. This
        may not be the computer running your browser.
      </p>
      <Button
        variant="outline"
        size="xs"
        render={
          <a
            href="https://github.com/PsychedelicShayna/neopi/releases"
            target="_blank"
            rel="noreferrer noopener"
          />
        }
      >
        Download NeoPi
        <ExternalLinkIcon aria-hidden />
      </Button>
      <p>
        Make <code>npi</code> available on that computer’s PATH, or select its executable with
        Binary path in Settings → NeoCore. If an explicit path is invalid, correct it or clear it to
        return to automatic discovery.
      </p>
    </div>
  );
}
