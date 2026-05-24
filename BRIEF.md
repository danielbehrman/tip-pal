# Shipyard — Project Brief

## Project
Joshy's TIP Dosing Assistant — paste a dosing schedule, see exactly what to give today

## Current Phase
Phase: Phase 2 — Production
Mode: Active Build
Last Updated: 2026-05-23
Blocker: None
Next Action: F3 — Appointment date + buffer day display

---

## Stack
| Layer | Decision | Status |
|---|---|---|
| Frontend | Next.js | ✅ Confirmed |
| Storage | localStorage (demo only — no shared state) | ✅ Confirmed |
| Hosting | Vercel | ✅ Confirmed |
| Schedule Parsing | Anthropic Claude API (server-side Next.js API route) | ✅ Confirmed |

> No database, no auth, no Supabase in Phase 1. This is a demo that proves the core concept. Shared state is a Phase 2 concern.

---

## Assumptions
- ⚠️ Anthropic API key is available as a server-side env var — Architect must confirm env setup before Dev starts
- ⚠️ localStorage is sufficient for demo persistence — data does not survive clearing browser storage, which is acceptable for Phase 1

---

## Carry Forward

| Item | Severity | Source Phase | Priority |
|---|---|---|---|
| localStorage state not persisting across page reloads — checkedFoods, week, and day reset on every refresh. Root cause unresolved after multiple fix attempts (hydration flag, direct save, name-based keys). Phase 2 moves to Supabase which eliminates localStorage entirely, but this must be fixed or replaced before the app is usable in production. | High | Phase 1 | P0 |

---

## Phase 1 — Demo 🔄 In Progress

### Feature 1: Schedule Parsing

**Goal:** Allow Dan to paste raw medical notes text and have the app parse it into a structured dosing schedule he can review and confirm before it's saved. This is the only data entry step. Nothing else in the app works without it.

**Acceptance Criteria:**
- [ ] A setup screen is shown on first load if no schedule exists in localStorage
- [ ] Dan can paste raw medical notes text into a multi-line input field
- [ ] Submitting sends the text to a Next.js API route, which calls the Claude API and returns a structured schedule as JSON containing:
  - `maintenanceFoods`: array of `{ name, dose, unit, capped, prepNote }`
  - `weeklyFoods`: array of `{ name, dose, unit, prepNote }` — Sunday-only foods, stored separately
  - `treatmentFoods`: array of `{ name, weeks: [{ week, dose, unit }] }`
- [ ] Parsed schedule is shown as a readable review screen — each food, dose, unit, and any flags — before saving
- [ ] Dan can edit any parsed field inline on the review screen before confirming
- [ ] On confirm, schedule is saved to localStorage and the app navigates to the daily dose view
- [ ] If the API returns an error or unparseable response, Dan sees a clear message and can edit the pasted text and retry
- [ ] A "Re-parse schedule" option is accessible from the main view to re-run setup at any time (e.g. after a clinic visit)

**Constraints:**
- Parsing is never silent — Dan must explicitly confirm parsed output before it is saved
- Dev must not write the Claude API prompt without Architect first defining the expected JSON schema and the prompt structure
- The app must handle the "continue at final dose" language in treatment notes — the final week entry should be flagged as terminal (no further week entries expected after it)

**Definition of Done:** Dan pastes the provided sample notes, sees a correctly structured review screen, edits one field, confirms, and the daily dose view immediately shows the correct foods and doses.

**Status:** Not Started

---

### Feature 2: Daily Dose View

**Goal:** Show exactly what to give Joshy right now — morning foods and evening treatment foods — with checkboxes to mark each as given. Solve the cognitive load problem: open the app, give the foods, check them off. Nothing else.

