"use client"

interface FoodItemProps {
  name: string
  dose: number
  unit: string
  prepNote: string | null
  capped: boolean
  isWeekly?: boolean
  isContinuing?: boolean
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export default function FoodItem({
  name,
  dose,
  unit,
  prepNote,
  capped,
  isWeekly = false,
  isContinuing = false,
  checked,
  onChange,
  disabled = false,
}: FoodItemProps) {
  return (
    <label className={`flex items-start gap-4 py-3 min-h-[44px] ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        className="w-6 h-6 mt-0.5 shrink-0 accent-slate-900"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-base font-medium ${checked ? "line-through text-gray-400" : ""}`}>
            {name}
          </span>
          {capped && (
            <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full font-semibold">
              CAPPED
            </span>
          )}
          {isWeekly && (
            <span className="bg-teal-600 text-white text-xs px-2 py-0.5 rounded-full font-semibold">
              Weekly
            </span>
          )}
          {isContinuing && (
            <span className="text-xs text-gray-500 italic">Continuing final dose</span>
          )}
        </div>
        <div className={`text-sm ${checked ? "text-gray-400" : "text-gray-700"}`}>
          {dose} {unit}
        </div>
        {prepNote && (
          <div className="text-xs text-gray-500 mt-0.5">{prepNote}</div>
        )}
      </div>
    </label>
  )
}
