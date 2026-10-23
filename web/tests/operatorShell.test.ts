import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { operatorCopy, type OperatorGateKind, type OperatorStatus, type VerdictTone } from "../src/copy/operator.ts";
import { menuFocusIndex } from "../src/components/operator/menuKeys.ts";

register("./support/tsxLoader.mjs", import.meta.url);
const { StatusPill } = await import("../src/components/operator/StatusPill.tsx");
const { VerdictBanner } = await import("../src/components/operator/VerdictBanner.tsx");
const { OperatorMenu } = await import("../src/components/operator/OperatorMenu.tsx");
const { OperatorGate } = await import("../src/components/operator/OperatorGate.tsx");
const { OperatorBar } = await import("../src/components/operator/OperatorBar.tsx");
const { Toast } = await import("../src/components/ui/Toast.tsx");

const html = (element: ReactElement) => renderToStaticMarkup(element);
/** Visible text of rendered markup. */
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const LATIN_DIGIT = /[0-9]/;
const PERSIAN_LETTER = /[؀-ۿ]/;

test("StatusPill maps every state to one word in fa and en", () => {
  const expected: Record<OperatorStatus, [string, string]> = {
    online: ["آنلاین", "Online"],
    offline: ["آفلاین", "Offline"],
    syncing: ["در حال ارسال…", "Sending…"],
    queued: ["۰ در صف", "0 queued"],
    conflicts: ["۰ تداخل", "0 conflicts"],
    archived: ["بایگانی‌شده", "Archived"],
    update: ["نسخهٔ تازه", "New version"],
  };
  for (const [status, [fa, en]] of Object.entries(expected) as [OperatorStatus, [string, string]][]) {
    const faMarkup = html(createElement(StatusPill, { locale: "fa", status }));
    assert.equal(text(faMarkup), fa, status);
    assert.match(faMarkup, new RegExp(`data-status="${status}"`));
    assert.match(faMarkup, /role="status"/);
    assert.equal(text(html(createElement(StatusPill, { locale: "en", status }))), en, status);
  }
});

test("StatusPill counts use Persian digits in fa", () => {
  const queued = text(html(createElement(StatusPill, { locale: "fa", status: "queued", count: 1500 })));
  assert.equal(queued, "۱٬۵۰۰ در صف");
  assert.doesNotMatch(queued, LATIN_DIGIT);
  assert.equal(text(html(createElement(StatusPill, { locale: "fa", status: "conflicts", count: 2 }))), "۲ تداخل");
  assert.equal(text(html(createElement(StatusPill, { locale: "en", status: "conflicts", count: 1 }))), "1 conflict");
  assert.equal(text(html(createElement(StatusPill, { locale: "en", status: "conflicts", count: 3 }))), "3 conflicts");
});

test("StatusPill offline adds the queue only when something waits, and takes a detail", () => {
  assert.equal(text(html(createElement(StatusPill, { locale: "fa", status: "offline", count: 0 }))), "آفلاین");
  assert.equal(text(html(createElement(StatusPill, { locale: "fa", status: "offline", count: 3 }))), "آفلاین، ۳ در صف");
  assert.equal(text(html(createElement(StatusPill, { locale: "en", status: "offline", count: 3 }))), "Offline · 3 queued");
  assert.equal(text(html(createElement(StatusPill, { locale: "fa", status: "offline", detail: "۱:۴۵ مانده" }))), "آفلاین، ۱:۴۵ مانده");
  assert.equal(text(html(createElement(StatusPill, { locale: "fa", status: "archived", detail: "فقط مشاهده" }))), "بایگانی‌شده، فقط مشاهده");
});

test("StatusPill with onClick is a button, not a live region", () => {
  const markup = html(createElement(StatusPill, { locale: "fa", status: "conflicts", count: 2, onClick: () => {} }));
  assert.match(markup, /^<button type="button"/);
  assert.doesNotMatch(markup, /role="status"/);
});

test("VerdictBanner: refusals are assertive alerts, the rest polite status", () => {
  const roles: Record<VerdictTone, [string, string]> = {
    admitted: ["status", "polite"],
    "admitted-offline": ["status", "polite"],
    exit: ["status", "polite"],
    info: ["status", "polite"],
    duplicate: ["alert", "assertive"],
    rejected: ["alert", "assertive"],
  };
  for (const [tone, [role, live]] of Object.entries(roles) as [VerdictTone, [string, string]][]) {
    const markup = html(createElement(VerdictBanner, { locale: "fa", tone }));
    assert.match(markup, new RegExp(`^<div role="${role}" aria-live="${live}" aria-atomic="true" data-tone="${tone}"`), tone);
    assert.match(markup, new RegExp(`op-verdict--${tone}`));
    assert.ok(text(markup).includes(operatorCopy.fa.verdict[tone]), tone);
    assert.ok(text(html(createElement(VerdictBanner, { locale: "en", tone }))).includes(operatorCopy.en.verdict[tone]), tone);
  }
});

