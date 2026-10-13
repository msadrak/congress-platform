import React, { useEffect, useRef, useId } from "react";
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
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Save previous focus and lock body scroll
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      // Focus first focusable element or dialog container
      const timer = setTimeout(() => {
        if (dialogRef.current) {
          const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length > 0) {
            focusable[0].focus();
          } else {
            dialogRef.current.focus();
          }
        }
      }, 50);

      return () => {
        document.body.style.overflow = originalOverflow;
        clearTimeout(timer);
        if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === "function") {
          previouslyFocusedRef.current.focus();
        }
      };
    }
  }, [isOpen]);

  // Handle Escape key and Focus Trapping
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-ink-950/55 backdrop-blur-[6px] motion-safe:animate-fade"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      aria-hidden={!isOpen}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative w-full ${sizeClasses[size]} bg-surface-panel rounded-t-[28px] sm:rounded-2xl sm:[border-start-end-radius:var(--radius-arc)] border border-border-default shadow-pop overflow-hidden focus:outline-none motion-safe:animate-pop pb-safe ${className}`}
      >
        {/* Brand hairline */}
        <div aria-hidden="true" className="h-[3px] w-full bg-[image:var(--grad-aiteb)]" />
        {/* Header */}
        <div className="px-5 pt-5 pb-4 sm:px-7 sm:pt-6 flex items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <h2 id={titleId} className="text-lg sm:text-xl font-bold tracking-tight text-text-primary">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="text-sm text-text-secondary leading-relaxed">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="shrink-0 grid place-items-center size-10 -me-2 -mt-1.5 rounded-full text-text-muted hover:text-text-primary hover:bg-surface-panel-subtle transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="px-5 pb-6 sm:px-7 sm:pb-7 max-h-[calc(88dvh-7rem)] overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );
}
