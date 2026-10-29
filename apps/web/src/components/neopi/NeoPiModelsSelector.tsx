import type { NeoPiModelsConfiguration } from "@t3tools/contracts";
import { getNeoPiModelsSelectorOptions } from "@t3tools/client-runtime/neopi-models";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { useMemo, useRef, useState } from "react";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxListVirtualized,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { SelectButton } from "../ui/select";

type Configuration = NeoPiModelsConfiguration;

/** Search is never an assignment: only catalog entries or native saved selectors can be picked. */
export function NeoPiModelsSelector({
  configuration,
  label,
  value,
  onChange,
  disabled = false,
}: {
  configuration: Configuration;
  label: string;
  value: string;
  onChange: (selector: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<LegendListRef | null>(null);
  const options = useMemo(
    () => getNeoPiModelsSelectorOptions(configuration, value),
    [configuration, value],
  );
  const items = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return [...options.keys()].filter((selector) => {
      const option = options.get(selector)!;
      return `${selector} ${option.label} ${option.detail}`.toLocaleLowerCase().includes(search);
    });
  }, [options, query]);
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Combobox
        items={items}
        filteredItems={items}
        virtualized
        autoHighlight
        disabled={disabled}
        value={value || null}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setQuery("");
        }}
        onValueChange={(next) => {
          if (typeof next !== "string") return;
          onChange(next);
          setOpen(false);
        }}
        onItemHighlighted={(_value, details) => {
          if (open && details.reason === "keyboard" && details.index >= 0)
            void listRef.current?.scrollIndexIntoView?.({ index: details.index, animated: false });
        }}
      >
        <ComboboxTrigger aria-label={label} render={<SelectButton />}>
          {options.get(value)?.label ?? "Choose a native model or saved selector…"}
        </ComboboxTrigger>
        <ComboboxPopup>
          <ComboboxSearchInput
            aria-label={`Search ${label.toLocaleLowerCase()}`}
            placeholder="Search models, roles and saved selectors…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ComboboxEmpty>No matching native models or saved selectors.</ComboboxEmpty>
          <div className="min-h-0 max-h-72 overflow-hidden">
            <ComboboxListVirtualized>
              <LegendList<string>
                ref={listRef}
                data={items}
                keyExtractor={(selector) => selector}
                estimatedItemSize={56}
                drawDistance={280}
                style={{ height: Math.min(items.length * 56, 288) }}
                renderItem={({ item: selector, index }) => {
                  const option = options.get(selector)!;
                  return (
                    <ComboboxItem key={selector} value={selector} index={index}>
                      <div className="min-w-0 py-1">
                        <p className="truncate">{option.label}</p>
                        <p className="truncate text-xs text-muted-foreground">{option.detail}</p>
                      </div>
                    </ComboboxItem>
                  );
                }}
              />
            </ComboboxListVirtualized>
          </div>
        </ComboboxPopup>
      </Combobox>
      {value ? <p className="break-all text-xs text-muted-foreground">{value}</p> : null}
    </div>
  );
}
