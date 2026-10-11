import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  isHoverable?: boolean;
}

export function Card({ isHoverable = false, className = "", children, ...props }: CardProps) {
  const hoverClass = isHoverable
    ? "transition-all duration-150 hover:border-border-strong hover:shadow-xs motion-reduce:transition-none"
    : "";

  return (
    <div
      className={`bg-surface-panel border border-border-default rounded-xl shadow-xs overflow-hidden ${hoverClass} ${className}`.trim()}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`p-5 sm:p-6 border-b border-border-subtle ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={`text-lg sm:text-xl font-semibold text-text-primary tracking-tight ${className}`.trim()}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardDescription({
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`mt-1.5 text-sm text-text-secondary leading-relaxed ${className}`.trim()} {...props}>
      {children}
    </p>
  );
}

export function CardContent({
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`p-5 sm:p-6 ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`px-5 py-4 sm:px-6 bg-surface-panel-subtle border-t border-border-subtle ${className}`.trim()}
      {...props}
    >
      {children}
    </div>
  );
}
