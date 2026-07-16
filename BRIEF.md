# Shipyard — Project Brief

## Project
TIP Pal — a daily dosing assistant for families in food allergy tolerance induction programs.

## Current Status
Phase: Phase 3.6 — Palette + iOS Hardening — ✅ Complete, signed off 2026-07-08
Mode: Stable/maintenance
Last Updated: 2026-07-14
Blocker: None — Dan explicitly chose Stable/maintenance (option 4) at Phase Gate on 2026-07-14. Bug fixes only, no new feature work, until Dan explicitly moves to a different mode.
Next Action: Architect design complete and confirmed with Dan for the "Treatment Food Tracking Fixes" bundle (Complete Day confirm-dialog + auto-rollover, banner root-cause fix, Settings per-food adjuster) — see `docs/superpowers/specs/2026-07-15-treatment-food-tracking-fixes-design.md`. Phase 2 Architecture Decisions table amended same day (Day completion rule, Day navigation, Trailing edit rows; Skip Session evening-skip path removed from active spec). Next: run `/write-plan` to produce `plans/PHASE-STABLE-F1.md`, then Dev. Phase 3 F1 Capacitor Simulator auth-flow re-verify still outstanding, blocking Phase 3 F7/F8 whenever that track resumes.

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

## Test Accounts

| Environment | Email | Notes |
|---|---|---|
| Production | daniel.behrman+test1@gmail.com | General prod testing |

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
- **SLIT:** sublingual immunotherapy — parsed from plan of care, categorised as medication (not food)

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
- `medications` are daily medications (e.g. Zyrtec, Flovent) and SLIT — not food, not scenario kit
- SLIT must be parsed into the `medications` array, not any food array
- Scenario kit medications managed separately in the Expiry Tracker, not parsed here

---

## Assumptions
- ✅ Anthropic API key available as server-side env var — confirmed working in Phase 1
- ✅ Supabase project and credentials provisioned — confirmed complete
- ✅ Capacitor with Next.js static export — locked 2026-05-30. See plans/PHASE-3.md.
- ✅ Resolved 2026-06-20: queried production Supabase directly — exactly 1 `is_skipped: true` row exists, `session: 'morning'` (legacy Skip Session, informational only), dated 2026-05-30. Confirmed safe: F0.1's position calculation never derives from `dose_log` at all (it's `dose_state.cycle_start_date`/`skip_count`-based), so this row has zero interaction with the new logic. F0.1's own Skip Day writes a distinguishable shape (`session: 'day', is_skipped: true`), confirmed via final whole-branch review to not leak into F6 (Trailing Edit) or F7 (Dose History), both of which already filter `is_skipped` rows out.

---

