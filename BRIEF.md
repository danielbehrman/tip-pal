# Shipyard — Project Brief

## Project
TIP Pal — a daily dosing assistant for families in food allergy tolerance induction programs.

## Current Status
Phase: Phase 3.5 — Mobile UI Redesign
Mode: Active Build
Last Updated: 2026-06-29
Blocker: .env.local overwritten during food grouping deploy — restore from 1Password before local dev. Production unaffected.
Next Action: Dan UI checkpoint on F0 (bottom nav, warm background, /foods route). After sign-off: begin F3 (per-food week/day data model migration).

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
- ✅ Resolved 2026-06-20: queried production Supabase directly — exactly 1 `is_skipped: true` row exists, `session: 'morning'` (legacy Skip Session, informational only), dated 2026-05-30. Confirmed safe: F0.1's position calculation never derives from `dose_log` at all (it's `dose_state.cycle_start_date`/`skip_count`-based), so this row has zero interaction with the new logic. F0.1's own Skip Day writes a distinguishable shape (`session: 'day', is_skipped: true`), confirmed via final whole-branch review to not leak into F6 (Trailing Edit) or F7 (Dose History), both of which already filter `is_skipped` rows out.

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
| F1 iOS Simulator — confirm lazy Supabase init fix works | High | Phase 3 | Parked — simulator launched but app errored on load before fix was confirmed. Re-verify before App Store submission. |

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
| Treatment day advancement | **Added F0:** Treatment day advances only via completion (auto or manual). Calendar time does not advance the treatment day — if a day is not completed, it remains the current day the next calendar day, with the date label updating to reflect the new calendar date. **⚠️ Superseded by Phase 3 F0.1 (2026-06-20):** see F0.1 below — day position now auto-advances with calendar time by default; only explicit Skip Day freezes it. |
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
- ~~Treatment day does not advance on calendar time — stays on current day until completed, with date label updating daily~~ **⚠️ Superseded by F0.1 (2026-06-20)** — see below.

Definition of done: Dan opens the app, sees today's date on the current day, checks off all evening treatment foods, day advances automatically, and cannot check foods on a future day.

---

#### F0.1: Calendar-Anchored Day Dating
**Goal:** Reverse the F0 "treatment day advances only via completion" rule. Anchor day position to calendar time so dates are easy to follow: Day 1 is the day the current protocol started, every day after is dated consecutively, and position auto-advances daily by default. An explicit Skip Day action is the only thing that freezes position.
**Priority:** P0 — blocking. Runs before resuming F1 (Capacitor simulator verification, paused).
**Status:** ✅ Complete — confirmed by Project Owner in production 2026-06-23, after two post-deploy follow-up fixes (see below). Deployed to `tippal.behrman.dev`.

**Architect investigation findings (2026-06-20):**
- No protocol/cycle start date field existed anywhere prior to this ticket — added `dose_state.cycle_start_date`, `skip_count`, `floor_week`, `floor_day`.
- The original F0 plan's `getTreatmentPosition()`/`fetchLoggedPositions()` (deriving position by walking `dose_log` for gaps) were written but never wired up — confirmed abandoned, removed as dead code.
- Buffer-day calc never actually used `completed_at` as BRIEF.md previously claimed — `fetchLastDay7Completion()` was dead code. The real implementation overcounted remaining days for any account already mid-treatment. Fixed as part of this ticket (see Architecture below) — buffer numbers will visibly *increase* for the existing account vs. before this ships; that's a correction, not a regression.
- A real timezone bug was caught and fixed during the production migration: Postgres `CURRENT_DATE` is UTC-evaluated, not the family's local day. Corrected using their stored `profiles.reminder_timezone`. Documented in `supabase/migrations/20260620_calendar_anchored_dating.sql` and `plans/PHASE-3-F0.1.md` Task 1.
- A gap in the original design was found during the Reviewer step (not the implementation): AC #7 (undated mid-protocol history) wasn't actually satisfiable by the original design — positions before `cycle_start_date` aren't "outside the addressable range" the way the design assumed, since the formula always defines position 0 as "Week 1, Day 1" even when backdated for a mid-protocol setup. Fixed via a new `floor_week`/`floor_day` navigation bound (Task 10).

