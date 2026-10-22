import React, { useEffect, useRef, useId, useState } from "react";
import { Icon } from "./Icon";

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Matches the *-out keyframes in index.css. */
const EXIT_MS = 180;

/** Open dialogs, innermost last: only the top one answers Escape and traps Tab. */
const openDialogs: symbol[] = [];

type DialogContent = Pick<DialogProps, "title" | "description" | "children">;

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = "md",
  className = "",
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const stackIdRef = useRef<symbol | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Stay mounted while the exit animation plays, showing the content as it was when open.
  const [present, setPresent] = useState(isOpen);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setPresent(true);
  }
  const closing = present && !isOpen;
  // Last open content, so callers that clear their data on close don't empty the sheet mid-exit.
  const [lastOpen, setLastOpen] = useState<DialogContent>({ title, description, children });
  if (isOpen && (lastOpen.title !== title || lastOpen.description !== description || lastOpen.children !== children)) {
    setLastOpen({ title, description, children });
  }

  useEffect(() => {
    if (!closing) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setPresent(false), reduced ? 0 : EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  // Save previous focus, lock body scroll, join the dialog stack.
  useEffect(() => {
    if (!isOpen) return;
    const stackId = Symbol("dialog");
    stackIdRef.current = stackId;
    openDialogs.push(stackId);
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // First control of the body (Cancel in a confirmation, the first field in a form), else the close button.
    const timer = setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      const target = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog;
      target.focus();
    }, 50);

    return () => {
      const index = openDialogs.indexOf(stackId);
      if (index >= 0) openDialogs.splice(index, 1);
      document.body.style.overflow = originalOverflow;
      clearTimeout(timer);
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === "function") {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [isOpen]);

  // Escape and focus trapping, for the top-most dialog only.
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (openDialogs[openDialogs.length - 1] !== stackIdRef.current) return;

      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!present) return null;
  const content: DialogContent = isOpen ? { title, description, children } : lastOpen;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-ink-950/55 backdrop-blur-[6px] reduced-transparency:bg-ink-950/85 ${
        closing ? "pointer-events-none motion-safe:animate-fade-out" : "motion-safe:animate-fade"
      }`}
      onClick={(e) => {
        if (!closing && e.target === e.currentTarget) {
          onClose();
        }
      }}
      aria-hidden={closing || undefined}
      inert={closing || undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={content.description ? descriptionId : undefined}
        tabIndex={-1}
        // Phones: a bottom sheet that rises from and returns to the bottom edge; larger screens: a centred pop.
        className={`relative w-full ${sizeClasses[size]} bg-surface-panel rounded-t-[28px] sm:rounded-2xl sm:[border-start-end-radius:var(--radius-arc)] border border-border-default shadow-pop overflow-hidden focus:outline-none pb-safe ${
          closing ? "max-sm:motion-safe:animate-sheet-out sm:motion-safe:animate-pop-out" : "max-sm:motion-safe:animate-sheet-in sm:motion-safe:animate-pop"
        } ${className}`}
      >
        {/* Brand hairline */}
        <div aria-hidden="true" className="h-[3px] w-full bg-[image:var(--grad-aiteb)]" />
        {/* Header */}
        <div className="px-5 pt-5 pb-4 sm:px-7 sm:pt-6 flex items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <h2 id={titleId} className="text-lg sm:text-xl font-bold tracking-tight text-text-primary">
              {content.title}
            </h2>
            {content.description && (
              <p id={descriptionId} className="text-sm text-text-secondary leading-relaxed">
                {content.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            // Dialogs render inside each portal's dir wrapper: name the close button in that page's language.
            ref={(el) => el?.setAttribute("aria-label", el.closest('[dir="rtl"]') ? "بستن" : "Close dialog")}
            className="shrink-0 grid place-items-center size-11 sm:size-10 -me-2 -mt-1.5 rounded-full text-text-muted hover:text-text-primary hover:bg-surface-panel-subtle transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div ref={bodyRef} className="px-5 pb-6 sm:px-7 sm:pb-7 max-h-[calc(88dvh-7rem)] overflow-y-auto overscroll-contain">
          {content.children}
        </div>
      </div>
    </div>
  );
}
