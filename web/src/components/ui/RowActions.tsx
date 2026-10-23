import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Button, IconButton } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon, type IconName } from "./Icon";
import { rovingTarget } from "./rovingKeys";
import { useUiCopy } from "./uiCopy";

export interface RowAction {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  disabled?: boolean;
  /**
   * Marks a destructive action. It is only ever offered inside the ⋯ menu, in danger text, and runs only
   * after this confirmation (title = a question, confirmLabel = the verb).
   */
  destructive?: { title: string; description?: string; confirmLabel: string };
}

export interface RowActionsProps {
  actions: readonly RowAction[];
  /** How many non-destructive actions show as buttons before the rest go into ⋯ (default 2). */
  visible?: 0 | 1 | 2;
  /** Accessible name of the ⋯ button; name the row, e.g. "More actions for Hall A". Defaults to «گزینه‌های بیشتر». */
  menuLabel?: string;
  className?: string;
}

const MENU_ITEM_HEIGHT = 44;

/**
 * The actions of one list or table row: up to two visible buttons, the rest in a ⋯ menu. Destructive items
 * live only in the menu and always ask for confirmation first.
 */
export function RowActions({ actions, visible = 2, menuLabel, className = "" }: RowActionsProps) {
  const { ref, copy } = useUiCopy<HTMLDivElement>();
  const safe = actions.filter((a) => !a.destructive);
  const shown = safe.slice(0, visible);
  const menu = [...safe.slice(visible), ...actions.filter((a) => a.destructive)];
  const [pending, setPending] = useState<RowAction | null>(null);

  function run(action: RowAction) {
    if (action.destructive) setPending(action);
    else action.onSelect();
  }

  return (
    <div ref={ref} className={`flex shrink-0 items-center justify-end gap-1.5 ${className}`.trim()}>
      {shown.map((action) => (
        <Button
          key={action.label}
          type="button"
          variant="secondary"
          size="sm"
          icon={action.icon}
          disabled={action.disabled}
          onClick={action.onSelect}
          className="pointer-coarse:min-h-(--control-md)"
        >
          {action.label}
        </Button>
      ))}
      {menu.length > 0 && <ActionMenu items={menu} label={menuLabel ?? copy.moreActions} onSelect={run} />}
      {pending?.destructive && (
        <ConfirmDialog
          isOpen
          tone="danger"
          title={pending.destructive.title}
          description={pending.destructive.description}
          confirmLabel={pending.destructive.confirmLabel}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const action = pending;
            setPending(null);
            action.onSelect();
          }}
        />
      )}
    </div>
  );
}

/** ⋯ button with a menu that opens below it (above when there is no room), clear of any clipping container. */
function ActionMenu({ items, label, onSelect }: { items: readonly RowAction[]; label: string; onSelect: (action: RowAction) => void }) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const [startAt, setStartAt] = useState<"first" | "last">("first");
  const open = position !== null;
  const disabled = items.map((item) => Boolean(item.disabled));

  function openMenu(from: "first" | "last") {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const rtl = getComputedStyle(trigger).direction === "rtl";
    const height = items.length * MENU_ITEM_HEIGHT + 12;
    const fitsBelow = window.innerHeight - rect.bottom >= height || rect.top < height;
    setStartAt(from);
    setPosition({
      position: "fixed",
      ...(fitsBelow ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }),
      // Align the menu's end edge with the button's end edge.
      ...(rtl ? { left: Math.max(8, rect.left) } : { right: Math.max(8, window.innerWidth - rect.right) }),
    });
  }

  function close(returnFocus: boolean) {
    setPosition(null);
    if (returnFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const enabled = itemRefs.current.filter((el): el is HTMLButtonElement => Boolean(el && !el.disabled));
    (startAt === "first" ? enabled[0] : enabled.at(-1))?.focus();
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setPosition(null);
    }
    function onViewportChange(event: Event) {
      if (event.type === "scroll" && menuRef.current?.contains(event.target as Node)) return;
      setPosition(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open, startAt]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const target = rovingTarget({ key: event.key, index: current, disabled, orientation: "vertical" });
    if (target === null) return;
    event.preventDefault();
    itemRefs.current[target]?.focus();
  }

  return (
    <>
      <IconButton
        ref={triggerRef}
        icon="more"
        label={label}
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu("first"))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(event.key === "ArrowDown" ? "first" : "last");
          }
        }}
      />
      {position && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          style={position}
          onKeyDown={onMenuKeyDown}
          className="z-50 min-w-48 max-w-[calc(100vw-1rem)] rounded-control border border-border-default bg-surface-panel p-1.5 shadow-pop motion-safe:animate-pop"
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => {
                close(true);
                onSelect(item);
              }}
              className={`flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-start text-body-sm font-medium hover:bg-surface-panel-subtle focus-visible:bg-surface-panel-subtle disabled:cursor-not-allowed disabled:opacity-50 ${
                item.destructive ? "text-status-danger-text" : "text-text-primary"
              }`}
            >
              {item.icon && <Icon name={item.icon} size={18} />}
              <span className="min-w-0 flex-1">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
