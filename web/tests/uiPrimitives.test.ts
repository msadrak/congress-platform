import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fieldWiring } from "../src/components/ui/fieldA11y.ts";
import { rovingTarget } from "../src/components/ui/rovingKeys.ts";
import { buttonClassName, buttonStateProps } from "../src/components/ui/buttonStyles.ts";

// Compile the .tsx primitives on import (see uiTsxHooks.mjs), then render them to markup.
register("./uiTsxHooks.mjs", import.meta.url);
const { Field } = await import("../src/components/ui/Field.tsx");
const { TextInput, Select } = await import("../src/components/ui/Input.tsx");
const { Button } = await import("../src/components/ui/Button.tsx");
const { SegmentedControl } = await import("../src/components/ui/SegmentedControl.tsx");
const { ConfirmDialog } = await import("../src/components/ui/ConfirmDialog.tsx");
const { Notice } = await import("../src/components/ui/Notice.tsx");
const { Icon } = await import("../src/components/ui/Icon.tsx");

/** Attributes of the first `<tag …>` in the markup. */
function attrs(markup: string, tag: string): Record<string, string> {
  const match = new RegExp(`<${tag}\\b([^>]*)>`).exec(markup);
  assert.ok(match, `no <${tag}> in ${markup}`);
  const out: Record<string, string> = {};
  for (const [, name, value] of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) out[name] = value;
  return out;
}

function idOfElementContaining(markup: string, text: string): string | undefined {
  const index = markup.indexOf(text);
  const open = markup.lastIndexOf("<p ", index);
  return /id="([^"]+)"/.exec(markup.slice(open, index))?.[1];
}

test("Field links its hint to the control while there is no error", () => {
  const markup = renderToStaticMarkup(h(Field, { label: "Mobile", hint: "11 digits" }, h(TextInput, {})));
  const input = attrs(markup, "input");
  assert.equal(input["aria-describedby"], idOfElementContaining(markup, "11 digits"));
  assert.equal(input["aria-invalid"], undefined);
});

test("Field: the error replaces the hint, describes the control and marks it invalid", () => {
  const markup = renderToStaticMarkup(
    h(Field, { label: "Mobile", hint: "11 digits", error: "Enter a valid mobile number" }, h(TextInput, {}))
  );
  const input = attrs(markup, "input");
  assert.equal(input["aria-invalid"], "true");
  assert.ok(input.id, "the control gets an id");
  assert.equal(input["aria-describedby"], idOfElementContaining(markup, "Enter a valid mobile number"));
  assert.equal(input["aria-describedby"], `${input.id}-error`);
  assert.ok(!markup.includes("11 digits"), "the hint is hidden while the error shows");
});

test("Field keeps the control's own id and aria-describedby, and works for a Select", () => {
  const markup = renderToStaticMarkup(
    h(Field, { label: "Zone", error: "Pick a zone", required: true }, h(Select, { id: "zone", "aria-describedby": "zone-note" }, h("option", {}, "A")))
  );
  const select = attrs(markup, "select");
  assert.equal(select.id, "zone");
  assert.equal(select["aria-describedby"], "zone-note zone-error");
  assert.equal(select["aria-invalid"], "true");
  assert.equal(select["aria-required"], "true");
});

test("fieldWiring: no hint and no error means no description", () => {
  assert.deepEqual(fieldWiring({ id: "f", hasHint: false, hasError: false }), {
    hintId: undefined,
    errorId: undefined,
    controlProps: { id: "f" },
  });
});

test("Button: loading sets aria-busy, keeps the label for width and ignores activation", () => {
  const busy = attrs(renderToStaticMarkup(h(Button, { loading: true }, "Save")), "button");
  assert.equal(busy["aria-busy"], "true");
  assert.equal(busy["aria-disabled"], "true");
  assert.ok(renderToStaticMarkup(h(Button, { loading: true }, "Save")).includes("Save"));
  const idle = attrs(renderToStaticMarkup(h(Button, {}, "Save")), "button");
  assert.equal(idle["aria-busy"], undefined);
  assert.deepEqual(buttonStateProps({ loading: true, disabled: true }), { disabled: true, "aria-busy": true });
});

test("Button sizes use the 40/48/56 control tokens and the 12 px control radius", () => {
  assert.match(buttonClassName({ size: "sm" }), /min-h-\(--control-sm\)!/);
  assert.match(buttonClassName({ size: "md" }), /min-h-\(--control-md\)/);
  assert.match(buttonClassName({ size: "lg" }), /min-h-\(--control-lg\)/);
  assert.match(buttonClassName({ size: "xl" }), /min-h-\(--control-lg\)/);
  for (const size of ["sm", "md", "lg", "xl"] as const) assert.match(buttonClassName({ size }), /\brounded-control!/);
});

