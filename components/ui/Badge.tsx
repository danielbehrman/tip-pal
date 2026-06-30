interface BadgeProps {
  variant: "capped" | "week"
  label?: string
}

export default function Badge({ variant, label }: BadgeProps) {
  if (variant === "capped") {
    return (
      <span
        className="text-[9px] font-semibold px-1.5 py-0.5 rounded-[4px]"
        style={{ background: "#fff0e6", color: "#c45a1a" }}
      >
        CAPPED
      </span>
    )
  }
  return (
    <span
      className="text-[9px] font-medium px-1.5 py-0.5 rounded-[4px]"
      style={{ background: "#f0eaff", color: "#7a4db8" }}
    >
      {label ?? "Wk"}
    </span>
  )
}
