import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { operatorCopy, type OperatorLocale } from "../../copy/operator";
import { Icon, type IconName } from "../ui/Icon";
import { menuFocusIndex } from "./menuKeys";

export interface OperatorMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  icon?: IconName;
  /** Destructive (sign out, unpair): red text. The caller still confirms it. */
  danger?: boolean;
  disabled?: boolean;
  /** Short trailing text, e.g. «پس از ارسال صف» on a waiting update. */
  hint?: string;
  /** Language of the label, when it is not the screen's (the language item is written in its target language). */
  lang?: string;
  /** Draws a divider above this item. */
  divider?: boolean;
}

export interface OperatorMenuProps {
  locale: OperatorLocale;
  items: OperatorMenuItem[];
  /** Non-interactive line on top, e.g. the operator's name. */
  header?: ReactNode;
  /** App version, shown last, Latin and left-to-right. */
  version?: string;
  /** Surface the trigger sits on. */
  tone?: "light" | "ink";
}

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';

/**
 * The ⋮ menu of the operator bar: a bottom sheet on phones, a popover under the button from 768 px. It renders in
 * a portal, so the sticky bar's stacking never hides it. Arrow keys, Home and End move between items; Escape and
 * Tab close it and return focus to the button.
 */
export function OperatorMenu({ locale, items, header, version, tone = "light" }: OperatorMenuProps) {
  const copy = operatorCopy[locale];
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<"first" | "last">("first");
  // Popover position (from 768 px), measured from the button when the menu opens.
  const [anchor, setAnchor] = useState({ top: 0, end: 0 });

  function menuItems(): HTMLElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const list = menuItems();
    (focusOnOpen.current === "last" ? list[list.length - 1] : list[0])?.focus();

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && (menuRef.current?.contains(target) || triggerRef.current?.contains(target))) return;
      setOpen(false);
    }
    // The popover is placed once; a rotation or resize closes it rather than leaving it adrift.
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  function openWith(focus: "first" | "last") {
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const rtl = getComputedStyle(trigger).direction === "rtl";
      setAnchor({ top: rect.bottom + 8, end: rtl ? rect.left : window.innerWidth - rect.right });
    }
    focusOnOpen.current = focus;
    setOpen(true);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openWith(event.key === "ArrowUp" ? "last" : "first");
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      close(true);
      return;
    }
    const list = menuItems();
    const current = list.findIndex((element) => element === document.activeElement);
    const next = menuFocusIndex(event.key, current, list.length);
    if (next === null) return;
    event.preventDefault();
    list[next]?.focus();
  }

  function select(item: OperatorMenuItem) {
    if (item.disabled) return;
    // Focus goes back first, so a dialog the item opens returns focus to the ⋮ button when it closes.
    close(true);
    item.onSelect();
  }

  const triggerLook =
    tone === "ink"
      ? "text-white hover:bg-white/10 focus-visible:outline-aiteb-orchid"
      : "text-text-secondary hover:bg-surface-panel-subtle hover:text-text-primary";

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={copy.menu.open}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openWith("first"))}
        onKeyDown={onTriggerKeyDown}
        className={`grid size-11 place-items-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 cursor-pointer ${triggerLook}`}
      >
        <svg viewBox="0 0 24 24" width={22} height={22} fill="currentColor" aria-hidden="true" focusable="false">
          <circle cx="12" cy="5" r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="12" cy="19" r="1.9" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div dir={locale === "fa" ? "rtl" : "ltr"} lang={locale}>
            {/* Scrim for the phone sheet; the popover needs none. */}
            <div aria-hidden="true" className="fixed inset-0 z-50 bg-ink-950/45 md:hidden" />
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={copy.menu.open}
              onKeyDown={onMenuKeyDown}
              style={{ "--op-menu-top": `${anchor.top}px`, "--op-menu-end": `${anchor.end}px` } as CSSProperties}
              className="fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-3xl border border-border-default bg-surface-panel pb-safe text-text-primary shadow-pop md:inset-x-auto md:top-(--op-menu-top) md:bottom-auto md:end-(--op-menu-end) md:w-72 md:rounded-2xl"
            >
              <div className="py-2">
                {header && <div className="px-4 pt-1 pb-2 text-sm text-text-secondary">{header}</div>}
                {items.map((item) => (
                  <div key={item.id}>
                    {item.divider && <div role="separator" className="my-1.5 border-t border-border-subtle" />}
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      lang={item.lang}
                      aria-disabled={item.disabled || undefined}
                      onClick={() => select(item)}
                      className={`flex min-h-12 w-full items-center gap-3 px-4 py-2 text-start text-base font-medium hover:bg-surface-panel-subtle focus:bg-surface-panel-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 md:min-h-11 md:text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-55 cursor-pointer ${
                        item.danger ? "text-status-danger-text" : "text-text-primary"
                      }`}
                    >
                      {item.icon && <Icon name={item.icon} size={18} className={item.danger ? "" : "text-text-muted"} />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        {item.hint && <span className="block text-xs font-normal text-text-muted">{item.hint}</span>}
                      </span>
                    </button>
                  </div>
                ))}
                {version && (
                  <p className="mt-1.5 border-t border-border-subtle px-4 pt-2.5 pb-1 text-xs text-text-muted">
                    {copy.menu.version}{" "}
                    <bdi dir="ltr" className="font-mono">
                      {version}
                    </bdi>
                  </p>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
