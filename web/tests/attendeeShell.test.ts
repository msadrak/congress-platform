import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * UX-ATT-SHELL: the attendee shell and panel pages use the shared control sizes (ui/buttonStyles), not per-call
 * height classes, and keep their words in `copy/attendee.ts`.
 */
const SRC = join(new URL("..", import.meta.url).pathname, "src");

const SHELL_FILES = [
  "layouts/AttendeeLayout.tsx",
  "pages/Me.tsx",
  "pages/MyCongress.tsx",
  "pages/MyNetwork.tsx",
  "pages/MyProfile.tsx",
  "pages/CongressDetails.tsx",
  "components/attendee/CongressDetailsView.tsx",
  "components/attendee/CongressHomeView.tsx",
  "components/attendee/CongressSchedule.tsx",
  "components/attendee/ProgramExplorer.tsx",
  "components/attendee/PhaseBadge.tsx",
  "components/attendee/network/ContactCard.tsx",
  "components/attendee/network/MyCodePanel.tsx",
  "components/attendee/network/ScanPanel.tsx",
];

const OBSOLETE = /min-h-11|max-sm:min-h-\[52px\]/;

for (const file of SHELL_FILES) {
  test(`${file} carries no per-call button-height classes`, () => {
    const source = readFileSync(join(SRC, file), "utf8");
    assert.doesNotMatch(source, OBSOLETE);
  });
}

test("the attendee words live in copy/attendee.ts, not in the old per-page dictionaries", () => {
  for (const file of ["pages/Me.tsx", "layouts/AttendeeLayout.tsx"]) {
    const source = readFileSync(join(SRC, file), "utf8");
    assert.doesNotMatch(source, /const (COPY|SHELL_COPY)\b/, `${file} still defines its own dictionary`);
  }
});