## Carry Forward
| Item | Severity | Source Phase | Priority |
|---|---|---|---|
| localStorage persistence unreliable | High | Phase 1 | ✅ Resolved — Supabase migration in Phase 2 F1 |
| Schema missing recommendedFoods and medications | Medium | Phase 1/2 | ✅ Resolved — Phase 3 F3 |
| Settings: appointment date not persisting | High | Phase 2 | ✅ Resolved — fixed in commit 2234b29 |
| Re-parse overwrites dose history | High | Phase 2 | ✅ Not a bug — dose_log untouched by re-parse, confirmed 2026-06-01 |
| Buffer calculation wrong | Medium | Phase 2 | ✅ Resolved — fixed in commit 2234b29 |
| Push notifications firing in wrong timezone | High | Phase 2 | ✅ Resolved — daily page now syncs device timezone on every load, 2026-06-01 |
| F1 iOS Simulator — confirm lazy Supabase init fix works | High | Phase 3 | ⚠️ Partially re-verified 2026-07-08 — app now launches and renders correctly in Simulator (previously errored before reaching this point). Full authenticated data-loading flow still NOT verified in Simulator (local `.env.local` had empty Supabase credentials during this test). Re-verify auth flow before App Store submission. |
| Coral-orange palette does not match app icon | Medium | Phase 3.5 | ✅ Resolved — Phase 3.6 F1, signed off 2026-07-08 |
| White gap above header on iOS | High | Phase 3.5 | ✅ Resolved — Phase 3.6 F1, confirmed on real device + Simulator 2026-07-08 |
| Bottom nav home indicator clearance insufficient | High | Phase 3.5 | ✅ Resolved — Phase 3.6 F1, confirmed by Dan 2026-07-07 |
| Three card categories not distinct enough for colorblind users | Medium | Phase 3.5 | ✅ Resolved — Phase 3.6 F1, protanopia check confirmed by Dan 2026-07-07 |
| Bottom nav shows on hidden routes (login/setup/onboarding/privacy/disclaimer) in native app only | High | Phase 3.6 F1 | ✅ Resolved — found during Capacitor Simulator re-verify 2026-07-08, fixed same day (trailing-slash pathname normalization in `BottomNav.tsx`) |
| False "yesterday wasn't completed" banner shows after manual day/week reset in Settings, even when today's foods are all checked | High | Dogfooding, 2026-07-14 | ⚠️ Rolled into the Treatment Food Tracking Fixes bundle (2026-07-15) — see `docs/superpowers/specs/2026-07-15-treatment-food-tracking-fixes-design.md`. Root cause confirmed (cycleStartDate backdating), fix approach locked, plan pending. |
| Settings week/day adjuster is global-only — doesn't support per-food position, but treatment foods have tracked independently via `treatment_food_progress` since Phase 3.5 | Medium | Dogfooding, 2026-07-14 | ⚠️ Rolled into the Treatment Food Tracking Fixes bundle (2026-07-15) — see `docs/superpowers/specs/2026-07-15-treatment-food-tracking-fixes-design.md`. Design confirmed via mockup with Dan, plan pending. |
| Complete Day was gated on 100% of treatment foods checked (should be per-food independent); day got stuck after a partial completion, blocking back-nav | High | Dogfooding, 2026-07-14 | ⚠️ Rolled into the Treatment Food Tracking Fixes bundle (2026-07-15) — expanded scope beyond the original gate-loosening fix: gate removed entirely, replaced with confirm-on-save dialog + new lazy auto-rollover mechanism (also amends Day navigation and Trailing Edit — see Architecture Decisions above and the linked design doc). Plan pending. |
| `fetchCompletedPositions()` (forward-nav gating) is not scoped to "since the last reset" — a position completed before a Settings reset could incorrectly read as already-completed immediately after a fresh reset | Medium | Found during Architect investigation of the Treatment Food Tracking Fixes bundle, 2026-07-15 | Open — not in scope for the current bundle (Dan hasn't been asked to confirm fix approach). First-priority candidate for the next Stable/maintenance pass. |

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
| Trailing edit | **⚠️ Superseded 2026-07-15 (Stable/maintenance bundle):** Trailing edits CAN affect advancement — correcting a previously-unchecked treatment food within the 3-day trailing window retroactively advances that food's position from that day forward. `getGlobalPosition()` re-derives after any trailing edit, same as after a Settings per-food edit, so foods that drifted out of sync from a missed dose can resync. Morning food checkbox state is unaffected — still no impact on day completion, informational only. |
| Buffer days | Buffer = days from the day after the final treatment food's final complete week Day 7 through the day before the next appointment. Excludes appointment day and travel day (day before appointment). |
| State on refresh | Server wins. Refresh always fetches latest from Supabase. No stale cookie or localStorage override. |
| Buffer anchor date | Buffer calculated against the furthest-behind treatment food's projected final week completion. Global header always shows the slowest food's position. |
| Dose log session model | One row per day (`session: 'day'`). Skip morning or skip evening creates a separate additional row. |
| Day completion rule | **⚠️ Superseded 2026-07-15 (Stable/maintenance bundle):** Complete Day is always available, no gate. On tap, if any treatment food is unchecked, a confirm dialog names the specific unchecked food(s) before saving; confirming saves exactly what's checked and each food's position advances independently. Skip Evening button removed entirely — superseded by this confirm-on-save flow. Morning skip (informational only) is unaffected. |
| Day navigation | **⚠️ Superseded 2026-07-15 (Stable/maintenance bundle):** Day advances automatically on calendar rollover (lazy — evaluated on next app load, not a background job), regardless of whether Complete Day was tapped, using whatever `checked_foods` was last saved. Only the single most recent missed day is auto-finalized this way — a longer gap of missed days does not retroactively finalize each one, to avoid fabricating multiple skip records. This is the only mechanism by which a day advances without an explicit Complete Day tap. |
| Date display | **Added F0:** Completed days show `completed_at` date from dose_log. Current incomplete day shows live today's date. |
| Treatment day advancement | **⚠️ Superseded by Phase 3 F0.1 (2026-06-20):** day position now auto-advances with calendar time by default; only explicit Skip Day freezes it. |
| Push delivery mechanism | External cron (cron-job.org) → `/api/send-reminders`. Runs every minute. |
| Branding | App displayed as "[Child Name]'s Tip Pal" — child's first name, not family name. Set during onboarding. |

---

### Phase 2 Features

#### F1: Supabase Foundation — Shared State Replacing localStorage
**Status:** ✅ Complete — deployed to production 2026-05-23

#### F2: Supabase Auth — Email/Password, Two Accounts
**Status:** ✅ Complete — deployed and verified 2026-05-24

#### F3: Appointment Date Entry and Buffer Day Display
**Status:** ✅ Complete — deployed to production 2026-05-24

#### F4: Completion-Based Week Advancement
**Status:** ✅ Complete — deployed to production 2026-05-24

#### F5: Skip Session
**Status:** ✅ Complete — deployed to production 2026-05-25
**⚠️ Evening-skip path removed from active spec 2026-07-15** (Stable/maintenance bundle) — superseded by the Day completion rule's confirm-on-save flow (see Architecture Decisions above). Morning skip (informational only) is unaffected and stays as-is.

#### F6: Trailing 3-Day Edit
**Status:** ✅ Complete — deployed to production 2026-05-25

#### F7: Full Dose History Log
**Status:** ✅ Complete — deployed to production 2026-05-25

#### F8: Web Push Notification Reminders
**Status:** ✅ Complete — deployed to production 2026-05-25

**F8 Activation Steps (required before notifications will fire):**

1. Generate VAPID keys (run once): `npx web-push generate-vapid-keys`
2. Add to Vercel environment variables: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:daniel.behrman@gmail.com), `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`
3. Set up external cron (cron-job.org): URL `https://tippal.behrman.dev/api/send-reminders`, GET, `Authorization: Bearer <CRON_SECRET>`, every minute
4. On iOS: add Tip Pal to Home Screen, then tap "Enable notifications" in Settings

