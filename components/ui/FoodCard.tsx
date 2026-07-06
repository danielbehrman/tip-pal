interface FoodCardProps {
  children: React.ReactNode
  checked: boolean
  session: "morning" | "evening" | "med"
  partial?: boolean
}

const SESSION_CHECKED_STYLES = {
  morning: "bg-[var(--color-primary-pale)]",
  evening: "bg-[var(--color-treatment-bg-checked)]",
  med: "bg-[var(--color-med-bg-checked)]",
}

const SESSION_DEFAULT_STYLES = {
  morning: "bg-white",
  evening: "bg-[var(--color-treatment-bg)]",
  med: "bg-[var(--color-med-bg)]",
}

const SESSION_CHECKED_BORDER_COLOR = {
  morning: "var(--color-primary-checked)",
  evening: "var(--color-treatment-border-checked)",
  med: "var(--color-med-border-checked)",
}

const SESSION_DEFAULT_BORDER_COLOR = {
  morning: "var(--color-primary-border)",
  evening: "var(--color-treatment-border)",
  med: "var(--color-med-border)",
}

export default function FoodCard({ children, checked, session, partial }: FoodCardProps) {
  const partialStyle: React.CSSProperties = {
    borderWidth: "1.5px",
    borderStyle: "dashed",
    borderColor: "var(--color-primary-mid)",
  }
  const checkedStyle: React.CSSProperties = {
    borderWidth: "0.5px",
    borderStyle: "solid",
    borderColor: SESSION_CHECKED_BORDER_COLOR[session],
  }
  const defaultStyle: React.CSSProperties = {
    borderWidth: "0.5px",
    borderStyle: "solid",
    borderColor: SESSION_DEFAULT_BORDER_COLOR[session],
  }

  const inlineStyle = partial ? partialStyle : checked ? checkedStyle : defaultStyle
  const bgClass = partial ? "bg-white" : checked ? SESSION_CHECKED_STYLES[session] : SESSION_DEFAULT_STYLES[session]

  return (
    <div
      className={`rounded-[14px] px-3 py-[10px] mb-[7px] transition-colors ${bgClass}`}
      style={inlineStyle}
    >
      {children}
    </div>
  )
}
