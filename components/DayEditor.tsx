"use client"

import { useEffect, useState } from "react"
import { DoseLogDay, ParsedSchedule, FoodProgress, ReactionRamp, FoodGroup } from "@/lib/types"
import {
  getTreatmentFoodsForWeek,
  getMedicationSessions,
  getGlobalPosition,
  treatmentRampActive,
  applyCrossCategoryCredit,
  recomputeFoodProgressFromHistory,
  advanceRampStepState,
  resolveRampAfterAdvance,
  formatDateOnly,
  todayDateString,
} from "@/lib/schedule"
import {
  updateDoseLogCheckedFoods,
  fetchFoodProgress,
  saveFoodProgress,
  fetchDoseState,
  saveDoseState,
  fetchReactionRamp,
  saveRecommendedGiven,
  fetchDoseLogDaysInRange,
  saveReactionRamp,
  appendPreviousRamp,
} from "@/lib/supabase"
import FoodItem from "@/components/FoodItem"
import { buildMorningItems, MorningItem } from "./MorningSection"
import FoodGroupRow from "./FoodGroupRow"

interface DayEditorProps {
  entry: DoseLogDay
  fallbackSchedule: ParsedSchedule
  onClose: () => void
  onSaved: (updated: DoseLogDay) => void
  foodGroups: FoodGroup[]
}

function formatEntryDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

interface Row {
  key: string
  name: string
  dose: number | string
  unit: string
  session: "morning" | "evening" | "med"
  isEdgeFood: boolean
}

