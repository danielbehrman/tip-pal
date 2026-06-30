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
          style={{ background: isMorning ? "#fff0e6" : "#f0eaff" }}
        >
          {isMorning ? "☀️" : "🌙"}
        </span>
        <span
          className="text-xs font-medium uppercase tracking-[0.04em]"
          style={{ color: "#6b4c3b" }}
        >
          {label}
        </span>
      </div>
      <span className="text-xs" style={{ color: "#c4927a", fontSize: "11px" }}>
        {count}
      </span>
    </div>
  )
}
