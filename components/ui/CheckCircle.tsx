interface CheckCircleProps {
  checked: boolean
  session: "morning" | "evening" | "med"
  size?: number
  onClick?: () => void
}

const SESSION_STYLES = {
  morning: {
    unchecked: "border-2 border-[#e8cfc4]",
    checked: "bg-[#ff6b35] border-[#ff6b35]",
  },
  evening: {
    unchecked: "border-2 border-[#d4bef0]",
    checked: "bg-[#9b6fd4] border-[#9b6fd4]",
  },
  med: {
    unchecked: "border-2 border-[#d4bef0]",
    checked: "bg-[#9b6fd4] border-[#9b6fd4]",
  },
}

export default function CheckCircle({ checked, session, size = 22, onClick }: CheckCircleProps) {
  const styles = SESSION_STYLES[session]
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width: size, height: size }}
      className={`flex-shrink-0 rounded-full flex items-center justify-center transition-colors ${
        checked ? styles.checked : styles.unchecked
      }`}
      aria-pressed={checked}
    >
      {checked && (
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 12 10" fill="none">
          <path d="M1 5l3.5 3.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
