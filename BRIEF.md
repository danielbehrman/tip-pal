# Shipyard — Project Brief

## Project
TIP Pal — a daily dosing assistant for families in food allergy tolerance induction programs.

## Current Status
Phase: Phase 3 — App Store Launch
Mode: Active Build
Last Updated: 2026-06-09
Blocker: None
Next Action: F1 (Capacitor Wrapper) — resume simulator verification on iOS

---

## Product Goal
Publish on Apple App Store and Google Play. Open source the repo for self-hosting. Optional donation model via milestone email — no subscription, no paywall. Differentiate from Tolerance Tracker 2 on: AI-powered schedule parsing, open source, and free.

---

## Stack
| Layer | Decision | Status |
|---|---|---|
| Frontend | Next.js | ✅ Confirmed |
| Storage | Supabase (Postgres) | ✅ Confirmed |
| Auth | Supabase Auth (email/password) | ✅ Confirmed |
| Hosting | Vercel | ✅ Confirmed |
| Schedule Parsing | Anthropic Claude API (server-side Next.js API route) | ✅ Confirmed |
| Mobile Wrapper | Capacitor (static export) | ✅ Locked — see plans/PHASE-3.md |
| Open Source License | AGPL v3 | ✅ Confirmed |

---

## Security Constraints
> RLS and shared state are implemented in Phase 2. Remaining items are Phase 3 gates.

**Data isolation — implemented in Phase 2:**
- RLS enabled on all Supabase tables — confirmed in Phase 2 (F7 family-scoped via RLS, dose_log RLS policies deployed)
- All app data tables use family UUID as the only identifier — no patient names or PII in food/dose tables
- Email addresses live only in Supabase Auth, never in app data tables

**Parser PII handling — Phase 3 requirement:**
- Raw plan of care text must never be persisted — discarded server-side immediately after the Claude API call
- Flow: client sends raw text → Next.js API route → Claude API → structured JSON returned → raw text discarded → JSON saved to Supabase
- JSON schema contains no PII fields — food names and doses only
- Claude API prompt must explicitly instruct the model to extract only food/medication fields and ignore all patient and provider information
- Server-side preprocessing pass strips obvious PII (names, phone numbers, dates of birth, email addresses) from raw text before it reaches the Claude API

**HIPAA:** Not applicable. Consumer app, not a covered entity. Good security practices above are sufficient.

**Privacy policy must state:** food/dose schedule stored linked to account email; no other personal information collected or stored; data not sold; account deletion removes all associated data; Supabase named as data processor.

---

## Terminology
- **Food cycle:** the period between clinic visits. Use this term in all user-facing copy.
- **Visit number:** increments at each clinic visit (Visit 1 → Visit 20 → Tolerance Visit 1 → Tolerance Visit 2 → Remission Visit 1 → Annual Remission Visits)
- **CAPPED:** exact dose — no more, no less. Always visually labeled.
- **Micro:** microdose — first introduction of a food
- **Denatured:** boiled milk (3-minute full boil). Distinct from uncooked dairy — not interchangeable.
- **Scenario kit:** pre-dosed emergency medications for allergic reaction scenarios 1, 2, and 3

---

## JSON Schema (Claude API Output — v2)
Target schema for Phase 3 parser update. Adds `recommendedFoods` and `medications` to Phase 1/2 schema.

```json
{
  "visitNumber": "9",
  "appointmentDate": "YYYY-MM-DD",
  "followUpWeeks": 8,
  "maintenanceFoods": [
    { "name": "", "dose": 0, "unit": "", "capped": false, "prepNote": "" }
  ],
  "weeklyFoods": [
    { "name": "", "dose": 0, "unit": "", "prepNote": "" }
  ],
  "treatmentFoods": [
    {
      "name": "",
      "weeks": [{ "week": 1, "dose": 0, "unit": "", "isFinal": false }]
    }
  ],
  "recommendedFoods": [
    { "name": "", "dose": 0, "unit": "", "frequencyPerWeek": "3-5" }
  ],
  "medications": [
    { "name": "", "dose": "", "unit": "", "frequency": "" }
  ]
}
```

