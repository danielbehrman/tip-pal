"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule } from "@/lib/types"
import {
  fetchSchedule,
  fetchChildPhotoUrl,
  archiveAndStartNewCycle,
  getSession,
} from "@/lib/supabase"
import { getVisitIndex, calculateBufferFromProgress } from "@/lib/schedule"

type View = "confirm" | "paste" | "loading" | "review" | "confirming" | "success" | "error"

const RADIUS = 50
const CIRCUM = 2 * Math.PI * RADIUS

function foodNamesMatch(a: string, b: string): boolean {
  if (a === b) return true
  const na = a.trim().toLowerCase()
  const nb = b.trim().toLowerCase()
  return na === nb || na.startsWith(nb + " ") || nb.startsWith(na + " ")
}

function formatVisitLabel(vn: string | null | undefined): string {
  if (!vn) return "—"
  const asNum = parseInt(vn.trim(), 10)
  if (!isNaN(asNum) && asNum.toString() === vn.trim()) return `Visit ${vn}`
  return vn
}

function getMaxWeek(schedule: ParsedSchedule): number {
  const weeks = schedule.treatmentFoods.flatMap(f => f.weeks.map(w => w.week))
  return weeks.length ? Math.max(...weeks) : 0
}

function DiffBadge({ kind, detail }: { kind: "new" | "updated" | "removed" | "kept"; detail?: string }) {
  if (kind === "new")
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: "#dcfce7", color: "#166534" }}>New</span>
  if (kind === "updated")
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: "#dbeafe", color: "#1e40af" }}>Updated</span>
  if (kind === "removed")
    return (
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "#fee2e2", color: "#991b1b" }}>Removed</span>
        {detail && <span className="text-xs" style={{ color: "#c4927a" }}>{detail}</span>}
      </div>
    )
  return <span className="text-xs shrink-0" style={{ color: "#9a6a55" }}>Kept</span>
}

