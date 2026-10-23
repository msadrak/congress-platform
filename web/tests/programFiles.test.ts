import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PROGRAM_FILE_BYTES,
  formatFileSize,
  labelFromFileName,
  precheckProgramFile,
  programFileErrorCode,
  reorderPatches,
} from "../src/lib/programFiles.ts";
import { eventTimeZone, programFilesOf } from "../src/api/lifecycleTypes.ts";

test("failed responses map to codes the screen localizes", () => {
  const pdf = { contentType: "application/pdf" };
  const png = { contentType: "image/png" };
  assert.equal(programFileErrorCode(413, "Schedule files are limited to 8 MB", pdf), "too_large");
  assert.equal(programFileErrorCode(415, "PDFs with scripts … are not accepted.", pdf), "rejected_pdf");
  assert.equal(programFileErrorCode(415, "The image could not be read", png), "rejected_image");
  assert.equal(programFileErrorCode(415, "Upload a PDF…", { contentType: "image/gif" }), "unsupported_type");
  assert.equal(programFileErrorCode(409, "An event can have at most 20 schedule files; delete one first", pdf), "limit_reached");
  assert.equal(programFileErrorCode(409, "This event is archived and read-only. Unarchive it to make changes.", pdf), "archived");
  assert.equal(programFileErrorCode(409, "This event is archived and read-only."), "archived");
  assert.equal(programFileErrorCode(422, "Give the schedule file a label", pdf), "label_required");
  assert.equal(programFileErrorCode(400, "The upload is empty", pdf), "empty");
  assert.equal(programFileErrorCode(401, ""), "unauthorized");
  assert.equal(programFileErrorCode(404, ""), "not_found");
  assert.equal(programFileErrorCode(0, ""), "network");
  assert.equal(programFileErrorCode(500, ""), "server");
});

test("files are checked before upload", () => {
  assert.equal(precheckProgramFile({ type: "application/pdf", size: 10 }, "  "), "label_required");
  assert.equal(precheckProgramFile({ type: "image/gif", size: 10 }, "Day 1"), "unsupported_type");
  assert.equal(precheckProgramFile({ type: "image/png", size: 0 }, "Day 1"), "empty");
  assert.equal(precheckProgramFile({ type: "image/webp", size: MAX_PROGRAM_FILE_BYTES + 1 }, "Day 1"), "too_large");
  assert.equal(precheckProgramFile({ type: "application/pdf", size: MAX_PROGRAM_FILE_BYTES }, "Day 1"), null);
});

test("a label is suggested from the file name", () => {
  assert.equal(labelFromFileName("Day_1_programme.pdf"), "Day 1 programme");
  assert.equal(labelFromFileName("برنامه روز اول.jpeg"), "برنامه روز اول");
  assert.equal(labelFromFileName("x".repeat(200) + ".png").length, 120);
});

test("reordering patches only the files whose position changes", () => {
  const files = [
    { id: "a", position: 0 },
    { id: "b", position: 1 },
    { id: "c", position: 2 },
  ];
  assert.deepEqual(reorderPatches(files, ["a", "c", "b"]), [
    { id: "c", position: 1 },
    { id: "b", position: 2 },
  ]);
  // Equal positions (older rows) are spread out on the first move.
  assert.deepEqual(reorderPatches([{ id: "a", position: 0 }, { id: "b", position: 0 }], ["b", "a"]), [{ id: "a", position: 1 }]);
});

test("sizes read in the organizer's language", () => {
  assert.equal(formatFileSize(1_250_000, "en"), "1.3 MB");
  assert.equal(formatFileSize(320_400, "en"), "320 KB");
  assert.equal(formatFileSize(12, "en"), "1 KB");
  assert.equal(formatFileSize(2_000_000, "fa"), "۲ مگابایت");
});

test("public payload helpers tolerate older servers", () => {
  assert.deepEqual(programFilesOf({}), []);
  assert.deepEqual(programFilesOf({ program_files: [{ id: "1", url: "/x", kind: "pdf" }, { id: 2 }, null] }), [{ id: "1", url: "/x", kind: "pdf" }]);
  assert.equal(eventTimeZone({}), "Asia/Tehran");
  assert.equal(eventTimeZone({ timezone: "Europe/Berlin" }), "Europe/Berlin");
});