export default function DayEditor({ entry, fallbackSchedule, onClose, onSaved, foodGroups }: DayEditorProps) {
  const s = entry.scheduleSnapshot ?? fallbackSchedule
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, boolean>>(entry.checkedFoods)
  const [foodProgress, setFoodProgress] = useState<Map<string, FoodProgress> | null>(null)
  const [activeRamp, setActiveRamp] = useState<ReactionRamp | null>(null)
  const [recommendedFoodCounts, setRecommendedFoodCounts] = useState<Record<string, Record<string, number>>>({})
  const [loadingProgress, setLoadingProgress] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(entry.checkedFoods)
    setEditing(false)
    setFoodProgress(null)
    setActiveRamp(null)
    setRecommendedFoodCounts({})
    setSaveError(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id])

  const treatmentEntries = getTreatmentFoodsForWeek(s, entry.week)
  const maintenanceRows: Row[] = [
    ...s.maintenanceFoods.map(f => ({
      key: `morning-${f.name}`, name: f.name, dose: f.dose, unit: f.unit, session: "morning" as const, isEdgeFood: false,
    })),
    ...(entry.day === 7
      ? s.weeklyFoods.map(f => ({
          key: `morning-weekly-${f.name}`, name: f.name, dose: f.dose, unit: f.unit, session: "morning" as const, isEdgeFood: false,
        }))
      : []),
  ]
  const morningItems: MorningItem[] = buildMorningItems(s.maintenanceFoods, s.weeklyFoods, entry.day === 7, foodGroups)
  const medicationRows: Row[] = (s.medications ?? []).flatMap(med =>
    getMedicationSessions(med.frequency).map(session => ({
      key: `${session}-med-${med.name}`, name: med.name, dose: med.dose, unit: med.unit, session: "med" as const, isEdgeFood: false,
    }))
  )
  const treatmentRows: Row[] = treatmentEntries.map(({ food, weekEntry }) => ({
    key: `evening-${food.name}`, name: food.name, dose: weekEntry.dose, unit: weekEntry.unit, session: "evening" as const, isEdgeFood: true,
  }))

  async function startEditing() {
    setLoadingProgress(true)
    try {
      const [progress, ramp, ds] = await Promise.all([
        fetchFoodProgress(),
        fetchReactionRamp(),
        fetchDoseState(),
      ])
      setFoodProgress(progress)
      setActiveRamp(ramp)
      setRecommendedFoodCounts(ds?.recommendedFoodCounts ?? {})
      setEditing(true)
    } catch {
      setSaveError("Couldn't load current progress — please try again")
    } finally {
      setLoadingProgress(false)
    }
  }

  function rampStartDate(): string | null {
    if (!treatmentRampActive(activeRamp) || !activeRamp) return null
    return formatDateOnly(new Date(activeRamp.startedAt))
  }

  function isRampControlled(foodName: string): boolean {
    if (!treatmentRampActive(activeRamp)) return false
    return !!activeRamp?.treatmentFoods.some(f => f.name === foodName)
  }

  function isTreatmentRowEditable(foodName: string): boolean {
    if (!isRampControlled(foodName)) return true
    if (entry.checkedFoods[`evening-${foodName}`]) return false
    const start = rampStartDate()
    const entryDate = formatDateOnly(new Date(entry.completedAt))
    return start !== null && entryDate >= start && entryDate <= todayDateString()
  }

  function treatmentLockedHint(foodName: string): string | undefined {
    if (!editing) return undefined
    if (isTreatmentRowEditable(foodName)) return undefined
    if (isRampControlled(foodName) && entry.checkedFoods[`evening-${foodName}`]) {
      return "Locked — already given during this Reaction Ramp"
    }
    return "Locked — outside this Reaction Ramp's date range"
  }

  function preAnchorNote(foodName: string): string | undefined {
    if (!editing) return undefined
    if (!isTreatmentRowEditable(foodName)) return undefined
    const fp = foodProgress?.get(foodName)
    if (!fp) return undefined
    if (entry.completedAt < fp.anchorAt) return "Before tracking started for this food"
    return undefined
  }

  function toggle(key: string, val: boolean) {
    setDraft(prev => ({ ...prev, [key]: val }))
  }

  async function commitSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await updateDoseLogCheckedFoods(entry.id, draft)

      // Cross-category recommended-food credit: compute as a single net delta
      // from the immutable entry.checkedFoods baseline vs. the final draft at
      // Save time, so repeated toggling before Save never over- or under-counts,
      // and nothing is persisted unless Save actually happens.
      const allRows = [...maintenanceRows, ...treatmentRows, ...medicationRows]
      let runningCounts = recommendedFoodCounts
      for (const row of allRows) {
        const wasChecked = !!entry.checkedFoods[row.key]
        const nowChecked = !!draft[row.key]
        if (nowChecked === wasChecked) continue
        const updated = applyCrossCategoryCredit(
          s.recommendedFoods ?? [],
          runningCounts,
          String(entry.week),
          row.key,
          nowChecked,
          wasChecked
        )
        if (updated) runningCounts = updated
      }
      if (runningCounts !== recommendedFoodCounts) {
        saveRecommendedGiven(runningCounts).catch(() => {})
      }

      const rampControlledNames = new Set(
        treatmentRampActive(activeRamp) ? (activeRamp?.treatmentFoods.map(f => f.name) ?? []) : []
      )
      if (activeRamp && rampControlledNames.size > 0) {
        let rampChanged = false
        const nextTreatmentFoods = activeRamp.treatmentFoods.map(rf => {
          if (!rampControlledNames.has(rf.name)) return rf
          const row = treatmentRows.find(r => r.name === rf.name)
          if (!row) return rf
          const wasChecked = !!entry.checkedFoods[row.key]
          const nowChecked = !!draft[row.key]
          if (!nowChecked || wasChecked === nowChecked) return rf
          rampChanged = true
          return { ...rf, ...advanceRampStepState(rf) }
        })
        if (rampChanged) {
          const { nextRamp, justFinishedTreatment, fullyDone } = resolveRampAfterAdvance(
            activeRamp, nextTreatmentFoods, activeRamp.maintenanceFoods, treatmentRampActive(activeRamp)
          )
          if (justFinishedTreatment) {
            try {
              await appendPreviousRamp({
                startedAt: activeRamp.startedAt,
                endedAt: new Date().toISOString(),
                rampDayCount: nextRamp.rampDay,
                treatmentFoods: nextRamp.treatmentFoods,
                maintenanceFoods: nextRamp.maintenanceFoods,
              })
            } catch {
              // History write failed — non-critical
            }
          }
          const updatedRamp = fullyDone
            ? { active: false, startedAt: "", rampDay: 0, startedAtWeek: 0, startedAtDay: 0, treatmentFoods: [], maintenanceFoods: [] }
            : nextRamp
          try {
            await saveReactionRamp(updatedRamp)
          } catch {
            // Save failed — non-critical, next load re-fetches truth
          }
        }
      }

      if (foodProgress) {
        const existing = await fetchDoseState()
        const cycleStartDate = existing?.cycleStartDate ?? formatDateOnly(new Date(entry.completedAt))
        const cycleDays = await fetchDoseLogDaysInRange(cycleStartDate, todayDateString())
        const recomputed = recomputeFoodProgressFromHistory(fallbackSchedule, cycleDays, foodProgress, rampControlledNames)
        await saveFoodProgress(recomputed)

        const oldGlobal = getGlobalPosition(foodProgress)
        const newGlobal = getGlobalPosition(recomputed)
        if (existing && (newGlobal.week !== oldGlobal.week || newGlobal.day !== oldGlobal.day)) {
          // cycleStartDate deliberately not written here — it's the sole editable/
          // backfillable boundary now; moving it on a routine correction would wall
          // off everything before it. Only archiveAndStartNewCycle/onboarding may set
          // it. See the same rule enforced in app/settings/page.tsx's saveFoodPosition.
          await saveDoseState({
            ...existing,
            currentWeek: newGlobal.week,
            currentDay: newGlobal.day,
          })
        }
      }

      onSaved({ ...entry, checkedFoods: draft })
      onClose()
    } catch {
      setSaveError("Save failed — please try again")
    } finally {
      setSaving(false)
    }
  }

  function handleSaveTap() {
    commitSave()
  }

  function renderRow(row: Row) {
    const checked = !!draft[row.key]
    const editable = editing && (row.session !== "evening" || isTreatmentRowEditable(row.name))
    return (
      <FoodItem
        key={row.key}
        name={row.name}
        dose={row.dose}
        unit={row.unit}
        prepNote={null}
        capped={false}
        session={row.session}
        checked={checked}
        onChange={val => toggle(row.key, val)}
        disabled={!editable}
        lockedHint={row.session === "evening" ? treatmentLockedHint(row.name) : undefined}
        infoNote={row.session === "evening" ? preAnchorNote(row.name) : undefined}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col" style={{ background: "var(--color-bg)" }}>
      <header
        className="px-4 pb-4 flex items-center justify-between"
        style={{ background: "var(--color-primary)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
      >
        <button onClick={onClose} className="text-white" aria-label="Close">‹ Close</button>
        <h1 className="text-base font-semibold text-white">{formatEntryDate(entry.completedAt)}</h1>
        {editing ? (
          <button onClick={handleSaveTap} disabled={saving} className="text-white font-semibold disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        ) : (
          <button onClick={startEditing} disabled={loadingProgress} className="text-white font-semibold disabled:opacity-50">
            {loadingProgress ? "Loading…" : "Edit"}
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24 flex flex-col gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Maintenance</p>
          <div className="flex flex-col gap-2">
            {morningItems.map(item => {
              if (item.type === "group") {
                return (
                  <FoodGroupRow
                    key={`group-${item.group.id}`}
                    group={item.group}
                    foods={item.foods}
                    checkedFoods={draft}
                    disabled={!editing}
                    onCheck={toggle}
                  />
                )
              }
              const isWeekly = item.type === "weekly"
              const key = `${item.prefix}-${item.food.name}`
              return (
                <FoodItem
                  key={key}
                  name={item.food.name}
                  dose={item.food.dose}
                  unit={item.food.unit}
                  prepNote={item.food.prepNote ?? null}
                  capped={"capped" in item.food ? item.food.capped : false}
                  session="morning"
                  isWeekly={isWeekly}
                  isContinuing={false}
                  checked={!!draft[key]}
                  disabled={!editing}
                  onChange={val => toggle(key, val)}
                />
              )
            })}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Treatment</p>
          <div className="flex flex-col gap-2">{treatmentRows.map(renderRow)}</div>
        </div>
        {medicationRows.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Medications</p>
            <div className="flex flex-col gap-2">{medicationRows.map(renderRow)}</div>
          </div>
        )}
        {saveError && <p className="text-sm" style={{ color: "#dc2626" }}>{saveError}</p>}
      </div>
    </div>
  )
}
