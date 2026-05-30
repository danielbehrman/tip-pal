# Phase 3 — App Store Launch: Implementation Plan

## 1. Architecture Decision (Locked)

### Capacitor with Next.js Static Export

**Confirmed:** Capacitor wraps the existing Next.js app into a native iOS/Android binary. No rewrite.

**Why not Expo/React Native:** Full rewrite of all Phase 1/2 features, 4–6 weeks vs. 1–2 weeks. No upside for the existing Next.js + Supabase stack.

**Why not pure WebView URL wrapper:** Apple Guideline 4.2 ("minimum functionality") rejects apps that simply load a URL in a WebView. Static export bundles HTML/JS/CSS into the binary — it passes review because the UI is self-contained.

**How it works:**
- `next build` with `output: 'export'` generates `out/` directory (static HTML/JS/CSS)
- Capacitor copies `out/` into the native iOS/Android project
- API routes (`/api/parse-schedule`, `/api/send-reminders`) stay on Vercel and are called via full URL from the native app
- Supabase client runs client-side in both web and native — no changes needed
- Vercel continues to serve the web app normally using the same codebase; static export is only activated for native builds via `IS_NATIVE=true`

---

## 2. Open Decision Required Before Dev Starts

### Push Notifications in the Native Wrapper

**The issue:** Web push (VAPID + service worker) does not work inside Capacitor's WKWebView on iOS or reliably in Android WebView. The existing push setup silently fails in the native app.

**Option A — Migrate to Capacitor push in Phase 3 (recommended):**
- Add `@capacitor/push-notifications` + Firebase Cloud Messaging (FCM)
- FCM handles both iOS (via APNs) and Android in a unified API
- Update `/api/send-reminders` to support both VAPID (web) and FCM (native)
- Add `platform` and `fcm_token` columns to `push_subscriptions` table
- Detect `Capacitor.isNativePlatform()` in `ServiceWorkerRegister` — use FCM when native, VAPID when web
- App Store reviewer will test the "Enable notifications" button; a broken button is worse than no button

**Option B — Hide push UI in native, defer to Phase 4:**
- When `Capacitor.isNativePlatform()`, hide the notifications section in Settings
- Web PWA keeps push working as-is
- Phase 4 adds native push

**Recommendation:** Option A. Push is a core feature. Firebase setup is ~2 hours; FCM migration is ~1 day. Option B ships a degraded experience to the App Store.

**Dan must decide before Dev starts.** This decision affects F1 scope and the Supabase migration.

---

## 3. New Dependencies

```bash
# Capacitor core
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android

# Capacitor push (if Option A)
npm install @capacitor/push-notifications @capacitor-firebase/messaging

# Capacitor assets (icons + splash screen)
npm install -D @capacitor/assets
```

---

## 4. Database Migrations

### 4a. Cycle isolation (required for F4 New Food Cycle)

Without cycle isolation, `countCompletedDaysInWeek` counts old-cycle entries for Week 1 and would immediately advance the week after the first Complete Day of a new cycle.

**Migration:**
```sql
-- Track when each cycle started — all dose_log queries filter by this
ALTER TABLE families ADD COLUMN cycle_start_date TIMESTAMPTZ DEFAULT now();

-- Store archived cycle schedules as JSONB array on families
ALTER TABLE families ADD COLUMN archived_cycles JSONB DEFAULT '[]';

-- Store visit number on schedules (parsed from plan of care)
ALTER TABLE schedules ADD COLUMN visit_number TEXT;
```

**Impact on supabase.ts:** All dose_log queries (`countCompletedDaysInWeek`, `fetchCompletedPositions`, `fetchAllDoseLogDays`, `fetchRecentCompletedDays`, `fetchLastDay7Completion`) add `.gte('completed_at', cycleStartDate)` filter. `cycleStartDate` is fetched from `families.cycle_start_date` on daily page load and passed through.

### 4b. Recommended foods counter (required for F3)

```sql
ALTER TABLE dose_state ADD COLUMN recommended_given JSONB DEFAULT '{}';
```

Structure stored: `{ "week": 3, "given": { "Mango": 2, "Peach": 1 } }`

When the stored week doesn't match `current_week`, reset to `{ "week": current_week, "given": {} }`.

### 4c. Push subscriptions (required for F1 Option A)

```sql
ALTER TABLE push_subscriptions ADD COLUMN platform TEXT DEFAULT 'web';
ALTER TABLE push_subscriptions ADD COLUMN fcm_token TEXT;
-- platform: 'web' | 'ios' | 'android'
-- web rows: endpoint/p256dh/auth populated; fcm_token null
-- native rows: fcm_token populated; endpoint/p256dh/auth null
```

---

