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
  saveBulkCatchUpLog,
  uploadChildPhoto,
  saveChildPhotoUrl,
} from "@/lib/supabase"
import { DoseState } from "@/lib/types"
import { cycleStartDateForPosition } from "@/lib/schedule"

export default function OnboardingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [childName, setChildName] = useState("")
  const [childPhotoUrl, setChildPhotoUrl] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [appointmentDate, setAppointmentDate] = useState("")
  const [week, setWeek] = useState(1)
  const [day, setDay] = useState(1)
  const [originalWeek, setOriginalWeek] = useState<number | null>(null)
  const [originalDay, setOriginalDay] = useState<number | null>(null)
  const [existingDoseState, setExistingDoseState] = useState<DoseState | null>(null)
  const [showCatchup, setShowCatchup] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      let session
      try { session = await getSession() } catch { router.replace("/login"); return }
      if (!session) { router.replace("/login"); return }
      try {
        const s = await fetchSchedule()
        if (!s) { router.replace("/setup"); return }
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

  async function saveAndRedirect(withCatchup: boolean) {
    setSaving(true)
    setSaveError(null)
    try {
      await saveFamilyConfig(childName.trim(), appointmentDate || null)
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
      if (withCatchup) {
        await saveBulkCatchUpLog(week, day)
      }
      router.replace("/daily")
    } catch (err) {
      const msg = err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : JSON.stringify(err)
      setSaveError(msg)
      setSaving(false)
    }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoUploading(true)
    try {
      const url = await uploadChildPhoto(file)
      await saveChildPhotoUrl(url)
      setChildPhotoUrl(url)
    } catch {
      // Silent — photo is optional; onboarding still proceeds without it
    } finally {
      setPhotoUploading(false)
    }
  }

  function handleConfirm() {
    if (!childName.trim()) { setNameError(true); return }
    const positionChanged = week !== originalWeek || day !== originalDay
    const aheadOfStart = week > 1 || day > 1
    if (aheadOfStart && (positionChanged || !existingDoseState)) {
      setShowCatchup(true)
    } else {
      saveAndRedirect(false)
    }
  }

  if (loading) return null

  return (
    <main className="max-w-sm mx-auto px-4 py-12 min-h-screen flex flex-col">
      <h1 className="text-2xl font-bold mb-2">Welcome to TIP Pal</h1>
      <p className="text-gray-500 text-sm mb-8">Set up your family profile to get started.</p>

      <div className="flex flex-col gap-5">
        {/* Optional child photo */}
        <div className="flex flex-col items-center mb-6">
          <button
            type="button"
            className="relative"
            onClick={() => photoInputRef.current?.click()}
            aria-label="Add child photo"
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
                style={{ width: 24, height: 24, background: "#ff6b35", fontSize: 13, color: "#fff" }}
              >
                +
              </div>
            )}
          </button>
          <p className="text-xs mt-2" style={{ color: "#9a6a55" }}>
            {photoUploading ? "Uploading…" : "Add a photo (optional)"}
          </p>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoChange}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">
            Child's name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Joshy"
            value={childName}
            onChange={e => { setChildName(e.target.value); setNameError(false) }}
            className={`border rounded-xl px-4 py-3 text-base w-full ${nameError ? "border-red-400" : "border-gray-300"}`}
          />
          {nameError && <p className="text-red-600 text-sm mt-1">Child's name is required.</p>}
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Next appointment (optional)</label>
          <input
            type="date"
            value={appointmentDate}
            onChange={e => setAppointmentDate(e.target.value)}
            className="border border-gray-300 rounded-xl px-4 py-3 text-base w-full"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-2">Current position in protocol</label>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 w-10">Week</span>
              <button onClick={() => setWeek(w => Math.max(1, w - 1))} disabled={week <= 1}
                className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold disabled:opacity-30">−</button>
              <span className="text-lg font-semibold w-6 text-center">{week}</span>
              <button onClick={() => setWeek(w => w + 1)}
                className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold">+</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 w-8">Day</span>
              <button onClick={() => setDay(d => Math.max(1, d - 1))} disabled={day <= 1}
                className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold disabled:opacity-30">−</button>
              <span className="text-lg font-semibold w-6 text-center">{day}</span>
              <button onClick={() => setDay(d => Math.min(7, d + 1))} disabled={day >= 7}
                className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold disabled:opacity-30">+</button>
            </div>
          </div>
        </div>

        {saveError && (
          <p className="text-red-600 text-sm">{saveError}</p>
        )}

        {showCatchup ? (
          <div className="px-4 py-4 bg-gray-50 border border-gray-200 rounded-xl">
            <p className="text-sm font-medium mb-3">
              Mark all days from Week 1, Day 1 up to your current position as complete in the log?
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 py-3 bg-slate-900 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                onClick={() => saveAndRedirect(true)}
                disabled={saving}
              >
                Yes — add to log
              </button>
              <button
                className="flex-1 py-3 bg-gray-200 text-gray-800 text-sm font-semibold rounded-lg disabled:opacity-50"
                onClick={() => saveAndRedirect(false)}
                disabled={saving}
              >
                No — skip history
              </button>
            </div>
          </div>
        ) : (
          <button
            className="w-full py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl disabled:opacity-50"
            onClick={handleConfirm}
            disabled={saving}
          >
            Continue
          </button>
        )}
      </div>
    </main>
  )
}
