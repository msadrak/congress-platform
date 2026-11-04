import React, { useEffect, useRef, useId, useState } from "react";
import { IconButton } from "./Button";
import { useUiCopy } from "./uiCopy";

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** One sentence stating the consequence; never a restatement of the title. */
  description?: string;
  children: React.ReactNode;
  /**
   * Width on larger screens. On phones every dialog is a bottom sheet; `full` makes it a full-height sheet
   * for long forms (the body scrolls, `footer` stays visible above the keyboard).
   */
  size?: "sm" | "md" | "lg" | "full";
  /** Actions pinned under the scrolling body (Cancel / Save). */
  footer?: React.ReactNode;
  /** Accessible name of the ✕ button; defaults to «بستن» / "Close". */
  closeLabel?: string;
  /** `ink` for dialogs over the scanner. */
  tone?: "default" | "ink";
  className?: string;
}

const sizeClasses = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-xl",
  full: "max-sm:h-[calc(100dvh-1rem)] max-sm:max-h-none sm:max-w-2xl",
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Matches the *-out keyframes in index.css. */
const EXIT_MS = 180;

/** Open dialogs, innermost last: only the top one answers Escape and traps Tab. */
const openDialogs: symbol[] = [];

type DialogContent = Pick<DialogProps, "title" | "description" | "children" | "footer">;

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = "md",
  footer,
  closeLabel,
  tone = "default",
  className = "",
}: DialogProps) {
  const { ref: copyRef, copy } = useUiCopy<HTMLDivElement>();
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
  const [lastOpen, setLastOpen] = useState<DialogContent>({ title, description, children, footer });
  if (
    isOpen &&
    (lastOpen.title !== title || lastOpen.description !== description || lastOpen.children !== children || lastOpen.footer !== footer)
  ) {
    setLastOpen({ title, description, children, footer });
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
  const content: DialogContent = isOpen ? { title, description, children, footer } : lastOpen;
  const ink = tone === "ink";

  return (
    <div
      ref={copyRef}
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
        // Phones: a bottom sheet (24 px top corners, safe-area padded) that rises from and returns to the
        // bottom edge; larger screens: a centred pop with the 20 px dialog radius.
        className={`relative flex w-full max-h-[88dvh] flex-col ${sizeClasses[size]} rounded-t-3xl sm:rounded-2xl border shadow-pop overflow-hidden focus:outline-none pb-safe ${
          ink ? "surface-ink bg-surface-ink border-white/10 text-white" : "bg-surface-panel border-border-default"
        } ${
          closing ? "max-sm:motion-safe:animate-sheet-out sm:motion-safe:animate-pop-out" : "max-sm:motion-safe:animate-sheet-in sm:motion-safe:animate-pop"
        } ${className}`}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 sm:px-7 sm:pt-6 flex items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <h2 id={titleId} className={`text-title-sm font-bold tracking-tight ${ink ? "text-white" : "text-text-primary"}`}>
              {content.title}
            </h2>
            {content.description && (
              <p id={descriptionId} className={`text-body-sm leading-relaxed ${ink ? "text-white/75" : "text-text-secondary"}`}>
                {content.description}
              </p>
            )}
          </div>
          <IconButton icon="x" label={closeLabel ?? copy.close} tone={tone} onClick={onClose} className="-me-2 -mt-1.5 rounded-full" />
        </div>

        {/* Content Body */}
        <div ref={bodyRef} className={`min-h-0 flex-1 px-5 sm:px-7 overflow-y-auto overscroll-contain ${content.footer ? "pb-4" : "pb-6 sm:pb-7"}`}>
          {content.children}
        </div>
        {content.footer && (
          <div className={`flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end sm:px-7 ${ink ? "border-white/10" : "border-border-subtle"}`}>
            {content.footer}
          </div>
        )}
      </div>
    </div>
  );
}
