import { MicIcon, MicOffIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { dictationStatusLabel, type ComposerDictationControl } from "./composerDictation.logic";

/** Click to start, click again to stop. The recording state is static, never animated. */
export function ComposerDictationButton(props: {
  readonly dictation: ComposerDictationControl;
  readonly shortcut: string | null;
}) {
  const { dictation, shortcut } = props;
  const capturing = dictation.phase === "starting" || dictation.phase === "recording";
  const label = capturing ? "Stop dictation" : "Dictate";
  const withShortcut = shortcut ? `${label} (${shortcut})` : label;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={capturing ? "destructive" : "ghost"}
            size="icon-sm"
            disabled={dictation.phase === "transcribing"}
            aria-pressed={capturing}
            aria-label={withShortcut}
            data-composer-dictation={dictation.phase}
            onPointerDown={(event) => event.preventDefault()}
            onClick={dictation.toggle}
          />
        }
      >
        {capturing ? <MicOffIcon /> : <MicIcon />}
      </TooltipTrigger>
      <TooltipPopup>{withShortcut}</TooltipPopup>
    </Tooltip>
  );
}

/** The live transcript while capturing, and NeoPi's own message when a capture fails. */
export function composerDictationBannerItems(
  dictation: ComposerDictationControl,
  shortcut: string | null,
): readonly ComposerBannerStackItem[] {
  const items: ComposerBannerStackItem[] = [];
  if (dictation.phase !== "idle")
    items.push({
      id: "composer-dictation",
      variant: "info",
      priority: "activity",
      icon: <MicIcon />,
      title: dictationStatusLabel(dictation.phase, shortcut),
      ...(dictation.preview ? { description: dictation.preview } : {}),
    });
  if (dictation.notice)
    items.push({
      id: "composer-dictation-notice",
      variant: "error",
      priority: "urgent",
      icon: <MicOffIcon />,
      title: dictation.notice,
      dismissLabel: "Dismiss",
      onDismiss: dictation.dismissNotice,
    });
  return items;
}
