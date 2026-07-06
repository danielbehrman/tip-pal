interface CheckCircleProps {
  checked: boolean
  session: "morning" | "evening" | "med"
  partial?: boolean
  size?: number
  onClick?: () => void
  disabled?: boolean
}

const SESSION_STYLES = {
  morning: {
    unchecked: { border: "2px solid var(--color-primary-border)" },
    checked: { background: "var(--color-primary-mid)", border: "2px solid var(--color-primary-mid)" },
    partial: { border: "2px dashed var(--color-primary-mid)", background: "transparent" },
  },
  evening: {
    unchecked: { border: "2px solid var(--color-treatment-border)" },
    checked: { background: "var(--color-treatment-check)", border: "2px solid var(--color-treatment-check)" },
    partial: { border: "2px dashed var(--color-treatment-check)", background: "transparent" },
  },
  med: {
    unchecked: { border: "2px solid var(--color-med-border)" },
    checked: { background: "var(--color-med-check)", border: "2px solid var(--color-med-check)" },
    partial: { border: "2px dashed var(--color-med-check)", background: "transparent" },
  },
}

export default function CheckCircle({
  checked,
  session,
  partial = false,
  size = 22,
  onClick,
  disabled = false,
}: CheckCircleProps) {
  const styles = SESSION_STYLES[session]
  const styleObj = partial ? styles.partial : checked ? styles.checked : styles.unchecked

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, ...styleObj }}
      className="flex items-center justify-center transition-colors disabled:opacity-50"
      aria-pressed={checked}
    >
      {checked && !partial && (
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 12 10" fill="none">
          <path
            d="M1 5l3.5 3.5L11 1"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}