**Schema notes:**
- `isFinal: true` marks the final week of a treatment food — "continue this dose until next visit"
- `capped: true` requires the CAPPED label — no more, no less than this dose
- `prepNote` captures instructions like "crushed," "chopped," "reconstituted"
- `recommendedFoods` are not daily — target frequency is 3–5x/week
- `medications` are daily medications (e.g. Zyrtec, Flovent) — not food, not scenario kit
- Scenario kit medications managed separately in the Expiry Tracker, not parsed here

---

## Assumptions
- ✅ Anthropic API key available as server-side env var — confirmed working in Phase 1
- ✅ Supabase project and credentials provisioned — confirmed complete
- ✅ Capacitor with Next.js static export — locked 2026-05-30. See plans/PHASE-3.md.
- ⚠️ ASSUMPTION: Existing dose_log rows with `is_skipped: true` may exist from prior Skip Session usage. The new logic (F0) must not break on these rows — they should be treated as logged days (not gaps) when calculating current treatment day position. Architect must verify how many skipped rows exist in production Supabase before Dev touches completion logic, and confirm query handling before proceeding.

---

## Carry Forward
| Item | Severity | Source Phase | Priority |
|---|---|---|---|
| localStorage persistence unreliable | High | Phase 1 | ✅ Resolved — Supabase migration in Phase 2 F1 |
| Schema missing recommendedFoods and medications | Medium | Phase 1/2 | P0 in Phase 3 — parser update required |
| Settings: appointment date not persisting | High | Phase 2 | ✅ Resolved — fixed in commit 2234b29 |
| Re-parse overwrites dose history | High | Phase 2 | ✅ Not a bug — dose_log untouched by re-parse, confirmed 2026-06-01 |
| Buffer calculation wrong | Medium | Phase 2 | ✅ Resolved — fixed in commit 2234b29 |
| Push notifications firing in wrong timezone | High | Phase 2 | ✅ Resolved — daily page now syncs device timezone on every load, 2026-06-01 |

---

## Phase 1 — Demo ✅ Complete

### Feature 1: Schedule Parsing ✅ Pass
**Status:** Complete — parsing confirmed working on live Vercel deploy.

### Feature 2: Daily Dose View ✅ Pass (with known carry forward)
**Status:** Complete. UI, checkboxes, Complete Day gate, and day/week advancement all working. localStorage persistence unresolved — not blocking Phase 1 close. Moved to Phase 2.

**Changes made during build (not in original brief):**
- `terminal: true` flag added to final week entry in `treatmentFoods` JSON schema
- Default Week 1, Day 1 on first load
- Checkbox state resets on re-parse confirm, not on initiation
- Complete Day blocked if any evening foods unchecked — amber inline warning
- localStorage keys changed from index-based to name-based to prevent corruption on re-parse

---

## Phase 1 — Completion Record

| Feature | Result | Notes |
|---|---|---|
| Schedule Parsing | ✅ Pass | Parsing, review, inline edit, confirm, and re-parse all working. Deployed to Vercel. |
| Daily Dose View | ⚠️ Partial | UI complete. localStorage state does not persist across page reloads. |

**Deferred items:** localStorage persistence — High severity — P0 in Phase 2. Resolved by F1.
**Known regressions:** None.
**Decisions made during build:** API key configured in Vercel only. Checkbox keys are name-based. Complete Day blocked if any evening foods unchecked — inline error with live reactive dismissal.

---

## Phase 2 — Production ✅ Complete (2026-05-25)

### Architecture Decisions (locked 2026-05-22, updated 2026-06-06)

