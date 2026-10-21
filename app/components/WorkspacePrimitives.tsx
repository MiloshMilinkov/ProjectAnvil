import type { ReactNode } from "react";
import { Users, Circle, CircleCheck, CircleDashed, Layers } from "lucide-react";
import { initials, type Person, type Status } from "../lib/types";
export function Avatar({
  person,
  small = false,
  label,
}: {
  person?: Person;
  small?: boolean;
  label?: string;
}) {
  return (
    <span
      className={"avatar " + (small ? "small" : "")}
      style={{
        background: person ? person.color + "25" : "#8e94aa20",
        color: person?.color || "#8e94aa",
      }}
      title={person?.name || label || "Unassigned"}
    >
      {person ? initials(person.name) : <Users size={12} />}
    </span>
  );
}
export function StatusIcon({ status }: { status: Status }) {
  return status === "done" ? (
    <CircleCheck size={15} color="#63c9a0" />
  ) : status === "in-progress" ? (
    <CircleDashed size={15} color="#a192fc" />
  ) : status === "review" ? (
    <Circle size={15} color="#edbd72" />
  ) : (
    <Circle size={15} color="#747a8f" />
  );
}
export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Layers size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
