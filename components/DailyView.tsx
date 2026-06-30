"use client"

import { ParsedSchedule, DoseState, DayRecord, FoodGroup, FoodProgress } from "@/lib/types"
import { getTotalTreatmentWeeks, calculateBufferFromProgress } from "@/lib/schedule"
import MorningSection from "./MorningSection"
import EveningSection from "./EveningSection"
import Link from "next/link"

interface DailyViewProps {
  schedule: ParsedSchedule
  doseState: DoseState
  onStateChange: (updater: (prev: DoseState) => DoseState) => void
  onCompleteDay: () => void
  onSkipDay: () => void
  appointmentDate: string | null
  onAppointmentChange: (value: string) => void
  familyName: string | null
  completedPositions: Set<string>
  dayRecords: Map<string, DayRecord>
  treatmentAnchor: { week: number; day: number }
  previousDayIncomplete: boolean
  foodGroups: FoodGroup[]
  visitNumber: string | null
  isAppointmentDay: boolean
  foodProgress: Map<string, FoodProgress>
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

export default function DailyView({
  schedule,
  doseState,
  onStateChange,
  onCompleteDay,
  onSkipDay,
  appointmentDate,
  onAppointmentChange,
  familyName,
  completedPositions,
  dayRecords,
  treatmentAnchor,
  previousDayIncomplete,
  foodGroups,
  visitNumber,
  isAppointmentDay,
  foodProgress,
}: DailyViewProps) {
  const { currentWeek, currentDay, checkedFoods, floorWeek, floorDay } = doseState

  const totalTreatmentWeeks = getTotalTreatmentWeeks(schedule)

  // Find the slowest food's completedDays for buffer projection
  let slowestCompletedDays = 0
  if (foodProgress.size > 0) {
    let minIdx = Infinity
    for (const fp of foodProgress.values()) {
      const idx = (fp.week - 1) * 7 + (fp.day - 1)
      if (idx < minIdx) {
        minIdx = idx
        slowestCompletedDays = fp.completedDays
      }
    }
  }

  const bufferResult = calculateBufferFromProgress(
    appointmentDate,
    totalTreatmentWeeks,
    doseState.currentWeek,
    slowestCompletedDays
  )
  const eveningItems = schedule.treatmentFoods

  const viewSeq = (currentWeek - 1) * 7 + currentDay
  const anchorSeq = (treatmentAnchor.week - 1) * 7 + treatmentAnchor.day
  const floorSeq = (floorWeek - 1) * 7 + floorDay
  const isFutureDay = viewSeq > anchorSeq
  const isCurrentTreatmentDay = viewSeq === anchorSeq
  const isPastDay = viewSeq < anchorSeq

  const posKey = `${currentWeek}-${currentDay}`
  const record = dayRecords.get(posKey)
  const projectedDate = new Date()
  projectedDate.setDate(projectedDate.getDate() + (viewSeq - anchorSeq))
  const isSkipped = record?.skipped === true
  // Date always comes from the calendar formula, never from dose_log's completed_at.
  // A position's date and its dose_log record's timestamp can diverge (bulk catch-up
  // actions, pre-F0.1 history, resets) — the formula is the single source of truth
  // for "what date is this position" under calendar-anchored dating. record is used
  // only to determine isSkipped above, never for what date to display.
  const dateLabel = formatDateLabel(projectedDate)
  const showPreviousDayWarning = isCurrentTreatmentDay && previousDayIncomplete

  function handleCheck(key: string, val: boolean) {
    onStateChange(prev => ({ ...prev, checkedFoods: { ...prev.checkedFoods, [key]: val } }))

    // Auto-complete fires on any non-future day, not just the live current day —
    // finishing a previous day's evening checkboxes after it's auto-advanced past
    // (e.g. correcting via trailing edit) retroactively logs the completion,
    // consistent with checking the boxes on the day itself.
    if (val && key.startsWith("evening-") && !isFutureDay && eveningItems.length > 0) {
      const updatedChecked = { ...checkedFoods, [key]: val }
      const allEveningChecked = eveningItems.every(
        food => !!updatedChecked[`evening-${food.name}`]
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
      const nextSeq = (nextWeek - 1) * 7 + prev.currentDay
      const floorSeq = (prev.floorWeek - 1) * 7 + prev.floorDay
      if (nextSeq < floorSeq) return prev
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
      const nextSeq = (prev.currentWeek - 1) * 7 + nextDay
      const floorSeq = (prev.floorWeek - 1) * 7 + prev.floorDay
      if (nextSeq < floorSeq) return prev
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
              <p className="text-sm text-gray-500 mb-0.5">{familyName}&apos;s Tip Pal</p>
            )}
            <h1 className="text-2xl font-bold">
              {isSkipped ? "Skipped" : `Week ${currentWeek}, Day ${currentDay}`} · {dateLabel}
            </h1>
          </div>
        </div>

        {showPreviousDayWarning && (
          <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl">
            <p className="text-sm text-amber-900 font-medium">
              Yesterday wasn&apos;t completed — you can still check off today&apos;s foods.
            </p>
          </div>
        )}

        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 w-10">Week</span>
            <button
              onClick={() => handleWeekChange(-1)}
              className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold disabled:opacity-30"
              disabled={currentWeek <= 1 || viewSeq - 7 < floorSeq}
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
              disabled={currentDay <= 1 || viewSeq - 1 < floorSeq}
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
          {visitNumber ? `Next appointment, Visit ${visitNumber}` : "Next appointment"}
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

      {isAppointmentDay && isCurrentTreatmentDay ? (
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-6 mb-4 flex flex-col gap-3">
          <div>
            <p className="text-base font-semibold text-blue-900">
              {visitNumber ? `Today is Visit ${visitNumber}.` : "Today is your appointment."}
            </p>
            <p className="text-sm text-blue-800 mt-1">
              When you&apos;re ready, start your new food cycle to load your updated schedule.
            </p>
          </div>
          <Link
            href="/new-cycle"
            className="inline-block text-center w-full py-3 bg-slate-900 text-white text-sm font-semibold rounded-xl"
          >
            Start new food cycle
          </Link>
        </div>
      ) : (
        <>
          <MorningSection
            schedule={schedule}
            currentDay={currentDay}
            checkedFoods={checkedFoods}
            onCheck={handleCheck}
            isFutureDay={isFutureDay}
            foodGroups={foodGroups}
          />

          <EveningSection
            schedule={schedule}
            currentWeek={currentWeek}
            checkedFoods={checkedFoods}
            onCheck={handleCheck}
            onSkipDay={onSkipDay}
            isFutureDay={isFutureDay}
            isCurrentTreatmentDay={isCurrentTreatmentDay}
            isSkipped={isSkipped}
            foodProgress={foodProgress}
          />
        </>
      )}

      <div className="mt-auto pt-4">
        <div className="flex justify-center gap-6 pb-4">
          {((schedule.recommendedFoods?.length ?? 0) > 0 || (schedule.medications?.length ?? 0) > 0) && (
            <Link href="/foods" className="text-sm text-gray-400 underline">
              Recommended
            </Link>
          )}
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