**Architecture (as built):** Position is fully derived — `positionIndex = daysSinceCycleStart − skipCount`, computed live, never advanced by a write-on-load path. `dose_state.current_week`/`current_day` are now a write-only debug cache; the application never reads them. Week-increment and buffer-day calc both derive from the same formula. Full design: `docs/superpowers/specs/2026-06-20-calendar-anchored-day-dating-design.md`. Full plan with as-built deviations recorded inline: `plans/PHASE-3-F0.1.md`.

**QA test matrix (code/logic-level — see "Conditional QA pass" above for what's still pending):**

| Scenario | Verified via | Result |
|---|---|---|
| Fresh onboarding (Week 1, Day 1) | Code trace, Task 5 + 10 review | ✅ |
| Mid-protocol onboarding (e.g. Week 3, Day 2) | Code trace, boundary math re-derived independently, Task 10 review | ✅ |
| Day completes normally, position doesn't advance until tomorrow | Task 7 review — `handleCompleteDay` no longer writes position | ✅ |
| Day passes incomplete (not skipped) — auto-advance + warning, foods unblocked | Task 7 (`previousDayIncomplete`) + Task 8 review | ✅ |
| Skip Day on incomplete day — position freezes, header reads "Skipped" immediately | Formula verification script (exact spec example) + Task 8 fix/re-review | ✅ |
| Skip Day double-click / re-trigger attempt | Task 8 review found this as a real bug, fixed and re-reviewed (`isSkipped` gates `canSkip`) | ✅ (after fix) |
| Buffer day calculation | Hand-verified against worked example, Task 3 review | ✅ |
| Week-increment (now purely derived, no discrete event) | Task 3/7 review; dead `countCompletedDaysInWeek` removed | ✅ |
| Legacy `is_skipped` rows don't interact with new logic | Confirmed: only 1 production row, position never reads `dose_log` | ✅ |
| F6 (Trailing Edit) / F7 (Dose History) unaffected by Skip Day's new `dose_log` shape | Final whole-branch review — both already filter `!is_skipped` | ✅ |
| Production migration correctness | Verified live against actual production `dose_state` row, twice (incl. timezone fix) | ✅ |
| Navigation never writes position/floor fields | Verified structurally impossible (only 3 explicit write paths exist) across 3 separate reviews | ✅ |
| AC #7 — undated mid-protocol history | Found broken during Reviewer step, fixed (Task 10), re-reviewed clean | ✅ |
| **Live interactive browser walkthrough** | **Not performed — no browser automation tooling in this environment, no test credentials found** | **⚠️ Pending — Project Owner** |

**Definition of done (restated):** not yet met — pending the live walkthrough above.

**Post-deploy fixes (2026-06-22), found via Project Owner testing in production:**
- Date display was preferring `dose_log.completed_at` over the calendar formula for past days. Under calendar-anchored dating the formula is the single source of truth for a position's date — `dose_log` records can be stale (e.g. bulk catch-up actions during testing wrote many weeks' worth of rows under one timestamp). Fixed: date always comes from the formula; `dose_log` is used only to determine `isSkipped`.
- Auto-complete only fired on the live current day. Project Owner went back and finished a previous day's evening checkboxes (via the existing Trailing Edit mechanism) and expected that to log a completion — it didn't, leaving the "yesterday wasn't completed" warning showing despite the boxes being checked. Confirmed with Project Owner and fixed: auto-complete now fires on any non-future day. Noted consequence: checking all boxes on an already-"Skipped" day now un-skips it (newest record wins) — not previously discussed, flagged as reasonable but worth knowing.
- Follow-up: the auto-complete-on-past-day fix above only catches *new* checkbox toggles — it didn't retroactively resolve a day that was already fully checked in the `completed_days` cache *before* that fix existed (exactly the Project Owner's case: Week 3 Day 1 was already checked but never logged). Fixed: on page load, if yesterday has no `dose_log` record but is already fully checked in the cache, retroactively log the completion instead of showing a stale warning.

