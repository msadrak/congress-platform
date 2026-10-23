import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { organizerSharedCopy } from "../src/copy/organizerShared.ts";

// Compile the .tsx components on import (see support/tsxLoader.mjs), then render them to markup.
register("./support/tsxLoader.mjs", import.meta.url);
const { SectionHeader, FormAlert, EventStatusBadge } = await import("../src/components/organizer/WorkspaceUi.tsx");
const { RolePicker } = await import("../src/components/organizer/RolePicker.tsx");

test("SectionHeader: the title and one action; no index, eyebrow or description", () => {
  const markup = renderToStaticMarkup(
    h(SectionHeader, { index: 4, eyebrow: "Alpha Congress", title: "Ticket types", description: "A long sentence.", action: h("button", {}, "Add") }),
  );
  assert.match(markup, /<h1[^>]*>Ticket types<\/h1>/);
  assert.match(markup, /<button>Add<\/button>/);
  for (const gone of ["04", "Alpha Congress", "A long sentence."]) assert.ok(!markup.includes(gone), `${gone} is not shown`);
});

test("SectionHeader as h2 keeps its title id", () => {
  const markup = renderToStaticMarkup(h(SectionHeader, { as: "h2", title: "Members", titleId: "members-title" }));
  assert.match(markup, /<h2 id="members-title"[^>]*>Members<\/h2>/);
});

test("FormAlert is announced as an alert; the status badge speaks the page language", () => {
  assert.match(renderToStaticMarkup(h(FormAlert, {}, "Failed")), /role="alert"/);
  assert.ok(renderToStaticMarkup(h(EventStatusBadge, { status: "in-progress", isRtl: true })).includes(organizerSharedCopy.fa.eventStatus["in-progress"]));
  assert.ok(renderToStaticMarkup(h(EventStatusBadge, { status: "ended", isRtl: false })).includes("Ended"));
});

test("RolePicker: one radio card per role with its meaning, the current role checked", () => {
  const markup = renderToStaticMarkup(h(RolePicker, { value: "staff", onChange: () => undefined, locale: "en" }));
  const radios = [...markup.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(([tag]) => tag);
  assert.deepEqual(
    radios.map((tag) => /value="(\w+)"/.exec(tag)?.[1]),
    ["owner", "manager", "staff", "viewer"],
  );
  assert.deepEqual(radios.map((tag) => tag.includes("checked")), [false, false, true, false]);
  assert.ok(markup.includes("<legend"), "the group is labelled");
  for (const tag of radios) {
    const describedBy = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
    assert.ok(describedBy && markup.includes(`id="${describedBy}"`), "each option is described by its meaning");
  }
  assert.ok(markup.includes("Reception, scanners and participant lookup"));
  // Closed: no confirmation is rendered until a different role is picked.
  assert.ok(!markup.includes('role="dialog"'));
});

test("RolePicker offers only the roles it is given, in Persian too", () => {
  const markup = renderToStaticMarkup(h(RolePicker, { value: "viewer", onChange: () => undefined, locale: "fa", roles: ["staff", "viewer"], busy: true }));
  assert.equal([...markup.matchAll(/type="radio"/g)].length, 2);
  assert.match(markup, /<fieldset[^>]*disabled/);
  assert.ok(markup.includes(organizerSharedCopy.fa.role.legend));
});

test("the role confirmation names the member and the new role", () => {
  assert.equal(organizerSharedCopy.en.role.confirmTitle("Manager", "Sara"), "Change Sara's role to Manager?");
  assert.equal(organizerSharedCopy.fa.role.confirmTitle("مدیر"), "نقش به «مدیر» تغییر کند؟");
});