| Decision | Detail |
|---|---|
| Shared state | Supabase (server-authoritative). No real-time subscriptions for MVP — refresh fetches latest. Stale local state must never override server on refresh. |
| Auth | Supabase Auth, email/password. Two users (Dan + wife) for MVP. Schema supports multi-family expansion (families → users → schedules) but MVP does not build multi-family UI. |
| Push notifications | Web push only for MVP. Native push is long-term target — out of scope for Phase 2. |
| Trailing edit | Checkbox state only. Unchecking a morning food = no impact on day completion. Unchecking an evening food = day incomplete. |
| Buffer days | Buffer = days from the day after the final complete week's Day 7 through the day before the next appointment. |
| State on refresh | Server wins. Refresh always fetches latest from Supabase. No stale cookie or localStorage override. |
| Buffer anchor date | Record a `completed_at` timestamp on every Day 7 "Complete Day" action. Buffer calculated from most recent Day-7 completion timestamp. |
| Dose log session model | One row per day (`session: 'day'`). Skip morning or skip evening creates a separate additional row. |
| Day completion rule | **Updated F0:** Auto-completes when last evening treatment food is checked — no user action required. Evening treatment foods only gate completion — consistent with clinical plan of care. Morning is informational only, no impact on completion. Complete Day button removed. Skip Session removed. |
| Day navigation | Day + disabled if current (week, day) has not been logged via Complete Day — cannot skip ahead to an unlogged position. After navigating back to a logged day, Day + is available to move forward. Backwards navigation (Day −) always allowed. Week +/− are manual overrides, unrestricted. |
| Date display | **Added F0:** Completed days show `completed_at` date from dose_log. Current incomplete day shows live today's date. Format: "Week 1, Day 4 · Thu Jun 6" in header. |
| Treatment day advancement | **Added F0:** Treatment day advances only via completion (auto or manual). Calendar time does not advance the treatment day — if a day is not completed, it remains the current day the next calendar day, with the date label updating to reflect the new calendar date. |
| Push delivery mechanism | External cron (cron-job.org) → `/api/send-reminders`. Runs every minute. |
| Branding | App displayed as "[Family Name]'s TIP Pal" in top left when logged in. Family name entered during onboarding. |

---

### Phase 2 Features

#### F1: Supabase Foundation — Shared State Replacing localStorage
**Status:** ✅ Complete — deployed to production 2026-05-23

#### F2: Supabase Auth — Email/Password, Two Accounts
**Status:** ✅ Complete — deployed and verified 2026-05-24

#### F3: Appointment Date Entry and Buffer Day Display
**Goal:** Let a parent record the next clinic appointment so the app can calculate and display buffer days remaining.
**Status:** ✅ Complete — deployed to production 2026-05-24

Key implementation details:
- Date input on main daily view labeled "Next appointment"
- Appointment date stored in Supabase (`next_appointment_date` on `families` table), shared between both parents
- Buffer displayed as "X buffer days before appointment"
- Appointment date in the past → "Appointment date has passed — please update"

#### F4: Completion-Based Week Advancement
**Goal:** Automatically advance the week counter when 7 Complete Day actions are logged for the current week.
**Status:** ✅ Complete — deployed to production 2026-05-24

Key implementation details:
- Every Complete Day writes a row to `dose_log` with `family_id`, `week`, `day`, `session`, `checked_foods`, `completed_at`, `is_skipped: false`
- Count reaches 7 → week increments by 1, day resets to 1, `checkedFoods` cleared
- Manual +/− controls remain as overrides — do not write to dose log

#### F5: Skip Session
**Goal:** Let a parent mark a morning or evening session as skipped so the event is logged rather than silently absent.
**Status:** ✅ Complete — deployed to production 2026-05-25

Key implementation details:
- Skip morning → `dose_log` row: `session: 'morning'`, `is_skipped: true` — informational only
- Skip evening → BLOCKS Complete Day with error: "Evening session was skipped — give the same evening treatment foods again before advancing"
- Evening skip always blocks Complete Day regardless of morning session state — treatment foods must be given before advancing

#### F6: Trailing 3-Day Edit
**Goal:** Let a parent correct checkbox state for the previous 3 completed days without affecting week advancement.
**Status:** ✅ Complete — deployed to production 2026-05-25. Accessible at /history/edit from dose history page.

#### F7: Full Dose History Log
**Goal:** Read-only chronological log of all dose sessions for reference at clinic appointments.
**Status:** ✅ Complete — deployed to production 2026-05-25. Accessible at /history from daily view.

#### F8: Web Push Notification Reminders
**Goal:** Two daily push notifications (morning and evening) at parent-configured times.
**Status:** ✅ Complete — deployed to production 2026-05-25. Push delivery via `/api/send-reminders` (external cron). Notification settings in Settings page. PWA manifest + service worker included.