**Supersedes:**
- Phase 2 F4 "Treatment day advancement" rule (completion-count-based week/day advancement)
- Phase 3 F0 acceptance criteria (shipped 2026-06-09): "Treatment day does not advance on calendar time"

Acceptance criteria:
1. The calendar date the current protocol started is Day 1; every day after is dated consecutively — one unique calendar date per day position.
2. By default, day position auto-advances with calendar time even if the previous day's evening foods were not all given.
3. The new day shows an inline warning that the previous day wasn't completed. Food-checking is NOT blocked on the new day.
4. An explicit "Skip Day" action is the only thing that freezes position. Skip Day is only actionable when a day's evening foods were not all given.
5. On Skip Day: position does not advance — the next calendar day repeats the same week/day. The skipped day's header changes to read "Skipped" instead of "Week X, Day Y."
6. Acceptance example: Saturday = Week 3, Day 2, incomplete.
   - If skipped → Sunday shows "Week 3, Day 2" again; Saturday's header now reads "Skipped."
   - If not skipped → Sunday shows "Week 3, Day 3" with the incomplete-warning; foods unblocked.
7. If the app is set up mid-protocol (not starting at Week 1, Day 1), historical days before app setup display as "undated" — never backfilled with a guessed date.

Constraints:
- Navigation (Day +/−, Week +/−) must never write `current_week`/`current_day` to Supabase — unchanged from F0. Only completion, Settings, and now Skip Day may write position. (See `treatmentAnchor` architecture, locked in F0.)
- Position must not be derived by walking `dose_log` history — confirmed unreliable and already abandoned once (the unused `getTreatmentPosition()`/`fetchLoggedPositions()` from the original F0 plan). Position stays state-column-based; calendar logic layers on top of the `dose_state` anchor, it does not replace it with a dose_log scan.
- No protocol/cycle start date field currently exists anywhere in the schema — this ticket must add one. Architect to design it, including how Phase 3 F4 (New Food Cycle) will reset it later.
- Existing `is_skipped: true` dose_log rows from the legacy Skip Session feature (removed in F0) must not break the new position/Skip Day logic. ⚠️ Architect must query production Supabase to confirm row count/shape before Dev starts (see Assumptions).
- Week-increment (currently 7-completions-based) and buffer-day calculation (currently anchored to last Day-7 `completed_at`) both assume completion-gated advancement and will very likely need redesign now that position advances independent of completion — Architect to confirm scope and resolve before Dev starts.
- No personal names in the codebase or app. App name is "Tip Pal" — not "TIP Pal" — in any new UI copy.

Definition of done: Project Owner opens the app on a day where the prior day's evening foods were incomplete and not skipped — sees the new day, with a warning banner, foods unblocked. Project Owner clicks Skip Day on an incomplete day — position freezes, that day's header reads "Skipped," and the next calendar day repeats the same week/day. A mid-protocol setup account sees "undated" labels for days that predate app setup.

#### F1: Capacitor Wrapper ⚠️ Dev Complete — simulator verification inconclusive (carry forward)
**Goal:** Wrap the Next.js app in a native mobile shell for App Store and Google Play distribution.
**Priority:** P0 — gates everything else in Phase 3

