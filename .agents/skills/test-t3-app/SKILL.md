---
name: test-t3-app
description: Test T3 Code's web and desktop UI against isolated development state, preferring its built-in Browser panel or using the operator's hidden Xvfb+i3 session with computer use when unavailable. Use for browser verification, browser pairing recovery, and test fixtures. Use test-t3-mobile for native mobile verification.
---

# Test T3 web and desktop

Prefer T3's built-in Browser panel when its tools are present and the panel
is available. Otherwise, the operator MUST continue verification with computer
use in its own hidden Xvfb+i3 session with private state, per
[AGENTS.md §Verifying](../../../AGENTS.md#verifying).
NEVER install a new automation system. For native mobile testing, use
[test-t3-mobile](../test-t3-mobile/SKILL.md).

## Start the app

Reuse this task's healthy dev server. Otherwise run `vp run dev` from the
repository root and retain its terminal session. Use the worktree's ignored
`.t3` state and read the actual ports and pairing URL from the dev-runner output.
Never run against `~/.t3/userdata` or set `VITE_HTTP_URL` or `VITE_WS_URL`.

Test with meaningful project and thread data. Read
[references/sqlite-fixtures.md](references/sqlite-fixtures.md) only when
inspecting or seeding SQLite. Stop the test server before direct fixture writes.

## Choose the verification surface

If the Browser panel's tools are absent or the panel reports unavailable,
use the operator's hidden Xvfb+i3 session with computer use under
[AGENTS.md §Verifying](../../../AGENTS.md#verifying). Navigate to the complete
startup pairing URL in that session's browser.

When using the Browser panel, call `preview_status`, then `preview_open` if it is
closed. Navigate to the complete startup pairing URL once with
`preview_navigate`, then use `preview_snapshot` and T3's interaction tools.
If the token was consumed or expired, run `node apps/server/src/bin.ts pair`
for a fresh one. Keep using the same tab.

## Verify and retain

Exercise the affected flow and capture the state that proves it works. Keep
the server, state, and panel available while the user inspects or iterates.
An assistant turn ending is not teardown. Stop only processes you started,
using retained terminal sessions or captured PIDs.

When sharing is requested, start with `vp run dev --share` and give the user
a fresh complete pairing URL that you have not consumed. Keep other credentials
out of screenshots, commits, and replies.