test("SegmentedControl arrow keys follow the visual order and wrap", () => {
  const none = [false, false, false];
  assert.equal(rovingTarget({ key: "ArrowRight", index: 0, disabled: none }), 1);
  assert.equal(rovingTarget({ key: "ArrowLeft", index: 0, disabled: none }), 2);
  // RTL: the next option sits to the left.
  assert.equal(rovingTarget({ key: "ArrowLeft", index: 0, disabled: none, rtl: true }), 1);
  assert.equal(rovingTarget({ key: "ArrowRight", index: 0, disabled: none, rtl: true }), 2);
  assert.equal(rovingTarget({ key: "ArrowDown", index: 2, disabled: none }), 0);
  assert.equal(rovingTarget({ key: "End", index: 0, disabled: none }), 2);
  assert.equal(rovingTarget({ key: "Home", index: 2, disabled: none }), 0);
  assert.equal(rovingTarget({ key: "ArrowRight", index: 0, disabled: [false, true, false] }), 2, "skips disabled");
  assert.equal(rovingTarget({ key: "Enter", index: 0, disabled: none }), null);
  assert.equal(rovingTarget({ key: "ArrowRight", index: 0, disabled: none, orientation: "vertical" }), null);
});

test("SegmentedControl is a radiogroup with one tab stop on the selected option", () => {
  const markup = renderToStaticMarkup(
    h(SegmentedControl, {
      label: "View",
      value: "list",
      onChange: () => {},
      options: [
        { value: "grid", label: "Grid" },
        { value: "list", label: "List" },
      ],
    })
  );
  assert.match(markup, /role="radiogroup"[^>]*aria-label="View"/);
  const radios = [...markup.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1]);
  assert.equal(radios.length, 2);
  assert.match(radios[0], /aria-checked="false"/);
  assert.match(radios[0], /tabindex="-1"/);
  assert.match(radios[1], /aria-checked="true"/);
  assert.match(radios[1], /tabindex="0"/);
});

test("ConfirmDialog requires confirmLabel and has no generic confirm word", async () => {
  const ts = (await import("typescript")).default;
  const root = new URL("../src/", import.meta.url).pathname;
  const probe = `${root}__confirm_probe.tsx`;
  const sources: Record<string, string> = {
    [probe]: `import { ConfirmDialog } from "./components/ui/ConfirmDialog";
      export const missing = <ConfirmDialog isOpen title="Delete?" onConfirm={() => {}} onCancel={() => {}} />;
      export const given = <ConfirmDialog isOpen title="Delete?" confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />;`,
  };
  const options = {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
    types: [],
    skipLibCheck: true,
    noEmit: true,
    allowImportingTsExtensions: true,
  };
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (name) => name in sources || fileExists(name);
  host.readFile = (name) => sources[name] ?? readFile(name);
  host.getSourceFile = (name, version) =>
    name in sources ? ts.createSourceFile(name, sources[name], version) : getSourceFile(name, version);
  const program = ts.createProgram([probe], options, host);
  const errors = ts.getPreEmitDiagnostics(program, program.getSourceFile(probe)).map((d) => ({
    line: program.getSourceFile(probe)!.getLineAndCharacterOfPosition(d.start ?? 0).line,
    text: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  }));
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.equal(errors[0].line, 1);
  assert.match(errors[0].text, /confirmLabel/);

  const markup = renderToStaticMarkup(
    h(ConfirmDialog, { isOpen: true, title: "Delete?", confirmLabel: "Delete", onConfirm: () => {}, onCancel: () => {} })
  );
  assert.ok(markup.includes(">Delete<"));
  assert.ok(!markup.includes("تأیید") && !markup.includes("تایید"));
});

test("Notice announces danger assertively and everything else politely", () => {
  assert.match(renderToStaticMarkup(h(Notice, { tone: "danger" }, "Failed")), /role="alert"/);
  assert.match(renderToStaticMarkup(h(Notice, { tone: "error" }, "Failed")), /role="alert"/);
  for (const tone of ["info", "success", "warning", "ok"] as const) {
    assert.match(renderToStaticMarkup(h(Notice, { tone }, "Saved")), /role="status"/);
  }
});

test("Icon mirrors back/forward glyphs and the login/logout pair in RTL, never clocks or media", () => {
  for (const name of ["arrow-left", "chevron-right", "login", "logout"] as const) {
    assert.match(renderToStaticMarkup(h(Icon, { name })), /rtl:-scale-x-100/, name);
  }
  for (const name of ["clock", "play", "pause", "sync", "upload", "chevron-down"] as const) {
    assert.doesNotMatch(renderToStaticMarkup(h(Icon, { name })), /rtl:-scale-x-100/, name);
  }
});