**F8 Activation Steps (required before notifications will fire):**

1. Generate VAPID keys (run once):
```
npx web-push generate-vapid-keys
```

2. Add to Vercel environment variables:
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` — `mailto:daniel.behrman@gmail.com`
- `CRON_SECRET` — any random string (`openssl rand -hex 32`)
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase dashboard → Project Settings → API

3. Set up external cron (cron-job.org — free):
- URL: `https://tippal.behrman.dev/api/send-reminders`
- Method: GET
- Header: `Authorization: Bearer <your CRON_SECRET>`
- Schedule: every minute

4. On iOS: add TIP Pal to Home Screen, then tap "Enable notifications" in Settings.

#### F9: Onboarding Config Screen
**Goal:** After parsing the schedule on first login, collect family name, appointment date, and current week/day position before landing on daily view.
**Status:** ✅ Complete — deployed to production 2026-05-25. Auto-shown after schedule parse. Skipped on subsequent logins when family name already set.

#### F10: Settings Screen
**Goal:** Allow parents to revisit and update family name, appointment date, and schedule after each clinic visit.
**Status:** ✅ Complete — deployed to production 2026-05-25. Accessible via "Settings" link at bottom of daily view. Includes family name, appointment date, week/day adjustment, notification times, push subscribe/unsubscribe, and re-parse schedule link.

---

### Cross-Feature Dependency Map

| Feature | Depends On |
|---|---|
| F1: Supabase Foundation | None |
| F2: Auth | F1 |
| F3: Appointment + Buffer | F1, F2 |
| F4: Completion-Based Advancement | F1, F2 |
| F5: Skip Session | F1, F2, F4 |
| F6: Trailing 3-Day Edit | F1, F2, F4, F5 |
| F7: Dose History Log | F1, F2, F4, F5 |
| F8: Push Notifications | F1, F2 |
| F9: Onboarding Config Screen | F1, F2 |
| F10: Settings Screen | F9 |

---

## Phase 2 — Completion Record

| Feature | Result | Notes |
|---|---|---|
| F1: Supabase Foundation | ✅ Pass | Deployed 2026-05-23 |
| F2: Auth | ✅ Pass | Deployed 2026-05-24 |
| F3: Appointment + Buffer | ✅ Pass | Deployed 2026-05-24 |
| F4: Week Advancement | ✅ Pass | Deployed 2026-05-24 |
| F5: Skip Session | ✅ Pass | Deployed 2026-05-25 |
| F6: Trailing Edit | ✅ Pass | Deployed 2026-05-25 |
| F7: History Log | ✅ Pass | Deployed 2026-05-25 |
| F8: Push Notifications | ✅ Pass | Deployed 2026-05-25 — activation steps required |
| F9: Onboarding | ✅ Pass | Deployed 2026-05-25 |
| F10: Settings | ✅ Pass | Deployed 2026-05-25 |

**Deferred to Phase 3:** Recommended foods, medications categories in schema.
**Known regressions:** None.

---

## Phase 3 — App Store Launch 📋 Planned

### Architecture Decision — Locked (2026-05-30)
**Capacitor with Next.js static export.** `output: 'export'` bundles HTML/JS/CSS into the native binary. API routes stay on Vercel, called via full URL from native. Same codebase for web and native. See `plans/PHASE-3.md` for full implementation details.

### Open Decisions — Locked 2026-06-01
1. **Push notifications in native:** ✅ Option B — push UI hidden in native wrapper. Web push remains active for web users. FCM/Capacitor push deferred to Phase 4.
2. **FAI branding:** ✅ No contact made. Use "food allergy tolerance program" in all Phase 3 copy — store listing, disclaimer, all UI. FAI outreach deferred to Phase 4.
3. **Apple Developer Program:** ✅ Enroll during F1 when physical device testing requires it — natural forcing function. Do not block F1 start on enrollment.
4. **Firebase:** ✅ Not needed. Moot with Option B.

### Phase 3 Features

#### F0: Daily View UX Fixes
**Goal:** Fix core usability issues discovered during dogfooding — missing date context, manual completion requirement, and ability to log out-of-order days.
**Priority:** P0 — blocking daily use. Ship to web before Capacitor work resumes.
**Status:** ✅ Complete — deployed to web 2026-06-09

