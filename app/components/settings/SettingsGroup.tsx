import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

interface SettingsGroupProps {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  initiallyOpen?: boolean;
  children: ReactNode;
}

/** Native disclosure keeps keyboard behavior and ongoing panel state intact. */
export default function SettingsGroup({
  id,
  title,
  description,
  icon: Icon,
  initiallyOpen = false,
  children,
}: SettingsGroupProps) {
  return (
    <details
      className="settings-group"
      data-settings-group={id}
      open={initiallyOpen}
    >
      <summary>
        <Icon size={20} aria-hidden="true" />
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <ChevronDown
          className="settings-group-chevron"
          size={18}
          aria-hidden="true"
        />
      </summary>
      <div className="settings-group-content">{children}</div>
    </details>
  );
}