test("VerdictBanner shows the name isolated, the reason, and the layout", () => {
  const markup = html(
    createElement(VerdictBanner, { locale: "fa", tone: "rejected", name: "Sara Ahmadi", reason: "کارت ورود لغو شده است", layout: "stage" }),
  );
  assert.match(markup, /<bdi>Sara Ahmadi<\/bdi>/);
  assert.match(markup, /op-verdict-reason">کارت ورود لغو شده است</);
  assert.match(markup, /op-verdict--stage/);
  const custom = html(createElement(VerdictBanner, { locale: "en", tone: "info", title: "Already a lead" }));
  assert.match(custom, /op-verdict-title">Already a lead</);
  assert.match(custom, /op-verdict--inline/);
});

test("OperatorMenu keyboard: arrows wrap, Home and End jump, other keys do nothing", () => {
  assert.equal(menuFocusIndex("ArrowDown", 0, 3), 1);
  assert.equal(menuFocusIndex("ArrowDown", 2, 3), 0);
  assert.equal(menuFocusIndex("ArrowUp", 0, 3), 2);
  assert.equal(menuFocusIndex("ArrowUp", 2, 3), 1);
  assert.equal(menuFocusIndex("ArrowDown", -1, 3), 0);
  assert.equal(menuFocusIndex("ArrowUp", -1, 3), 2);
  assert.equal(menuFocusIndex("Home", 2, 3), 0);
  assert.equal(menuFocusIndex("End", 0, 3), 2);
  assert.equal(menuFocusIndex("ArrowLeft", 1, 3), null);
  assert.equal(menuFocusIndex("a", 1, 3), null);
  assert.equal(menuFocusIndex("ArrowDown", 0, 0), null);
});

test("OperatorMenu renders a closed menu button with a localized name", () => {
  const items = [{ id: "lang", label: "English", lang: "en", onSelect: () => {} }];
  const fa = html(createElement(OperatorMenu, { locale: "fa", items }));
  assert.match(fa, /aria-label="منو"/);
  assert.match(fa, /aria-haspopup="menu"/);
  assert.match(fa, /aria-expanded="false"/);
  assert.doesNotMatch(fa, /role="menu"/);
  assert.match(html(createElement(OperatorMenu, { locale: "en", items })), /aria-label="Menu"/);
});

test("OperatorGate: every kind has a 2–4 word title and one line in fa and en", () => {
  const kinds = Object.keys(operatorCopy.fa.gate) as OperatorGateKind[];
  assert.equal(kinds.length, 9);
  for (const locale of ["fa", "en"] as const) {
    for (const kind of kinds) {
      const { title, body } = operatorCopy[locale].gate[kind];
      const words = title.trim().split(/\s+/).length;
      assert.ok(words >= 2 && words <= 4, `${locale} ${kind}: «${title}»`);
      assert.ok((body.match(/[.!?؟]/g) ?? []).length <= 1, `${locale} ${kind} body is one sentence`);
      assert.equal(PERSIAN_LETTER.test(title + body), locale === "fa", `${locale} ${kind} language`);
    }
  }
});

test("OperatorGate renders direction, title, line, action and folded details", () => {
  const markup = html(
    createElement(OperatorGate, {
      locale: "fa",
      kind: "revoked",
      tone: "ink",
      action: createElement("button", { type: "button" }, "اسکن کد QR اتصال"),
      details: "v1.2.3",
    }),
  );
  assert.match(markup, /^<div dir="rtl" lang="fa" data-gate="revoked"/);
  assert.match(markup, new RegExp(`<h1[^>]*>${operatorCopy.fa.gate.revoked.title}</h1>`));
  assert.ok(text(markup).includes(operatorCopy.fa.gate.revoked.body));
  assert.match(markup, /<details[^>]*><summary[^>]*><span>جزئیات فنی<\/span>/);
  assert.match(markup, />اسکن کد QR اتصال<\/button>/);

  const en = html(createElement(OperatorGate, { locale: "en", kind: "signIn", title: "Desk sign-in", body: null }));
  assert.match(en, /^<div dir="ltr" lang="en"/);
  assert.match(en, />Desk sign-in<\/h1>/);
  assert.ok(!text(en).includes(operatorCopy.en.gate.signIn.body));
  assert.doesNotMatch(en, /<details/);
});

test("OperatorBar puts the title in a one-line h1 with the status and menu at the end", () => {
  const markup = html(
    createElement(OperatorBar, {
      title: "درِ اصلی",
      subtitle: "همایش قلب ۱۴۰۵",
      status: createElement(StatusPill, { locale: "fa", status: "online" }),
      menu: createElement(OperatorMenu, { locale: "fa", items: [] }),
    }),
  );
  assert.match(markup, /^<header class="sticky top-0[^"]*pt-safe/);
  assert.match(markup, /class="[^"]*h-14[^"]*"/);
  assert.match(markup, /<h1 class="truncate[^"]*" title="درِ اصلی">درِ اصلی<\/h1>/);
  assert.ok(markup.indexOf("آنلاین") < markup.indexOf('aria-haspopup="menu"'));
});

test("Toast is one polite line with an optional action and a named close button", () => {
  const plain = html(createElement(Toast, { message: "لید ثبت شد.", dismissLabel: "بستن", onDismiss: () => {} }));
  assert.match(plain, /role="status" aria-live="polite" data-testid="toast"/);
  assert.match(plain, /aria-label="بستن"/);
  assert.equal((plain.match(/<button/g) ?? []).length, 1);

  const undo = html(
    createElement(Toast, {
      message: "Lead moved to trash.",
      dismissLabel: "Close",
      onDismiss: () => {},
      action: { label: "Undo", onClick: () => {}, busy: true },
      testId: "undo-toast",
    }),
  );
  assert.match(undo, /data-testid="undo-toast"/);
  assert.match(undo, /disabled="" aria-busy="true"[^>]*>Undo<\/button>/);
  assert.equal((undo.match(/<button/g) ?? []).length, 2);
});

test("Persian operator copy never uses «·», which reads as the digit zero «۰»", () => {
  const strings: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") strings.push(value);
    else if (typeof value === "function") strings.push(String(value("۳", 3)));
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(operatorCopy.fa);
  assert.ok(strings.length > 30);
  for (const value of strings) assert.ok(!value.includes("·"), value);
});
