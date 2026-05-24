"use client"

import { useState } from "react"
import { ParsedSchedule, DoseState } from "@/lib/types"
import { getTreatmentFoodsForWeek, calculateBuffer } from "@/lib/schedule"
import MorningSection from "./MorningSection"
import EveningSection from "./EveningSection"
import Link from "next/link"

interface DailyViewProps {
  schedule: ParsedSchedule
  doseState: DoseState
  onStateChange: (state: DoseState) => void
  appointmentDate: string | null
  anchorTimestamp: string | null
  onAppointmentChange: (value: string) => void
}

export default function DailyView({ schedule, doseState, onStateChange, appointmentDate, anchorTimestamp, onAppointmentChange }: DailyViewProps) {
  const [confirmingComplete, setConfirmingComplete] = useState(false)
  const [completionAttempted, setCompletionAttempted] = useState(false)

  const { currentWeek, currentDay, checkedFoods } = doseState

  const bufferResult = calculateBuffer(appointmentDate, anchorTimestamp)
  const eveningItems = getTreatmentFoodsForWeek(schedule, currentWeek)
  const allEveningChecked = eveningItems.every(
    ({ food }) => !!checkedFoods[`evening-${food.name}`]
  )
  const showEveningError = completionAttempted && !allEveningChecked

  function handleCheck(key: string, val: boolean) {
    onStateChange({
      ...doseState,
      checkedFoods: { ...checkedFoods, [key]: val },
    })
  }

  function handleWeekChange(delta: number) {
    const nextWeek = currentWeek + delta
    if (nextWeek < 1) return
    const completedDays = {
      ...(doseState.completedDays ?? {}),
      [`${currentWeek}-${currentDay}`]: checkedFoods,
    }
    const restored = completedDays[`${nextWeek}-${currentDay}`] ?? {}
    onStateChange({ ...doseState, currentWeek: nextWeek, checkedFoods: restored, completedDays })
  }

  function handleDayChange(delta: number) {
    const nextDay = currentDay + delta
    if (nextDay < 1 || nextDay > 7) return
    const completedDays = {
      ...(doseState.completedDays ?? {}),
      [`${currentWeek}-${currentDay}`]: checkedFoods,
    }
    const restored = completedDays[`${currentWeek}-${nextDay}`] ?? {}
    onStateChange({ ...doseState, currentDay: nextDay, checkedFoods: restored, completedDays })
  }

  function handleCompleteDay() {
    setConfirmingComplete(false)
    setCompletionAttempted(false)
    let nextDay = currentDay
    let nextWeek = currentWeek
    if (currentDay < 7) {
      nextDay = currentDay + 1
    } else {
      nextDay = 1
      nextWeek = currentWeek + 1
    }
    // Snapshot current checkboxes before clearing so back-navigation can restore them
    const completedDays = {
      ...(doseState.completedDays ?? {}),
      [`${currentWeek}-${currentDay}`]: checkedFoods,
    }
    onStateChange({ currentWeek: nextWeek, currentDay: nextDay, checkedFoods: {}, completedDays })
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 min-h-screen flex flex-col">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">
            Week {currentWeek}, Day {currentDay}
          </h1>
        </div>

        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 w-10">Week</span>
            <button
              onClick={() => handleWeekChange(-1)}
              className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold disabled:opacity-30"
              disabled={currentWeek <= 1}
            >
              −
            </button>
            <span className="text-lg font-semibold w-6 text-center">{currentWeek}</span>
            <button
              onClick={() => handleWeekChange(1)}
              className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold"
            >
              +
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 w-8">Day</span>
            <button
              onClick={() => handleDayChange(-1)}
              className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold disabled:opacity-30"
              disabled={currentDay <= 1}
            >
              −
            </button>
            <span className="text-lg font-semibold w-6 text-center">{currentDay}</span>
            <button
              onClick={() => handleDayChange(1)}
              className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold disabled:opacity-30"
              disabled={currentDay >= 7}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm text-gray-500 mb-1" htmlFor="next-appointment">
          Next appointment
        </label>
        <input
          id="next-appointment"
          type="date"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full"
          value={appointmentDate ?? ""}
          onChange={(e) => onAppointmentChange(e.target.value)}
        />
        {bufferResult.kind === "days" && (
          <p className="mt-2 text-sm text-gray-600">
            {bufferResult.count} buffer day{bufferResult.count !== 1 ? "s" : ""} before appointment
          </p>
        )}
        {bufferResult.kind === "past" && (
          <p className="mt-2 text-sm text-amber-700 font-medium">
            Appointment date has passed — please update
          </p>
        )}
      </div>

      <MorningSection
        schedule={schedule}
        currentDay={currentDay}
        checkedFoods={checkedFoods}
        onCheck={handleCheck}
      />

      <EveningSection
        schedule={schedule}
        currentWeek={currentWeek}
        checkedFoods={checkedFoods}
        onCheck={handleCheck}
      />

      <div className="mt-auto pt-4">
        <button
          className="bg-slate-900 text-white w-full py-4 text-lg font-semibold rounded-xl"
          onClick={() => {
            setCompletionAttempted(true)
            if (allEveningChecked) {
              setConfirmingComplete(true)
            } else {
              setConfirmingComplete(false)
            }
          }}
        >
          Complete Day
        </button>

        {showEveningError && (
          <div className="mt-3 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl">
            <p className="text-sm text-amber-900 font-medium">
              Please verify all evening treatment foods were given. If any dose was missed, give the same amounts again the next day — do not advance until all evening foods are completed.
            </p>
          </div>
        )}

        {confirmingComplete && (
          <div className="flex items-center justify-between mt-3 px-2 py-2 bg-gray-100 rounded-xl">
            <span className="text-sm font-medium">Confirm complete?</span>
            <div className="flex gap-3">
              <button
                className="px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
                onClick={handleCompleteDay}
              >
                Yes
              </button>
              <button
                className="px-4 py-2 bg-gray-200 text-gray-800 text-sm font-semibold rounded-lg"
                onClick={() => setConfirmingComplete(false)}
              >
                No
              </button>
            </div>
          </div>
        )}

        <div className="text-center mt-4 pb-4">
          <Link href="/setup" className="text-sm text-gray-400 underline">
            Re-parse schedule
          </Link>
        </div>
      </div>
    </div>
  )
}