**Acceptance Criteria:**
- [ ] Main screen shows a "Week X, Day Y" counter at the top (e.g. "Week 3, Day 5") — this is the only progress indicator
- [ ] Week and Day are each adjustable via tappable +/− controls — no automation, no logic, Dan sets them manually
- [ ] Screen is divided into two sections: **Morning** and **Evening**
- [ ] Morning section shows all maintenance foods with name, dose, unit, and prep note if present
- [ ] Weekly foods appear at the bottom of the morning section with a "Weekly" badge — only when Day counter is 7
- [ ] Evening section shows treatment foods for the current week (derived from Week counter) with name, dose, and unit
- [ ] If the current week exceeds the last defined week in the schedule, the evening section shows the final week's dose with a note: "Continuing final dose"
- [ ] Each food in both sections has a checkbox
- [ ] Checking a food saves its state to localStorage immediately
- [ ] CAPPED foods display a "CAPPED" label — visually distinct
- [ ] Foods with a prep note (e.g. "crush before serving") display that note inline beneath the food name
- [ ] Evening section shows a non-blocking timing reminder: "4 hrs after morning · 15 min between foods · 1 hr rest after"
- [ ] A prominent "Complete Day" button advances Day by 1 (Day 7 rolls to Day 1 and increments Week) and resets all checkboxes
- [ ] "Complete Day" requires a single confirmation tap — no multi-step modal

**Constraints:**
- No date awareness — the app does not know or care what calendar day it is
- No back/forward day navigation — there is only one view: current dose state
- No buffer calculation, no appointment date, no session skip logic in Phase 1
- Weekly foods appear in the morning section only when Day = 7 — hidden on all other days
- Week counter drives treatment food selection — it is the only scheduling logic in Phase 1

**Definition of Done:** After parsing a schedule, Dan can open the app, see the correct morning and evening foods for the current week, check them off, tap "Complete Day", see the counter advance and checkboxes reset. All state survives a page refresh.

**Status:** Not Started

---

## Phase 1 — Completion Record

| Feature | Result | Notes |
|---|---|---|
| Schedule Parsing | ✅ Pass | Parsing, review, inline edit, confirm, and re-parse all working. Deployed to Vercel. |
| Daily Dose View | ⚠️ Partial | UI complete — week/day controls, morning/evening sections, CAPPED badges, prep notes, Complete Day gate on evening foods all working. localStorage state does not persist across page reloads. |

**Deferred items:**
- localStorage persistence — High severity — carried forward as P0 to Phase 2. See Carry Forward table.

**Known regressions:** None.

**Decisions made during build:**
- API key configured in Vercel only (no local .env.local) — local dev requires `vercel dev`
- Checkbox keys are name-based (`morning-{food.name}`) not index-based — prevents stale key mismatches after re-parse
- Complete Day blocked if any evening foods unchecked — inline error with live reactive dismissal

---

## Phase 2 — Production 🔄 In Progress

### Architecture Decisions (locked 2026-05-22)

| Decision | Detail |
|---|---|
| Shared state | Supabase (server-authoritative). No real-time subscriptions for MVP — refresh fetches latest. Stale local state must never override server on refresh. |
| Auth | Supabase Auth, email/password. Two users (Dan + wife) for MVP. Schema must support multi-family expansion for future scale (families → users → schedules) but MVP does not build multi-family UI. |
| Push notifications | Web push only for MVP (simplest implementation). Native app is the long-term target but out of scope for Phase 2. |
| Trailing edit | Checkbox state only (no dose edits). Unchecking a morning food = no impact on day completion. Unchecking an evening food = day incomplete (all evening foods must be checked to advance). |
| Buffer days | Buffer = days from the day after the last complete dosing week through the day before the next appointment. Example: last week ends March 3, appointment March 10 → buffer = 6 days (March 4–9). App accepts appointment date; buffer is calculated and displayed. |
| State on refresh | Server wins. Refresh always fetches latest from Supabase. No stale cookie or localStorage override. |
| Buffer anchor date | Record a `completed_at` timestamp on every Day 7 "Complete Day" action. Buffer is calculated from the most recent Day-7 completion timestamp. |
| Dose log session model | One row per day (`session: 'day'`). Skip morning or skip evening creates a separate additional row. History shows both day completions and individual skipped sessions. |
| Skipped day counts toward week advancement | **NO.** Only days where at least one session of doses was actually given count toward the 7-day week advancement. A fully skipped day does not advance the week. Treatment timeline may extend if days are skipped. |
| Push delivery mechanism | Vercel Cron Job — runs every minute, checks Supabase for users whose reminder time matches the current time, sends the push notification. |

---

### Phase 2 PM Tickets

---

#### F1: Supabase Foundation — Shared State Replacing localStorage *(P0 carry-forward fix)*

**Dependencies:** None. All F2–F8 depend on this. No other Phase 2 feature starts until F1 passes QA.

**Goal:** Replace all localStorage reads and writes with Supabase, making app state server-authoritative and shared between both parents on any device.