Acceptance criteria:
- Completed days display the `completed_at` date from dose_log in the header: "Week 1, Day 4 · Thu Jun 6"
- Current incomplete day displays today's live calendar date in the same format
- When the last evening treatment food is checked, the day completes automatically — no user action required
- `completed_at` timestamp is written to dose_log at the moment of auto-complete
- App advances to next day automatically on auto-complete
- Complete Day button removed entirely
- Skip Session button and skip logging removed entirely
- Checking foods on any day ahead of the current treatment day is blocked
- Blocked state shows inline error: "You haven't reached this treatment day yet"
- Browsing forward with Day + navigation is still allowed — only food interaction is blocked on future days

Constraints:
- Evening treatment foods only gate auto-complete — clinically confirmed: treatment foods dosed PM, maintenance AM with no completion requirement per plan of care
- Morning section unchanged and remains informational only
- No new data fields required — dates derived from `completed_at` for past days, live date for current day
- Removing Skip Session must not break existing dose_log queries that reference `is_skipped` rows — `is_skipped: true` rows treated as logged days (not gaps) for treatment day position calculation
- Treatment day does not advance on calendar time — stays on current day until completed, with date label updating daily

Definition of done: Dan opens the app, sees today's date on the current day, checks off all evening treatment foods, day advances automatically, and cannot check foods on a future day.

#### F1: Capacitor Wrapper ✅ Dev Complete — pending Dan simulator verification
**Goal:** Wrap the Next.js app in a native mobile shell for App Store and Google Play distribution.
**Priority:** P0 — gates everything else in Phase 3

Acceptance criteria:
- App runs as a native iOS app via Capacitor
- App runs as a native Android app via Capacitor
- All Phase 1 and Phase 2 functionality works identically in the native wrapper
- App icon and splash screen configured — ✅ placeholder assets in place; Dan provides final 1024×1024 PNG before F7
- No external payment or donation links inside the iOS app — App Store policy

Build commands:
- `npm run build:native` — **permanent native build command**: renames `app/api` → `app/_api`, runs `next build` with `IS_NATIVE=true` + env vars from `.env.local`, restores `app/api` in `try/finally` (always, even on failure), then runs `npx cap sync ios`. Run this before every Xcode build.
- `npm run cap:open:ios` — opens Xcode workspace
- `npm run cap:open:android` — opens Android Studio

Why the rename: Next.js requires `export const dynamic` to be a static string literal — Turbopack rejects runtime expressions. No config option exists to exclude specific routes from `output: 'export'`. Removing API routes before the build is the only viable approach. They stay on Vercel; native app calls them via `NEXT_PUBLIC_API_BASE_URL`.

Recovery: if `app/api` is missing after an interrupted build, re-running `npm run build:native` auto-detects `app/_api` and restores it before starting.

#### F2: Parser PII Hardening
**Goal:** Ensure raw plan of care text is never stored and PII cannot leak into the parsed JSON output.
**Priority:** P0 — security requirement before public launch

Acceptance criteria:
- Raw parse text discarded server-side immediately after Claude API call — never logged or persisted
- Server-side preprocessing strips names, phone numbers, dates of birth, email addresses before Claude API call
- Claude API prompt explicitly instructs model to extract food/medication fields only and ignore all patient and provider information
- Verified: no PII appears in Supabase after a parse of a full plan of care document

#### F3: Schema v2 — Recommended Foods + Medications
**Goal:** Update the Claude API parsing prompt and UI to handle all five food/medication categories.
**Priority:** P0 — incomplete without it

Acceptance criteria:
- Parser outputs all fields per Schema v2 above: maintenanceFoods, weeklyFoods, treatmentFoods, recommendedFoods, medications
- Recommended foods display on a separate info screen — not in the daily dose view
- Medications (e.g. Zyrtec, Flovent) display on the same screen as recommended foods
- Review screen shows all categories before confirm
- Inline editing works for all categories
- Recommended foods screen shows a per-food weekly frequency counter: number of times given this week out of the target (e.g. "2 / 3–5 this week"). Counter increments when the parent taps the food as given. Resets each week.

