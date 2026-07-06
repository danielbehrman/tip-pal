interface BadgeProps {
  variant: "capped" | "week"
  label?: string
}

export default function Badge({ variant, label }: BadgeProps) {
  if (variant === "capped") {
    return (
      <span
        className="text-[9px] font-semibold px-1.5 py-0.5 rounded-[4px]"
        style={{ background: "var(--color-primary-light)", color: "var(--color-primary-mid)" }}
      >
        CAPPED
      </span>
    )
  }
  return (
    <span
      className="text-[9px] font-medium px-1.5 py-0.5 rounded-[4px]"
      style={{ background: "var(--color-treatment-bg)", color: "var(--color-treatment-text)" }}
    >
      {label ?? "Wk"}
    </span>
  )
}
