interface SectionHeaderProps {
  session: "morning" | "evening"
  label: string
  count: number
}

export default function SectionHeader({ session, label, count }: SectionHeaderProps) {
  const isMorning = session === "morning"
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <span
          className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-sm"
          style={{ background: isMorning ? "var(--color-primary-light)" : "var(--color-evening-icon-bg)" }}
        >
          {isMorning ? "☀️" : "🌙"}
        </span>
        <span
          className="font-medium uppercase tracking-[0.04em]"
          style={{ fontSize: 13, color: "var(--color-text-section)" }}
        >
          {label}
        </span>
      </div>
      <span className="text-xs" style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>
        {count}
      </span>
    </div>
  )
}