Constraints:
- Recommended foods and medications are informational only — no checkbox tracking in Phase 3. The weekly counter is a simple given-this-week tally, not a dose log entry.
- Daily dose view is unchanged

#### F4: New Food Cycle Flow
**Goal:** When a clinic visit produces a new plan of care, archive the current cycle and load the new schedule without losing history.
**Priority:** P0

Acceptance criteria:
- "New Food Cycle" option accessible from Settings
- Confirmation prompt: "Starting a new food cycle will archive your current one. Your history will be preserved."
- Re-parse flow runs: paste new plan of care, Claude parses, review screen shows what's changing
- On confirm: treatment foods replaced entirely, maintenance foods merged (new items added, existing preserved), week/day counter resets to Week 1/Day 1, visit number increments, previous cycle archived in Supabase
- App header updates: "Visit 10 · Week 1, Day 1"
- Previous cycles preserved in Supabase — not surfaced in UI yet

Constraints:
- Maintenance foods are never wiped — new cycle is additive only
- Visit number parsed from plan of care, not manually entered
- History view is out of scope for Phase 3

#### F5: Privacy Policy
**Goal:** Publicly hosted privacy policy satisfying Apple's App Store requirement.
**Priority:** P0

Must cover: what data is stored (food/dose schedule linked to account email only), no PII in app data tables, no sale of data, account deletion removes all data, Supabase as data processor.

#### F6: Medical Disclaimer
**Goal:** Clear disclaimer that TIP Pal is not a medical device and not affiliated with FAI.
**Priority:** P0

Copy: "TIP Pal is not a medical device. It is not affiliated with the Food Allergy Institute or the Tolerance Induction Program. Always follow your provider's instructions."

Note: Do not use "TIP" or "Tolerance Induction Program" in the App Store listing without written FAI permission. Use "food allergy tolerance program" as fallback if no response to FAI outreach.

#### F7: App Store Submission
**Goal:** Published on Apple App Store and Google Play.
**Priority:** P0

Requirements:
- Apple Developer account ($99/year — up to 2 days for approval)
- Google Play Console ($25 one-time)
- App Store metadata: name (TIP Pal), description, screenshots (iPhone), keywords, category: Medical
- Age rating: 4+
- No HealthKit integration — custom data only

#### F8: Open Source Repo
**Goal:** Public GitHub repo with README, self-hosting guide, and AGPL v3 license. Ships alongside store launch.
**Priority:** P0

Contents: project description, setup instructions, environment variable guide, AGPL v3 license, contribution notes.
---

## Phase 4 — Engagement 📋 Planned
> First draft. Details locked after Phase 3 is confirmed.

#### Milestone Email — Donation Ask
**Goal:** After a user completes their first full day, send a triggered email with a soft donation ask.

Key spec:
- Trigger: first Complete Day event per account, ever
- Content: brief personal note from Dan, what the app is, optional donation link (Buy Me a Coffee or equivalent)
- Donation link is external web only — not inside the iOS app (App Store policy)
- One email per account, never repeated

---

#### Emergency Medication Expiry Tracker
**Goal:** Track expiration dates for all scenario kit medications and EpiPens. Warn ahead of expiry so nothing is expired when it's needed.

Scenario kit medications to track:
| Medication | Scenario(s) |
|---|---|
| Benadryl (12.5mg/5ml) | 1, 2, 3 |
| Famotidine (40mg/5mL) | 1, 2, 3 |
| Prednisolone (15mg/5ml) | 2, 3 |
| Claritin | 3 |
| Activated Charcoal (25g) | 3 |
| EpiPen | 3 |

Key spec:
- Dedicated screen: Scenario Kit / EpiPens grouped separately
- Each item: name, scenario label (kit items only), expiration date, status (OK / Expiring Soon / Expired)
- Default warning window: 30 days for kit medications, 60 days for EpiPens
- Warning window adjustable per user in settings
- Expired items: high visual urgency, sorted to top
- Notifications fire at warning threshold per item and again on expiration date
- Add, edit, delete items with single confirmation
- Shared state — both users see the same list, both receive notifications
- EpiPens tracked individually by location label (e.g. "Home," "School bag")

