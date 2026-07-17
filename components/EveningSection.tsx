"use client"

import { useState } from "react"
import { ParsedSchedule, FoodProgress, Medication } from "@/lib/types"
import { getMedicationSessions, getTreatmentFoodEntry, foodsAreInSync } from "@/lib/schedule"
import FoodItem from "./FoodItem"
import SectionHeader from "./ui/SectionHeader"
import CTAButton from "./ui/CTAButton"
import CompleteDayConfirm from "./CompleteDayConfirm"

interface EveningSectionProps {
  schedule: ParsedSchedule
  currentWeek: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
  onSkipMorning: () => void
  onCompleteDayTap: () => void
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
  onSkipMorning,
  onCompleteDayTap,
  isFutureDay,
  isCurrentTreatmentDay,
  isSkipped,
  foodProgress,
}: EveningSectionProps) {
  const inSync = foodsAreInSync(foodProgress)
  const treatmentFoods = schedule.treatmentFoods
  const eveningMeds = getEveningMedications(schedule.medications)

  // Count: treatment foods + medications
  const itemCount = treatmentFoods.length + eveningMeds.length

  const showActions = isCurrentTreatmentDay && !isFutureDay && !isSkipped

  const [showConfirm, setShowConfirm] = useState(false)

  const uncheckedTreatmentFoods = treatmentFoods.filter(
    food => !checkedFoods[`evening-${food.name}`]
  ).map(food => food.name)

  function handleCompleteDayTap() {
    if (uncheckedTreatmentFoods.length === 0) {
      onCompleteDayTap()
      return
    }
    setShowConfirm(true)
  }

  function handleConfirm() {
    setShowConfirm(false)
    onCompleteDayTap()
  }

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

          {/* Complete Day — always enabled; confirm dialog handles partial/zero checks */}
          {showActions && (
            <div className="mt-4">
              <CTAButton onClick={handleCompleteDayTap}>
                Complete Day
              </CTAButton>
            </div>
          )}

          {/* Skip morning — informational log only */}
          {showActions && (
            <div className="mt-3 flex flex-col items-center gap-1">
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
      {showConfirm && (
        <CompleteDayConfirm
          unchecked={uncheckedTreatmentFoods}
          noneChecked={uncheckedTreatmentFoods.length === treatmentFoods.length}
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </section>
  )
}
