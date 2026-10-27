import type { Priority } from "../../lib/types";

const priorityColor: Record<Priority, string> = {
  urgent: "#ef878b",
  high: "#edb36e",
  medium: "#a397f8",
  low: "#7fa7c5",
};

export default function PriorityMark({ value }: { value: Priority }) {
  return (
    <span
      className="priority-mark"
      style={{ color: priorityColor[value] }}
      role="img"
      aria-label={"Priority: " + value}
      title={"Priority: " + value}
    >
      <span style={{ height: value === "low" ? 5 : 8 }} />
      <span
        style={{
          height: value === "low" ? 8 : value === "medium" ? 11 : 12,
          opacity: value === "low" ? 0.3 : 1,
        }}
      />
      <span
        style={{
          height: 15,
          opacity: value === "low" || value === "medium" ? 0.25 : 1,
        }}
      />
    </span>
  );
}
