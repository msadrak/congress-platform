import type { ReactNode } from "react";
import { LinkButton } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { CongressSignature } from "../brand/CongressSignature";

interface SignInPromptProps {
  title: string;
  description?: ReactNode;
  actionLabel: string;
  to: string;
  /** Congress slug for the artwork tile; a generic seed is used outside a congress. */
  seed?: string;
  icon?: IconName;
}

/** Signed-out state for personal destinations: the page heading plus one clear way back in. */
export function SignInPrompt({ title, description, actionLabel, to, seed, icon = "lock" }: SignInPromptProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-14 text-center sm:py-20">
      <div className="relative mb-8">
        <span aria-hidden="true" className="block size-24 overflow-hidden rounded-[22px] [border-start-end-radius:40px] shadow-lift">
          <CongressSignature seed={seed ?? "attendee-portal"} tone="ink" className="size-full" />
        </span>
        <span aria-hidden="true" className="absolute -bottom-3 -end-3 grid size-11 place-items-center rounded-full bg-surface-panel text-aiteb-indigo shadow-lift ring-1 ring-border-default">
          <Icon name={icon} size={20} />
        </span>
      </div>
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text-primary text-balance sm:text-3xl">{title}</h1>
      {description && <p className="mt-3 text-sm leading-relaxed text-text-secondary">{description}</p>}
      <LinkButton to={to} variant="primary" size="lg" isFullWidth className="mt-8">
        {actionLabel}
        <Icon name="arrow-right" size={18} />
      </LinkButton>
    </div>
  );
}
