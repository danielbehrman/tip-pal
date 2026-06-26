"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import PasteInput from "@/components/PasteInput"
import NewCycleReview from "@/components/NewCycleReview"
import { ParsedSchedule } from "@/lib/types"
import { fetchSchedule, archiveAndStartNewCycle, getSession } from "@/lib/supabase"

type View = "paste" | "loading" | "review" | "confirming" | "error"

export default function NewCyclePage() {
  const router = useRouter()
  const [view, setView] = useState<View>("paste")
  const [rawText, setRawText] = useState("")
  const [currentSchedule, setCurrentSchedule] = useState<ParsedSchedule | null>(null)
  const [parsedSchedule, setParsedSchedule] = useState<ParsedSchedule | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    async function init() {
      const session = await getSession()
      if (!session) {
        router.replace("/login")
        return
      }
      const s = await fetchSchedule().catch(() => null)
      setCurrentSchedule(s)
    }
    init()
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
    setView("confirming")
    try {
      await archiveAndStartNewCycle(
        currentSchedule,
        parsedSchedule,
        parsedSchedule.visitNumber ?? null,
        parsedSchedule.appointmentDate ?? null
      )
      router.push("/daily")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save new cycle")
      setView("error")
    }
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-8 min-h-screen">
      <h1 className="text-2xl font-bold mb-2">New Food Cycle</h1>
      <p className="text-sm text-gray-500 mb-6">
        Paste your updated plan of care. Your current schedule will be archived and replaced.
      </p>

      {view === "paste" && (
        <PasteInput
          value={rawText}
          onChange={setRawText}
          onSubmit={handleSubmit}
        />
      )}

      {view === "loading" && (
        <p className="text-gray-600 text-lg">Parsing new schedule…</p>
      )}

      {view === "review" && parsedSchedule && (
        <NewCycleReview
          currentSchedule={currentSchedule}
          newSchedule={parsedSchedule}
          onBack={() => setView("paste")}
          onConfirm={handleConfirm}
          confirming={false}
        />
      )}

      {view === "confirming" && (
        <p className="text-gray-600 text-lg">Saving new food cycle…</p>
      )}

      {view === "error" && (
        <div className="flex flex-col gap-4">
          <p className="text-red-700 font-medium">Error: {error}</p>
          <button
            className="w-full py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl"
            onClick={() => { setView("paste"); setError("") }}
          >
            Try Again
          </button>
        </div>
      )}
    </main>
  )
}
