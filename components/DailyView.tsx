"use client"

import { useState } from "react"
import { ParsedSchedule, DoseState } from "@/lib/types"
import MorningSection from "./MorningSection"
import EveningSection from "./EveningSection"
import Link from "next/link"

interface DailyViewProps {
  schedule: ParsedSchedule
  doseState: DoseState
  onStateChange: (state: DoseState) => void
}

export default function DailyView({ schedule, doseState, onStateChange }: DailyViewProps) {
  const [confirmingComplete, setConfirmingComplete] = useState(false)

  const { currentWeek, currentDay, checkedFoods } = doseState

  function handleCheck(key: string, val: boolean) {
    onStateChange({
      ...doseState,
      checkedFoods: { ...checkedFoods, [key]: val },
    })
  }

  function handleWeekChange(delta: number) {
    const next = currentWeek + delta
    if (next < 1) return
    onStateChange({ ...doseState, currentWeek: next })
  }

  function handleDayChange(delta: number) {
    const next = currentDay + delta
    if (next < 1 || next > 7) return
    onStateChange({ ...doseState, currentDay: next })
  }

  function handleCompleteDay() {
    setConfirmingComplete(false)
    let nextDay = currentDay
    let nextWeek = currentWeek
    if (currentDay < 7) {
      nextDay = currentDay + 1
    } else {
      nextDay = 1
      nextWeek = currentWeek + 1
    }
    onStateChange({ currentWeek: nextWeek, currentDay: nextDay, checkedFoods: {} })
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
          onClick={() => setConfirmingComplete(true)}
        >
          Complete Day
        </button>

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