#### F9: Onboarding Config Screen
**Status:** ✅ Complete — deployed to production 2026-05-25

#### F10: Settings Screen
**Status:** ✅ Complete — deployed to production 2026-05-25

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

## Phase 3 — App Store Launch ✅ Complete

### Architecture Decision — Locked (2026-05-30)
**Capacitor with Next.js static export.** `output: 'export'` bundles HTML/JS/CSS into the native binary. API routes stay on Vercel, called via full URL from native. Same codebase for web and native. See `plans/PHASE-3.md` for full implementation details.

### Open Decisions — Locked 2026-06-01
1. **Push notifications in native:** ✅ Option B — push UI hidden in native wrapper. Web push remains active for web users. FCM/Capacitor push deferred to Phase 4.
2. **FAI branding:** ✅ No contact made. Use "food allergy tolerance program" in all Phase 3 copy. FAI outreach deferred to Phase 4.
3. **Apple Developer Program:** ✅ Enroll during F1 when physical device testing requires it.
4. **Firebase:** ✅ Not needed. Moot with Option B.

### Phase 3 Features

#### F0: Daily View UX Fixes ✅ Complete — deployed 2026-06-09

#### F0.1: Calendar-Anchored Day Dating ✅ Complete — confirmed in production 2026-06-23
**Architecture (as built):** Position is fully derived — `positionIndex = daysSinceCycleStart − skipCount`, computed live. `dose_state.current_week`/`current_day` are write-only debug cache; application never reads them. Full design: `docs/superpowers/specs/2026-06-20-calendar-anchored-day-dating-design.md`.

**Supersedes:**
- Phase 2 F4 completion-count-based week/day advancement
- Phase 3 F0 "treatment day does not advance on calendar time" rule

#### F1: Capacitor Wrapper ⚠️ Dev Complete — simulator verification inconclusive (carry forward)
Build commands:
- `npm run build:native` — renames `app/api` → `app/_api`, runs next build, restores `app/api`, runs `npx cap sync ios`
- `npm run cap:open:ios` — opens Xcode workspace
- `npm run cap:open:android` — opens Android Studio

App icon: ✅ final icon in place 2026-06-23. Generated via `npx @capacitor/assets generate`.

Required env var: `NEXT_PUBLIC_API_BASE_URL` = `https://tippal.behrman.dev` — native app uses this to call Vercel API routes. Must be set in `.env.local` before any native build.

