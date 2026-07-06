"use client"

import { useState } from "react"
import { ParsedSchedule, FoodProgress, Medication } from "@/lib/types"
import { getMedicationSessions, getTreatmentFoodEntry, foodsAreInSync } from "@/lib/schedule"
import FoodItem from "./FoodItem"
import SectionHeader from "./ui/SectionHeader"
import CTAButton from "./ui/CTAButton"

interface EveningSectionProps {
  schedule: ParsedSchedule
  currentWeek: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
  onSkipDay: () => void
  onSkipMorning: () => void
  onCompleteDay: () => void
  isFutureDay: boolean
  isCurrentTreatmentDay: boolean
  isSkipped: boolean
  foodProgress: Map<string, FoodProgress>
}

function getEveningMedications(medications: Medication[] | undefined): Medication[] {
  if (!medications?.length) return []
  return medications.filter(med => getMedicationSessions(med.frequency).includes("evening"))
}

export default function EveningSection({
  schedule,
  currentWeek,
  checkedFoods,
  onCheck,
  onSkipDay,
  onSkipMorning,
  onCompleteDay,
  isFutureDay,
  isCurrentTreatmentDay,
  isSkipped,
  foodProgress,
}: EveningSectionProps) {
  const [confirmingSkip, setConfirmingSkip] = useState(false)

  const inSync = foodsAreInSync(foodProgress)
  const treatmentFoods = schedule.treatmentFoods
  const eveningMeds = getEveningMedications(schedule.medications)

  const allTreatmentChecked =
    treatmentFoods.length > 0 &&
    treatmentFoods.every(food => !!checkedFoods[`evening-${food.name}`])

  // Count: treatment foods + medications
  const itemCount = treatmentFoods.length + eveningMeds.length

  const showActions = isCurrentTreatmentDay && !isFutureDay && !isSkipped

  return (
    <section className="mb-6">
      <SectionHeader session="evening" label="Evening" count={itemCount} />

      {isFutureDay ? (
        <div
          className="px-4 py-3 rounded-xl"
          style={{ background: "#fff8e1", border: "0.5px solid #ffe082" }}
        >
          <p className="text-sm font-medium" style={{ color: "#795548" }}>
            You haven&apos;t reached this treatment day yet
          </p>
        </div>
      ) : (
        <>
          {/* Treatment foods */}
          {treatmentFoods.map(food => {
            const fp = foodProgress.get(food.name)
            const foodWeek = fp?.week ?? currentWeek
            const { weekEntry, isContinuing } = getTreatmentFoodEntry(food, foodWeek)
            const weekBadge = !inSync && fp ? `Wk ${fp.week} · Day ${fp.day}` : undefined
            const key = `evening-${food.name}`
            return (
              <FoodItem
                key={key}
                name={food.name}
                dose={weekEntry.dose}
                unit={weekEntry.unit}
                prepNote={null}
                capped={false}
                session="evening"
                isContinuing={isContinuing}
                checked={!!checkedFoods[key]}
                onChange={val => onCheck(key, val)}
                weekBadge={weekBadge}
              />
            )
          })}

          {/* Evening medications */}
          {eveningMeds.map(med => {
            const key = `evening-med-${med.name}`
            return (
              <FoodItem
                key={key}
                name={med.name}
                dose={med.dose}
                unit={med.unit}
                prepNote={null}
                capped={false}
                session="med"
                checked={!!checkedFoods[key]}
                onChange={val => onCheck(key, val)}
              />
            )
          })}

          {/* Complete Day — always visible; disabled until all treatment foods checked */}
          {showActions && (
            <div className="mt-4">
              <CTAButton
                disabled={!allTreatmentChecked}
                onClick={onCompleteDay}
              >
                Complete Day
              </CTAButton>
            </div>
          )}

          {/* Skip links */}
          {showActions && (
            <div className="mt-3 flex flex-col items-center gap-1">
              {/* Skip evening — position freeze; only when not all checked */}
              {!allTreatmentChecked && !confirmingSkip && (
                <button
                  className="text-sm underline"
                  style={{ color: "var(--color-text-muted)" }}
                  onClick={() => setConfirmingSkip(true)}
                >
                  Skip evening
                </button>
              )}
              {confirmingSkip && (
                <div
                  className="w-full px-4 py-3 rounded-xl"
                  style={{ background: "var(--color-bg-secondary)", border: "0.5px solid var(--color-primary-border)" }}
                >
                  <p className="text-sm font-medium mb-3" style={{ color: "var(--color-text-primary)" }}>
                    Skip this day? Tomorrow will repeat the same week and day. This can&apos;t be undone.
                  </p>
                  <div className="flex gap-3">
                    <button
                      className="flex-1 py-2 text-sm font-semibold rounded-lg"
                      style={{ background: "var(--color-primary-mid)", color: "#fff" }}
                      onClick={() => { setConfirmingSkip(false); onSkipDay() }}
                    >
                      Yes — skip
                    </button>
                    <button
                      className="flex-1 py-2 text-sm font-semibold rounded-lg"
                      style={{ background: "var(--color-primary-border)", color: "var(--color-text-primary)" }}
                      onClick={() => setConfirmingSkip(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {/* Skip morning — informational log only */}
              <button
                className="text-sm underline"
                style={{ color: "var(--color-text-muted)" }}
                onClick={onSkipMorning}
              >
                Skip morning
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