export default function NewCyclePage() {
  const router = useRouter()
  const [view, setView] = useState<View>("confirm")
  const [rawText, setRawText] = useState("")
  const [currentSchedule, setCurrentSchedule] = useState<ParsedSchedule | null>(null)
  const [parsedSchedule, setParsedSchedule] = useState<ParsedSchedule | null>(null)
  const [appointmentDate, setAppointmentDate] = useState("")
  const [childPhotoUrl, setChildPhotoUrl] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [ringAnimated, setRingAnimated] = useState(false)

  useEffect(() => {
    async function init() {
      const session = await getSession()
      if (!session) { router.replace("/login"); return }
      const [s, photo] = await Promise.all([
        fetchSchedule().catch(() => null),
        fetchChildPhotoUrl().catch(() => null),
      ])
      setCurrentSchedule(s)
      setChildPhotoUrl(photo)
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (view !== "success") { setRingAnimated(false); return }
    const id = setTimeout(() => setRingAnimated(true), 100)
    return () => clearTimeout(id)
  }, [view])

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
      setAppointmentDate(data.schedule.appointmentDate ?? "")
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
        appointmentDate || null
      )
      setView("success")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save new cycle")
      setView("error")
    }
  }

  const newIdx = getVisitIndex(parsedSchedule?.visitNumber ?? null)
  const oldIdx = getVisitIndex(currentSchedule?.visitNumber ?? null)
  const ghostOffset = CIRCUM * (1 - oldIdx / 25)
  const targetOffset = CIRCUM * (1 - newIdx / 25)
  const blueOffset = ringAnimated ? targetOffset : CIRCUM

  const bufferResult = parsedSchedule
    ? calculateBufferFromProgress(appointmentDate || null, getMaxWeek(parsedSchedule), 1, 0)
    : { kind: "hidden" as const }
  const bufferText =
    bufferResult.kind === "days" ? `${bufferResult.count} buffer day${bufferResult.count !== 1 ? "s" : ""}`
    : bufferResult.kind === "behind" ? `${bufferResult.count} day${bufferResult.count !== 1 ? "s" : ""} behind`
    : "—"

  // Orange header (all steps)
  const headerTitle =
    view === "review" || view === "confirming" ? "Review changes"
    : view === "success" ? "New food cycle"
    : "New food cycle"

  const showBack = view === "paste" || view === "review"

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#fffbf7" }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 pt-5 pb-4"
        style={{ background: "#ff6b35" }}
      >
        {showBack ? (
          <button
            onClick={() => setView(view === "review" ? "paste" : "confirm")}
            className="text-white text-lg"
            aria-label="Back"
          >
            ‹
          </button>
        ) : (
          <div style={{ width: 24 }} />
        )}
        <h1 className="text-xl font-semibold text-white">{headerTitle}</h1>
        {view === "confirm" ? (
          <button
            onClick={() => router.back()}
            className="text-sm"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            Cancel
          </button>
        ) : (
          <div style={{ width: 50 }} />
        )}
      </header>

      {/* Step 1: Confirm */}
      {view === "confirm" && (
        <div className="px-4 pt-6 pb-24 flex flex-col gap-5">
          <div
            className="bg-white rounded-xl p-4"
            style={{ border: "0.5px solid #f0ddd4" }}
          >
            <p className="text-sm font-semibold mb-3" style={{ color: "#2d1a0e" }}>
              What happens when you start a new cycle:
            </p>
            <ul className="flex flex-col gap-2">
              {[
                "Treatment foods are replaced with the new plan",
                "Maintenance foods are kept and may be additive",
                "Position resets to Week 1, Day 1",
                "Your full dosing history is preserved",
                "Visit number updates to the new plan",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span style={{ color: "#ff6b35", fontWeight: 700, flexShrink: 0, lineHeight: "20px" }}>·</span>
                  <span className="text-sm" style={{ color: "#2d1a0e" }}>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white"
            style={{ background: "#ff6b35" }}
            onClick={() => setView("paste")}
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 2: Paste + loading */}
      {(view === "paste" || view === "loading") && (
        <div className="px-4 pt-6 pb-24 flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: "#2d1a0e" }}>
              Paste your new dosing plan
            </p>
            <p className="text-xs mb-3" style={{ color: "#9a6a55" }}>
              Personal information is stripped before processing and never stored.
            </p>
            <textarea
              className="w-full p-4 rounded-xl text-base resize-none outline-none"
              style={{
                minHeight: 200,
                border: "0.5px solid #f0ddd4",
                color: "#2d1a0e",
                background: "#fff",
              }}
              placeholder="Paste dosing schedule notes here…"
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              disabled={view === "loading"}
            />
          </div>
          {view === "loading" ? (
            <p className="text-center text-sm py-3" style={{ color: "#9a6a55" }}>
              Parsing new dosing plan…
            </p>
          ) : (
            <button
              className="w-full py-4 rounded-xl text-base font-semibold text-white disabled:opacity-40"
              style={{ background: "#ff6b35" }}
              onClick={handleSubmit}
              disabled={rawText.trim() === ""}
            >
              Parse new dosing plan
            </button>
          )}
        </div>
      )}

      {/* Step 3: Review */}
      {(view === "review" || view === "confirming") && parsedSchedule && (() => {
        const cur = currentSchedule

        // Visit transition
        const oldVisit = formatVisitLabel(cur?.visitNumber)
        const newVisit = formatVisitLabel(parsedSchedule.visitNumber)

        // Treatment foods
        const removedTreatment = (cur?.treatmentFoods ?? []).filter(
          f => !parsedSchedule.treatmentFoods.some(nf => foodNamesMatch(nf.name, f.name))
        )

        // Maintenance (daily + weekly combined)
        const allNewMaint = [...parsedSchedule.maintenanceFoods, ...parsedSchedule.weeklyFoods]
        const allCurMaint = [...(cur?.maintenanceFoods ?? []), ...(cur?.weeklyFoods ?? [])]

        return (
          <div className="px-4 pt-6 pb-24 flex flex-col gap-5">
            {/* Visit transition card */}
            <div className="bg-white rounded-xl p-4" style={{ border: "0.5px solid #f0ddd4" }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#9a6a55" }}>
                Visit transition
              </p>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium" style={{ color: "#9a6a55" }}>{oldVisit}</span>
                <span style={{ color: "#c4927a" }}>→</span>
                <span className="text-sm font-semibold" style={{ color: "#2d1a0e" }}>{newVisit}</span>
              </div>
              <p className="text-xs mt-2" style={{ color: "#c4927a" }}>Resets to Week 1, Day 1</p>
            </div>

            {/* Treatment foods */}
            {(parsedSchedule.treatmentFoods.length > 0 || removedTreatment.length > 0) && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#9a6a55" }}>
                  Treatment foods
                </p>
                <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid #f0ddd4" }}>
                  {parsedSchedule.treatmentFoods.map((food, i) => {
                    const inCurrent = cur?.treatmentFoods.some(f => foodNamesMatch(f.name, food.name))
                    const kind = inCurrent ? "updated" : "new"
                    return (
                      <div
                        key={food.name}
                        className="flex items-center justify-between px-4 py-3"
                        style={{ borderBottom: i < parsedSchedule.treatmentFoods.length - 1 || removedTreatment.length > 0 ? "0.5px solid #f0ddd4" : undefined }}
                      >
                        <span className="text-sm" style={{ color: "#2d1a0e" }}>{food.name}</span>
                        <DiffBadge kind={kind} />
                      </div>
                    )
                  })}
                  {removedTreatment.map((food, i) => (
                    <div
                      key={food.name}
                      className="flex items-center justify-between px-4 py-3"
                      style={{ borderBottom: i < removedTreatment.length - 1 ? "0.5px solid #f0ddd4" : undefined }}
                    >
                      <span className="text-sm" style={{ color: "#9a6a55" }}>{food.name}</span>
                      <DiffBadge kind="removed" detail="Not in new plan" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Maintenance foods */}
            {allNewMaint.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#9a6a55" }}>
                  Maintenance foods
                </p>
                <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid #f0ddd4" }}>
                  {allNewMaint.map((food, i) => {
                    const inCurrent = allCurMaint.some(f => foodNamesMatch(f.name, food.name))
                    const kind = inCurrent ? "kept" : "new"
                    return (
                      <div
                        key={food.name + i}
                        className="flex items-center justify-between px-4 py-3"
                        style={{ borderBottom: i < allNewMaint.length - 1 ? "0.5px solid #f0ddd4" : undefined }}
                      >
                        <span className="text-sm" style={{ color: "#2d1a0e" }}>{food.name}</span>
                        <DiffBadge kind={kind} />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Appointment date */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#9a6a55" }}>
                Next appointment
              </p>
              <div className="bg-white rounded-xl px-4 py-3 flex items-center justify-between" style={{ border: "0.5px solid #f0ddd4" }}>
                <span className="text-sm" style={{ color: "#2d1a0e" }}>Appointment date</span>
                <input
                  type="date"
                  value={appointmentDate}
                  onChange={e => setAppointmentDate(e.target.value)}
                  className="text-sm bg-transparent outline-none border-none text-right"
                  style={{ color: "#9a6a55" }}
                />
              </div>
            </div>

            {/* Confirm CTA */}
            <button
              className="w-full py-4 rounded-xl text-base font-semibold text-white disabled:opacity-50"
              style={{ background: "#ff6b35" }}
              onClick={handleConfirm}
              disabled={view === "confirming"}
            >
              {view === "confirming" ? "Saving…" : "Confirm new cycle"}
            </button>
          </div>
        )
      })()}

      {/* Step 4: Success */}
      {view === "success" && parsedSchedule && (
        <div className="px-4 pt-8 pb-24 flex flex-col items-center gap-6">
          {/* Animated ring with avatar */}
          <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
            <svg width="120" height="120" viewBox="0 0 120 120">
              {/* Track */}
              <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="#f0ddd4" strokeWidth="8" />
              {/* Ghost arc: old visit */}
              {oldIdx > 0 && (
                <circle
                  cx="60" cy="60" r={RADIUS}
                  fill="none"
                  stroke="#ff9966"
                  strokeWidth="8"
                  strokeOpacity="0.55"
                  strokeDasharray={`${CIRCUM} ${CIRCUM}`}
                  strokeDashoffset={ghostOffset}
                  strokeLinecap="round"
                  style={{ transform: "rotate(-90deg)", transformOrigin: "60px 60px" }}
                />
              )}
              {/* Animated sky blue arc: new visit */}
              <circle
                cx="60" cy="60" r={RADIUS}
                fill="none"
                stroke="#4fc3f7"
                strokeWidth="8"
                strokeDasharray={`${CIRCUM} ${CIRCUM}`}
                strokeDashoffset={blueOffset}
                strokeLinecap="round"
                style={{
                  transform: "rotate(-90deg)",
                  transformOrigin: "60px 60px",
                  transition: "stroke-dashoffset 1.4s ease",
                }}
              />
            </svg>
            {/* Avatar overlay */}
            <div
              className="absolute rounded-full overflow-hidden flex items-center justify-center"
              style={{ width: 80, height: 80, background: "#fff3ec", fontSize: 34 }}
            >
              {childPhotoUrl ? (
                <img src={childPhotoUrl} alt="Child" className="w-full h-full object-cover" />
              ) : (
                "🧒"
              )}
            </div>
          </div>

          {/* Title */}
          <div className="text-center">
            <h2 className="text-xl font-bold" style={{ color: "#2d1a0e" }}>
              {parsedSchedule.visitNumber
                ? `${formatVisitLabel(parsedSchedule.visitNumber)} is live`
                : "New cycle is live"}
            </h2>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-6">
            {oldIdx > 0 && (
              <div className="flex items-center gap-1.5">
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff9966", opacity: 0.85 }} />
                <span className="text-xs" style={{ color: "#9a6a55" }}>{formatVisitLabel(currentSchedule?.visitNumber)}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#4fc3f7" }} />
              <span className="text-xs" style={{ color: "#9a6a55" }}>{formatVisitLabel(parsedSchedule.visitNumber)}</span>
            </div>
          </div>

          {/* Summary card */}
          <div className="w-full bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid #f0ddd4" }}>
            {[
              { label: "Visit", value: formatVisitLabel(parsedSchedule.visitNumber) },
              { label: "Starting position", value: "Week 1, Day 1" },
              {
                label: "Next appointment",
                value: appointmentDate
                  ? new Date(appointmentDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "—",
              },
              { label: "Buffer days", value: bufferText },
            ].map((row, i, arr) => (
              <div
                key={row.label}
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: i < arr.length - 1 ? "0.5px solid #f0ddd4" : undefined }}
              >
                <span className="text-sm" style={{ color: "#9a6a55" }}>{row.label}</span>
                <span className="text-sm font-medium" style={{ color: "#2d1a0e" }}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* Start dosing CTA */}
          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white"
            style={{ background: "#ff6b35" }}
            onClick={() => router.push("/daily")}
          >
            Start dosing
          </button>
        </div>
      )}

      {/* Error */}
      {view === "error" && (
        <div className="px-4 pt-6 pb-24 flex flex-col gap-4">
          <p className="text-sm font-medium" style={{ color: "#dc2626" }}>Error: {error}</p>
          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white"
            style={{ background: "#ff6b35" }}
            onClick={() => { setView("paste"); setError("") }}
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  )
}