#### F2: Parser PII Hardening ✅ Complete

#### F3: Schema v2 — Recommended Foods + Medications ✅ Complete — deployed 2026-06-24

#### F4: New Food Cycle Flow ✅ Complete — deployed 2026-06-26

#### F5: Privacy Policy ✅ Complete — live at tippal.behrman.dev/privacy

#### F6: Medical Disclaimer ✅ Complete — live at tippal.behrman.dev/disclaimer

#### F7: App Store Submission 📋 Pending Phase 3.6 completion

#### F8: Open Source Repo 📋 Pending Phase 3.6 completion

---

## Phase 3 — Completion Record

| Feature | Result | Notes |
|---|---|---|
| F0: Daily View UX Fixes | ✅ Pass | Deployed 2026-06-09 |
| F0.1: Calendar-Anchored Dating | ✅ Pass | Deployed and confirmed in production 2026-06-23 |
| F1: Capacitor Wrapper | ⚠️ Conditional | Dev complete. Partially re-verified 2026-07-08 — app builds/launches/renders correctly in Simulator (previously errored before this point). Authenticated flow still needs a Simulator test with real Supabase credentials before App Store submission. |
| F2: Parser PII Hardening | ✅ Pass | |
| F3: Schema v2 | ✅ Pass | Deployed 2026-06-24 |
| F4: New Food Cycle Flow | ✅ Pass | Deployed 2026-06-26 |
| F5: Privacy Policy | ✅ Pass | Live at /privacy |
| F6: Medical Disclaimer | ✅ Pass | Live at /disclaimer |
| F7: App Store Submission | 📋 Unblocked, not started | Phase 3.6 sign-off received 2026-07-08. Still needs F1's authenticated-flow Simulator re-verify first. |
| F8: Open Source Repo | 📋 Unblocked, not started | Phase 3.6 sign-off received 2026-07-08. No blockers remaining. |

---

## Phase 3.5 — Mobile UI Redesign ✅ Complete (2026-06-30)

### Design Decisions — Locked (superseded by Phase 3.6 palette update)

> ⚠️ Color tokens below were the original Phase 3.5 spec. They are superseded by Phase 3.6. All other design decisions remain locked.

| Decision | Detail |
|---|---|
| Direction | Family app — warm palette, rounded cards |
| Mode | Light only |
| Child name in header | Child's first name, not family name (e.g. "Joshy's Tip Pal") |
| Bottom nav | 4 tabs: Today · History · Rec. Foods · Settings — replaces link-based nav |
| Program progress | SVG ring around child avatar — fills clockwise, Visit N of 25 |
| Buffer days | Replaces week progress bar in header — label + bold number + ⓘ info button |
| Buffer days ⓘ explanation | "Buffer days are the days between completing your final week of dosing and your next clinic appointment. Your program requires at least 7 days on the final week's dose before your visit. Buffer days show how much cushion you have — so you know you're on track. Note: The day of your appointment and the day before (for travel) are not counted as buffer days." |
| Week badges on treatment foods | Hidden when all foods in sync; shown per-food only when diverged |
| Group food interaction | Checkbox completes all; chevron expands/collapses independently; no auto-expand on check |
| Medications on daily view | Inline in AM/PM food list — not a separate screen |
| SLIT on daily view | Parsed as medication, rendered with medication card treatment |
| Skip links | Skip morning = informational only (logs, does not freeze position). Skip evening = freezes position (same behavior as old Skip Day). |
| Web layout | max-width 430px centered container. Desktop gutter background set by palette. |
| Visit sequence | Launch → Visit 1–20 → Tolerance 1 → Tolerance 2 → Remission 1 → Annual Remission (25 total) |

### Architecture Change — Treatment Food Week/Day Tracking (locked)

**New model (replaces single global week/day counter):**
- Each treatment food stores its own `week` and `day` in `treatment_food_progress` Supabase table (`family_id`, `food_name`, `week`, `day`, `completed_days`, `last_completed_at`)
- **Global week/day** (displayed in header) = the furthest-behind treatment food at all times
- **Buffer days** calculated against the global (slowest) counter
- **Per-food week badges** hidden when all foods share the same week/day; shown when any food diverges
- Complete Day gate: all evening treatment foods must be checked
- Each checked treatment food advances its own counter independently on day complete
- An individually skipped treatment food stays on its current day — does not advance
- A full evening skip blocks Complete Day entirely
- Migration: existing global `week`/`day` seeded into all treatment foods on first load

