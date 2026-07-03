"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  getSession,
  fetchSchedule,
  fetchFamilyName,
  fetchDoseState,
  fetchAppointmentDate,
  saveFamilyConfig,
  saveDoseState,
  saveVisitNumber,
  saveBulkCatchUpLog,
  uploadChildPhoto,
  saveChildPhotoUrl,
} from "@/lib/supabase"
import { ParsedSchedule, DoseState } from "@/lib/types"
import { cycleStartDateForPosition, calculateBufferFromProgress } from "@/lib/schedule"

const VISIT_SEQUENCE = [
  "Launch",
  "1","2","3","4","5","6","7","8","9","10",
  "11","12","13","14","15","16","17","18","19","20",
  "Tolerance 1","Tolerance 2","Remission 1","Annual Remission",
]

function visitLabel(raw: string): string {
  const n = parseInt(raw, 10)
  return !isNaN(n) && n.toString() === raw ? `Visit ${raw}` : raw
}

function getMaxWeek(schedule: ParsedSchedule): number {
  const weeks = schedule.treatmentFoods.flatMap(f => f.weeks.map(w => w.week))
  return weeks.length ? Math.max(...weeks) : 0
}

export default function OnboardingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  // Child setup
  const [childName, setChildName] = useState("")
  const [childPhotoUrl, setChildPhotoUrl] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [nameError, setNameError] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  // Schedule (loaded on init)
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)

  // Appointment date
  const [appointmentDate, setAppointmentDate] = useState("")

  // Position
  const [visitIdx, setVisitIdx] = useState(0)
  const [week, setWeek] = useState(1)
  const [day, setDay] = useState(1)
  const [originalWeek, setOriginalWeek] = useState<number | null>(null)
  const [originalDay, setOriginalDay] = useState<number | null>(null)
  const [existingDoseState, setExistingDoseState] = useState<DoseState | null>(null)

  // Save state
  const [showCatchup, setShowCatchup] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      let session
      try { session = await getSession() } catch { router.replace("/login"); return }
      if (!session) { router.replace("/login"); return }
      try {
        const s = await fetchSchedule()
        if (!s) { router.replace("/setup"); return }
        setSchedule(s)
        const [name, apptDate, ds] = await Promise.all([
          fetchFamilyName().catch(() => null),
          fetchAppointmentDate().catch(() => null),
          fetchDoseState().catch(() => null),
        ])
        if (name) { router.replace("/daily"); return }
        if (apptDate) setAppointmentDate(apptDate)
        if (ds) {
          setWeek(ds.currentWeek)
          setDay(ds.currentDay)
          setOriginalWeek(ds.currentWeek)
          setOriginalDay(ds.currentDay)
          setExistingDoseState(ds)
        }
      } catch {
        // proceed with defaults
      }
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoUploading(true)
    setPhotoError(null)
    try {
      const url = await uploadChildPhoto(file)
      await saveChildPhotoUrl(url)
      setChildPhotoUrl(url)
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Photo upload failed")
    } finally {
      setPhotoUploading(false)
    }
  }

  function handleStep1Continue() {
    if (!childName.trim()) { setNameError(true); return }
    setStep(2)
  }

  function handleConfirm() {
    const positionChanged = week !== originalWeek || day !== originalDay
    const aheadOfStart = week > 1 || day > 1
    if (aheadOfStart && (positionChanged || !existingDoseState)) {
      setShowCatchup(true)
    } else {
      saveAndRedirect(false)
    }
  }

  async function saveAndRedirect(withCatchup: boolean) {
    setSaving(true)
    setSaveError(null)
    try {
      await saveFamilyConfig(childName.trim(), appointmentDate || null)
      await saveVisitNumber(VISIT_SEQUENCE[visitIdx])
      const positionChanged = week !== originalWeek || day !== originalDay
      if (positionChanged || !existingDoseState) {
        await saveDoseState({
          currentWeek: week,
          currentDay: day,
          checkedFoods: {},
          completedDays: existingDoseState?.completedDays ?? {},
          cycleStartDate: cycleStartDateForPosition(week, day),
          skipCount: 0,
          floorWeek: week,
          floorDay: day,
        })
      }
      if (withCatchup) await saveBulkCatchUpLog(week, day)
      router.replace("/daily")
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed — please try again")
      setSaving(false)
    } finally {
      setShowCatchup(false)
      setSaving(false)
    }
  }

  // Buffer calculation for step 4
  const maxWeek = schedule ? getMaxWeek(schedule) : 99
  const bufferResult = schedule
    ? calculateBufferFromProgress(appointmentDate || null, maxWeek, week, day - 1)
    : { kind: "hidden" as const }
  const bufferText =
    bufferResult.kind === "days"
      ? `${bufferResult.count} buffer day${bufferResult.count !== 1 ? "s" : ""}`
      : bufferResult.kind === "behind"
      ? `${bufferResult.count} day${bufferResult.count !== 1 ? "s" : ""} behind`
      : "—"

  const currentVisitRaw = VISIT_SEQUENCE[visitIdx]

  if (loading) return null

  // Progress dots
  function ProgressDots() {
    return (
      <div className="flex items-center gap-1.5">
        {([1, 2, 3, 4] as const).map(n => (
          <div
            key={n}
            style={{
              width: step === n ? 8 : 6,
              height: step === n ? 8 : 6,
              borderRadius: "50%",
              background: step === n ? "#fff" : "rgba(255,255,255,0.4)",
              transition: "all 0.2s",
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#fffbf7" }}>
      {/* Orange header */}
      <header
        className="px-4 pb-4 flex flex-col gap-3"
        style={{ background: "#ff6b35", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
      >
        <div className="flex items-center justify-between">
          {step > 1 ? (
            <button
              onClick={() => setStep((step - 1) as 1 | 2 | 3 | 4)}
              className="text-white text-lg"
              aria-label="Back"
            >
              ‹
            </button>
          ) : (
            <div style={{ width: 24 }} />
          )}
          <ProgressDots />
          <div style={{ width: 24 }} />
        </div>

        {step === 1 && (
          <h1 className="text-xl font-semibold text-white">Welcome to Tip Pal</h1>
        )}

        {step === 2 && (
          <h1 className="text-xl font-semibold text-white">Next appointment</h1>
        )}

        {step === 3 && (
          <div>
            <h1 className="text-xl font-semibold text-white">Your position</h1>
            <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.8)" }}>
              Set the week and day you&apos;re currently dosing on.
            </p>
          </div>
        )}

        {step === 4 && (
          <div className="flex items-center gap-3">
            <div
              className="rounded-full overflow-hidden flex items-center justify-center shrink-0"
              style={{ width: 36, height: 36, background: "#fff3ec", fontSize: 18 }}
            >
              {childPhotoUrl ? (
                <img src={childPhotoUrl} alt="Child" className="w-full h-full object-cover" />
              ) : (
                "🧒"
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{childName}</p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
                Week {week}, Day {day}
              </p>
            </div>
          </div>
        )}
      </header>

      {/* Step 1: Child setup */}
      {step === 1 && (
        <div className="px-4 pt-8 pb-24 flex flex-col gap-6">
          {/* Photo */}
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              className="relative"
              onClick={() => photoInputRef.current?.click()}
              aria-label="Add child photo"
              disabled={photoUploading}
            >
              <div
                className="rounded-full overflow-hidden flex items-center justify-center"
                style={{ width: 80, height: 80, background: "#fff3ec", fontSize: 32 }}
              >
                {childPhotoUrl ? (
                  <img src={childPhotoUrl} alt="Child" className="w-full h-full object-cover" />
                ) : (
                  "🧒"
                )}
              </div>
              {!childPhotoUrl && !photoUploading && (
                <div
                  className="absolute bottom-0 right-0 rounded-full flex items-center justify-center"
                  style={{ width: 24, height: 24, background: "#ff6b35", fontSize: 14, color: "#fff" }}
                >
                  +
                </div>
              )}
            </button>
            <button
              type="button"
              className="text-sm"
              style={{ color: "#9a6a55" }}
              onClick={handleStep1Continue}
            >
              {photoUploading ? "Uploading…" : "Skip photo for now"}
            </button>
            {photoError && (
              <p className="text-xs text-center" style={{ color: "#dc2626" }}>{photoError}</p>
            )}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
            />
          </div>

          {/* Name */}
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: "#2d1a0e" }}>
              Child&apos;s name
            </p>
            <input
              type="text"
              placeholder="e.g. Joshy"
              value={childName}
              onChange={e => { setChildName(e.target.value); setNameError(false) }}
              className="w-full px-4 py-3 text-base rounded-xl outline-none"
              style={{
                border: nameError ? "1.5px solid #dc2626" : "0.5px solid #f0ddd4",
                color: "#2d1a0e",
                background: "#fff",
              }}
            />
            {nameError && (
              <p className="text-sm mt-1" style={{ color: "#dc2626" }}>
                Child&apos;s name is required.
              </p>
            )}
          </div>

          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white"
            style={{ background: "#ff6b35" }}
            onClick={handleStep1Continue}
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 2: Appointment date */}
      {step === 2 && (
        <div className="px-4 pt-8 pb-24 flex flex-col gap-6">
          <div
            className="bg-white rounded-xl px-4 py-3 flex items-center justify-between"
            style={{ border: "0.5px solid #f0ddd4" }}
          >
            <span className="text-sm" style={{ color: "#2d1a0e" }}>Appointment date</span>
            <input
              type="date"
              value={appointmentDate}
              onChange={e => setAppointmentDate(e.target.value)}
              className="text-sm bg-transparent outline-none border-none text-right"
              style={{ color: "#9a6a55" }}
            />
          </div>
          <p className="text-sm text-center" style={{ color: "#c4927a" }}>
            Tap to pick a date from the calendar.
          </p>
          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white"
            style={{ background: "#ff6b35" }}
            onClick={() => setStep(3)}
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 3: Position — Visit / Week / Day */}
      {step === 3 && (
        <div className="px-4 pt-8 pb-24 flex flex-col gap-6">
          {/* Visit stepper */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#9a6a55" }}>
              Visit
            </p>
            <div
              className="bg-white rounded-xl px-4 py-3 flex items-center justify-between"
              style={{ border: "0.5px solid #f0ddd4" }}
            >
              <button
                onClick={() => setVisitIdx(i => Math.max(0, i - 1))}
                disabled={visitIdx <= 0}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "#f0ddd4", border: "none", color: "#2d1a0e" }}
              >
                −
              </button>
              <span className="text-base font-medium" style={{ color: "#2d1a0e" }}>
                {visitLabel(currentVisitRaw)}
              </span>
              <button
                onClick={() => setVisitIdx(i => Math.min(VISIT_SEQUENCE.length - 1, i + 1))}
                disabled={visitIdx >= VISIT_SEQUENCE.length - 1}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "#f0ddd4", border: "none", color: "#2d1a0e" }}
              >
                +
              </button>
            </div>
          </div>

          {/* Week stepper */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#9a6a55" }}>
              Week
            </p>
            <div
              className="bg-white rounded-xl px-4 py-3 flex items-center justify-between"
              style={{ border: "0.5px solid #f0ddd4" }}
            >
              <button
                onClick={() => setWeek(w => Math.max(1, w - 1))}
                disabled={week <= 1}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "#f0ddd4", border: "none", color: "#2d1a0e" }}
              >
                −
              </button>
              <span className="text-base font-medium" style={{ color: "#2d1a0e" }}>Week {week}</span>
              <button
                onClick={() => setWeek(w => Math.min(maxWeek, w + 1))}
                disabled={week >= maxWeek}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "#f0ddd4", border: "none", color: "#2d1a0e" }}
              >
                +
              </button>
            </div>
          </div>

          {/* Day stepper */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#9a6a55" }}>
              Day
            </p>
            <div
              className="bg-white rounded-xl px-4 py-3 flex items-center justify-between"
              style={{ border: "0.5px solid #f0ddd4" }}
            >
              <button
                onClick={() => setDay(d => Math.max(1, d - 1))}
                disabled={day <= 1}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "#f0ddd4", border: "none", color: "#2d1a0e" }}
              >
                −
              </button>
              <span className="text-base font-medium" style={{ color: "#2d1a0e" }}>Day {day}</span>
              <button
                onClick={() => setDay(d => Math.min(7, d + 1))}
                disabled={day >= 7}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "#f0ddd4", border: "none", color: "#2d1a0e" }}
              >
                +
              </button>
            </div>
          </div>

          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white"
            style={{ background: "#ff6b35" }}
            onClick={() => setStep(4)}
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 4: Summary */}
      {step === 4 && (
        <div className="px-4 pt-8 pb-24 flex flex-col gap-5">
          {/* Summary card */}
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid #f0ddd4" }}>
            {[
              { label: "Child", value: childName },
              {
                label: "Next appointment",
                value: appointmentDate
                  ? new Date(appointmentDate + "T00:00:00").toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "—",
              },
              {
                label: "Current position",
                value: `${visitLabel(currentVisitRaw)} · Week ${week} · Day ${day}`,
              },
              { label: "Buffer days", value: bufferText },
            ].map((row, i, arr) => (
              <div
                key={row.label}
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: i < arr.length - 1 ? "0.5px solid #f0ddd4" : undefined }}
              >
                <span className="text-sm" style={{ color: "#9a6a55" }}>{row.label}</span>
                <span className="text-sm font-medium text-right" style={{ color: "#2d1a0e", maxWidth: "60%" }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          {/* Schedule parsed badge */}
          {schedule && (
            <div className="flex items-center gap-1.5">
              <span className="text-sm" style={{ color: "#9a6a55" }}>Schedule parsed</span>
              <span className="text-sm" style={{ color: "#22c55e" }}>✓</span>
            </div>
          )}

          {saveError && (
            <p className="text-sm" style={{ color: "#dc2626" }}>{saveError}</p>
          )}

          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white disabled:opacity-50"
            style={{ background: "#ff6b35" }}
            onClick={handleConfirm}
            disabled={saving}
          >
            {saving ? "Saving…" : "Start dosing"}
          </button>
        </div>
      )}

      {/* Catchup modal — fixed bottom sheet */}
      {showCatchup && (
        <div className="fixed inset-0 z-[60] flex items-end" style={{ background: "rgba(45,26,14,0.4)" }}>
          <div className="w-full bg-white rounded-t-2xl px-4 pt-6 pb-10 flex flex-col gap-4">
            <p className="text-sm font-medium" style={{ color: "#2d1a0e" }}>
              Mark all days from Week 1, Day 1 up to your current position as complete in the log?
            </p>
            <div className="flex flex-col gap-3">
              <button
                className="w-full py-4 rounded-xl text-base font-semibold text-white disabled:opacity-50"
                style={{ background: "#ff6b35" }}
                onClick={() => saveAndRedirect(true)}
                disabled={saving}
              >
                {saving ? "Saving…" : "Yes — add to log"}
              </button>
              <button
                className="w-full py-4 rounded-xl text-base font-semibold disabled:opacity-50"
                style={{ background: "#f0ddd4", color: "#2d1a0e" }}
                onClick={() => saveAndRedirect(false)}
                disabled={saving}
              >
                No — skip history
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
