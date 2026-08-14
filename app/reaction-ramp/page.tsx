"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { FoodProgress, ReactionRamp, RampStep, RampTreatmentFood, RampMaintenanceFood } from "@/lib/types"
import { fetchSchedule, fetchFoodProgress, fetchReactionRamp, saveReactionRamp, getSession, fetchFoodGroups } from "@/lib/supabase"
import { getTreatmentFoodEntry, getGlobalPosition, treatmentRampDone } from "@/lib/schedule"
import RampStepEditor from "@/components/RampStepEditor"
import CTAButton from "@/components/ui/CTAButton"

type RampView = "loading" | "treatment" | "maintenance" | "review" | "success"

interface TreatmentDraft {
  name: string
  included: boolean
  steps: RampStep[]
  returnDose: number
  returnUnit: string
  wasCapped: boolean
  referenceDose: number
  referenceUnit: string
}

interface MaintenanceDraft {
  name: string
  included: boolean
  steps: RampStep[]
  referenceDose: number
  referenceUnit: string
}

function defaultStep(dose: number, unit: string): RampStep {
  return { dose, unit, days: 7 }
}

export default function ReactionRampPage() {
  const router = useRouter()
  const [view, setView] = useState<RampView>("loading")
  const [isEditMode, setIsEditMode] = useState(false)
  const [existingRamp, setExistingRamp] = useState<ReactionRamp | null>(null)
  const [treatmentDrafts, setTreatmentDrafts] = useState<TreatmentDraft[]>([])
  const [maintenanceDrafts, setMaintenanceDrafts] = useState<MaintenanceDraft[]>([])
  const [adjustMaintenance, setAdjustMaintenance] = useState(false)
  const [maintenanceMode, setMaintenanceMode] = useState<"same" | "different">("different")
  const [sharedMaintenanceSteps, setSharedMaintenanceSteps] = useState<RampStep[]>([defaultStep(0, "ml")])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      let session
      try { session = await getSession() } catch { router.replace("/login"); return }
      if (!session) { router.replace("/login"); return }

      const [schedule, progress, ramp, groups] = await Promise.all([
        fetchSchedule().catch(() => null),
        fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
        fetchReactionRamp().catch(() => null),
        fetchFoodGroups().catch(() => []),
      ])
      if (!schedule) { router.replace("/setup"); return }

      const rampTreatmentByName = new Map((ramp?.treatmentFoods ?? []).map(f => [f.name, f]))
      const treatmentInit: TreatmentDraft[] = schedule.treatmentFoods.map(food => {
        const fp = progress.get(food.name)
        const { weekEntry } = getTreatmentFoodEntry(food, fp?.week ?? 1)
        const existing = rampTreatmentByName.get(food.name)
        return {
          name: food.name,
          // A treatment food already finished (complete: true) is never
          // pre-checked — otherwise confirming an edit during the maintenance
          // tail would re-freeze and restart an already-completed food.
          included: !!existing && !existing.complete,
          steps: existing ? existing.steps.map(s => ({ ...s })) : [defaultStep(weekEntry.dose, weekEntry.unit)],
          returnDose: existing ? existing.returnDose : weekEntry.dose,
          returnUnit: existing ? existing.returnUnit : weekEntry.unit,
          wasCapped: existing ? existing.wasCapped : false,
          referenceDose: weekEntry.dose,
          referenceUnit: weekEntry.unit,
        }
      })

      const groupedFoodNames = new Set(groups.flatMap(g => g.foodNames))
      const rampMaintenanceByName = new Map((ramp?.maintenanceFoods ?? []).map(f => [f.name, f]))
      const maintenanceInit: MaintenanceDraft[] = schedule.maintenanceFoods
        .filter(food => !groupedFoodNames.has(food.name))
        .map(food => {
          const existing = rampMaintenanceByName.get(food.name)
          return {
            name: food.name,
            included: !!existing,
            steps: existing ? existing.steps.map(s => ({ ...s })) : [defaultStep(food.dose, food.unit)],
            referenceDose: food.dose,
            referenceUnit: food.unit,
          }
        })

      setTreatmentDrafts(treatmentInit)
      setMaintenanceDrafts(maintenanceInit)
      setAdjustMaintenance(maintenanceInit.some(d => d.included))
      setIsEditMode(!!ramp)
      setExistingRamp(ramp)
      setView("treatment")
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateTreatmentDraft(index: number, patch: Partial<TreatmentDraft>) {
    setTreatmentDrafts(prev => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  function updateMaintenanceDraft(index: number, patch: Partial<MaintenanceDraft>) {
    setMaintenanceDrafts(prev => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  async function handleConfirm() {
    setSaving(true)
    setSaveError(null)
    try {
      const progress = await fetchFoodProgress()
      const globalPos = getGlobalPosition(progress)

      const treatmentFoods: RampTreatmentFood[] = treatmentDrafts
        .filter(d => d.included)
        .map(d => ({
          name: d.name,
          steps: d.steps,
          returnDose: d.returnDose,
          returnUnit: d.returnUnit,
          wasCapped: d.wasCapped,
          currentStep: 0,
          daysInStep: 0,
          complete: false,
        }))

      const maintenanceFoods: RampMaintenanceFood[] = adjustMaintenance
        ? maintenanceDrafts
            .filter(d => d.included)
            .map(d => ({
              name: d.name,
              steps: (maintenanceMode === "same" ? sharedMaintenanceSteps : d.steps).map(s => ({ ...s })),
              currentStep: 0,
              daysInStep: 0,
              complete: false,
            }))
        : []

      const ramp: ReactionRamp = isEditMode && existingRamp
        ? {
            active: true,
            startedAt: existingRamp.startedAt,
            rampDay: existingRamp.rampDay,
            startedAtWeek: existingRamp.startedAtWeek,
            startedAtDay: existingRamp.startedAtDay,
            treatmentFoods,
            maintenanceFoods,
          }
        : {
            active: true,
            startedAt: new Date().toISOString(),
            rampDay: 0,
            startedAtWeek: globalPos.week,
            startedAtDay: globalPos.day,
            treatmentFoods,
            maintenanceFoods,
          }

      await saveReactionRamp(ramp)
      setView("success")
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed — please try again")
    } finally {
      setSaving(false)
    }
  }

  if (view === "loading") return null

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      <header
        className="px-4 pb-4 flex items-center gap-3"
        style={{ background: "var(--color-primary)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
      >
        <Link href="/settings" className="text-white" aria-label="Back to Settings">‹</Link>
        <h1 className="text-xl font-semibold text-white">
          {isEditMode ? "Edit Reaction Ramp" : "Start Reaction Ramp"}
        </h1>
      </header>

      <div className="px-4 pt-6 pb-24 flex flex-col gap-4">
        {view === "treatment" && (
          <>
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
              Select the treatment foods affected by the reaction and enter the clinic&apos;s ramp-back plan.
            </p>
            {treatmentDrafts.map((draft, i) => (
              <div key={draft.name} className="bg-white rounded-xl p-4" style={{ border: "0.5px solid var(--color-primary-border)" }}>
                <label className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked={draft.included}
                    onChange={e => updateTreatmentDraft(i, { included: e.target.checked })}
                  />
                  <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{draft.name}</span>
                  <span className="text-xs ml-auto" style={{ color: "var(--color-text-muted)" }}>
                    Currently {draft.referenceDose} {draft.referenceUnit}
                  </span>
                </label>
                {draft.included && (
                  <div className="flex flex-col gap-3 mt-2">
                    <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-secondary)" }}>
                      <input
                        type="checkbox"
                        checked={draft.wasCapped}
                        onChange={e => updateTreatmentDraft(i, { wasCapped: e.target.checked })}
                      />
                      CAPPED — exact dose, no more no less
                    </label>
                    <RampStepEditor
                      steps={draft.steps}
                      onChange={steps => updateTreatmentDraft(i, { steps })}
                      disabled={saving}
                    />
                  </div>
                )}
              </div>
            ))}
            <CTAButton
              onClick={() => setView("maintenance")}
              disabled={
                !treatmentDrafts.some(d => d.included) &&
                !(isEditMode && existingRamp && treatmentRampDone(existingRamp))
              }
            >
              Next: Maintenance foods
            </CTAButton>
          </>
        )}

        {view === "maintenance" && (
          <>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={adjustMaintenance}
                onChange={e => setAdjustMaintenance(e.target.checked)}
              />
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Also adjusting maintenance foods?</span>
            </label>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Foods that belong to a food group aren&apos;t shown here — ramp adjustments only apply to standalone maintenance foods.
            </p>

            {adjustMaintenance && (
              <>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMaintenanceMode("same")}
                    className="text-sm px-3 py-2 rounded-lg"
                    style={{
                      background: maintenanceMode === "same" ? "var(--color-primary-mid)" : "var(--color-bg-secondary)",
                      color: maintenanceMode === "same" ? "#fff" : "var(--color-text-primary)",
                    }}
                  >
                    Same ramp for all
                  </button>
                  <button
                    type="button"
                    onClick={() => setMaintenanceMode("different")}
                    className="text-sm px-3 py-2 rounded-lg"
                    style={{
                      background: maintenanceMode === "different" ? "var(--color-primary-mid)" : "var(--color-bg-secondary)",
                      color: maintenanceMode === "different" ? "#fff" : "var(--color-text-primary)",
                    }}
                  >
                    Different per food
                  </button>
                </div>

                {maintenanceMode === "same" && (
                  <div className="bg-white rounded-xl p-4" style={{ border: "0.5px solid var(--color-primary-border)" }}>
                    <RampStepEditor steps={sharedMaintenanceSteps} onChange={setSharedMaintenanceSteps} disabled={saving} />
                  </div>
                )}

                {maintenanceDrafts.map((draft, i) => (
                  <div key={draft.name} className="bg-white rounded-xl p-4" style={{ border: "0.5px solid var(--color-primary-border)" }}>
                    <label className="flex items-center gap-2 mb-2">
                      <input
                        type="checkbox"
                        checked={draft.included}
                        onChange={e => updateMaintenanceDraft(i, { included: e.target.checked })}
                      />
                      <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{draft.name}</span>
                      <span className="text-xs ml-auto" style={{ color: "var(--color-text-muted)" }}>
                        Currently {draft.referenceDose} {draft.referenceUnit}
                      </span>
                    </label>
                    {draft.included && maintenanceMode === "different" && (
                      <RampStepEditor
                        steps={draft.steps}
                        onChange={steps => updateMaintenanceDraft(i, { steps })}
                        disabled={saving}
                      />
                    )}
                  </div>
                ))}
              </>
            )}

            <div className="flex gap-3">
              <CTAButton variant="secondary" onClick={() => setView("treatment")}>Back</CTAButton>
              <CTAButton onClick={() => setView("review")}>Review</CTAButton>
            </div>
          </>
        )}

        {view === "review" && (
          <>
            <div className="bg-white rounded-xl p-4 flex flex-col gap-3" style={{ border: "0.5px solid var(--color-primary-border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-secondary)" }}>
                Treatment foods
              </p>
              {treatmentDrafts.filter(d => d.included).map(d => (
                <div key={d.name} className="text-sm" style={{ color: "var(--color-text-primary)" }}>
                  <p className="font-medium">{d.name}{d.wasCapped ? " · CAPPED" : ""}</p>
                  {d.steps.map((s, i) => (
                    <p key={i} className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                      Step {i + 1}: {s.dose} {s.unit} for {s.days} days
                    </p>
                  ))}
                </div>
              ))}
              {adjustMaintenance && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide mt-2" style={{ color: "var(--color-text-secondary)" }}>
                    Maintenance foods
                  </p>
                  {maintenanceDrafts.filter(d => d.included).map(d => (
                    <div key={d.name} className="text-sm" style={{ color: "var(--color-text-primary)" }}>
                      <p className="font-medium">{d.name}</p>
                      {(maintenanceMode === "same" ? sharedMaintenanceSteps : d.steps).map((s, i) => (
                        <p key={i} className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                          Step {i + 1}: {s.dose} {s.unit} for {s.days} days
                        </p>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
            {saveError && <p className="text-sm" style={{ color: "#dc2626" }}>{saveError}</p>}
            <div className="flex gap-3">
              <CTAButton variant="secondary" onClick={() => setView("maintenance")} disabled={saving}>Back</CTAButton>
              <CTAButton onClick={handleConfirm} disabled={saving}>
                {saving ? "Saving…" : isEditMode ? "Save changes" : "Start ramp"}
              </CTAButton>
            </div>
          </>
        )}

        {view === "success" && (
          <div className="flex flex-col items-center gap-4 pt-10">
            <p className="text-base font-semibold" style={{ color: "var(--color-text-primary)" }}>
              {isEditMode ? "Ramp updated" : "Reaction Ramp started"}
            </p>
            <Link
              href="/daily"
              className="block text-center w-full py-3 text-white text-sm font-semibold rounded-[16px]"
              style={{ background: "var(--color-primary-mid)" }}
            >
              Back to Daily View
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
