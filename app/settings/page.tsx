"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  getSession,
  fetchSchedule,
  fetchFamilyName,
  fetchAppointmentDate,
  fetchDoseState,
  fetchNotificationSettings,
  saveFamilyName,
  saveAppointmentDate,
  saveDoseState,
  saveBulkCatchUpLog,
  saveNotificationSettings,
  savePushSubscription,
  deletePushSubscription,
} from "@/lib/supabase"
import { DoseState } from "@/lib/types"

function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const buffer = new ArrayBuffer(rawData.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i)
  return buffer
}

export default function SettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [familyName, setFamilyName] = useState("")
  const [appointmentDate, setAppointmentDate] = useState("")
  const [week, setWeek] = useState(1)
  const [day, setDay] = useState(1)
  const [originalWeek, setOriginalWeek] = useState(1)
  const [originalDay, setOriginalDay] = useState(1)
  const [existingDoseState, setExistingDoseState] = useState<DoseState | null>(null)
  const [morningReminder, setMorningReminder] = useState("08:00")
  const [eveningReminder, setEveningReminder] = useState("18:00")
  const [timezone, setTimezone] = useState("America/New_York")
  const [pushSupported, setPushSupported] = useState(false)
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [showCatchup, setShowCatchup] = useState(false)
  const [saving, setSaving] = useState(false)
  const [subscribing, setSubscribing] = useState(false)
  const [nameError, setNameError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appointmentDateLoaded = useRef(false)

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const pushAvailable = pushSupported && !!vapidPublicKey

  useEffect(() => {
    async function load() {
      let session
      try { session = await getSession() } catch { router.replace("/login"); return }
      if (!session) { router.replace("/login"); return }
      try {
        const [name, ds, notifSettings] = await Promise.all([
          fetchFamilyName().catch(() => null),
          fetchDoseState().catch(() => null),
          fetchNotificationSettings().catch(() => null),
        ])
        // Load appointment date separately so we know if it succeeded
        try {
          const apptDate = await fetchAppointmentDate()
          setAppointmentDate(apptDate ?? "")
          appointmentDateLoaded.current = true
        } catch {
          // Don't update appointmentDateLoaded — prevents overwriting DB value on save
        }
        if (name) setFamilyName(name)
        if (ds) {
          setWeek(ds.currentWeek)
          setDay(ds.currentDay)
          setOriginalWeek(ds.currentWeek)
          setOriginalDay(ds.currentDay)
          setExistingDoseState(ds)
        }
        if (notifSettings) {
          setMorningReminder(notifSettings.morningReminder)
          setEveningReminder(notifSettings.eveningReminder)
        }
        setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)
      } catch {
        // proceed with defaults
      }
      setLoading(false)

      if ("serviceWorker" in navigator && "PushManager" in window) {
        setPushSupported(true)
        navigator.serviceWorker.ready.then(async (reg) => {
          const sub = await reg.pushManager.getSubscription()
          setPushSubscribed(!!sub)
        })
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubscribe() {
    if (!vapidPublicKey) return
    setSubscribing(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(vapidPublicKey),
      })
      const json = sub.toJSON()
      await savePushSubscription({
        endpoint: json.endpoint!,
        p256dh: json.keys!.p256dh,
        auth: json.keys!.auth,
      })
      setPushSubscribed(true)
    } catch {
      // Permission denied or subscription failed
    }
    setSubscribing(false)
  }

  async function handleUnsubscribe() {
    setSubscribing(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await deletePushSubscription(sub.endpoint)
        await sub.unsubscribe()
        setPushSubscribed(false)
      }
    } catch {}
    setSubscribing(false)
  }

  async function saveAll(withCatchup: boolean) {
    setSaving(true)
    setSaveError(null)
    try {
      await saveFamilyName(familyName.trim())
      if (appointmentDateLoaded.current) {
        await saveAppointmentDate(appointmentDate || null)
      }
      await saveNotificationSettings(morningReminder, eveningReminder, timezone)
      const positionChanged = week !== originalWeek || day !== originalDay
      if (positionChanged || !existingDoseState) {
        await saveDoseState({
          currentWeek: week,
          currentDay: day,
          checkedFoods: {},
          completedDays: existingDoseState?.completedDays ?? {},
        })
        setOriginalWeek(week)
        setOriginalDay(day)
      }
      if (withCatchup) await saveBulkCatchUpLog(week, day)
      setShowCatchup(false)
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed — please try again")
    }
    setSaving(false)
  }

  function handleSave() {
    if (!familyName.trim()) { setNameError(true); return }
    const positionChanged = week !== originalWeek || day !== originalDay
    const aheadOfStart = week > 1 || day > 1
    if (aheadOfStart && positionChanged) {
      setShowCatchup(true)
    } else {
      saveAll(false)
    }
  }

  if (loading) return null

  return (
    <main className="max-w-sm mx-auto px-4 py-8 min-h-screen flex flex-col">
      <div className="mb-6">
        <Link href="/daily" className="text-sm text-gray-400 underline">← Daily view</Link>
        <h1 className="text-2xl font-bold mt-3">Settings</h1>
      </div>

      <div className="flex flex-col gap-5">
        <div>
          <label className="block text-sm text-gray-500 mb-1">
            Family name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={familyName}
            onChange={e => { setFamilyName(e.target.value); setNameError(false) }}
            className={`border rounded-xl px-4 py-3 text-base w-full ${nameError ? "border-red-400" : "border-gray-300"}`}
          />
          {nameError && <p className="text-red-600 text-sm mt-1">Family name is required.</p>}
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Next appointment</label>
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

        <div className="border-t border-gray-100 pt-5">
          <p className="text-sm font-medium text-gray-700 mb-3">Reminders</p>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-500 w-16">Morning</label>
              <input
                type="time"
                value={morningReminder}
                onChange={e => setMorningReminder(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-500 w-16">Evening</label>
              <input
                type="time"
                value={eveningReminder}
                onChange={e => setEveningReminder(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <p className="text-xs text-gray-400">Timezone: {timezone}</p>
          </div>

          {pushAvailable ? (
            <button
              className="mt-3 text-sm underline text-gray-500 disabled:opacity-40"
              onClick={pushSubscribed ? handleUnsubscribe : handleSubscribe}
              disabled={subscribing}
            >
              {pushSubscribed ? "Disable notifications" : "Enable notifications"}
            </button>
          ) : pushSupported && !vapidPublicKey ? (
            <p className="mt-3 text-xs text-gray-400">Notifications not configured — VAPID key missing.</p>
          ) : !pushSupported ? (
            <p className="mt-3 text-xs text-gray-400">
              Notifications require adding this app to your Home Screen on iOS.
            </p>
          ) : null}
        </div>

        <div className="border-t border-gray-100 pt-5">
          <Link href="/setup" className="text-sm text-gray-500 underline">
            Re-parse schedule
          </Link>
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
                onClick={() => saveAll(true)}
                disabled={saving}
              >
                Yes — add to log
              </button>
              <button
                className="flex-1 py-3 bg-gray-200 text-gray-800 text-sm font-semibold rounded-lg disabled:opacity-50"
                onClick={() => saveAll(false)}
                disabled={saving}
              >
                No — skip history
              </button>
            </div>
          </div>
        ) : (
          <button
            className="w-full py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            {saved ? "Saved" : saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>
    </main>
  )
}