---

#### Recommended Foods View
**Goal:** Display recommended foods (3–5x/week) with a weekly frequency counter.

Key spec: TBD — requires Schema v2 parser to be shipped in Phase 3 first.

---

#### Food Grouping
**Goal:** Allow composite foods to be checked off as one item with the ability to expand and check individual components on days when not all are served.

Key spec: TBD — needs detailed spec before Phase 4 planning session. Confirmed real user need — Tolerance Tracker 2 shipped this in March 2026.

---

#### Native Push Notifications (via Capacitor)
**Goal:** Replace web push with native iOS/Android push for more reliable delivery.

Key spec: TBD — depends on Capacitor wrapper from Phase 3.

---

## Phase 5+ — Backlog
> Valid, not yet scheduled.

- Household invite flow (replace manual account setup)
- Appointment buffer enforcement (warn if behind on dosing relative to appointment date)
- Skip conditions surfaced in UI (fever, antibiotics, dental work, appointment day)
- Cycle history view (browse archived food cycles)
- Reaction reporting
- SLIT tracking
- Sourcing reminders (source specialty foods 4+ weeks before appointment)
- App icon generation via npx @capacitor/assets generate — single 1024x1024 source PNG generates all required iOS and Android sizes
- Design system foundation — Tailwind config as token layer (colors, spacing, type scale), reusable component library (buttons, cards, checkboxes), and layout components that control screen structure independently of business logic. Goal: move UI elements and redesign screens without touching dosing logic.

---

## Execution Notes

**Core promise:** Open the app, know exactly what to give, check it off. If that's fast and clear, the concept is validated.

**Stakes context:** This manages active medical treatment for a 5-year-old in a food allergy tolerance induction program. Wrong doses or wrong week progression can set back treatment by weeks and require rebooking travel to the treating clinic. The UI must be calm, clear, and unambiguous — it is used at 6am and 9pm by tired parents.

**CAPPED foods:** Exact doses — no more, no less. Must be visually labeled in all views.

**Seeds:** All seeds must show a "crush/chop before serving" note inline. Medical requirement.

**Denatured vs. uncooked dairy:** These are clinically distinct. Denatured = boiled 3 minutes. Uncooked = never heated. The parser must preserve this distinction — they are not interchangeable and swapping them is a medical error.

**Timing rules (informational only, not enforced):** Treatment foods at least 4 hours after morning maintenance. Multiple treatment foods spaced 15 min apart. Followed by 1-hour rest — no exercise, showers, or sleeping.

**Weekly foods:** Shown in the morning section on Day 7 only.

**Branding:** App header displays "[Family Name]'s TIP Pal" when logged in. Family name set during onboarding (F9).

**7-day minimum rule:** Plan of care requires at least 7 days on the final week's dose before the next clinic challenge. Informational only — not enforced by the app.

**Skip conditions (informational only, not enforced):**
- Fever over 100.4°F
- First 24 hours after starting antibiotics
- First 24 hours after losing a tooth, dental work, or cuts in the mouth
- Appointment day: skip maintenance and treatment foods, still give daily medications and SLIT

**Visit progression:** Launch Visit → Visit 1 → ... → Visit 20 → Tolerance Visit 1 → Tolerance Visit 2 → Remission Visit 1 → Annual Remission Visits.

**Sourcing lead time:** Specialty foods (camel milk, mare milk) require 4+ weeks to source. Informational only — app does not track sourcing.

**Competitive context:** Tolerance Tracker 2 launched January 2026. Closed source, ~$9.99/month. Does not have AI-powered schedule parsing. TIP Pal differentiates on: free, open source, AI parsing, no subscription.

---

## Project Configuration
- **Project Name:** tip-tip (repo) / TIP Pal (product name)
- **URL:** tippal.behrman.dev
- **Stack:** Next.js, Supabase, Vercel, Anthropic Claude API, Capacitor (Phase 3+)
- **Key Ports / IPs:** N/A
- **Ground Rules:** No scope beyond features listed. All architectural decisions locked by Architect before Dev starts. UI components require Dan sign-off regardless of QA status.