**Example scenario:** Peanut Gelatin on Wk 7 Day 3, Uncooked Mare Milk on Wk 1 Day 1. Header shows "Week 1, Day 1" (furthest behind). Per-food week badges shown on both cards. Completing a day where both are checked: Peanut → Wk 7 Day 4, Mare Milk → Wk 1 Day 2. Header updates to "Week 1, Day 2". If only Peanut checked (Mare Milk individually skipped): Peanut advances, Mare Milk stays at Day 1. Header remains "Week 1, Day 1".

### Phase 3.5 Features

#### F0: Design System Foundation ✅ Pass
#### F1: Daily View Redesign ✅ Pass — Dan sign-off received
#### F2: Header Child Name + Photo ✅ Pass
#### F3: Treatment Food Data Model Migration ✅ Pass
#### F4: Medications on Daily View ✅ Pass
#### F5: Recommended Foods Screen Redesign ✅ Pass
**Tab labels (approved design):** 'This week' (current protocol week pip counters per food) and 'History' (flat collapsible list per week, food name + pip row, no grouping). Nav label: 'Rec. Foods'. Screen title: 'Recommended Foods'. Pip dots: 5 per food, orange filled = given, empty = remaining. Label: '3–5 per week'. No count prefix before dots.
#### F6: History Screen Redesign ✅ Pass
#### F7: Settings Screen Redesign ✅ Pass
#### F8: New Food Cycle Flow Redesign ✅ Pass
**Done screen ring animation (approved design):** Large child avatar with two-layer SVG progress ring. Ghost arc (`#ff9966`, 55% opacity, drawn on top) shows previous visit position. Sky blue arc (`#01d4f1`) animates from zero to new visit position on screen load (1.4s ease, cubic-bezier). Legend below avatar: old visit label / new visit label. Buffer days shown immediately (calculated from appointment date confirmed on review screen). This spec carries into Phase 3.6 — ring colors must update to `#01d4f1` for the new arc per the new palette.
#### F9: Onboarding Flow Redesign ✅ Pass
#### F10: Auth Screen Redesign ✅ Pass

---

## Phase 3.5 — Completion Record

| Feature | Result | Notes |
|---|---|---|
| F0: Design System Foundation | ✅ Pass | Tokens, bottom nav, component primitives, 430px web container |
| F1: Daily View Redesign | ✅ Pass | Dan sign-off received |
| F2: Child Name + Photo | ✅ Pass | |
| F3: Treatment Food Data Model | ✅ Pass | `treatment_food_progress` table |
| F4: Medications on Daily View | ✅ Pass | |
| F5: Recommended Foods Screen | ✅ Pass | |
| F6: History Screen | ✅ Pass | |
| F7: Settings Screen | ✅ Pass | |
| F8: New Food Cycle Flow | ✅ Pass | |
| F9: Onboarding Flow | ✅ Pass | |
| F10: Auth Screen | ✅ Pass | |

**Known issues carried into Phase 3.6:**
- Coral-orange palette does not match app icon — replaced in Phase 3.6
- White gap visible above header on iOS — safe area fix in Phase 3.6
- Bottom nav home indicator clearance insufficient — safe area fix in Phase 3.6
- Three card categories not visually distinct enough for colorblind users — fixed in Phase 3.6

---

## Phase 3.6 — Palette + iOS Hardening 📋 Active

> Single-feature phase. Colors and iOS fixes only. No layout, logic, or feature changes.
> Prerequisite: Phase 3.5 confirmed complete. ✅

### Features

#### F1: Color Scheme Migration + iOS Best Practice Fixes
**Goal:** Replace the coral-orange palette with the icon-derived navy/cyan/amber palette. Apply four iOS best practice fixes. No layout, logic, or feature changes.
**Priority:** P0 — blocks App Store submission (Phase 3 F7)

---

**ACCEPTANCE CRITERIA**

**Color tokens**
- All color tokens in globals.css replaced per new palette using Tailwind 4 `@theme` directive
- No hardcoded hex values from the old coral-orange palette (`#ff6b35`, `#fffbf7`, `#fff0e6`, `#9b6fd4` etc.) remaining anywhere in the codebase
- New token values:

```
--color-primary:              #0a1f6e   /* deep navy — header, nav background */
--color-primary-mid:          #1a3a8a   /* royal blue — CTAs, checks, section labels */
--color-primary-light:        #dde8ff   /* light blue — morning section icon bg */
--color-primary-pale:         #eef2ff   /* checked maintenance card bg */
--color-primary-border:       #c5d0f0   /* default card border */
--color-primary-checked:      #7a9ae8   /* checked maintenance card border */
--color-primary-muted:        #c5d0f0   /* disabled CTA bg */
--color-primary-text:         #5a78c4   /* muted text, skip links, counts */

--color-bg:                   #f0f4ff   /* app background */
--color-bg-secondary:         #e8eeff   /* day nav bg, secondary surfaces */
--color-surface:              #ffffff   /* cards */

--color-text-primary:         #0d1f5c
--color-text-secondary:       #3b5ab8
--color-text-muted:           #5a78c4
--color-text-section:         #1a3a8a   /* section label headers */

--color-ring-new:             #01d4f1   /* cyan arc — from app icon wave */
--color-ring-track:           rgba(255,255,255,0.18)

/* Treatment foods — cyan */
--color-treatment-bg:         #e0f8fd
--color-treatment-bg-checked: #b8f0fa
--color-treatment-border:     #00b8d9
--color-treatment-border-checked: #007a94
--color-treatment-check:      #007a94
--color-treatment-text:       #007a94
--color-treatment-badge-bg:   #b8f0fa
--color-treatment-badge-text: #007a94
--color-evening-icon-bg:      #d4f5fc

/* Medications + SLIT — amber/yellow */
--color-med-bg:               #fff8e8
--color-med-bg-checked:       #fef0c0
--color-med-border:           #e8c240
--color-med-border-checked:   #c49a00
--color-med-check:            #c49a00
--color-med-text:             #8a6a00

/* Status */
--color-complete:             #4caf50
--color-partial:              #e09a3a
--color-danger:               #e05252
--color-warning-bg:           #fff8e1
--color-warning-border:       #ffe082
--color-warning-text:         #795548
```

**Three card categories — colorblind-safe (differ in hue AND luminance)**
- Maintenance foods: white card `#ffffff`, border `#c5d0f0`, check `#1a3a8a`
- Treatment foods (evening): cyan card `#e0f8fd`, border `#00b8d9`, check `#007a94`
- Medications + SLIT: amber card `#fff8e8`, border `#e8c240`, check `#c49a00`
- SLIT parsed from plan of care must render with amber (medication) card treatment — not food
- All three card types must be distinguishable without relying on hue alone — verified by Dan (protanopia) before sign-off

**Header layout — daily view only**
- Avatar wrapper: 76×76px, SVG ring `viewBox="0 0 76 76"`, `r=34`, `stroke-width=6`
- Ring track: `rgba(255,255,255,0.18)`. Ring arc: `#01d4f1`, fills clockwise from 12 o'clock
- Arc fill: `(visitIndex / 25) * 2π * 34` — visitIndex = position in full visit sequence
- Avatar inner circle: `position: absolute`, `inset: 8px` on all sides, `border-radius: 50%`, `overflow: hidden` — must render as a perfect circle with no visible background ring showing behind the photo
- Header text column (right of avatar), four lines top to bottom:
  - Line 1: child name — 11px, `rgba(255,255,255,0.65)`
  - Line 2: "Visit N of 25" — 12px, `rgba(255,255,255,0.80)`, weight 400
  - Line 3: "Week N, Day N" — 16px, `#fff`, weight 600 (reduced from 20px to fit on one line)
  - Line 4: appointment bubble — frosted pill `rgba(255,255,255,0.15)`, no emoji, text only
- Visit number and Week/Day must be on separate lines — never combined on one line

**iOS safe area — top (blocking QA failure if not met)**
- Header background `#0a1f6e` extends to absolute top of screen — zero white gap visible above it on any iPhone in any state
- Apply `padding-top: env(safe-area-inset-top)` to header's outermost element
- `body` and `html`: `margin: 0; padding: 0; background: #0a1f6e`
- `capacitor.config.ts` AND `ios/App/App/capacitor.config.json` both have `StatusBar.overlaysWebView: true` — both files must be in sync
- Run `npx cap sync ios` after any config change
- QA must verify on iOS Simulator (iPhone 15 Pro target) — any white gap above the header is a blocking failure

