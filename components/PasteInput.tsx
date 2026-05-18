"use client"

interface PasteInputProps {
  value: string
  onChange: (val: string) => void
  onSubmit: () => void
}

export default function PasteInput({ value, onChange, onSubmit }: PasteInputProps) {
  return (
    <div className="flex flex-col gap-4">
      <textarea
        className="w-full min-h-64 p-4 border border-gray-300 rounded-xl text-base resize-none focus:outline-none focus:ring-2 focus:ring-slate-500"
        placeholder="Paste dosing schedule notes here..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        className="w-full py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl disabled:opacity-40"
        onClick={onSubmit}
        disabled={value.trim() === ""}
      >
        Parse Schedule
      </button>
    </div>
  )
}
