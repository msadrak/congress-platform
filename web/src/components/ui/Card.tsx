import React from "react";

export type CardTone = "panel" | "subtle" | "lavender" | "ink";

const toneStyles: Record<CardTone, string> = {
  panel: "bg-surface-panel border-border-default shadow-soft",
  subtle: "bg-surface-panel-subtle border-border-subtle",
  lavender: "bg-aiteb-lavender border-action-subtle-border",
  ink: "bg-surface-ink border-white/10 text-white shadow-lift",
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  isHoverable?: boolean;
  tone?: CardTone;
  /** `arc` gives the signature quarter-arc corner (mirrors in RTL). */
  shape?: "default" | "arc";
}

export function Card({ isHoverable = false, tone = "panel", shape = "default", className = "", children, ...props }: CardProps) {
  const hoverClass = isHoverable
    ? "transition-[border-color,box-shadow,transform] duration-300 ease-[var(--ease-arc)] hover:border-border-strong hover:shadow-lift motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none"
    : "";
  const shapeClass = shape === "arc" ? "shape-arc" : "rounded-2xl";

  return (
    <div className={`border overflow-hidden ${toneStyles[tone]} ${shapeClass} ${hoverClass} ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`p-5 sm:p-6 border-b border-border-subtle ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className = "", children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={`text-lg sm:text-xl font-bold text-text-primary tracking-tight ${className}`.trim()} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ className = "", children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`mt-1.5 text-sm text-text-secondary leading-relaxed ${className}`.trim()} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`p-5 sm:p-6 ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-5 py-4 sm:px-6 bg-surface-panel-subtle border-t border-border-subtle ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}