Acceptance criteria:
- App runs as a native iOS app via Capacitor
- App runs as a native Android app via Capacitor
- All Phase 1 and Phase 2 functionality works identically in the native wrapper
- App icon and splash screen configured — ✅ final icon in place 2026-06-23 (`Tip Pal App Icon.png`, full-bleed source, generated via `npx @capacitor/assets generate` — 87 Android + 10 iOS + 7 PWA assets). Splash remains solid background color (unchanged, no logo overlay).
- ✅ Fixed 2026-06-23: production web app's iOS "Add to Home Screen" icon was never actually wired up — `manifest.json` pointed at `/icons/*`, but those files only existed in a gitignored, never-deployed project-root folder, and the `.gitignore` rule (`icons/`, unanchored) would have silently excluded `public/icons/` too even if someone tried to fix it there. No `apple-touch-icon` tag existed at all (the tag iOS Safari relies on most for home screen bookmarks). Fixed: anchored the gitignore rule to `/icons/` (root only), added real icon files to `public/icons/` + a dedicated `public/apple-touch-icon.png`, declared both explicitly in `app/layout.tsx` metadata, corrected `manifest.json`'s paths and MIME type. Verified live in production (200s on all icon paths, `apple-touch-icon` link tag renders in page head). **Note for Project Owner:** if you already have TIP Pal on your home screen, iOS caches that icon at add-time — remove and re-add the bookmark to pick up the new one; it won't update automatically.
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
**Status:** ✅ Complete — deployed 2026-06-24. UI checkpoint passed.

**Scope locked 2026-06-23:**
- Full ticket as written below — recommended foods AND medications together, one pass.
- Weekly counter resets on the app's protocol week (the same calendar-anchored week from F0.1), not a calendar week (Sun–Sat). No new date-boundary logic — reuses the existing week-derivation formula.

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
- Existing family's stored schedule predates this schema — `recommendedFoods`/`medications` will be empty/absent until they re-parse via Settings → Re-parse schedule. Not a backfill blocker; the app must handle the absent-field case gracefully without crashing.

Definition of done: Project Owner re-parses the existing plan of care, sees recommended foods and medications on a new info screen separate from the daily view, taps a recommended food as given and watches its counter increment toward the target range, and confirms the counter resets when the protocol week advances.

#### F4: New Food Cycle Flow ✅ Complete — deployed 2026-06-26. UI checkpoint passed.
**Goal:** When a clinic visit produces a new plan of care, archive the current cycle and load the new schedule without losing history.
**Priority:** P0

**Bugs fixed post-deploy during test account validation (2026-06-26):**
- Parse route: Claude occasionally returns JSON wrapped in markdown code fences despite instructions — strip before JSON.parse.
- New user provisioning: no trigger existed to create families/profiles rows on signup — all new users hit "Profile not found." Fixed: `handle_new_user()` trigger on auth.users INSERT auto-creates both rows.
- `saveFamilyConfig` used upsert (INSERT + ON CONFLICT) — Postgres evaluates INSERT RLS even on conflict, blocking write. Fixed: use update (row always exists post-trigger).
- `NewCycleReview` diff: "Stone Fruit" ≠ "Stone Fruit (Peach, Apricot, Cherry...)" caused spurious NEW badge. Fixed: prefix-based fuzzy name match handles clinic abbreviation variants.

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
**Status:** ✅ Complete — deployed 2026-06-25. Live at tippal.behrman.dev/privacy. Links in login page + Settings footer.

Must cover: what data is stored (food/dose schedule linked to account email only), no PII in app data tables, no sale of data, account deletion removes all data, Supabase as data processor.

#### F6: Medical Disclaimer
**Goal:** Clear disclaimer that Tip Pal is not a medical device and not affiliated with FAI.
**Priority:** P0
**Status:** ✅ Complete — deployed 2026-06-25. Live at tippal.behrman.dev/disclaimer. Links in login page + Settings footer.

Copy: "Tip Pal is not a medical device. It is not affiliated with the Food Allergy Institute or the Tolerance Induction Program. Always follow your provider's instructions."

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


## Phase 3.5 — Mobile UI Redesign 📋 Planned
> Insert this phase between Phase 3 (App Store Launch) and Phase 4 (Engagement).
> All screens designed and approved in a dedicated design session (June 2026).
> Design system spec and screen mockups: `plans/DESIGN-SPEC.md`
> Prerequisite: Phase 3 complete and confirmed.

### Design Decisions — Locked