## 5. Build Process Changes

### next.config.ts
```ts
const isNative = process.env.IS_NATIVE === 'true'

const nextConfig: NextConfig = {
  ...(isNative && {
    output: 'export',
    images: { unoptimized: true },
  }),
}
```

### package.json scripts
```json
"build:web": "next build",
"build:native": "IS_NATIVE=true next build",
"cap:sync:ios": "npm run build:native && npx cap sync ios",
"cap:sync:android": "npm run build:native && npx cap sync android",
"cap:open:ios": "npx cap open ios",
"cap:open:android": "npx cap open android"
```

### .env additions
```
# For native builds only — points API calls to production Vercel
NEXT_PUBLIC_API_BASE_URL=https://tippal.behrman.dev
```
In production Vercel: leave unset (empty) so web app uses relative paths.

### capacitor.config.ts (new file)
```ts
import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.behrman.tippal',
  appName: 'TIP Pal',
  webDir: 'out',
  server: {
    androidScheme: 'https',
  },
}
export default config
```

---

## 6. Feature Implementation Details

---

### F1: Capacitor Wrapper

**Files changed:**
- `next.config.ts` — add conditional static export (above)
- `package.json` — add native build scripts (above)
- `capacitor.config.ts` — new file (above)
- `app/setup/page.tsx` — change API fetch URL:
  ```ts
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? ''
  fetch(`${apiBase}/api/parse-schedule`, ...)
  ```
- `components/ServiceWorkerRegister.tsx` — guard service worker registration:
  ```ts
  import { Capacitor } from '@capacitor/core'
  // Skip service worker registration when running as native
  if ('serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }
  ```

**iOS-specific setup (Dev must do manually):**
1. `npx cap add ios` — generates `ios/` Xcode project
2. Set bundle identifier: `dev.behrman.tippal`
3. Set display name: `TIP Pal`
4. Add app icon via `@capacitor/assets` (1024x1024 PNG → all sizes auto-generated)
5. Configure splash screen via `@capacitor/assets`
6. Set deployment target: iOS 16+
7. Sign with Apple Developer certificate

**Android-specific setup:**
1. `npx cap add android` — generates `android/` Gradle project
2. Set application ID: `dev.behrman.tippal`
3. App icon via `@capacitor/assets`
4. Target SDK: 34 (Android 14)

**Push notifications (if Option A selected):**
- `ServiceWorkerRegister.tsx` expanded to handle both VAPID (web) and FCM (native)
- On native: call `@capacitor/push-notifications` `requestPermissions()` + `register()`
- On `registration` event: get FCM token, call new `saveFcmToken(token, platform)` function
- `/api/send-reminders`: detect subscription type by `platform` column; send via VAPID or FCM accordingly
- Firebase project required: `firebase.google.com` → add iOS app (`dev.behrman.tippal`) + Android app
- APNs key: Apple Developer Portal → Keys → create key with APNs, upload .p8 to Firebase Console
- Add `GoogleService-Info.plist` to Xcode project
- Add `google-services.json` to `android/app/`

**Acceptance criteria verification:**
- Build `IS_NATIVE=true next build` completes without errors
- `npx cap sync ios` copies `out/` to Xcode project
- App launches on iOS simulator
- Login, parse schedule, daily view, history, settings all work
- App launches on Android emulator — same verification

---

### F2: Parser PII Hardening

**File changed:** `app/api/parse-schedule/route.ts`

**Changes:**
1. Add `stripPii(text: string): string` function before Claude call:
   - Strip phone numbers: `/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g`
   - Strip emails: `/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g`
   - Strip DOBs: `/\b(DOB|Date of Birth|Born)[:\s]+[\d\/\-]+/gi`
   - Strip common name patterns: `/\b(Patient|Provider|Doctor|Dr\.?|Mr\.?|Mrs\.?|Ms\.?)[\s]+[A-Z][a-z]+\b/g`
2. Update Claude system prompt with explicit PII instruction (append to existing):
   ```
   IMPORTANT: Extract ONLY food names, doses, units, and schedule information.
   Ignore and do not reproduce any patient names, provider names, phone numbers,
   dates of birth, email addresses, or any personal identifying information.
   ```
3. Strip function runs on `text` before it's passed to Claude API — raw text never logged or stored

**Acceptance criteria verification:**
- Parse a test document with fake patient name and phone number
- Verify neither appears in the returned JSON
- Verify Supabase `schedules.parsed_data` contains no PII fields

---

### F3: Schema v2 — Recommended Foods + Medications

