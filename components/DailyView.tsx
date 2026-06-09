"use client"

import { ParsedSchedule, DoseState } from "@/lib/types"
import { getTreatmentFoodsForWeek, getTotalTreatmentWeeks, calculateBuffer } from "@/lib/schedule"
import MorningSection from "./MorningSection"
import EveningSection from "./EveningSection"
import Link from "next/link"

interface DailyViewProps {
  schedule: ParsedSchedule
  doseState: DoseState
  onStateChange: (updater: (prev: DoseState) => DoseState) => void
  onCompleteDay: () => void
  appointmentDate: string | null
  onAppointmentChange: (value: string) => void
  familyName: string | null
  completedPositions: Set<string>
  completedDayDates: Map<string, string>
  treatmentAnchor: { week: number; day: number }
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

export default function DailyView({
  schedule,
  doseState,
  onStateChange,
  onCompleteDay,
  appointmentDate,
  onAppointmentChange,
  familyName,
  completedPositions,
  completedDayDates,
  treatmentAnchor,
}: DailyViewProps) {
  const { currentWeek, currentDay, checkedFoods } = doseState

  const bufferResult = calculateBuffer(appointmentDate, getTotalTreatmentWeeks(schedule))
  const eveningItems = getTreatmentFoodsForWeek(schedule, currentWeek)

  const viewSeq = (currentWeek - 1) * 7 + currentDay
  const anchorSeq = (treatmentAnchor.week - 1) * 7 + treatmentAnchor.day
  const isFutureDay = viewSeq > anchorSeq
  const isCurrentTreatmentDay = viewSeq === anchorSeq

  // Past days: use completion date from DB.
  // Current day: today. Future days: today + days ahead.
  const posKey = `${currentWeek}-${currentDay}`
  const isPastDay = viewSeq < anchorSeq
  const projectedDate = new Date()
  projectedDate.setDate(projectedDate.getDate() + (viewSeq - anchorSeq))
  const dateLabel = isPastDay && completedDayDates.has(posKey)
    ? formatDateLabel(new Date(completedDayDates.get(posKey)!))
    : formatDateLabel(projectedDate)

  function handleCheck(key: string, val: boolean) {
    onStateChange(prev => ({ ...prev, checkedFoods: { ...prev.checkedFoods, [key]: val } }))

    if (val && key.startsWith("evening-") && isCurrentTreatmentDay && eveningItems.length > 0) {
      const updatedChecked = { ...checkedFoods, [key]: val }
      const allEveningChecked = eveningItems.every(
        ({ food }) => !!updatedChecked[`evening-${food.name}`]
      )
      if (allEveningChecked) {
        onCompleteDay()
      }
    }
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
      return { ...prev, currentWeek: nextWeek, checkedFoods: restored, completedDays }
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
      return { ...prev, currentDay: nextDay, checkedFoods: restored, completedDays }
    })
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
              Week {currentWeek}, Day {currentDay} · {dateLabel}
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
              disabled={currentDay >= 7 || !completedPositions.has(`${currentWeek}-${currentDay}`)}
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
            {bufferResult.count} buffer day{bufferResult.count !== 1 ? "s" : ""} after completing protocol
          </p>
        )}
        {bufferResult.kind === "behind" && (
          <p className="mt-2 text-sm text-amber-700 font-medium">
            {bufferResult.count} day{bufferResult.count !== 1 ? "s" : ""} short — appointment falls within the protocol period
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
        isFutureDay={isFutureDay}
      />

      <EveningSection
        schedule={schedule}
        currentWeek={currentWeek}
        checkedFoods={checkedFoods}
        onCheck={handleCheck}
        isFutureDay={isFutureDay}
      />

      <div className="mt-auto pt-4">
        <div className="flex justify-center gap-6 pb-4">
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