| Decision | Detail |
|---|---|
| Direction | Warm/Family — coral-orange primary, rounded cards, warm tones |
| Mode | Light only |
| Primary color | `#ff6b35` (coral-orange) |
| Evening/medication color | `#9b6fd4` (purple) |
| Progress ring color | `#4fc3f7` (sky blue) |
| Child name in header | Child's first name, not family name (e.g. "Joshy's Tip Pal") |
| Bottom nav | 4 tabs: Today · History · Rec. Foods · Settings — replaces link-based nav |
| Morning session | Orange checkmarks (`#ff6b35`) |
| Evening session | Purple checkmarks (`#9b6fd4`) |
| Medications on daily view | Inline in AM/PM food list with purple card treatment — not a separate screen |
| Program progress | SVG ring around child avatar — fills clockwise, sky blue, Visit N of 25 |
| Buffer days | Replaces week progress bar in header — label + bold number + ⓘ info button |
| Week badges on treatment foods | Hidden when all foods in sync; shown per-food only when diverged |
| Group food interaction | Checkbox completes all; chevron expands/collapses independently; no auto-expand on check |

---

### Architecture Change — Treatment Food Week/Day Tracking

**This is a data model change from Phase 2.** The single global week/day counter is replaced by per-food counters.

**New model:**
- Each treatment food stores its own `week` and `day` in Supabase (`treatment_food_progress` table or equivalent column on the treatment food row)
- **Global week/day** (displayed in header) = the furthest-behind treatment food at all times
- **Buffer days** are calculated against the global (slowest) counter — because buffer is only meaningful when the slowest food completes its final week
- **Per-food week badges** hidden when all foods share the same week/day; appear on individual food cards only when at least one food diverges from the rest

**Day completion and advancement:**
- Complete Day gate: all evening treatment foods must be checked (existing rule unchanged)
- When Complete Day is triggered: each **checked** evening treatment food advances its own day counter independently
- A treatment food that was **individually skipped** (not checked) stays on its current day — it does not advance
- A **full evening skip** (Skip evening button) blocks Complete Day entirely, same as current behaviour
- When foods fall out of sync: per-food week/day badges appear on each evening treatment food card showing that food's individual position (e.g. `Wk 7` vs `Wk 1`)
- The global header counter always reflects the furthest-behind food, so buffer days are never overstated

**Example scenario (real case):**
Peanut Gelatin is on Week 7, Day 3. Uncooked Mare Milk is on Week 1, Day 1 (new food this cycle). Header shows "Week 1, Day 1" (the furthest behind). Both foods show individual week badges since they are out of sync. Completing a day where both are checked: Peanut advances to Week 7 Day 4, Mare Milk advances to Week 1 Day 2. Header updates to "Week 1, Day 2". If only Peanut is checked (Mare Milk individually skipped): Peanut advances, Mare Milk stays at Day 1. Header remains "Week 1, Day 1".

**Migration note:** Existing `week` and `day` columns on `families` table seed the initial value for all treatment foods on first load after this phase ships.

---

### Features

#### F0: Design System Foundation
**Goal:** Implement the approved color tokens, typography scale, component library, and bottom nav before any screen-level work begins. All subsequent features build on this foundation.
**Priority:** P0 — gates everything else in this phase

Acceptance criteria:
- CSS custom properties defined for all color tokens per `plans/DESIGN-SPEC.md`
- Bottom nav component (Today · History · Rec. Foods · Settings) replaces current link-based navigation — active state, inactive state, correct routes
- Card, badge, check circle, section header, CTA button components match spec
- Morning (orange) and evening (purple) color coding applied throughout
- No existing functionality broken

Constraints:
- No screen-level UI changes in this feature — foundation only
- Dan sign-off required before F1 begins

---

#### F1: Daily View Redesign
**Goal:** Redesign the primary daily view screen to match the approved design.
**Priority:** P0

