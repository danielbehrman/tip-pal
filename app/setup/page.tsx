"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import PasteInput from "@/components/PasteInput"
import ScheduleReview from "@/components/ScheduleReview"
import { ParsedSchedule } from "@/lib/types"
import { saveSchedule, saveDoseState, getSession } from "@/lib/supabase"
import { todayDateString } from "@/lib/schedule"

type View = "paste" | "loading" | "review" | "error"

export default function SetupPage() {
  const router = useRouter()
  const [view, setView] = useState<View>("paste")
  const [rawText, setRawText] = useState("")
  const [parsedSchedule, setParsedSchedule] = useState<ParsedSchedule | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    getSession().then((session) => {
      if (!session) router.replace("/login")
    })
  }, [router])

  async function handleSubmit() {
    setView("loading")
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""
      const res = await fetch(`${apiBase}/api/parse-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawText }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error ?? "Unknown error")
        setView("error")
        return
      }
      setParsedSchedule(data.schedule)
      setView("review")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
      setView("error")
    }
  }

  async function handleConfirm() {
    if (!parsedSchedule) return
    try {
      await saveSchedule(parsedSchedule)
      await saveDoseState({
        currentWeek: 1,
        currentDay: 1,
        checkedFoods: {},
        cycleStartDate: todayDateString(),
        skipCount: 0,
        floorWeek: 1,
        floorDay: 1,
      })
      router.push("/onboarding")
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Failed to save schedule. Please try again."
      setError(msg)
      setView("error")
    }
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-8 min-h-screen">
      <h1 className="text-2xl font-bold mb-6">Setup Dosing Schedule</h1>

      {view === "paste" && (
        <PasteInput
          value={rawText}
          onChange={setRawText}
          onSubmit={handleSubmit}
        />
      )}

      {view === "loading" && (
        <p className="text-gray-600 text-lg">Parsing schedule...</p>
      )}

      {view === "review" && parsedSchedule && (
        <ScheduleReview
          schedule={parsedSchedule}
          onScheduleChange={setParsedSchedule}
          onConfirm={handleConfirm}
          onBack={() => setView("paste")}
        />
      )}

      {view === "error" && (
        <div className="flex flex-col gap-4">
          <p className="text-red-700 font-medium">Error: {error}</p>
          <button
            className="w-full py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl"
            onClick={() => setView("paste")}
          >
            Try Again
          </button>
        </div>
      )}
    </main>
  )
}