**iOS safe area — bottom**
- Bottom nav container: `padding-bottom: env(safe-area-inset-bottom)`
- Nav background color extends below icon/label area into the safe zone (background fill only — no tappable elements in the home indicator zone)
- Resolves to 34px on Face ID iPhones — verified in iOS Simulator
- Prevents accidental home gesture triggers when tapping bottom nav items

**Viewport meta tag**
- Exactly one `<meta name="viewport">` tag across entire project
- Remove all duplicates in `layout.tsx`, `_document.tsx`, or any other file
- Required: `content="width=device-width, initial-scale=1, viewport-fit=cover"`
- `viewport-fit=cover` is required — without it `env(safe-area-inset-bottom)` returns 0 after Next.js client-side navigation via `next/link`

**Text scaling**
- Add to top of `globals.css`: `html { -webkit-text-size-adjust: 100%; }`
- Prevents iOS from auto-scaling text on orientation change

**Web layout**
- Desktop gutter background: `#e8eeff` (replaces old warm off-white — matches new palette)
- `app-container` max-width 430px, centered, `background: var(--color-bg)` unchanged

---

**DEFINITION OF DONE**
- All color tokens updated, no old hex values remaining anywhere
- Build passes, no regressions on any existing feature
- Dan verifies card colors are distinguishable with protanopia — blocking sign-off
- Dan verifies zero white gap at top of screen on iOS Simulator (iPhone 15 Pro) — blocking sign-off
- Dan verifies bottom nav taps do not trigger home gesture — blocking sign-off
- Single viewport meta tag with `viewport-fit=cover` confirmed across all files
- Dan sign-off required — UI gate

**CONSTRAINTS**
- Colors, safe area fixes, viewport tag, and text scaling only
- No layout, component, logic, routing, or feature changes beyond header text layout above
- Do not change font sizes other than Week/Day header line (20px → 16px)
- Do not change any Phase 3.5 logic, data model, or routing

---

## Phase 3.6 — Completion Record

| Feature | Result | Notes |
|---|---|---|
| F1: Color Scheme Migration + iOS Fixes | ✅ Pass | Code complete, reviewed (18-task subagent-driven build, all task reviews + final whole-branch review clean), deployed to production tippal.behrman.dev and pushed to GitHub. All Definition of Done items pass — see checklist below. |

**Build process note:** Implemented via `docs/superpowers/specs/2026-07-04-phase-3.6-f1-color-ios-hardening-design.md` → `plans/PHASE-3.6-F1.md` (18 tasks) → subagent-driven-development execution, all directly on `main` (no worktree, by Dan's choice). Deployed to production via direct `vercel --prod` CLI deploy 2026-07-07; GitHub push completed same day once Dan authenticated `gh` locally.

**Post-deploy fixes (found via Dan testing the installed PWA on iPhone 17 Pro Max, then via Claude Code running the actual Capacitor Simulator build):**
1. Top safe-area gap — was stale PWA cache from before the deploy, not a code bug. Resolved by deleting and re-adding the home-screen icon.
2. Side gutters (pale, then navy) — real bug: the `@media (min-width: 431px)` desktop-gutter breakpoint (`globals.css`) assumed no phone would exceed the 430px `app-container` width. iPhone 17 Pro Max's CSS viewport width does. Fixed in two commits: raised the breakpoint to 768px (matches Tailwind's `md:`), then made `.app-container`'s `max-width: 430px` conditional on that same breakpoint (was unconditional, capping the container even on phones wider than 430px). Confirmed fixed by Dan on-device.
3. Bottom nav visible on hidden routes (login/setup/onboarding/privacy/disclaimer) in the native app only — `next.config.ts`'s `trailingSlash: true` (native-only) makes `usePathname()` return e.g. `/login/` instead of `/login`, so `BottomNav.tsx`'s `HIDDEN_ROUTES` set (bare paths) never matched. Found during the Capacitor Simulator re-verify below; fixed by normalizing the trailing slash before matching. Confirmed fixed via simulator screenshot before/after.

