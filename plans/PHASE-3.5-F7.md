# Phase 3.5 F7: Settings Screen Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Settings screen with the warm design system: orange header, section cards (Child / Program / Notifications / Account / Legal), sign out, version number at bottom. All existing functionality preserved.

**Architecture:** Full replacement of `app/settings/page.tsx` only. No component changes. No supabase changes. `signOut` already exported from `@/lib/supabase` (line 24). `APP_VERSION` hardcoded as `"0.1.0"`. GroupsManager kept in Program section (brief: "all functionality preserved").

**Tech Stack:** Next.js, React hooks, Tailwind + inline styles

## Global Constraints

- App name "Tip Pal" — never "TIP Pal"; version display: "Tip Pal v0.1.0"
- Colors: `#ff6b35` orange header/save CTA/push enable, `#fffbf7` app bg, `#fff` card bg, `#f0ddd4` card border/dividers/stepper bg, `#2d1a0e` primary text, `#9a6a55` secondary/section label text, `#c4927a` tertiary/chevron text, `#dc2626` sign out / name error
- Section labels: `text-xs font-semibold uppercase tracking-wide`, color `#9a6a55`, `mb-2` above card
- Cards: `bg-white rounded-xl overflow-hidden`, `border: "0.5px solid #f0ddd4"`
- Row dividers: `height: "0.5px"`, `background: "#f0ddd4"`, `marginLeft: 16`
- Save button: orange `#ff6b35` bg, white text
- Catchup flow: bottom-sheet modal overlay (not inline)
- Notifications section hidden on `isNative()`
- `pb-24` on body for BottomNav clearance
- All state management, save logic, photo upload, catchup flow, push subscribe/unsubscribe, GroupsManager — all preserved exactly
- `npm run build` must pass with zero TypeScript errors

---

## File Map

| File | Change |
|---|---|
| `app/settings/page.tsx` | Full replacement |

---

### Task 1: Settings Screen Redesign

**Files:**
- Modify: `app/settings/page.tsx` — full replacement

**Interfaces preserved:**
- All imports unchanged except add `signOut` to the `@/lib/supabase` import list
- `APP_VERSION = "0.1.0"` constant at top of file
- All state variables, refs, and handlers preserved verbatim
- New handler: `handleSignOut` — calls `signOut()`, then `router.replace("/login")`

- [ ] **Step 1: Replace `app/settings/page.tsx`**

Write the complete file:

```tsx
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
  return <div style={{ height: "0.5px", background: "#f0ddd4", marginLeft: 16 }} />
}

export default function SettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [childName, setChildName] = useState("")
  const [childPhotoUrl, setChildPhotoUrl] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
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
        const [name, ds, notifSettings, groups, sched, photoUrl] = await Promise.all([
          fetchFamilyName().catch(() => null),
          fetchDoseState().catch(() => null),
          fetchNotificationSettings().catch(() => null),
          fetchFoodGroups().catch(() => []),
          fetchSchedule().catch(() => null),
          fetchChildPhotoUrl().catch(() => null),
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
    try {
      const url = await uploadChildPhoto(file)
      await saveChildPhotoUrl(url)
      setChildPhotoUrl(url)
    } catch {} finally {
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
    <div className="flex flex-col min-h-screen" style={{ background: "#fffbf7" }}>
      {/* Orange header */}
      <header
        className="px-4 pt-5 pb-4"
        style={{ background: "#ff6b35" }}
      >
        <h1 className="text-xl font-semibold text-white">Settings</h1>
      </header>

      <div className="px-4 pt-6 pb-24 flex flex-col gap-6">
        {/* Child */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#9a6a55" }}>
            Child
          </p>
          <div
            className="bg-white rounded-xl overflow-hidden"
            style={{ border: "0.5px solid #f0ddd4" }}
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
                  style={{ width: 60, height: 60, background: "#fff3ec", fontSize: 26 }}
                >
                  {childPhotoUrl ? (
                    <img src={childPhotoUrl} alt="Child" className="w-full h-full object-cover" />
                  ) : (
                    "🧒"
                  )}
                </div>
                <div
                  className="absolute bottom-0 right-0 rounded-full flex items-center justify-center"
                  style={{ width: 20, height: 20, background: "#ff6b35", color: "#fff", fontSize: 11 }}
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
                    color: nameError ? "#dc2626" : "#2d1a0e",
                    borderBottom: `1px solid ${nameError ? "#dc2626" : "#f0ddd4"}`,
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
          </div>
        </div>

        {/* Program */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#9a6a55" }}>
            Program
          </p>
          <div
            className="bg-white rounded-xl overflow-hidden"
            style={{ border: "0.5px solid #f0ddd4" }}
          >
            {/* Appointment date */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "#2d1a0e" }}>Next appointment</span>
              <input
                type="date"
                value={appointmentDate}
                onChange={e => setAppointmentDate(e.target.value)}
                className="text-sm bg-transparent text-right outline-none border-none"
                style={{ color: "#9a6a55" }}
              />
            </div>
            <RowDivider />
            {/* Week stepper */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "#2d1a0e" }}>Week</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setWeek(w => Math.max(1, w - 1))}
                  disabled={week <= 1}
                  className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                  style={{ width: 32, height: 32, borderRadius: 8, background: "#f0ddd4", border: "none", color: "#2d1a0e" }}
                >
                  −
                </button>
                <span className="text-base font-semibold w-6 text-center" style={{ color: "#2d1a0e" }}>
                  {week}
                </span>
                <button
                  onClick={() => setWeek(w => w + 1)}
                  className="flex items-center justify-center text-lg font-bold"
                  style={{ width: 32, height: 32, borderRadius: 8, background: "#f0ddd4", border: "none", color: "#2d1a0e" }}
                >
                  +
                </button>
              </div>
            </div>
            <RowDivider />
            {/* Day stepper */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "#2d1a0e" }}>Day</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setDay(d => Math.max(1, d - 1))}
                  disabled={day <= 1}
                  className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                  style={{ width: 32, height: 32, borderRadius: 8, background: "#f0ddd4", border: "none", color: "#2d1a0e" }}
                >
                  −
                </button>
                <span className="text-base font-semibold w-6 text-center" style={{ color: "#2d1a0e" }}>
                  {day}
                </span>
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
            {schedule && (
              <>
                <RowDivider />
                <div className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm" style={{ color: "#2d1a0e" }}>Food groups</p>
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
              <span className="text-sm" style={{ color: "#2d1a0e" }}>New food cycle</span>
              <span style={{ color: "#c4927a" }}>›</span>
            </Link>
            <RowDivider />
            {/* Re-parse schedule */}
            <Link href="/setup" className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "#2d1a0e" }}>Re-parse schedule</span>
              <span style={{ color: "#c4927a" }}>›</span>
            </Link>
          </div>
        </div>

        {/* Notifications (non-native only) */}
        {!isNative() && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#9a6a55" }}>
              Notifications
            </p>
            <div
              className="bg-white rounded-xl overflow-hidden"
              style={{ border: "0.5px solid #f0ddd4" }}
            >
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm" style={{ color: "#2d1a0e" }}>Morning reminder</span>
                <input
                  type="time"
                  value={morningReminder}
                  onChange={e => setMorningReminder(e.target.value)}
                  className="text-sm bg-transparent outline-none border-none text-right"
                  style={{ color: "#9a6a55" }}
                />
              </div>
              <RowDivider />
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm" style={{ color: "#2d1a0e" }}>Evening reminder</span>
                <input
                  type="time"
                  value={eveningReminder}
                  onChange={e => setEveningReminder(e.target.value)}
                  className="text-sm bg-transparent outline-none border-none text-right"
                  style={{ color: "#9a6a55" }}
                />
              </div>
              <RowDivider />
              <div className="px-4 py-3">
                {pushAvailable ? (
                  <button
                    onClick={pushSubscribed ? handleUnsubscribe : handleSubscribe}
                    disabled={subscribing}
                    className="text-sm disabled:opacity-40"
                    style={{ color: pushSubscribed ? "#dc2626" : "#ff6b35" }}
                  >
                    {pushSubscribed ? "Disable push notifications" : "Enable push notifications"}
                  </button>
                ) : !pushSupported ? (
                  <p className="text-xs" style={{ color: "#c4927a" }}>
                    Add to Home Screen to enable push notifications.
                  </p>
                ) : (
                  <p className="text-xs" style={{ color: "#c4927a" }}>
                    Notifications not configured.
                  </p>
                )}
                <p className="text-xs mt-1" style={{ color: "#c4927a" }}>
                  Timezone: {timezone}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Account */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#9a6a55" }}>
            Account
          </p>
          <div
            className="bg-white rounded-xl overflow-hidden"
            style={{ border: "0.5px solid #f0ddd4" }}
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
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#9a6a55" }}>
            Legal
          </p>
          <div
            className="bg-white rounded-xl overflow-hidden"
            style={{ border: "0.5px solid #f0ddd4" }}
          >
            <Link href="/privacy" className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "#2d1a0e" }}>Privacy policy</span>
              <span style={{ color: "#c4927a" }}>›</span>
            </Link>
            <RowDivider />
            <Link href="/disclaimer" className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "#2d1a0e" }}>Medical disclaimer</span>
              <span style={{ color: "#c4927a" }}>›</span>
            </Link>
          </div>
        </div>

        {saveError && (
          <p className="text-sm" style={{ color: "#dc2626" }}>{saveError}</p>
        )}

        {/* Save */}
        <button
          className="w-full py-4 text-white text-base font-semibold rounded-xl disabled:opacity-50"
          style={{ background: "#ff6b35" }}
          onClick={handleSave}
          disabled={saving}
        >
          {saved ? "Saved ✓" : saving ? "Saving…" : "Save"}
        </button>

        {/* Version */}
        <p className="text-center text-xs" style={{ color: "#c4927a" }}>
          Tip Pal v{APP_VERSION}
        </p>
      </div>

      {/* Catchup bottom-sheet modal */}
      {showCatchup && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white w-full rounded-t-2xl p-6">
            <p className="text-base font-semibold mb-1" style={{ color: "#2d1a0e" }}>
              Update dose history?
            </p>
            <p className="text-sm mb-5" style={{ color: "#9a6a55" }}>
              Mark all days from Week 1, Day 1 up to your current position as complete in the log?
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "#ff6b35", color: "#fff" }}
                onClick={() => saveAll(true)}
                disabled={saving}
              >
                Yes — add to log
              </button>
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "#f0ddd4", color: "#2d1a0e" }}
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
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 3: Full build**

```bash
npm run build 2>&1 | tail -8
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat(f7): redesign Settings screen with section cards, sign out, version number"
```