**Files changed:**
- `app/api/parse-schedule/route.ts` — update schema and system prompt
- `lib/types.ts` — add `RecommendedFood`, `Medication` types; add to `ParsedSchedule`
- `lib/supabase.ts` — add `recommended_given` to `DoseState`; add `saveRecommendedGiven`
- `components/ScheduleReview.tsx` — add review sections for recommended + medications
- `app/setup/page.tsx` — no change (passes parsed schedule through as-is)
- New: `app/recommended/page.tsx` — recommended foods + medications screen
- New: `components/RecommendedFoodsView.tsx` — displays foods with weekly counter + medications

**Types additions (`lib/types.ts`):**
```ts
export interface RecommendedFood {
  name: string
  dose: number
  unit: string
  frequencyPerWeek: string  // "3-5"
}

export interface Medication {
  name: string
  dose: string
  unit: string
  frequency: string
}

// Add to ParsedSchedule:
recommendedFoods: RecommendedFood[]
medications: Medication[]

// Add to DoseState:
recommendedGiven?: { week: number; given: Record<string, number> }
```

**Parser prompt update:** Add to system prompt:
```
- recommendedFoods: foods recommended 3–5x per week but not daily. Not treatment foods.
- medications: daily medications (e.g. Zyrtec, Flovent, SLIT drops). Not scenario kit items.
```
Update schema in prompt to match v2 (add `recommendedFoods` and `medications` arrays with `isFinal` removed from medications).

**Recommended foods screen (`app/recommended/page.tsx`):**
- Load schedule + dose_state (for recommendedGiven)
- Show each recommended food with: name, dose, target frequency ("3–5x/week")
- Counter: "X / 3–5 this week" — tap food to increment, hold to decrement
- Resets when `current_week` doesn't match stored week in `recommendedGiven`
- Medications section below: name, dose, frequency — read-only, no counter
- Link to this page from daily view footer (alongside "Dose history" and "Settings")

**ScheduleReview additions:**
- Add sections for `recommendedFoods` and `medications` after treatment foods
- Inline editing for both (name, dose, unit, frequency)
- Both are read-only toggle-style display (not FoodReviewRow with capped/prepNote)

---

### F4: New Food Cycle Flow

**Files changed:**
- `lib/supabase.ts` — add `fetchCycleStartDate`, `startNewFoodCycle`; update all dose_log queries to filter by `cycleStartDate`
- `app/daily/page.tsx` — load `cycleStartDate` on mount; pass to affected functions
- `app/settings/page.tsx` — add "New Food Cycle" section with confirmation flow
- `app/setup/page.tsx` — parse `visitNumber` from schedule; pass to `saveSchedule`

**`startNewFoodCycle(newSchedule: ParsedSchedule, visitNumber: string)` function:**
1. Fetch current `schedules.parsed_data`
2. Append to `families.archived_cycles` array: `{ parsed_data, visit_number, archived_at }`
3. Upsert new schedule with `visit_number`
4. Set `families.cycle_start_date = now()`
5. Reset `dose_state` to Week 1, Day 1, empty checkedFoods, empty recommendedGiven
6. Clear `completedPositions` in client state

**Dose log isolation:**
All dose_log query functions gain a `cycleStartDate: string` parameter and add `.gte('completed_at', cycleStartDate)`:
- `countCompletedDaysInWeek(week, cycleStartDate)`
- `fetchCompletedPositions(cycleStartDate)`
- `fetchAllDoseLogDays(cycleStartDate)`
- `fetchRecentCompletedDays(cycleStartDate)`
- `fetchLastDay7Completion(cycleStartDate)`

`cycleStartDate` is fetched on daily page load alongside other state, stored in React state, passed to all affected handlers.

**Settings UI for new food cycle:**
```
New Food Cycle
[Start new food cycle →]
```
Tapping opens confirmation: "Starting a new food cycle will archive your current schedule and reset to Week 1, Day 1. Your dose history is preserved." → Confirm → takes user to `/setup` with a `newCycle=true` query param → after parse and confirm, calls `startNewFoodCycle` instead of `saveSchedule`.

**Visit number:**
- Parser prompt updated to extract `visitNumber` from plan of care
- Displayed in app header: "Visit 9 · Week 3, Day 4" (if visit number available)
- `DailyView` updated to show visit number from schedule if present
- `families` table: add `visit_number TEXT` (updated by `startNewFoodCycle`)

---

### F5: Privacy Policy

**New file:** `app/privacy/page.tsx` — static server component, no auth required

**Content (no UI needed beyond readable text):**
- What data is stored: food/dose schedule linked to account email only
- No PII in app data tables
- No sale of data
- Account deletion removes all data
- Supabase named as data processor
- Contact: `daniel.behrman@gmail.com`

Must be live at `https://tippal.behrman.dev/privacy` before App Store submission.

---

### F6: Medical Disclaimer

