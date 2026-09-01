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
  saveFliesToAppointments,
  saveDoseState,
  saveVisitNumber,
  uploadChildPhoto,
  saveChildPhotoUrl,
  seedFoodProgress,
} from "@/lib/supabase"
import { ParsedSchedule, DoseState } from "@/lib/types"
import { cycleStartDateForPosition, calculateBufferFromProgress, getGlobalPosition } from "@/lib/schedule"
import FoodPositionStepper, { FoodPositionEntry } from "@/components/FoodPositionStepper"
import TravelDayToggle from "@/components/TravelDayToggle"

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
  const [fliesToAppointments, setFliesToAppointments] = useState<boolean | null>(null)
  const [travelError, setTravelError] = useState(false)

  // Position
  const [visitIdx, setVisitIdx] = useState(0)
  const [positionEntries, setPositionEntries] = useState<FoodPositionEntry[]>([])
  const [existingDoseState, setExistingDoseState] = useState<DoseState | null>(null)

  // Save state
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
        setPositionEntries(s.treatmentFoods.map(f => ({ foodName: f.name, week: 1, day: 1 })))
        const [name, apptDate, ds] = await Promise.all([
          fetchFamilyName().catch(() => null),
          fetchAppointmentDate().catch(() => null),
          fetchDoseState().catch(() => null),
        ])
        if (name) { router.replace("/daily"); return }
        if (apptDate) setAppointmentDate(apptDate)
        if (ds) {
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

  function handleStep2Continue() {
    if (fliesToAppointments === null) { setTravelError(true); return }
    setStep(3)
  }

  function handleConfirm() {
    saveAndRedirect()
  }

  function handlePositionChange(foodName: string, week: number, day: number) {
    setPositionEntries(prev => prev.map(e => (e.foodName === foodName ? { ...e, week, day } : e)))
  }

  async function saveAndRedirect() {
    setSaving(true)
    setSaveError(null)
    try {
      await saveFamilyConfig(childName.trim(), appointmentDate || null)
      await saveFliesToAppointments(fliesToAppointments ?? false)
      await saveVisitNumber(VISIT_SEQUENCE[visitIdx])
      const seededProgress = await seedFoodProgress(positionEntries)
      const globalPos = getGlobalPosition(seededProgress)
      await saveDoseState({
        currentWeek: globalPos.week,
        currentDay: globalPos.day,
        checkedFoods: {},
        completedDays: existingDoseState?.completedDays ?? {},
        cycleStartDate: cycleStartDateForPosition(globalPos.week, globalPos.day),
        skipCount: 0,
        floorWeek: globalPos.week,
        floorDay: globalPos.day,
      })
      router.replace("/daily")
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed — please try again")
      setSaving(false)
    } finally {
      setSaving(false)
    }
  }

  // Buffer calculation for step 4
  const maxWeek = schedule ? getMaxWeek(schedule) : 99
  const slowestPosition = (() => {
    if (positionEntries.length === 0) return { week: 1, day: 1 }
    const map = new Map(
      positionEntries.map(e => [e.foodName, { foodName: e.foodName, week: e.week, day: e.day, completedDays: e.day - 1, lastCompletedAt: null }])
    )
    return getGlobalPosition(map)
  })()
  const bufferResult = schedule
    ? calculateBufferFromProgress(appointmentDate || null, maxWeek, slowestPosition.week, slowestPosition.day - 1, fliesToAppointments ?? false)
    : { kind: "hidden" as const }
  const bufferText =
    bufferResult.kind === "days"
      ? `${bufferResult.count} buffer day${bufferResult.count !== 1 ? "s" : ""}`
      : bufferResult.kind === "behind"
      ? `${bufferResult.count} day${bufferResult.count !== 1 ? "s" : ""} behind`
      : "—"

  const currentVisitRaw = VISIT_SEQUENCE[visitIdx]

  const positionsInSync =
    positionEntries.length === 0 ||
    positionEntries.every(e => e.week === positionEntries[0].week && e.day === positionEntries[0].day)

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
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Orange header */}
      <header
        className="px-4 pb-4 flex flex-col gap-3"
        style={{ background: "var(--color-primary)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
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
              Set each treatment food&apos;s starting week and day.
            </p>
          </div>
        )}

        {step === 4 && (
          <div className="flex items-center gap-3">
            <div
              className="rounded-full overflow-hidden flex items-center justify-center shrink-0"
              style={{ width: 36, height: 36, background: "var(--color-primary-light)", fontSize: 18 }}
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
                {positionsInSync
                  ? `Week ${positionEntries[0]?.week ?? 1}, Day ${positionEntries[0]?.day ?? 1}`
                  : "Starting positions vary by food"}
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
                style={{ width: 80, height: 80, background: "var(--color-primary-light)", fontSize: 32 }}
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
                  style={{ width: 24, height: 24, background: "var(--color-primary-mid)", fontSize: 14, color: "#fff" }}
                >
                  +
                </div>
              )}
            </button>
            <button
              type="button"
              className="text-sm"
              style={{ color: "var(--color-text-secondary)" }}
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
            <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text-primary)" }}>
              Child&apos;s name
            </p>
            <input
              type="text"
              placeholder="e.g. Joshy"
              value={childName}
              onChange={e => { setChildName(e.target.value); setNameError(false) }}
              className="w-full px-4 py-3 text-base rounded-xl outline-none"
              style={{
                border: nameError ? "1.5px solid #dc2626" : "0.5px solid var(--color-primary-border)",
                color: "var(--color-text-primary)",
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
            style={{ background: "var(--color-primary-mid)" }}
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
            style={{ border: "0.5px solid var(--color-primary-border)" }}
          >
            <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Appointment date</span>
            <input
              type="date"
              value={appointmentDate}
              onChange={e => setAppointmentDate(e.target.value)}
              className="text-sm bg-transparent outline-none border-none text-right"
              style={{ color: "var(--color-text-secondary)" }}
            />
          </div>
          <p className="text-sm text-center" style={{ color: "var(--color-text-muted)" }}>
            Tap to pick a date from the calendar.
          </p>
          <TravelDayToggle
            value={fliesToAppointments}
            onChange={v => { setFliesToAppointments(v); setTravelError(false) }}
            error={travelError}
          />
          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white"
            style={{ background: "var(--color-primary-mid)" }}
            onClick={handleStep2Continue}
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
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--color-text-secondary)" }}>
              Visit
            </p>
            <div
              className="bg-white rounded-xl px-4 py-3 flex items-center justify-between"
              style={{ border: "0.5px solid var(--color-primary-border)" }}
            >
              <button
                onClick={() => setVisitIdx(i => Math.max(0, i - 1))}
                disabled={visitIdx <= 0}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                −
              </button>
              <span className="text-base font-medium" style={{ color: "var(--color-text-primary)" }}>
                {visitLabel(currentVisitRaw)}
              </span>
              <button
                onClick={() => setVisitIdx(i => Math.min(VISIT_SEQUENCE.length - 1, i + 1))}
                disabled={visitIdx >= VISIT_SEQUENCE.length - 1}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                +
              </button>
            </div>
          </div>

          {/* Per-food starting position */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--color-text-secondary)" }}>
              Treatment foods
            </p>
            <div
              className="bg-white rounded-xl overflow-hidden"
              style={{ border: "0.5px solid var(--color-primary-border)" }}
            >
              <FoodPositionStepper entries={positionEntries} onChange={handlePositionChange} />
            </div>
          </div>

          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white"
            style={{ background: "var(--color-primary-mid)" }}
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
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
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
              { label: "Travel day", value: fliesToAppointments ? "Yes" : "No" },
              {
                label: "Starting position",
                value: positionsInSync
                  ? `${visitLabel(currentVisitRaw)} · Week ${positionEntries[0]?.week ?? 1} · Day ${positionEntries[0]?.day ?? 1}`
                  : `${visitLabel(currentVisitRaw)} · Varies by food`,
              },
              { label: "Buffer days", value: bufferText },
            ].map((row, i, arr) => (
              <div
                key={row.label}
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: i < arr.length - 1 ? "0.5px solid var(--color-primary-border)" : undefined }}
              >
                <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{row.label}</span>
                <span className="text-sm font-medium text-right" style={{ color: "var(--color-text-primary)", maxWidth: "60%" }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          {/* Schedule parsed badge */}
          {schedule && (
            <div className="flex items-center gap-1.5">
              <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>Schedule parsed</span>
              <span className="text-sm" style={{ color: "#22c55e" }}>✓</span>
            </div>
          )}

          {saveError && (
            <p className="text-sm" style={{ color: "#dc2626" }}>{saveError}</p>
          )}

          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--color-primary-mid)" }}
            onClick={handleConfirm}
            disabled={saving}
          >
            {saving ? "Saving…" : "Start dosing"}
          </button>
        </div>
      )}
    </div>
  )
}
