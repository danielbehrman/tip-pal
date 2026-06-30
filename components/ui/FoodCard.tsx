interface FoodCardProps {
  children: React.ReactNode
  checked: boolean
  session: "morning" | "evening" | "med"
  partial?: boolean
}

const SESSION_CHECKED_STYLES = {
  morning: "bg-[#fff8f5]",
  evening: "bg-[#faf8ff]",
  med: "bg-[#faf8ff]",
}

const SESSION_CHECKED_BORDER_COLOR = {
  morning: "#ffb899",
  evening: "#c4a8f0",
  med: "#e8dff5",
}

export default function FoodCard({ children, checked, session, partial }: FoodCardProps) {
  const partialStyle: React.CSSProperties = {
    borderWidth: "1.5px",
    borderStyle: "dashed",
    borderColor: "#ff6b35",
  }
  const checkedStyle: React.CSSProperties = {
    borderWidth: "0.5px",
    borderStyle: "solid",
    borderColor: SESSION_CHECKED_BORDER_COLOR[session],
  }
  const defaultStyle: React.CSSProperties = {
    borderWidth: "0.5px",
    borderStyle: "solid",
    borderColor: "#f0ddd4",
  }

  const inlineStyle = partial ? partialStyle : checked ? checkedStyle : defaultStyle
  const bgClass = partial ? "bg-white" : checked ? SESSION_CHECKED_STYLES[session] : "bg-white"

  return (
    <div
      className={`rounded-[14px] px-3 py-[10px] mb-[7px] transition-colors ${bgClass}`}
      style={inlineStyle}
    >
      {children}
    </div>
  )
}
