"use client"

import { RampStep } from "@/lib/types"

interface RampStepEditorProps {
  steps: RampStep[]
  onChange: (steps: RampStep[]) => void
  disabled?: boolean
}

function emptyStep(): RampStep {
  return { dose: 0, unit: "ml", days: 7 }
}

export default function RampStepEditor({ steps, onChange, disabled = false }: RampStepEditorProps) {
  function updateStep(index: number, patch: Partial<RampStep>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function addStep() {
    onChange([...steps, emptyStep()])
  }

  function removeStep(index: number) {
    onChange(steps.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-2">
      {steps.map((step, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: "var(--color-bg-secondary)" }}
        >
          <span className="text-xs w-12" style={{ color: "var(--color-text-muted)" }}>Step {i + 1}</span>
          <input
            type="number"
            value={step.dose}
            onChange={e => updateStep(i, { dose: parseFloat(e.target.value) || 0 })}
            disabled={disabled}
            className="text-sm bg-white rounded px-2 py-1 w-16 outline-none"
            style={{ border: "0.5px solid var(--color-primary-border)", color: "var(--color-text-primary)" }}
            aria-label={`Step ${i + 1} dose`}
          />
          <input
            type="text"
            value={step.unit}
            onChange={e => updateStep(i, { unit: e.target.value })}
            disabled={disabled}
            className="text-sm bg-white rounded px-2 py-1 w-14 outline-none"
            style={{ border: "0.5px solid var(--color-primary-border)", color: "var(--color-text-primary)" }}
            aria-label={`Step ${i + 1} unit`}
          />
          <input
            type="number"
            value={step.days}
            onChange={e => updateStep(i, { days: parseInt(e.target.value, 10) || 1 })}
            disabled={disabled}
            className="text-sm bg-white rounded px-2 py-1 w-14 outline-none"
            style={{ border: "0.5px solid var(--color-primary-border)", color: "var(--color-text-primary)" }}
            aria-label={`Step ${i + 1} days`}
          />
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>days</span>
          <button
            type="button"
            onClick={() => removeStep(i)}
            disabled={disabled || steps.length <= 1}
            className="ml-auto text-xs disabled:opacity-30"
            style={{ color: "#dc2626" }}
            aria-label={`Remove step ${i + 1}`}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addStep}
        disabled={disabled}
        className="text-sm text-left px-1"
        style={{ color: "var(--color-primary-mid)" }}
      >
        + Add step
      </button>
    </div>
  )
}