**Acceptance Criteria:**
- Supabase project provisioned with the following tables:
  - `families` — `id`, `name`, `created_at`
  - `profiles` — `id` (= Supabase auth uid), `family_id`, `display_name`
  - `schedules` — `id`, `family_id`, `parsed_data` (JSONB), `created_at`, `updated_at`
  - `dose_state` — `id`, `family_id`, `current_week`, `current_day` (1–7), `checked_foods` (JSONB), `updated_at`
  - `dose_log` — `id`, `family_id`, `week`, `day`, `session` (`morning`|`evening`|`day`), `checked_foods` (JSONB), `completed_at`, `is_skipped` (boolean)
- RLS enabled on all tables — all policies enforce `family_id` isolation
- `lib/supabase.ts` client module with typed read/write functions for schedule and dose state
- On page load, app fetches schedule and dose state from Supabase — never reads localStorage
- No schedule in Supabase → redirect to `/setup` (same as Phase 1)
- Saving parsed schedule writes to Supabase, not localStorage
- Checkbox state changes write to Supabase immediately
- "Complete Day" writes updated state to Supabase before advancing the view
- All `localStorage` calls removed from codebase
- Two browser sessions refresh and see the same server state
- Vercel env vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` configured
- `dose_log` table defined here; row insertion is gated by F4/F5

**Constraints:**
- No real-time subscriptions — server state fetched on load only
- No auth UI — F2 owns that. F1 may use a hardcoded `family_id` scaffold temporarily
- Do not insert dose log rows in F1 — that belongs to F4/F5
- `ParsedSchedule` and `DoseState` TypeScript types must not change shape

**Status:** ✅ Complete — deployed to production 2026-05-23

---

#### F2: Supabase Auth — Email/Password, Two Accounts

**Dependencies:** F1 complete and passing QA.

**Goal:** Require login before accessing the app so both parents have authenticated sessions and state is correctly scoped to their family.

**Acceptance Criteria:**
- `/login` page with email, password, and "Sign in" button
- Valid credentials → sign in via Supabase Auth → redirect to `/daily`
- Invalid credentials → clear inline error ("Incorrect email or password")
- Unauthenticated user at `/daily` or `/setup` → redirect to `/login`
- Authenticated user at `/login` → redirect to `/daily`
- Session persists across page refreshes
- "Sign out" accessible from main daily view → clears session → redirect to `/login`
- Two user accounts provisioned manually in Supabase dashboard — no self-registration UI
- All Supabase queries auto-scoped to authenticated user's `family_id` via RLS
- Hardcoded `family_id` scaffold from F1 removed

**Constraints:**
- No self-registration, no password reset, no social login
- Sessions always persisted — no "remember me" toggle

**Status:** ✅ Complete — deployed and verified 2026-05-24

---

#### F3: Appointment Date Entry and Buffer Day Display

**Dependencies:** F1 and F2 complete and passing QA.

**Goal:** Let a parent record Joshy's next clinic appointment so the app can calculate and display buffer days remaining.

**Acceptance Criteria:**
- Date input on main daily view labeled "Next appointment" (plain `<input type="date">`)
- Appointment date stored in Supabase (`next_appointment_date` on `families` table), shared between both parents
- Buffer = days from the day after the final complete week's Day 7 through the day before the appointment
- Buffer displayed on main view as "X buffer days before appointment"
- No appointment date set → buffer display hidden
- Appointment date in the past → "Appointment date has passed — please update" (no negative count)
- Anchor date for buffer calculation: `completed_at` timestamp of the most recent Day 7 "Complete Day" action (recorded by F4 — see Decision Gap below)

**Constraints:**
- No calendar picker UI — plain date input only
- One appointment date at a time — overwritten on change
- Buffer display is informational only — no blocking or triggering behavior

**Decision Gaps — must be confirmed before Dev starts:**
- **Buffer anchor date:** App uses the `completed_at` timestamp of the most recent Day-7 Complete Day log row as the anchor. Recommended approach assumes F4 records this timestamp. If F3 is built before F4, the buffer calculation has no anchor — confirm build order enforces F4 first, or buffer display is hidden until a Day-7 log row exists.

**Status:** Not Started

---

#### F4: Completion-Based Week Advancement

**Dependencies:** F1 and F2 complete and passing QA. Introduces the dose log write path.

**Goal:** Automatically advance the week counter when 7 "Complete Day" actions are logged for the current week.

**Acceptance Criteria:**
- Every "Complete Day" confirmation writes a row to `dose_log` with `family_id`, `week`, `day`, `session`, `checked_foods`, `completed_at` (server timestamp), `is_skipped: false`
- After "Complete Day," count non-skipped log rows for the current week
- Count reaches 7 → week increments by 1, day resets to 1, `checkedFoods` cleared
- Week advancement triggered by the 7th Complete Day action
- Manual +/− controls remain and work as overrides — do not write to dose log
- Manual week adjustment resets the completion count — does not inherit prior context
- "Complete Day" label and confirmation dialog unchanged

**Constraints:**
- 7-day count based on `dose_log` rows for the current `week` value — not calendar days
- Manual +/− adjustments create no dose log entries
- No "undo complete day"

**Decision Gaps — must be confirmed before Dev starts:**
- **Session model:** Does "Complete Day" write one row (`session: 'day'`) or two (`session: 'morning'` + `session: 'evening'`)? Affects F5, F6, F7. Recommended: single `session: 'day'` row per Complete Day; F5 introduces separate morning/evening rows for skip tracking. **Confirm.**
- **Checked foods in log:** `checked_foods` at log time = final checkbox state of all foods for that day. Absent or false = not given. Confirm this is the correct representation.

**Status:** Not Started

---

#### F5: Skip Session

**Dependencies:** F1, F2, and F4 complete and passing QA.

**Goal:** Let a parent mark a morning or evening session as skipped so the event is logged rather than silently absent.

**Acceptance Criteria:**
- "Skip" action available for morning and evening sessions on the daily view
- Tapping "Skip morning" writes a `dose_log` row: `session: 'morning'`, `checked_foods: {}`, `is_skipped: true`, `completed_at`
- Tapping "Skip evening" writes a `dose_log` row: `session: 'evening'`, `is_skipped: true` — does not require evening checkboxes
- Skipped session visually marked for remainder of that day (e.g., "Skipped" badge replaces food list)
- Skipping morning → evening foods must still all be checked (or skipped) before "Complete Day" is available
- Skipping evening → satisfies the evening gate — "Complete Day" available without evening checkboxes
- Skipping both sessions + "Complete Day" → logs full day as complete and counts toward 7-day advancement
- Skipped sessions appear in F7 history with "Skipped" label

**Constraints:**
- No "un-skip" in the current day
- Skip does not delete or overwrite existing checkbox state
- Skip is a deliberate tappable action — not automatic

**Decision Gaps — must be confirmed before Dev starts:**
- **Does a skipped day count toward 7-day week advancement?** Assumed YES — a skipped day still counts. **This is a medical protocol question. Dan must confirm explicitly.**
- **UI placement of Skip:** "Skip this session" link beneath each section header, single confirmation tap. Architect defines final placement.

**Status:** Not Started

---

#### F6: Trailing 3-Day Edit

**Dependencies:** F1, F2, F4, and F5 complete and passing QA.

**Goal:** Let a parent correct checkbox state for the previous 3 completed days without affecting week advancement.

**Acceptance Criteria:**
- "Edit recent days" control accessible from main daily view
- Opens a view showing 3 most recently completed days with logged checkbox state
- Each day shows: week number, day number, completion date, food list with checkboxes
- Parent can toggle any checkbox — changes saved back to `dose_log` row's `checked_foods` field immediately
- Unchecking morning food → no impact on completion status
- Unchecking evening food → marks that log row as having an incomplete evening session — does not reverse week advancement
- Re-checking a food restores checked state in the log
- Current in-progress day not shown in trailing edit view

**Constraints:**
- Checkbox state only — no dose amount, food name, or week/day edits
- Week advancement already recorded is never reversed by trailing edits
- Window = exactly 3 completed days, not 3 calendar days
- Skipped sessions shown but cannot be un-skipped via trailing edit

**Decision Gaps — must be resolved by Architect:**
- **Post-hoc correction flag:** Does updating `checked_foods` in a past `dose_log` row require a new `corrected_at` timestamp or a `was_corrected: boolean` field? Recommend adding `corrected_at` for audit trail clarity. Architect must decide.
- **"3 most recent completed days" definition:** 3 most recent `dose_log` rows ordered by `completed_at` DESC. Confirm with Architect.

**Status:** Not Started

---

#### F7: Full Dose History Log

**Dependencies:** F1, F2, F4, and F5 complete and passing QA. Read-only view.

**Goal:** Provide a read-only chronological log of all dose sessions for parents to reference at clinic appointments.

**Acceptance Criteria:**
- "History" page or modal accessible from main daily view
- Shows all `dose_log` rows ordered by `completed_at` DESC
- Each row: date (e.g., "May 21"), week number, day number, session label, foods checked
- Skipped sessions: "Skipped" label in place of food list
- Unchecked foods shown as "Not given" — not silently hidden
- Read-only — no editing from this view (F6 owns editing)
- No pagination for MVP
- Empty state: "No doses logged yet"
- Clear "Back" or close control — no navigation trap

**Constraints:**
- No export, share, filter, or search for MVP
- Family-scoped via RLS

**Decision Gaps:**
- **Session label display** depends on session model decision in F4. F7 must not be built until F4's session model is locked.
- **"Not given" foods:** `checked_foods` is a sparse record — absence = not given. Confirm Architect stores as sparse (only truthy values) for consistent display logic.

**Status:** Not Started

---

#### F8: Web Push Notification Reminders

**Dependencies:** F1 and F2 complete and passing QA. Independent of F3–F7.

**Goal:** Deliver two daily push notifications (morning and evening) at parent-configured times.

**Acceptance Criteria:**
- Settings section allows each parent to set morning and evening reminder times (`<input type="time">`)
- Reminder times stored in Supabase per user (not per family) — parents can set different times
- On first use, app requests browser push permission
- Permission denied → clear explanation + prompt to enable in browser settings
- Permission granted → service worker registered, push subscription stored in Supabase associated with user
- Notifications fire at configured times daily
- Notification body static: "Time for Joshy's morning dose" / "Time for Joshy's evening dose"
- Tapping notification opens app to `/daily`
- Time change → takes effect at next occurrence
- Push permission revoked → graceful degradation, no crash

**Constraints:**
- Web push only — no SMS, email, native push
- No per-session conditional logic — fires at set time regardless of dose state
- No notification history or delivery receipts
- Push delivery requires server-side component (VAPID keys + push send endpoint)

**Decision Gaps — Architect must resolve before Dev starts:**
- **Push delivery mechanism:** Vercel Cron Job (checks Supabase for due subscriptions) vs. Supabase Edge Function on schedule. Architect selects and validates.
- **Per-device subscriptions:** MVP assumes one active subscription per user — latest registration overwrites previous. Confirm.
- **VAPID key management:** Generate and store as Vercel env vars. Architect includes this in implementation plan.

**Status:** Not Started

---

### Cross-Feature Dependency Map

| Feature | Depends On |
|---|---|
| F1: Supabase Foundation | None — build first |
| F2: Auth | F1 |
| F3: Appointment + Buffer | F1, F2 |
| F4: Completion-Based Advancement | F1, F2 |
| F5: Skip Session | F1, F2, F4 |
| F6: Trailing 3-Day Edit | F1, F2, F4, F5 |
| F7: Dose History Log | F1, F2, F4, F5 |
| F8: Push Notifications | F1, F2 |

---

## Execution Notes

**The only thing this demo needs to prove:** open the app, know exactly what to give Joshy, check it off. If that feels fast and clear, the concept is validated.

**Stakes context (for agent team):** This manages active medical treatment for a 5-year-old in a food allergy tolerance induction program. Wrong doses or wrong week progression can set back treatment by weeks. The UI must be calm, clear, and unambiguous — it is used at 6am and 9pm by tired parents.

**CAPPED foods:** Exact doses — no more, no less. Must be visually labeled.

**Seeds:** All seeds must show a "crush/chop before serving" note inline. Medical requirement.

**Timing rules (informational only, not enforced):** Treatment foods given at least 4 hours after morning maintenance. Multiple treatment foods spaced 15 min apart. Followed by 1-hour rest — no exercise, showers, or sleeping.

**Weekly foods:** Shown in the morning section on Day 7 only — hidden on all other days. Day 7 is the only date logic in Phase 1.

**Project Configuration:**
- **Project Name:** joshy-tip
- **Stack:** Next.js, localStorage, Vercel, Anthropic Claude API (server-side API route)
- **Key Ports / IPs:** N/A
- **Ground Rules:** No scope beyond the two features above. No auth, no database, no buffer logic, no date tracking. If it's not in this brief, it does not get built in Phase 1.