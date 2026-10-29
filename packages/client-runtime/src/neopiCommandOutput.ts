export interface NativeCommandTextRun {
  readonly text: string;
  readonly bold: boolean;
  readonly color: string | null;
}

// A command result is a text document, not a terminal. Only native SGR emphasis
// and foreground RGB are presented; cursor movement and terminal payloads vanish.
export function nativeCommandTextRuns(text: string): ReadonlyArray<NativeCommandTextRun> {
  const runs: NativeCommandTextRun[] = [];
  let chunks: string[] = [];
  let bold = false;
  let color: string | null = null;
  let start = 0;
  let cursor = 0;

  const flush = (runBold: boolean = bold, runColor: string | null = color) => {
    if (chunks.length === 0) return;
    runs.push({
      text: chunks.length === 1 ? chunks[0]! : chunks.join(""),
      bold: runBold,
      color: runColor,
    });
    chunks = [];
  };

  while (cursor < text.length) {
    const code = text.charCodeAt(cursor);
    if (code >= 0x20 && code !== 0x7f && (code < 0x80 || code > 0x9f)) {
      cursor++;
      continue;
    }
    if (code === 0x09 || code === 0x0a) {
      cursor++;
      continue;
    }
    if (cursor > start) chunks.push(text.slice(start, cursor));

    const escaped = code === 0x1b;
    const kind = escaped ? text.charCodeAt(cursor + 1) : code;
    const payload = cursor + (escaped ? 2 : 1);
    if ((escaped && kind === 0x5b) || code === 0x9b) {
      let end = payload;
      while (end < text.length && text.charCodeAt(end) >= 0x30 && text.charCodeAt(end) <= 0x3f)
        end++;
      const parametersEnd = end;
      while (end < text.length && text.charCodeAt(end) >= 0x20 && text.charCodeAt(end) <= 0x2f)
        end++;
      const final = text.charCodeAt(end);
      if (final >= 0x40 && final <= 0x7e) {
        if (final === 0x6d && end === parametersEnd) {
          const parameters = text.slice(payload, parametersEnd);
          if (/^[\d;]*$/.test(parameters)) {
            const values = parameters.split(";").map(Number);
            const previousBold: boolean = bold;
            const previousColor: string | null = color;
            for (let index = 0; index < values.length; index++) {
              const value = values[index];
              if (value === 0) {
                bold = false;
                color = null;
              } else if (value === 1) {
                bold = true;
              } else if (value === 22) {
                bold = false;
              } else if (value === 39) {
                color = null;
              } else if (value === 38 || value === 48 || value === 58) {
                // Consume unsupported extended background/underline colours as a
                // unit too: RGB components must never become bold/reset codes.
                const mode = values[++index];
                if (mode === 2) {
                  const red = values[index + 1];
                  const green = values[index + 2];
                  const blue = values[index + 3];
                  if (
                    value === 38 &&
                    red !== undefined &&
                    green !== undefined &&
                    blue !== undefined &&
                    red >= 0 &&
                    red <= 255 &&
                    green >= 0 &&
                    green <= 255 &&
                    blue >= 0 &&
                    blue <= 255
                  ) {
                    color = `rgb(${red}, ${green}, ${blue})`;
                  }
                  index += 3;
                } else if (mode === 5) {
                  index++;
                } else {
                  // An unknown colour encoding has no safe parameter boundary.
                  break;
                }
              }
            }
            if (bold !== previousBold || color !== previousColor)
              flush(previousBold, previousColor);
          }
        }
        cursor = end + 1;
      } else {
        // Drop a truncated CSI prefix, but leave the newline/Unicode/new escape
        // that interrupted it for the normal scanner instead of eating the tail.
        cursor = end;
      }
    } else if (
      (escaped &&
        (kind === 0x5d || kind === 0x50 || kind === 0x58 || kind === 0x5e || kind === 0x5f)) ||
      code === 0x9d ||
      code === 0x90 ||
      code === 0x98 ||
      code === 0x9e ||
      code === 0x9f
    ) {
      const osc = kind === 0x5d || code === 0x9d;
      const end = controlStringEnd(text, payload, osc);
      if (end !== null) {
        cursor = end;
      } else {
        // Without a terminator, payload versus ordinary text is ambiguous. Strip
        // the introducer (and OSC selector), retaining readable trailing text.
        cursor = payload;
        if (osc) {
          let selectorEnd = payload;
          while (text.charCodeAt(selectorEnd) >= 0x30 && text.charCodeAt(selectorEnd) <= 0x39)
            selectorEnd++;
          if (text[selectorEnd] === ";") cursor = selectorEnd + 1;
        }
      }
    } else if (escaped) {
      let end = cursor + 1;
      while (text.charCodeAt(end) >= 0x20 && text.charCodeAt(end) <= 0x2f) end++;
      const final = text.charCodeAt(end);
      cursor = final >= 0x30 && final <= 0x7e ? end + 1 : end;
    } else {
      // Preserve LF and tabs above; drop CR, BEL, DEL and other C0/C1 controls.
      cursor++;
    }
    start = cursor;
  }
  if (cursor > start) chunks.push(text.slice(start, cursor));
  flush();
  return runs;
}

function controlStringEnd(text: string, start: number, osc: boolean): number | null {
  for (let cursor = start; cursor < text.length; cursor++) {
    const code = text.charCodeAt(cursor);
    if (code === 0x9c || (osc && code === 0x07)) return cursor + 1;
    if (code === 0x1b) return text[cursor + 1] === "\\" ? cursor + 2 : null;
    // A new C1 instruction interrupts a broken string. Stopping here also
    // prevents overlapping scans of repeated unterminated string introducers.
    if (code >= 0x80 && code <= 0x9f) return null;
  }
  return null;
}
