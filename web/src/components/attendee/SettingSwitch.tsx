import { Switch } from "../ui/Switch";

interface SettingSwitchProps {
  label: string;
  description: string;
  checked: boolean;
  busy: boolean;
  /** Deprecated: the on/off caption is no longer shown (the switch state is in `aria-checked`). */
  onLabel?: string;
  offLabel?: string;
  onToggle: () => void;
}

/** Deprecated wrapper over `ui/Switch` in a subtle box (UX-Z removes it). */
export function SettingSwitch({ label, description, checked, busy, onToggle }: SettingSwitchProps) {
  return (
    <Switch
      label={label}
      description={description}
      checked={checked}
      busy={busy}
      onChange={onToggle}
      className="rounded-card border border-border-subtle bg-surface-panel-subtle p-4"
    />
  );
}