**New file:** `app/disclaimer/page.tsx` — static, no auth required

**Also:** Add disclaimer banner to `app/login/page.tsx` (below the sign-in form, small text):
> "TIP Pal is not a medical device. It is not affiliated with the Food Allergy Institute or the Tolerance Induction Program. Always follow your provider's instructions."

Displayed on login so it's visible before use. Also accessible as standalone page for App Store link.

---

### F7: App Store Submission

**Not code — prerequisites Dev must flag as blocked until Dan completes:**

- [ ] Apple Developer Program enrolled ($99/year) — up to 2 days for approval
- [ ] Google Play Console registered ($25 one-time)
- [ ] App icon: 1024×1024 PNG, no transparency, no alpha channel
- [ ] iPhone screenshots: 6.7" required (iPhone 15 Pro Max simulator)
- [ ] Privacy policy URL live (`https://tippal.behrman.dev/privacy`)
- [ ] If Option A: Firebase project created, APNs key generated

**App Store metadata:**
- Name: TIP Pal
- Category: Medical
- Age rating: 4+
- Description: TBD — must not use "Tolerance Induction Program" without FAI permission; use "food allergy tolerance program" as fallback
- Keywords: food allergy, tolerance, dosing, OIT, schedule
- No HealthKit entitlement

**Submission path:**
1. Xcode → Product → Archive
2. Upload to App Store Connect via Xcode Organizer or Transporter
3. TestFlight internal testing first (Dan + wife)
4. Submit for review after TestFlight passes

---

### F8: Open Source Repo

**Files to create/update:**
- `README.md` — project description, screenshots, App Store links (once live)
- `SELF_HOSTING.md` — step-by-step: fork repo, create Supabase project, set env vars, deploy to Vercel
- `LICENSE` — already exists (MIT) ✓
- `.env.example` — list of all required env vars with descriptions, no values

**README sections:** What it is, screenshots, self-hosting quick-start, contributing, license.

**SELF_HOSTING.md must cover:**
1. Supabase: create project, run all SQL migrations (consolidate all migrations into one file: `supabase/migrations/001_initial.sql`)
2. Anthropic: get API key
3. Vercel: fork repo, connect to Vercel, add all env vars
4. VAPID keys: `npx web-push generate-vapid-keys`
5. Cron: set up cron-job.org pointing at `/api/send-reminders`
6. First login: create two accounts manually in Supabase Auth

**Env var documentation (`SELF_HOSTING.md` + `.env.example`):**
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
CRON_SECRET
NEXT_PUBLIC_API_BASE_URL  (native builds only)
```

---

## 7. Implementation Order

Feature dependencies within Phase 3:

| Feature | Depends On |
|---|---|
| F2: PII Hardening | None — isolated to API route |
| F5: Privacy Policy | None — static page |
| F6: Medical Disclaimer | None — static page |
| F3: Schema v2 | DB migration 4b (recommended_given column) |
| F1: Capacitor Wrapper | F2, F3, F5, F6 must be complete first (all functionality must work before wrapping) |
| F4: New Food Cycle | DB migration 4a (cycle_start_date), F3 (visitNumber parsing) |
| F8: Open Source Repo | All migrations consolidated; F2, F3, F4 complete |
| F7: App Store Submission | F1, F4, F5, F6, F8; Apple Developer account active |

**Recommended build order:**
1. F5 + F6 (static pages — 1 day, fast, no dependencies)
2. F2 (PII hardening — isolated, 0.5 day)
3. DB migrations (all at once — cycle_start_date, recommended_given, push_subscriptions columns)
4. F3 (Schema v2 — parser + recommended foods UI + counter, 2–3 days)
5. F4 (New food cycle flow — 2 days, depends on DB + F3 for visitNumber)
6. F1 (Capacitor wrapper — 2–3 days, wraps the completed app; push migration if Option A chosen)
7. F8 (Open source repo — 1 day, parallel-able with F1)
8. F7 (App Store submission — blocked on Apple Developer account)

**Total estimated Dev time:** 10–14 days depending on push notification option.

---

## 8. Unresolved Before Dev Starts

| Decision | Options | Recommended | Owner |
|---|---|---|---|
| Push notifications in native | A: migrate to FCM in Phase 3 / B: hide and defer to Phase 4 | Option A | Dan |
| FAI permission for "TIP"/"Tolerance Induction Program" branding | Reach out to FAI / use "food allergy tolerance program" fallback | Start outreach now, use fallback if no response by submission | Dan |
| Apple Developer Program enrollment | Enroll now ($99) | Do immediately — 2-day approval can block F7 | Dan |
| Firebase project (if Option A) | Create at firebase.google.com | Do alongside Dev F1 work | Dan |