**Definition of done checklist:**
- [x] All color tokens updated, no old hex values remaining — repo-wide grep sweep clean, confirmed independently twice
- [x] Build passes, no regressions — `npm run build` clean, final whole-branch review found zero dangling `var()` references and zero scope creep
- [x] Dan verifies card colors distinguishable with protanopia — confirmed 2026-07-07
- [x] Dan verifies zero white/pale gap at top and sides — confirmed on real device (iPhone 17 Pro Max, PWA) and via Capacitor Simulator (iPhone 17 Pro) — 2026-07-07/08
- [x] Dan verifies bottom nav taps do not trigger home gesture — confirmed 2026-07-07
- [x] Single viewport meta tag with `viewport-fit=cover` confirmed — single-sourced via Next `Viewport` export, no manual duplicates found
- [x] Capacitor simulator re-verified (carry forward from Phase 3 F1) — built and ran on iPhone 17 Pro simulator 2026-07-08, safe-area confirmed correct, uncovered and fixed the bottom-nav bug above
- [x] Dan sign-off received — 2026-07-08

---

## Phase 4 — Engagement 📋 Planned
> First draft. Details locked after Phase 3.6 is confirmed.

#### Milestone Email — Donation Ask
**Goal:** After a user completes their first full day, send a triggered email with a soft donation ask.

Key spec:
- Trigger: first Complete Day event per account, ever
- Content: brief personal note from Dan, what the app is, optional donation link (Buy Me a Coffee or equivalent)
- Donation link is external web only — not inside the iOS app (App Store policy)
- One email per account, never repeated

---

#### Emergency Medication Expiry Tracker
**Goal:** Track expiration dates for all scenario kit medications and EpiPens.

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
- Sourcing reminders (source specialty foods 4+ weeks before appointment)
- Multi-child support (single account, multiple children)

---

## Execution Notes

**Core promise:** Open the app, know exactly what to give, check it off. If that's fast and clear, the concept is validated.

**Stakes context:** This manages active medical treatment for a 5-year-old in a food allergy tolerance induction program. Wrong doses or wrong week progression can set back treatment by weeks and require rebooking travel to the treating clinic. The UI must be calm, clear, and unambiguous — it is used at 6am and 9pm by tired parents.

**CAPPED foods:** Exact doses — no more, no less. Must be visually labeled in all views.

**Seeds:** All seeds must show a "crush/chop before serving" note inline. Medical requirement.

**Denatured vs. uncooked dairy:** These are clinically distinct. Denatured = boiled 3 minutes. Uncooked = never heated. The parser must preserve this distinction — they are not interchangeable and swapping them is a medical error.

**Timing rules (informational only, not enforced):** Treatment foods at least 4 hours after morning maintenance. Multiple treatment foods spaced 15 min apart. Followed by 1-hour rest — no exercise, showers, or sleeping.

**Weekly foods:** Shown in the morning section on Day 7 only.

**Branding:** App header displays "[Child Name]'s Tip Pal" — child's first name, not family name.

**7-day minimum rule:** Plan of care requires at least 7 days on the final week's dose before the next clinic challenge. Informational only — not enforced by the app.

**Skip conditions (informational only, not enforced):**
- Fever over 100.4°F
- First 24 hours after starting antibiotics
- First 24 hours after losing a tooth, dental work, or cuts in the mouth
- Appointment day: skip maintenance and treatment foods, still give daily medications and SLIT

**Visit progression:** Launch Visit → Visit 1 → ... → Visit 20 → Tolerance Visit 1 → Tolerance Visit 2 → Remission Visit 1 → Annual Remission Visits.

**Sourcing lead time:** Specialty foods (camel milk, mare milk) require 4+ weeks to source. Informational only — app does not track sourcing.

**Competitive context:** Tolerance Tracker 2 launched January 2026. Closed source, ~$9.99/month. Does not have AI-powered schedule parsing. Tip Pal differentiates on: free, open source, AI parsing, no subscription.

---

## Project Configuration
- **Project Name:** tip-tip (repo) / Tip Pal (product name)
- **URL:** tippal.behrman.dev
- **Stack:** Next.js, Supabase, Vercel, Anthropic Claude API, Capacitor (Phase 3+)
- **Key Ports / IPs:** N/A
- **Ground Rules:** No scope beyond features listed. All architectural decisions locked by Architect before Dev starts. UI components require Dan sign-off regardless of QA status.
- **Claude Code context error:** `/clear` and `/model` alone do not resolve the 1M context error — a full terminal restart is required. Documented in CLAUDE.md.
- **Avoid loading large HTML files into Claude Code context** — test against live Vercel deployment (tippal.behrman.dev) rather than locally.