Acceptance criteria:
- **Header:** child photo avatar with SVG progress ring (sky blue, Visit N of 25, fills clockwise from 12 o'clock). Child name ("Joshy's Tip Pal") top left. Visit · Week · Day title. Appointment bubble (frosted pill, no emoji, text only: "61 days to appointment"). All three text lines stack to the right of the avatar.
- **Buffer days row:** immediately below header. Label "Buffer days" (13px, regular weight, `rgba(255,255,255,0.85)`), bold number (13px, 700, white), ⓘ circle button far right. Tap ⓘ → sheet with buffer days explanation including: "The day of your appointment and the day before (for travel) are not counted as buffer days."
- **Day navigator:** date + "Today" sub, left/right chevrons, right disabled on current unlogged day
- **Morning section:** ☀️ icon, "MORNING" label, count. Orange check circles. CAPPED badge. Crush/chop note inline on dose line for seeds.
- **Evening section:** 🌙 icon, "EVENING" label, count. Purple check circles. Week badge per food — hidden when all in sync, shown when diverged.
- **Medications:** appear inline in AM and/or PM list per their schedule. Purple card treatment (border `#e8dff5`, check circle `#9b6fd4`). No CAPPED badge, no week badge.
- **Group food cards:** checkbox completes all; chevron expands/collapses only; partial state = dashed border + dashed circle; expanded state shows individual sub-item check circles; no auto-expand on checkbox tap.
- **Complete Day button:** disabled (muted) until all evening treatment foods checked. Skip morning / Skip evening links below.
- **Bottom nav:** Today tab active.
- Per-food week/day advancement logic per Architecture Change section above.

Constraints:
- Dan sign-off required (UI gate)
- No changes to dose logging, week advancement, or skip logic beyond what is specified above

---

#### F2: Header Child Name + Photo
**Goal:** Replace family name with child name in header. Add child photo to avatar circle.
**Priority:** P0

Acceptance criteria:
- `child_name` field added to Supabase (replaces or supplements `family_name`)
- Header displays "[child_name]'s Tip Pal" (e.g. "Joshy's Tip Pal")
- Child photo stored in Supabase Storage, displayed in header avatar circle
- Tapping photo in Settings → opens device photo library (Capacitor Camera plugin)
- Onboarding updated: collects child name and optional photo on step 1; no family name field
- Existing accounts: `child_name` defaults to existing `family_name` value on migration

Constraints:
- Multi-child architecture not built — single child per account for now. Schema should not block it in future.

---

#### F3: Treatment Food Week/Day Data Model Migration
**Goal:** Migrate from single global week/day counter to per-food independent counters.
**Priority:** P0 — blocks F1 daily view logic

Acceptance criteria:
- Each treatment food row in Supabase has its own `week` and `day` columns
- On load, global header week/day = minimum (furthest behind) across all active treatment foods
- Complete Day advances only checked treatment foods; skipped foods stay on their current day
- Per-food week badges appear on evening food cards when at least one food is on a different week/day than the others; hidden when all in sync
- Buffer days recalculated against the furthest-behind food's projected final week completion date
- Existing data migrated: current global `week` and `day` seeded into all treatment foods

Constraints:
- Architect must define migration plan before Dev starts — this touches existing Phase 2 F4 logic
- No change to Complete Day gate rule (all evening foods must be checked)

---

#### F4: Medications on Daily View
**Goal:** Move medications (Zyrtec, Flovent, etc.) from the Recommended Foods screen into the daily AM/PM food list.
**Priority:** P0

Acceptance criteria:
- Medications parsed via Schema v2 `medications` array appear inline in the morning and/or evening food list based on their `frequency` field
- Medication cards use purple visual treatment: border `#e8dff5`, check circle `#9b6fd4` when checked, card bg `#faf8ff` when checked
- No CAPPED badge, no week badge on medication cards
- Dose shown in subtitle line (e.g. "2 puffs")
- Medications are checkable — tracked same as food items for session completion purposes
- Medications do NOT gate Complete Day (only evening treatment foods gate Complete Day)
- Recommended Foods screen (`/foods`) no longer shows medications — tab removed, screen shows recommended foods only with This Week / History tabs

Constraints:
- Medication order within session: shown after food items, before skip links

---

#### F5: Recommended Foods Screen Redesign
**Goal:** Redesign the Recommended Foods screen to match the approved design. Rename nav label.
**Priority:** P1

Acceptance criteria:
- Bottom nav label: "Rec. Foods"
- Screen title: "Recommended Foods"
- Two tabs in orange header: "This week" and "History"
- **This week tab:** foods grouped by category (Fruits, Proteins & legumes, Seeds & flours, etc.). Each food card shows name, dose, and 5-pip dot row. Filled dots = given this week (`#ff6b35`). Empty dots = remaining (`#f0ddd4`). Label below pips: "3–5 per week". No count prefix before the dots.
- **History tab:** flat list per week, collapsible. Each collapsed row: week label + date range + status. Expanded: food name + pip row, no grouping, no extra info. Current week expanded by default, prior weeks collapsed.
- Tapping a pip logs a serving for that food (increments count, fills dot)
- Weekly count resets on Monday (or configurable week start)

Constraints:
- No medications on this screen (moved to daily view in F4)
- Dan sign-off required (UI gate)

---

#### F6: History Screen Redesign
**Goal:** Redesign the History screen to match the approved design.
**Priority:** P1

Acceptance criteria:
- Grouped by week with section labels ("Week 3 · Visit 9")
- Each day row: date, day number, status dot + label (Complete / In progress / AM skipped / PM skipped)
- Default collapsed. Chevron expands to show AM and PM session detail inline
- Expanded: session tag (AM orange / PM purple) + food list as comma-separated string. "Not yet dosed" for pending session.
- "Edit" button top right → trailing 3-day edit flow (existing F6 from Phase 2, no changes to logic)
- Most recent week at top

Constraints:
- Dan sign-off required (UI gate)
- No changes to edit logic

---

#### F7: Settings Screen Redesign
**Goal:** Redesign the Settings screen to match the approved design.
**Priority:** P1

Acceptance criteria:
- Sections: Child · Program · Notifications · Account · Legal
- **Child section:** child name (editable inline), child photo (tap to change)
- **Program section:** next appointment date, current week (manual adjust), current day (manual adjust), New Food Cycle (→ F8 flow), Re-parse schedule
- **Notifications section:** morning reminder time, evening reminder time, push toggle
- **Account section:** Sign out (red destructive style)
- **Legal section:** Privacy policy (→ `/privacy`), Medical disclaimer (→ `/disclaimer`)
- Version number at bottom
- All existing settings functionality preserved

Constraints:
- Dan sign-off required (UI gate)

---

#### F8: New Food Cycle Flow Redesign
**Goal:** Redesign the New Food Cycle flow to match the approved design.
**Priority:** P1

Acceptance criteria:
- **Step 1 — Confirm:** what-happens list (treatment foods replaced, maintenance kept/additive, week/day resets to 1/1, history preserved, visit number updates). Continue / Cancel.
- **Step 2 — Paste dosing plan:** text area with label "Paste your new dosing plan". PII strip note. CTA: "Parse new dosing plan". Parsing spinner hidden until CTA tapped — not visible on load.
- **Step 3 — Review changes:** visit transition card (old → new, "Resets to Week 1, Day 1"). Treatment food diff (New / Updated / Removed with reason). Maintenance food diff (New / Kept). **Appointment date input on this screen** — pre-filled from parsed notes, tappable to adjust. CTA: "Confirm new cycle".
- **Step 4 — Cycle started:** large child avatar with two-layer animated SVG progress ring. Ghost arc (orange `#ff9966`, 55% opacity) shows previous visit position. Sky blue arc (`#4fc3f7`) animates from zero to new visit position on screen load (1.4s ease). Legend below: old visit / new visit. Title "Visit [N] is live". Buffer days shown immediately (calculated from appointment date entered in step 3). Summary card: visit, starting position, next appointment, buffer days. CTA: "Start dosing" → daily view.

Constraints:
- Dan sign-off required (UI gate)
- Appointment date not requested before step 3 — parsed from notes and confirmed there

---

#### F9: Onboarding Flow Redesign
**Goal:** Redesign the 4-step onboarding flow to match the approved design.
**Priority:** P1

Acceptance criteria:
- **Step 1 — Child setup:** header "Welcome to Tip Pal" with no child name reference (name not known yet). Photo upload circle (tap → device library). Child name text input. "Skip photo for now" secondary link.
- **Step 2 — Appointment date:** date picker. Single field. "Tap to pick a date from the calendar."
- **Step 3 — Visit / Week / Day:** three steppers. Visit stepper cycles through full labeled sequence: Launch → Visit 1 → Visit 2 → … → Visit 20 → Tolerance 1 → Tolerance 2 → Remission 1 → Annual Remission. Week stepper: 1+. Day stepper: 1–7. Header subtitle: "Set the week and day you're currently dosing on." — no appointment reference on this step.
- **Step 4 — Summary:** mini header preview showing child name and Week/Day (no visit number — not yet parsed). Summary card: child name, next appointment, current position (Visit · Week · Day from steppers), buffer days auto-calculated, "Schedule parsed ✓" if parse already done. CTA: "Start dosing".
- Progress dots in orange header track step position throughout.

Constraints:
- Dan sign-off required (UI gate)
- Visit number in header only appears after schedule is parsed — not during onboarding

---

#### F10: Auth Screen Redesign
**Goal:** Redesign the login and first-parse screens to match the approved design.
**Priority:** P1

Acceptance criteria:
- **Login screen:** orange hero with app icon and tagline "Your family's daily dosing companion". Email + password fields. "Sign in" primary CTA. "Create account" secondary. "Forgot password?" link. Medical disclaimer text at bottom: "Tip Pal is not a medical device and is not affiliated with the Food Allergy Institute or the Tolerance Induction Program. Always follow your provider's instructions."
- **First parse screen** (shown after first login, before onboarding completes): matches app header style. Avatar with empty ring (no progress yet). Title "Load your dosing plan". Intro text. Paste area labeled "Paste your dosing plan". Hint: "Copy from your patient portal (e.g. TIPConnect) and paste above." CTA: "Parse dosing plan". Secondary: "Enter foods manually instead."

Constraints:
- Dan sign-off required (UI gate)
- No changes to Supabase Auth logic

---

### Cross-Feature Dependency Map

| Feature | Depends On |
|---|---|
| F0: Design System | None |
| F1: Daily View | F0, F3 |
| F2: Child Name + Photo | F0 |
| F3: Treatment Food Data Model | F0 |
| F4: Medications on Daily View | F1 |
| F5: Recommended Foods Screen | F0 |
| F6: History Screen | F0 |
| F7: Settings Screen | F0, F2 |
| F8: New Food Cycle Flow | F7, F3 |
| F9: Onboarding Flow | F2 |
| F10: Auth Screen | None |

---

### Definition of Done (Phase 3.5)
- All 10 features pass QA
- All UI features have explicit Dan sign-off
- Daily view, History, Recommended Foods, Settings, New Food Cycle, Onboarding, and Auth screens match approved mockups in `plans/DESIGN-SPEC.md`
- Per-food week/day tracking logic verified: skipped foods stay behind, global counter always reflects slowest food, buffer days correct
- Medications appear in daily AM/PM list, not on Recommended Foods screen
- No regressions in dose logging, week advancement, skip logic, or push notifications

---

### Web Layout Constraint

The web app at tippal.behrman.dev shares the same codebase as the native iOS app. No separate web build is needed — Phase 3.5 changes deploy to both simultaneously on every Vercel push.

**Desktop viewport handling:** Apply a max-width container of `430px` centered on the page with a neutral background (`#f0ece8` or similar warm off-white) filling the remaining space. This renders the app as a centered mobile column on desktop — intentional, zero additional design work required.

Implementation: wrap the root layout in a single container:

```css
.app-container {
  max-width: 430px;
  margin: 0 auto;
  min-height: 100vh;
  background: var(--color-bg);
  position: relative;
}

body {
  background: #f0ece8;
}
```

This is an F0 (Design System Foundation) task — one of the first things applied.

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