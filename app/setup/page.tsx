"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Orange header with empty ring avatar */}
      <header
        className="flex items-center gap-4 px-4 pb-4"
        style={{ background: "var(--color-primary)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
      >
        {/* Empty progress ring avatar */}
        <div className="relative flex items-center justify-center shrink-0" style={{ width: 60, height: 60 }}>
          <svg width="60" height="60" viewBox="0 0 60 60">
            <circle cx="30" cy="30" r="26" fill="none" stroke="var(--color-primary-border)" strokeWidth="4" />
          </svg>
          <div
            className="absolute rounded-full overflow-hidden flex items-center justify-center"
            style={{ width: 44, height: 44, background: "var(--color-primary-light)", fontSize: 22 }}
          >
            🧒
          </div>
        </div>
        <h1 className="text-xl font-semibold text-white">Load your dosing plan</h1>
      </header>

      {/* Paste view */}
      {(view === "paste" || view === "loading") && (
        <div className="px-4 pt-6 pb-24 flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text-primary)" }}>
              Paste your dosing plan
            </p>
            <textarea
              className="w-full p-4 rounded-xl text-base resize-none outline-none"
              style={{
                minHeight: 200,
                border: "0.5px solid var(--color-primary-border)",
                color: "var(--color-text-primary)",
                background: "#fff",
              }}
              placeholder="Paste dosing schedule notes here…"
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              disabled={view === "loading"}
            />
          </div>

          {view === "loading" ? (
            <p className="text-center text-sm py-3" style={{ color: "var(--color-text-secondary)" }}>
              Parsing your dosing plan…
            </p>
          ) : (
            <>
              <button
                className="w-full py-4 rounded-xl text-base font-semibold text-white disabled:opacity-40"
                style={{ background: "var(--color-primary-mid)" }}
                onClick={handleSubmit}
                disabled={rawText.trim() === ""}
              >
                Parse dosing plan
              </button>
              <p className="text-xs text-center" style={{ color: "var(--color-text-muted)" }}>
                Copy from your patient portal (e.g. TIPConnect) and paste above.
              </p>
              <button
                type="button"
                className="text-sm text-center"
                style={{ color: "var(--color-text-secondary)" }}
                onClick={() => router.push("/onboarding")}
              >
                Enter foods manually instead.
              </button>
            </>
          )}
        </div>
      )}

      {/* Review view */}
      {view === "review" && parsedSchedule && (
        <div className="px-4 pt-6 pb-24">
          <ScheduleReview
            schedule={parsedSchedule}
            onScheduleChange={setParsedSchedule}
            onConfirm={handleConfirm}
            onBack={() => setView("paste")}
          />
        </div>
      )}

      {/* Error view */}
      {view === "error" && (
        <div className="px-4 pt-6 pb-24 flex flex-col gap-4">
          <p className="text-sm font-medium" style={{ color: "#dc2626" }}>
            Error: {error}
          </p>
          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white"
            style={{ background: "var(--color-primary-mid)" }}
            onClick={() => { setView("paste"); setError("") }}
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  )
}
