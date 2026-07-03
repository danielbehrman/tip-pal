"use client"

import { useState } from "react"
import { ParsedSchedule, DoseState, DayRecord, FoodGroup, FoodProgress } from "@/lib/types"
import { getTotalTreatmentWeeks, calculateBufferFromProgress, getVisitIndex } from "@/lib/schedule"
import MorningSection from "./MorningSection"
import EveningSection from "./EveningSection"
import Link from "next/link"

interface DailyViewProps {
  schedule: ParsedSchedule
  doseState: DoseState
  onStateChange: (updater: (prev: DoseState) => DoseState) => void
  onCompleteDay: () => void
  onSkipDay: () => void
  onSkipMorning: () => void
  appointmentDate: string | null
  familyName: string | null
  completedPositions: Set<string>
  dayRecords: Map<string, DayRecord>
  treatmentAnchor: { week: number; day: number }
  previousDayIncomplete: boolean
  foodGroups: FoodGroup[]
  visitNumber: string | null
  isAppointmentDay: boolean
  foodProgress: Map<string, FoodProgress>
  childPhotoUrl: string | null
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function getDaysToAppointment(appointmentDate: string | null): number | null {
  if (!appointmentDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const appt = new Date(appointmentDate + "T00:00:00")
  const diff = Math.round((appt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : null
}

const CIRCUMFERENCE = 2 * Math.PI * 26 // ≈ 163.4

const BUFFER_INFO_COPY =
  "Buffer days are the days between completing your final week of dosing and your next clinic appointment. " +
  "Your program requires at least 7 days on the final week's dose before your visit. " +
  "Buffer days show how much cushion you have — so you know you're on track. " +
  "Note: The day of your appointment and the day before (for travel) are not counted as buffer days."

export default function DailyView({
  schedule,
  doseState,
  onStateChange,
  onCompleteDay,
  onSkipDay,
  onSkipMorning,
  appointmentDate,
  familyName,
  completedPositions,
  dayRecords,
  treatmentAnchor,
  previousDayIncomplete,
  foodGroups,
  visitNumber,
  isAppointmentDay,
  foodProgress,
  childPhotoUrl,
}: DailyViewProps) {
  const [infoSheetOpen, setInfoSheetOpen] = useState(false)
  const { currentWeek, currentDay, checkedFoods, floorWeek, floorDay } = doseState

  const totalTreatmentWeeks = getTotalTreatmentWeeks(schedule)

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

  const bufferDisplay =
    bufferResult.kind === "days" ? `${bufferResult.count}` :
    bufferResult.kind === "behind" ? `-${bufferResult.count}` :
    "—"

  const viewSeq = (currentWeek - 1) * 7 + currentDay
  const anchorSeq = (treatmentAnchor.week - 1) * 7 + treatmentAnchor.day
  const floorSeq = (floorWeek - 1) * 7 + floorDay
  const isFutureDay = viewSeq > anchorSeq
  const isCurrentTreatmentDay = viewSeq === anchorSeq

  const posKey = `${currentWeek}-${currentDay}`
  const record = dayRecords.get(posKey)
  const projectedDate = new Date()
  projectedDate.setDate(projectedDate.getDate() + (viewSeq - anchorSeq))
  const isSkipped = record?.skipped === true
  const dateLabel = formatDateLabel(projectedDate)
  const isToday = viewSeq === anchorSeq && !isSkipped

  // Visit ring
  const visitIdx = getVisitIndex(visitNumber)
  const visitProgress = visitIdx / 25
  const strokeDashoffset = CIRCUMFERENCE * (1 - visitProgress)

  // Appointment bubble
  const daysToAppt = getDaysToAppointment(appointmentDate)

  const leftDisabled = viewSeq <= floorSeq
  const rightDisabled = !completedPositions.has(posKey)

  function handleNavigate(delta: number) {
    onStateChange(prev => {
      let nextDay = prev.currentDay + delta
      let nextWeek = prev.currentWeek
      if (nextDay > 7) { nextWeek += 1; nextDay = 1 }
      else if (nextDay < 1) { nextWeek -= 1; nextDay = 7 }
      if (nextWeek < 1) return prev
      const nextSeq = (nextWeek - 1) * 7 + nextDay
      const fSeq = (prev.floorWeek - 1) * 7 + prev.floorDay
      if (nextSeq < fSeq) return prev
      const completedDays = { ...(prev.completedDays ?? {}), [`${prev.currentWeek}-${prev.currentDay}`]: prev.checkedFoods }
      const restored = completedDays[`${nextWeek}-${nextDay}`] ?? {}
      return { ...prev, currentWeek: nextWeek, currentDay: nextDay, checkedFoods: restored, completedDays }
    })
  }

  function handleCheck(key: string, val: boolean) {
    onStateChange(prev => ({ ...prev, checkedFoods: { ...prev.checkedFoods, [key]: val } }))
    if (val && key.startsWith("evening-") && !isFutureDay && schedule.treatmentFoods.length > 0) {
      const updatedChecked = { ...checkedFoods, [key]: val }
      const allEveningChecked = schedule.treatmentFoods.every(
        food => !!updatedChecked[`evening-${food.name}`]
      )
      if (allEveningChecked) onCompleteDay()
    }
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#fffbf7" }}>
      {/* Orange header */}
      <header style={{ background: "#ff6b35", paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-4 pt-5 pb-3 flex items-center gap-3">
          {/* Avatar with SVG progress ring */}
          <div className="relative flex-shrink-0" style={{ width: 58, height: 58 }}>
            <svg width="58" height="58" viewBox="0 0 58 58" style={{ position: "absolute", inset: 0 }}>
              <circle
                cx="29" cy="29" r="26"
                fill="none"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="5"
              />
              <circle
                cx="29" cy="29" r="26"
                fill="none"
                stroke="#4fc3f7"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${CIRCUMFERENCE}`}
                strokeDashoffset={`${strokeDashoffset}`}
                transform="rotate(-90 29 29)"
              />
            </svg>
            {/* Avatar inner — child photo or emoji fallback */}
            {childPhotoUrl ? (
              <div
                className="absolute rounded-full overflow-hidden"
                style={{ inset: 6 }}
              >
                <img
                  src={childPhotoUrl}
                  alt="Child"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
            ) : (
              <div
                className="absolute rounded-full flex items-center justify-center"
                style={{ inset: 6, background: "#fff3ec", fontSize: 20 }}
              >
                🧒
              </div>
            )}
          </div>

          {/* Text stack */}
          <div className="flex-1 min-w-0">
            {familyName && (
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.85)" }}>
                {familyName}&apos;s Tip Pal
              </p>
            )}
            <p className="font-semibold text-white" style={{ fontSize: 15 }}>
              {visitNumber ? `Visit ${visitNumber} · ` : ""}Week {treatmentAnchor.week}, Day {treatmentAnchor.day}
            </p>
            {daysToAppt !== null && (
              <span
                className="inline-block text-white mt-0.5"
                style={{
                  background: "rgba(255,255,255,0.20)",
                  borderRadius: 9999,
                  padding: "3px 10px",
                  fontSize: 11,
                  fontWeight: 400,
                }}
              >
                {daysToAppt} days to appointment
              </span>
            )}
          </div>
        </div>

        {/* Buffer days row */}
        <div
          className="flex items-center"
          style={{ padding: "2px 16px 12px" }}
        >
          <span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.85)" }}>
            Buffer days
          </span>
          <span className="ml-1" style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>
            {bufferDisplay}
          </span>
          <button
            className="ml-auto flex items-center justify-center italic"
            style={{
              width: 18,
              height: 18,
              border: "1.5px solid rgba(255,255,255,0.5)",
              borderRadius: "50%",
              fontSize: 10,
              color: "#fff",
              fontFamily: "serif",
              background: "transparent",
            }}
            onClick={() => setInfoSheetOpen(true)}
            aria-label="Buffer days info"
          >
            i
          </button>
        </div>
      </header>

      {/* Day navigator strip */}
      <div
        className="flex items-center justify-between px-4"
        style={{
          background: "#fff8f5",
          borderBottom: "0.5px solid #f0ddd4",
          minHeight: 52,
        }}
      >
        <button
          onClick={() => handleNavigate(-1)}
          disabled={leftDisabled}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "#fff",
            border: "0.5px solid #f0ddd4",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: leftDisabled ? 0.3 : 1,
          }}
          aria-label="Previous day"
        >
          <svg width="8" height="13" viewBox="0 0 8 13" fill="none">
            <path d="M7 1L1 6.5L7 12" stroke="#2d1a0e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="text-center">
          <p className="font-medium" style={{ fontSize: 13, color: "#2d1a0e" }}>
            {isSkipped ? "Skipped" : dateLabel}
          </p>
          {isToday && (
            <p style={{ fontSize: 11, color: "#9a6a55" }}>Today</p>
          )}
        </div>

        <button
          onClick={() => handleNavigate(1)}
          disabled={rightDisabled}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "#fff",
            border: "0.5px solid #f0ddd4",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: rightDisabled ? 0.3 : 1,
          }}
          aria-label="Next day"
        >
          <svg width="8" height="13" viewBox="0 0 8 13" fill="none">
            <path d="M1 1L7 6.5L1 12" stroke="#2d1a0e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 pt-4 pb-24">
        {previousDayIncomplete && isCurrentTreatmentDay && (
          <div
            className="mb-4 px-4 py-3 rounded-xl"
            style={{ background: "#fff8e1", border: "0.5px solid #ffe082" }}
          >
            <p className="text-sm font-medium" style={{ color: "#795548" }}>
              Yesterday wasn&apos;t completed — you can still check off today&apos;s foods.
            </p>
          </div>
        )}

        {isAppointmentDay && isCurrentTreatmentDay ? (
          <div
            className="rounded-xl px-4 py-6 mb-4 flex flex-col gap-3"
            style={{ background: "#e8f4fd", border: "0.5px solid #bdddf5" }}
          >
            <div>
              <p className="text-base font-semibold" style={{ color: "#1a5276" }}>
                {visitNumber ? `Today is Visit ${visitNumber}.` : "Today is your appointment."}
              </p>
              <p className="text-sm mt-1" style={{ color: "#2980b9" }}>
                When you&apos;re ready, start your new food cycle to load your updated schedule.
              </p>
            </div>
            <Link
              href="/new-cycle"
              className="block text-center w-full py-3 text-white text-sm font-semibold rounded-[16px]"
              style={{ background: "#ff6b35" }}
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
              onSkipMorning={onSkipMorning}
              onCompleteDay={onCompleteDay}
              isFutureDay={isFutureDay}
              isCurrentTreatmentDay={isCurrentTreatmentDay}
              isSkipped={isSkipped}
              foodProgress={foodProgress}
            />
          </>
        )}
      </div>

      {/* ⓘ info sheet overlay */}
      {infoSheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "rgba(0,0,0,0.3)" }}
          onClick={() => setInfoSheetOpen(false)}
        >
          <div
            className="w-full mx-auto rounded-t-2xl px-6 pt-6 pb-10 shadow-xl"
            style={{ maxWidth: 430, background: "#fff" }}
            onClick={e => e.stopPropagation()}
          >
            <p className="text-sm leading-relaxed" style={{ color: "#4a3728" }}>
              {BUFFER_INFO_COPY}
            </p>
            <button
              className="mt-5 w-full py-3 rounded-xl text-sm font-medium"
              style={{ background: "#f5efe9", color: "#2d1a0e" }}
              onClick={() => setInfoSheetOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
