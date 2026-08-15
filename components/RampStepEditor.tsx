"use client"

import { useState } from "react"
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
  // Local text buffers let the dose/days inputs be legitimately empty or
  // mid-edit (e.g. "" while backspacing to retype, "1." while typing a
  // decimal) without every keystroke snapping back to a clamped number —
  // the clamp only happens on blur. Keyed by step index; cleared entirely
  // on add/remove since indices shift and stale buffers would otherwise
  // overlay the wrong step.
  const [doseText, setDoseText] = useState<Record<number, string>>({})
  const [daysText, setDaysText] = useState<Record<number, string>>({})

  function updateStep(index: number, patch: Partial<RampStep>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function commitDose(index: number, raw: string) {
    const parsed = parseFloat(raw)
    updateStep(index, { dose: isNaN(parsed) ? 0 : Math.max(0, parsed) })
    setDoseText(prev => {
      const next = { ...prev }
      delete next[index]
      return next
    })
  }

  function commitDays(index: number, raw: string) {
    const parsed = parseInt(raw, 10)
    updateStep(index, { days: isNaN(parsed) ? 1 : Math.max(1, parsed) })
    setDaysText(prev => {
      const next = { ...prev }
      delete next[index]
      return next
    })
  }

  function addStep() {
    onChange([...steps, emptyStep()])
  }

  function removeStep(index: number) {
    onChange(steps.filter((_, i) => i !== index))
    setDoseText({})
    setDaysText({})
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
            value={doseText[i] ?? String(step.dose)}
            onChange={e => setDoseText(prev => ({ ...prev, [i]: e.target.value }))}
            onBlur={e => commitDose(i, e.target.value)}
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
            value={daysText[i] ?? String(step.days)}
            onChange={e => setDaysText(prev => ({ ...prev, [i]: e.target.value }))}
            onBlur={e => commitDays(i, e.target.value)}
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
