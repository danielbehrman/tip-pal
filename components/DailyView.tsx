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
  onStateChange: (updater: (prev: DoseState) => DoseState) => void
  onCompleteDay: () => void
  onSkipMorning: () => void
  onSkipEvening: () => void
  appointmentDate: string | null
  anchorTimestamp: string | null
  onAppointmentChange: (value: string) => void
  familyName: string | null
  completedPositions: Set<string>
}

export default function DailyView({ schedule, doseState, onStateChange, onCompleteDay, onSkipMorning, onSkipEvening, appointmentDate, anchorTimestamp, onAppointmentChange, familyName, completedPositions }: DailyViewProps) {
  const [confirmingComplete, setConfirmingComplete] = useState(false)
  const [completionAttempted, setCompletionAttempted] = useState(false)

  const { currentWeek, currentDay, checkedFoods, morningSkipped, eveningSkipped } = doseState

  const bufferResult = calculateBuffer(appointmentDate, anchorTimestamp)
  const eveningItems = getTreatmentFoodsForWeek(schedule, currentWeek)
  const allEveningChecked = eveningItems.every(({ food }) => !!checkedFoods[`evening-${food.name}`])
  const showEveningError = completionAttempted && !allEveningChecked

  function handleCheck(key: string, val: boolean) {
    onStateChange(prev => ({ ...prev, checkedFoods: { ...prev.checkedFoods, [key]: val } }))
  }

  function handleWeekChange(delta: number) {
    onStateChange(prev => {
      const nextWeek = prev.currentWeek + delta
      if (nextWeek < 1) return prev
      const completedDays = {
        ...(prev.completedDays ?? {}),
        [`${prev.currentWeek}-${prev.currentDay}`]: prev.checkedFoods,
      }
      const restored = completedDays[`${nextWeek}-${prev.currentDay}`] ?? {}
      return { ...prev, currentWeek: nextWeek, checkedFoods: restored, completedDays, morningSkipped: false, eveningSkipped: false }
    })
  }

  function handleDayChange(delta: number) {
    onStateChange(prev => {
      const nextDay = prev.currentDay + delta
      if (nextDay < 1 || nextDay > 7) return prev
      const completedDays = {
        ...(prev.completedDays ?? {}),
        [`${prev.currentWeek}-${prev.currentDay}`]: prev.checkedFoods,
      }
      const restored = completedDays[`${prev.currentWeek}-${nextDay}`] ?? {}
      return { ...prev, currentDay: nextDay, checkedFoods: restored, completedDays, morningSkipped: false, eveningSkipped: false }
    })
  }

  function handleCompleteDay() {
    setConfirmingComplete(false)
    setCompletionAttempted(false)
    onCompleteDay()
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 min-h-screen flex flex-col">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            {familyName && (
              <p className="text-sm text-gray-500 mb-0.5">{familyName}&apos;s TIP Pal</p>
            )}
            <h1 className="text-2xl font-bold">
              Week {currentWeek}, Day {currentDay}
            </h1>
          </div>
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
              className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold disabled:opacity-30"
              disabled={!!eveningSkipped}
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
              disabled={currentDay >= 7 || !!eveningSkipped || !completedPositions.has(`${currentWeek}-${currentDay}`)}
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
        skipped={!!morningSkipped}
        onSkip={onSkipMorning}
      />

      <EveningSection
        schedule={schedule}
        currentWeek={currentWeek}
        checkedFoods={checkedFoods}
        onCheck={handleCheck}
        skipped={!!eveningSkipped}
        onSkip={onSkipEvening}
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
              {eveningSkipped
                ? "Evening session was skipped — give the same evening treatment foods again before advancing to the next day."
                : "Please verify all evening treatment foods were given. If any dose was missed, give the same amounts again the next day — do not advance until all evening foods are completed."}
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

        <div className="flex justify-center gap-6 mt-4 pb-4">
          <Link href="/history" className="text-sm text-gray-400 underline">
            Dose history
          </Link>
          <Link href="/settings" className="text-sm text-gray-400 underline">
            Settings
          </Link>
        </div>
      </div>
    </div>
  )
}
