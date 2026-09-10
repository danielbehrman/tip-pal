"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, MaintenanceFood, WeeklyFood, TreatmentFood, TreatmentWeek, RecommendedFood, Medication } from "@/lib/types"
import { getSession, fetchSchedule, saveSchedule } from "@/lib/supabase"

function RowDivider() {
  return <div style={{ height: "0.5px", background: "var(--color-primary-border)", marginLeft: 16 }} />
}

function NumberField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="text-sm bg-transparent outline-none border-none text-right w-16"
      style={{ color: "var(--color-text-secondary)" }}
    />
  )
}

function TextField({ value, onChange, width = 60 }: { value: string; onChange: (v: string) => void; width?: number }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-sm bg-transparent outline-none border-none text-right"
      style={{ color: "var(--color-text-secondary)", width }}
    />
  )
}

export default function EditFoodsPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const session = await getSession().catch(() => null)
      if (!session) { router.replace("/login"); return }
      const s = await fetchSchedule().catch(() => null)
      if (!s) { router.replace("/setup"); return }
      setSchedule(s)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateMaintenance(index: number, patch: Partial<MaintenanceFood>) {
    setSchedule(prev => {
      if (!prev) return prev
      const next = [...prev.maintenanceFoods]
      next[index] = { ...next[index], ...patch }
      return { ...prev, maintenanceFoods: next }
    })
  }

  function updateWeekly(index: number, patch: Partial<WeeklyFood>) {
    setSchedule(prev => {
      if (!prev) return prev
      const next = [...prev.weeklyFoods]
      next[index] = { ...next[index], ...patch }
      return { ...prev, weeklyFoods: next }
    })
  }

  function updateTreatmentWeek(foodIndex: number, weekIndex: number, patch: Partial<TreatmentWeek>) {
    setSchedule(prev => {
      if (!prev) return prev
      const foods = [...prev.treatmentFoods]
      const weeks = [...foods[foodIndex].weeks]
      weeks[weekIndex] = { ...weeks[weekIndex], ...patch }
      foods[foodIndex] = { ...foods[foodIndex], weeks }
      return { ...prev, treatmentFoods: foods }
    })
  }

  function addTreatmentWeek(foodIndex: number) {
    setSchedule(prev => {
      if (!prev) return prev
      const foods = [...prev.treatmentFoods]
      const weeks = foods[foodIndex].weeks
      const lastWeek = weeks.length > 0 ? weeks[weeks.length - 1] : { week: 0, dose: 0, unit: "mg", isFinal: false }
      foods[foodIndex] = { ...foods[foodIndex], weeks: [...weeks, { ...lastWeek, week: lastWeek.week + 1 }] }
      return { ...prev, treatmentFoods: foods }
    })
  }

  function removeTreatmentWeek(foodIndex: number, weekIndex: number) {
    setSchedule(prev => {
      if (!prev) return prev
      const foods = [...prev.treatmentFoods]
      foods[foodIndex] = { ...foods[foodIndex], weeks: foods[foodIndex].weeks.filter((_, i) => i !== weekIndex) }
      return { ...prev, treatmentFoods: foods }
    })
  }

  function updateRecommended(index: number, patch: Partial<RecommendedFood>) {
    setSchedule(prev => {
      if (!prev) return prev
      const next = [...(prev.recommendedFoods ?? [])]
      next[index] = { ...next[index], ...patch }
      return { ...prev, recommendedFoods: next }
    })
  }

  function updateMedication(index: number, patch: Partial<Medication>) {
    setSchedule(prev => {
      if (!prev) return prev
      const next = [...(prev.medications ?? [])]
      next[index] = { ...next[index], ...patch }
      return { ...prev, medications: next }
    })
  }

  async function handleSave() {
    if (!schedule) return
    setSaving(true)
    setSaveError(null)
    try {
      await saveSchedule(schedule)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed — please try again")
    } finally {
      setSaving(false)
    }
  }

  if (!schedule) return null

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      <header
        className="px-4 pb-4 flex items-center justify-between"
        style={{ background: "var(--color-primary)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
      >
        <button onClick={() => router.back()} className="text-white" aria-label="Back">‹ Settings</button>
        <h1 className="text-base font-semibold text-white">Edit foods &amp; doses</h1>
        <button onClick={handleSave} disabled={saving} className="text-white font-semibold disabled:opacity-50">
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </header>

      <div className="flex-1 px-4 pt-4 pb-24 flex flex-col gap-5">
        {saveError && <p className="text-sm" style={{ color: "#dc2626" }}>{saveError}</p>}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Maintenance foods</p>
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
            {schedule.maintenanceFoods.map((food, i) => (
              <div key={food.name}>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>{food.name}</span>
                  <div className="flex items-center gap-1">
                    <NumberField value={food.dose} onChange={v => updateMaintenance(i, { dose: v })} />
                    <TextField value={food.unit} onChange={v => updateMaintenance(i, { unit: v })} width={44} />
                  </div>
                </div>
                {i < schedule.maintenanceFoods.length - 1 && <RowDivider />}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Weekly foods (Day 7)</p>
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
            {schedule.weeklyFoods.map((food, i) => (
              <div key={food.name}>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>{food.name}</span>
                  <div className="flex items-center gap-1">
                    <NumberField value={food.dose} onChange={v => updateWeekly(i, { dose: v })} />
                    <TextField value={food.unit} onChange={v => updateWeekly(i, { unit: v })} width={44} />
                  </div>
                </div>
                {i < schedule.weeklyFoods.length - 1 && <RowDivider />}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Treatment foods</p>
          <div className="flex flex-col gap-3">
            {schedule.treatmentFoods.map((food, fi) => (
              <div key={food.name} className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
                <div className="px-4 py-2">
                  <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{food.name}</span>
                </div>
                {food.weeks.map((week, wi) => (
                  <div key={week.week}>
                    <RowDivider />
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Week {week.week}</span>
                      <div className="flex items-center gap-1">
                        <NumberField value={week.dose} onChange={v => updateTreatmentWeek(fi, wi, { dose: v })} />
                        <TextField value={week.unit} onChange={v => updateTreatmentWeek(fi, wi, { unit: v })} width={44} />
                        <button onClick={() => removeTreatmentWeek(fi, wi)} className="text-sm ml-2" style={{ color: "#dc2626" }}>✕</button>
                      </div>
                    </div>
                  </div>
                ))}
                <RowDivider />
                <button onClick={() => addTreatmentWeek(fi)} className="w-full text-sm py-3" style={{ color: "var(--color-primary-mid)" }}>
                  + Add week
                </button>
              </div>
            ))}
          </div>
        </div>

        {(schedule.recommendedFoods?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Recommended foods</p>
            <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
              {(schedule.recommendedFoods ?? []).map((food, i) => (
                <div key={food.name}>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>{food.name}</span>
                    <div className="flex items-center gap-1">
                      <NumberField value={food.dose} onChange={v => updateRecommended(i, { dose: v })} />
                      <TextField value={food.unit} onChange={v => updateRecommended(i, { unit: v })} width={44} />
                      <TextField value={food.frequencyPerWeek} onChange={v => updateRecommended(i, { frequencyPerWeek: v })} width={44} />
                    </div>
                  </div>
                  {i < (schedule.recommendedFoods ?? []).length - 1 && <RowDivider />}
                </div>
              ))}
            </div>
          </div>
        )}

        {(schedule.medications?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Medications</p>
            <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
              {(schedule.medications ?? []).map((med, i) => (
                <div key={med.name}>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>{med.name}</span>
                    <div className="flex items-center gap-1">
                      <TextField value={med.dose} onChange={v => updateMedication(i, { dose: v })} />
                      <TextField value={med.unit} onChange={v => updateMedication(i, { unit: v })} width={44} />
                    </div>
                  </div>
                  {i < (schedule.medications ?? []).length - 1 && <RowDivider />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
