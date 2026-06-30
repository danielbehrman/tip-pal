interface FoodCardProps {
  children: React.ReactNode
  checked: boolean
  session: "morning" | "evening" | "med"
}

const SESSION_CHECKED_STYLES = {
  morning: "bg-[#fff8f5] border-[#ffb899]",
  evening: "bg-[#faf8ff] border-[#c4a8f0]",
  med: "bg-[#faf8ff] border-[#e8dff5]",
}

export default function FoodCard({ children, checked, session }: FoodCardProps) {
  return (
    <div
      className={`rounded-[14px] border px-3 py-[10px] mb-[7px] transition-colors ${
        checked
          ? SESSION_CHECKED_STYLES[session]
          : "bg-white border-[#f0ddd4]"
      }`}
      style={{ borderWidth: "0.5px" }}
    >
      {children}
    </div>
  )
}
