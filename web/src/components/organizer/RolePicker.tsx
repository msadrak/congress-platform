import { useId, useState } from "react";
import type { OrganizerRole } from "../../api/client";
import { organizerSharedCopy } from "../../copy/organizerShared";
import { ORGANIZER_ROLES, ROLE_COPY } from "../../lib/organizerConsole";
import { ConfirmDialog } from "../ui/ConfirmDialog";

export interface RolePickerProps {
  /** The current role. */
  value: OrganizerRole;
  /**
   * Called with the new role: at once when `confirm` is false, otherwise only after the confirmation dialog's
   * confirm button. The caller saves it and passes the saved role back as `value`.
   */
  onChange: (role: OrganizerRole) => void;
  locale: "fa" | "en";
  /** Ask before changing (default): a role change of an existing member. False for a form (adding a member). */
  confirm?: boolean;
  /** Names the member in the confirmation title. */
  memberName?: string;
  /** The roles offered, highest first; defaults to owner, manager, staff, viewer. */
  roles?: readonly OrganizerRole[];
  /** Visible group label; defaults to «نقش» / "Role". */
  legend?: string;
  /** Saving: the options are disabled. */
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * The one organizer role picker (members add / change role, platform members): radio cards, each with the role's
 * name and what it may do (`ROLE_COPY`). A change of an existing member's role is confirmed first.
 */
export function RolePicker({
  value,
  onChange,
  locale,
  confirm = true,
  memberName,
  roles = ORGANIZER_ROLES,
  legend,
  busy = false,
  disabled = false,
  className = "",
}: RolePickerProps) {
  const name = useId();
  const copy = organizerSharedCopy[locale];
  const labels = ROLE_COPY[locale];
  const [pending, setPending] = useState<OrganizerRole | null>(null);

  const choose = (role: OrganizerRole) => {
    if (role === value) return;
    if (confirm) setPending(role);
    else onChange(role);
  };

  return (
    <>
      <fieldset className={`space-y-2 ${className}`.trim()} disabled={disabled || busy} aria-busy={busy || undefined}>
        <legend className="ui-label">{legend ?? copy.role.legend}</legend>
        {roles.map((role) => (
          <label
            key={role}
            className="flex min-h-12 cursor-pointer items-start gap-3 rounded-control border border-border-default px-3.5 py-2.5 has-[:checked]:border-action-primary has-[:checked]:bg-action-subtle has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
          >
            <input
              type="radio"
              name={name}
              value={role}
              // While the confirmation is open the current role stays selected: nothing changed yet.
              checked={value === role}
              onChange={() => choose(role)}
              aria-describedby={`${name}-${role}`}
              className="mt-1"
            />
            <span>
              <span className="block text-body-sm font-semibold text-text-primary">{labels[role].label}</span>
              <span id={`${name}-${role}`} className="block text-caption text-text-secondary">
                {labels[role].summary}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {confirm && (
        <ConfirmDialog
          isOpen={pending !== null}
          title={pending ? copy.role.confirmTitle(labels[pending].label, memberName) : ""}
          description={pending ? labels[pending].summary : undefined}
          confirmLabel={copy.role.confirmAction}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const role = pending;
            setPending(null);
            if (role) onChange(role);
          }}
        />
      )}
    </>
  );
}
