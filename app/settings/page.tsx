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
  fetchFoodGroups,
  saveChildName,
  uploadChildPhoto,
  saveChildPhotoUrl,
  fetchChildPhotoUrl,
  saveAppointmentDate,
  saveDoseState,
  saveBulkCatchUpLog,
  saveNotificationSettings,
  savePushSubscription,
  deletePushSubscription,
  saveFoodGroups,
  resetFoodProgress,
  signOut,
  fetchVisitNumber,
  saveVisitNumber,
} from "@/lib/supabase"
import { isNative } from "@/lib/platform"
import { DoseState, ParsedSchedule, FoodGroup } from "@/lib/types"
import GroupsManager from "@/components/GroupsManager"
import { cycleStartDateForPosition } from "@/lib/schedule"

const APP_VERSION = "0.1.0"

function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const buffer = new ArrayBuffer(rawData.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i)
  return buffer
}

function RowDivider() {
  return <div style={{ height: "0.5px", background: "var(--color-primary-border)", marginLeft: 16 }} />
}

export default function SettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [childName, setChildName] = useState("")
  const [childPhotoUrl, setChildPhotoUrl] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
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
  const [visitNumber, setVisitNumber] = useState<string>("")
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [foodGroups, setFoodGroups] = useState<FoodGroup[]>([])
  const [groupsSaved, setGroupsSaved] = useState(false)
  const groupsSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const pushAvailable = pushSupported && !!vapidPublicKey

  useEffect(() => {
    async function load() {
      let session
      try { session = await getSession() } catch { router.replace("/login"); return }
      if (!session) { router.replace("/login"); return }
      try {
        const [name, ds, notifSettings, groups, sched, photoUrl, vNum] = await Promise.all([
          fetchFamilyName().catch(() => null),
          fetchDoseState().catch(() => null),
          fetchNotificationSettings().catch(() => null),
          fetchFoodGroups().catch(() => []),
          fetchSchedule().catch(() => null),
          fetchChildPhotoUrl().catch(() => null),
          fetchVisitNumber().catch(() => null),
        ])
        try {
          const apptDate = await fetchAppointmentDate()
          setAppointmentDate(apptDate ?? "")
          appointmentDateLoaded.current = true
        } catch {}
        if (name) setChildName(name)
        setChildPhotoUrl(photoUrl)
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
        setFoodGroups(groups)
        if (sched) setSchedule(sched)
        if (vNum) setVisitNumber(vNum)
        setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)
      } catch {}
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
    } catch {}
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

  async function handleGroupsChange(groups: FoodGroup[]) {
    setFoodGroups(groups)
    try {
      await saveFoodGroups(groups)
      setGroupsSaved(true)
      if (groupsSavedTimerRef.current) clearTimeout(groupsSavedTimerRef.current)
      groupsSavedTimerRef.current = setTimeout(() => setGroupsSaved(false), 2000)
    } catch {}
  }

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

  async function saveAll(withCatchup: boolean) {
    setSaving(true)
    setSaveError(null)
    try {
      await saveChildName(childName.trim())
      if (appointmentDateLoaded.current) {
        await saveAppointmentDate(appointmentDate || null)
      }
      await saveVisitNumber(visitNumber.trim() || null)
      await saveNotificationSettings(morningReminder, eveningReminder, timezone)
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
        await resetFoodProgress(week, day)
        setOriginalWeek(week)
        setOriginalDay(day)
      }
      if (withCatchup) await saveBulkCatchUpLog(week, day)
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed — please try again")
    } finally {
      setShowCatchup(false)
      setSaving(false)
    }
  }

  function handleSave() {
    if (!childName.trim()) { setNameError(true); return }
    const positionChanged = week !== originalWeek || day !== originalDay
    const aheadOfStart = week > 1 || day > 1
    if (aheadOfStart && positionChanged) {
      setShowCatchup(true)
    } else {
      saveAll(false)
    }
  }

  async function handleSignOut() {
    try { await signOut() } catch {}
    router.replace("/login")
  }

  if (loading) return null

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Orange header */}
      <header
        className="px-4 pb-4"
        style={{ background: "var(--color-primary)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
      >
        <h1 className="text-xl font-semibold text-white">Settings</h1>
      </header>

      <div className="px-4 pt-6 pb-24 flex flex-col gap-6">
        {/* Child */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>
            Child
          </p>
          <div
            className="bg-white rounded-xl overflow-hidden"
            style={{ border: "0.5px solid var(--color-primary-border)" }}
          >
            <div className="p-4 flex items-center gap-4">
              {/* Avatar */}
              <button
                type="button"
                className="relative shrink-0"
                onClick={() => photoInputRef.current?.click()}
                aria-label="Change child photo"
              >
                <div
                  className="rounded-full overflow-hidden flex items-center justify-center"
                  style={{ width: 60, height: 60, background: "var(--color-primary-light)", fontSize: 26 }}
                >
                  {childPhotoUrl ? (
                    <img src={childPhotoUrl} alt="Child" className="w-full h-full object-cover" />
                  ) : (
                    "🧒"
                  )}
                </div>
                <div
                  className="absolute bottom-0 right-0 rounded-full flex items-center justify-center"
                  style={{ width: 20, height: 20, background: "var(--color-primary-mid)", color: "#fff", fontSize: 11 }}
                >
                  {photoUploading ? "…" : "✎"}
                </div>
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />
              {/* Name */}
              <div className="flex-1">
                <input
                  type="text"
                  value={childName}
                  onChange={e => { setChildName(e.target.value); setNameError(false) }}
                  placeholder="Child's name"
                  className="w-full text-base bg-transparent outline-none"
                  style={{
                    color: nameError ? "#dc2626" : "var(--color-text-primary)",
                    borderBottom: `1px solid ${nameError ? "#dc2626" : "var(--color-primary-border)"}`,
                    paddingBottom: 4,
                  }}
                />
                {nameError && (
                  <p className="text-xs mt-1" style={{ color: "#dc2626" }}>
                    Name is required
                  </p>
                )}
              </div>
            </div>
            {photoError && (
              <p className="px-4 pb-3 text-xs" style={{ color: "#dc2626" }}>{photoError}</p>
            )}
          </div>
        </div>

        {/* Program */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>
            Program
          </p>
          <div
            className="bg-white rounded-xl overflow-hidden"
            style={{ border: "0.5px solid var(--color-primary-border)" }}
          >
            {/* Appointment date */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Next appointment</span>
              <input
                type="date"
                value={appointmentDate}
                onChange={e => setAppointmentDate(e.target.value)}
                className="text-sm bg-transparent text-right outline-none border-none"
                style={{ color: "var(--color-text-secondary)" }}
              />
            </div>
            <RowDivider />
            {/* Week stepper */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Week</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setWeek(w => Math.max(1, w - 1))}
                  disabled={week <= 1}
                  className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                  style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
                >
                  −
                </button>
                <span className="text-base font-semibold w-6 text-center" style={{ color: "var(--color-text-primary)" }}>
                  {week}
                </span>
                <button
                  onClick={() => setWeek(w => w + 1)}
                  className="flex items-center justify-center text-lg font-bold"
                  style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
                >
                  +
                </button>
              </div>
            </div>
            <RowDivider />
            {/* Day stepper */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Day</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setDay(d => Math.max(1, d - 1))}
                  disabled={day <= 1}
                  className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                  style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
                >
                  −
                </button>
                <span className="text-base font-semibold w-6 text-center" style={{ color: "var(--color-text-primary)" }}>
                  {day}
                </span>
                <button
                  onClick={() => setDay(d => Math.min(7, d + 1))}
                  disabled={day >= 7}
                  className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                  style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
                >
                  +
                </button>
              </div>
            </div>
            <RowDivider />
            {/* Visit number */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Visit number</span>
              <input
                type="text"
                value={visitNumber}
                onChange={e => setVisitNumber(e.target.value)}
                placeholder="e.g. 8"
                className="text-sm bg-transparent text-right outline-none border-none w-28"
                style={{ color: "var(--color-text-secondary)" }}
              />
            </div>
            {schedule && (
              <>
                <RowDivider />
                <div className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>Food groups</p>
                    {groupsSaved && (
                      <span className="text-xs" style={{ color: "#22c55e" }}>Saved</span>
                    )}
                  </div>
                  <GroupsManager
                    schedule={schedule}
                    groups={foodGroups}
                    onChange={handleGroupsChange}
                  />
                </div>
              </>
            )}
            <RowDivider />
            {/* New food cycle */}
            <Link href="/new-cycle" className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>New food cycle</span>
              <span style={{ color: "var(--color-text-muted)" }}>›</span>
            </Link>
            <RowDivider />
            {/* Re-parse schedule */}
            <Link href="/setup" className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Re-parse schedule</span>
              <span style={{ color: "var(--color-text-muted)" }}>›</span>
            </Link>
          </div>
        </div>

        {/* Notifications (non-native only) */}
        {!isNative() && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>
              Notifications
            </p>
            <div
              className="bg-white rounded-xl overflow-hidden"
              style={{ border: "0.5px solid var(--color-primary-border)" }}
            >
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Morning reminder</span>
                <input
                  type="time"
                  value={morningReminder}
                  onChange={e => setMorningReminder(e.target.value)}
                  className="text-sm bg-transparent outline-none border-none text-right"
                  style={{ color: "var(--color-text-secondary)" }}
                />
              </div>
              <RowDivider />
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Evening reminder</span>
                <input
                  type="time"
                  value={eveningReminder}
                  onChange={e => setEveningReminder(e.target.value)}
                  className="text-sm bg-transparent outline-none border-none text-right"
                  style={{ color: "var(--color-text-secondary)" }}
                />
              </div>
              <RowDivider />
              <div className="px-4 py-3">
                {pushAvailable ? (
                  <button
                    onClick={pushSubscribed ? handleUnsubscribe : handleSubscribe}
                    disabled={subscribing}
                    className="text-sm disabled:opacity-40"
                    style={{ color: pushSubscribed ? "#dc2626" : "var(--color-primary-mid)" }}
                  >
                    {pushSubscribed ? "Disable push notifications" : "Enable push notifications"}
                  </button>
                ) : !pushSupported ? (
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Add to Home Screen to enable push notifications.
                  </p>
                ) : (
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Notifications not configured.
                  </p>
                )}
                <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
                  Timezone: {timezone}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Account */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>
            Account
          </p>
          <div
            className="bg-white rounded-xl overflow-hidden"
            style={{ border: "0.5px solid var(--color-primary-border)" }}
          >
            <button
              onClick={handleSignOut}
              className="w-full flex items-center px-4 py-3 text-left"
            >
              <span className="text-sm font-medium" style={{ color: "#dc2626" }}>
                Sign out
              </span>
            </button>
          </div>
        </div>

        {/* Legal */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>
            Legal
          </p>
          <div
            className="bg-white rounded-xl overflow-hidden"
            style={{ border: "0.5px solid var(--color-primary-border)" }}
          >
            <Link href="/privacy" className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Privacy policy</span>
              <span style={{ color: "var(--color-text-muted)" }}>›</span>
            </Link>
            <RowDivider />
            <Link href="/disclaimer" className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Medical disclaimer</span>
              <span style={{ color: "var(--color-text-muted)" }}>›</span>
            </Link>
          </div>
        </div>

        {saveError && (
          <p className="text-sm" style={{ color: "#dc2626" }}>{saveError}</p>
        )}

        {/* Save */}
        <button
          className="w-full py-4 text-white text-base font-semibold rounded-xl disabled:opacity-50"
          style={{ background: "var(--color-primary-mid)" }}
          onClick={handleSave}
          disabled={saving}
        >
          {saved ? "Saved ✓" : saving ? "Saving…" : "Save"}
        </button>

        {/* Version */}
        <p className="text-center text-xs" style={{ color: "var(--color-text-muted)" }}>
          Tip Pal v{APP_VERSION}
        </p>
      </div>

      {/* Catchup bottom-sheet modal */}
      {showCatchup && (
        <div className="fixed inset-0 z-[60] flex items-end" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white w-full rounded-t-2xl px-6 pt-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <p className="text-base font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>
              Update dose history?
            </p>
            <p className="text-sm mb-5" style={{ color: "var(--color-text-secondary)" }}>
              Mark all days from Week 1, Day 1 up to your current position as complete in the log?
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--color-primary-mid)", color: "#fff" }}
                onClick={() => saveAll(true)}
                disabled={saving}
              >
                Yes — add to log
              </button>
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--color-primary-border)", color: "var(--color-text-primary)" }}
                onClick={() => saveAll(false)}
                disabled={saving}
              >
                No — skip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
