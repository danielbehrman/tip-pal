"use client"

import { useEffect, useState } from "react"
import { DoseLogDay, ParsedSchedule, FoodProgress, ReactionRamp, FoodGroup } from "@/lib/types"
import {
  getFoodEdgeState,
  advanceFoodProgress,
  regressFoodProgress,
  getTreatmentFoodsForWeek,
  getMedicationSessions,
  getGlobalPosition,
  cycleStartDateForPosition,
  treatmentRampActive,
  applyCrossCategoryCredit,
} from "@/lib/schedule"
import {
  updateDoseLogCheckedFoods,
  fetchFoodProgress,
  saveFoodProgress,
  fetchDoseState,
  saveDoseState,
  fetchReactionRamp,
  saveRecommendedGiven,
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
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(entry.checkedFoods)
    setEditing(false)
    setFoodProgress(null)
    setActiveRamp(null)
    setRecommendedFoodCounts({})
    setConfirming(false)
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

  function isRampFrozen(foodName: string): boolean {
    if (!treatmentRampActive(activeRamp)) return false
    return !!activeRamp?.treatmentFoods.some(f => f.name === foodName)
  }

  function isTreatmentRowEditable(foodName: string, wasChecked: boolean): boolean {
    if (!foodProgress) return false
    if (isRampFrozen(foodName)) return false
    const fp = foodProgress.get(foodName)
    if (!fp) return false
    const { canAdvance, canRegress } = getFoodEdgeState(fp, entry.week, entry.day)
    return wasChecked ? canRegress : canAdvance
  }

  function toggle(key: string, val: boolean) {
    setDraft(prev => ({ ...prev, [key]: val }))
  }

  function simulateProgressChange(): { nextProgress: Map<string, FoodProgress>; changed: boolean } | null {
    if (!foodProgress) return null
    let nextProgress = foodProgress
    let changed = false
    for (const row of treatmentRows) {
      const wasChecked = !!entry.checkedFoods[row.key]
      const nowChecked = !!draft[row.key]
      if (wasChecked === nowChecked) continue
      if (isRampFrozen(row.name)) continue
      const fp = nextProgress.get(row.name)
      if (!fp) continue
      const { canAdvance, canRegress } = getFoodEdgeState(fp, entry.week, entry.day)
      if (nowChecked && canAdvance) {
        const updated = new Map(nextProgress)
        updated.set(row.name, advanceFoodProgress(fp, new Date().toISOString()))
        nextProgress = updated
        changed = true
      } else if (!nowChecked && canRegress) {
        const updated = new Map(nextProgress)
        updated.set(row.name, regressFoodProgress(fp))
        nextProgress = updated
        changed = true
      }
    }
    return { nextProgress, changed }
  }

  function willChangePosition(): boolean {
    if (!foodProgress) return false
    const result = simulateProgressChange()
    if (!result || !result.changed) return false
    const oldGlobal = getGlobalPosition(foodProgress)
    const newGlobal = getGlobalPosition(result.nextProgress)
    return newGlobal.week !== oldGlobal.week || newGlobal.day !== oldGlobal.day
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
        if (updated) {
          runningCounts = updated
        }
      }
      if (runningCounts !== recommendedFoodCounts) {
        // Deliberately not calling setRecommendedFoodCounts here: on success this
        // component unmounts via onClose() below, so nothing reads the new value —
        // and if a later step in this save throws, leaving the state at its
        // original baseline means a retry recomputes the same net delta from the
        // same starting point (idempotent) instead of double-applying it.
        saveRecommendedGiven(runningCounts).catch(() => {})
      }

      if (foodProgress) {
        const oldGlobal = getGlobalPosition(foodProgress)
        const result = simulateProgressChange()
        if (result && result.changed) {
          await saveFoodProgress(result.nextProgress)
          const newGlobal = getGlobalPosition(result.nextProgress)
          if (newGlobal.week !== oldGlobal.week || newGlobal.day !== oldGlobal.day) {
            const existing = await fetchDoseState()
            if (existing) {
              await saveDoseState({
                ...existing,
                currentWeek: newGlobal.week,
                currentDay: newGlobal.day,
                cycleStartDate: cycleStartDateForPosition(newGlobal.week, newGlobal.day),
                skipCount: 0,
              })
            }
          }
        }
      }

      onSaved({ ...entry, checkedFoods: draft })
      onClose()
    } catch {
      setSaveError("Save failed — please try again")
    } finally {
      setSaving(false)
      setConfirming(false)
    }
  }

  function handleSaveTap() {
    if (willChangePosition()) {
      setConfirming(true)
    } else {
      commitSave()
    }
  }

  function renderRow(row: Row) {
    const checked = !!draft[row.key]
    const editable = editing && (row.session !== "evening" || isTreatmentRowEditable(row.name, !!entry.checkedFoods[row.key]))
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

      {confirming && (
        <div className="fixed inset-0 z-[80] flex items-end" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white w-full rounded-t-2xl px-6 pt-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <p className="text-base font-semibold mb-5" style={{ color: "var(--color-text-primary)" }}>
              This will change your current week/day position. Are you sure?
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--color-primary-mid)", color: "#fff" }}
                onClick={commitSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Yes, save"}
              </button>
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold"
                style={{ background: "var(--color-primary-border)", color: "var(--color-text-primary)" }}
                onClick={() => setConfirming(false)}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
