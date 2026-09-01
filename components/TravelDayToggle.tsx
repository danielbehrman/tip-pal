"use client"

interface TravelDayToggleProps {
  value: boolean | null
  onChange: (value: boolean) => void
  error?: boolean
}

export default function TravelDayToggle({ value, onChange, error = false }: TravelDayToggleProps) {
  return (
    <div>
      <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text-primary)" }}>
        Do you travel to your appointments?
      </p>
      <p className="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>
        If you fly or travel the day before, we&apos;ll automatically account for one extra skip day in your buffer calculation.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(true)}
          className="flex-1 py-2 rounded-lg text-sm font-medium"
          style={{
            background: value === true ? "var(--color-primary-mid)" : "var(--color-bg-secondary)",
            color: value === true ? "#fff" : "var(--color-text-primary)",
            border: error ? "1.5px solid #dc2626" : "none",
          }}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className="flex-1 py-2 rounded-lg text-sm font-medium"
          style={{
            background: value === false ? "var(--color-primary-mid)" : "var(--color-bg-secondary)",
            color: value === false ? "#fff" : "var(--color-text-primary)",
            border: error ? "1.5px solid #dc2626" : "none",
          }}
        >
          No
        </button>
      </div>
      {error && (
        <p className="text-sm mt-1" style={{ color: "#dc2626" }}>
          Please answer this question.
        </p>
      )}
    </div>
  )
}
