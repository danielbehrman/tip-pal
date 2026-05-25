# Shipyard — Project Brief

## Project
TIP Pal — a daily dosing assistant for families in food allergy tolerance induction programs.

## Current Phase
Phase: Phase 2 — Production
Mode: Active Build
Last Updated: 2026-05-24
Blocker: None
Next Action: F5 — Skip session

---

## Stack
| Layer | Decision | Status |
|---|---|---|
| Frontend | Next.js | ✅ Confirmed |
| Storage | Supabase (Postgres) | ✅ Confirmed |
| Auth | Supabase Auth (email/password) | ✅ Confirmed |
| Hosting | Vercel | ✅ Confirmed |
| Schedule Parsing | Anthropic Claude API (server-side Next.js API route) | ✅ Confirmed |

---

## Assumptions
- ⚠️ Anthropic API key is available as a server-side env var — confirmed working in Phase 1
- ⚠️ Supabase project and credentials must be provisioned before Phase 2 Dev starts — confirmed complete

---

## Carry Forward

| Item | Severity | Source Phase | Priority |
|---|---|---|---|
| localStorage state not persisting across page reloads — root cause unresolved after multiple fix attempts. Phase 2 moves to Supabase which eliminates localStorage entirely. | High | Phase 1 | P0 — resolved by F1 |

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

## Phase 2 — Production 🔄 In Progress

### Architecture Decisions (locked 2026-05-22)

| Decision | Detail |
|---|---|
| Shared state | Supabase (server-authoritative). No real-time subscriptions for MVP — refresh fetches latest. Stale local state must never override server on refresh. |
| Auth | Supabase Auth, email/password. Two users (Dan + wife) for MVP. Schema must support multi-family expansion for future scale (families → users → schedules) but MVP does not build multi-family UI. |
| Push notifications | Web push only for MVP. Native app is the long-term target but out of scope for Phase 2. |
| Trailing edit | Checkbox state only. Unchecking a morning food = no impact on day completion. Unchecking an evening food = day incomplete. |
| Buffer days | Buffer = days from the day after the final complete week's Day 7 through the day before the next appointment. |
| State on refresh | Server wins. Refresh always fetches latest from Supabase. No stale cookie or localStorage override. |
| Buffer anchor date | Record a `completed_at` timestamp on every Day 7 "Complete Day" action. Buffer calculated from most recent Day-7 completion timestamp. |
| Dose log session model | One row per day (`session: 'day'`). Skip morning or skip evening creates a separate additional row. |
| Day completion rule | All evening treatment foods must be checked before Complete Day is available. Evening skip does NOT satisfy the gate — it blocks Complete Day with an error ("dose evening again before advancing"). Morning has no impact on day completion or week advancement — morning skip is informational only. |
| Day navigation | Day + button is disabled until the current day has been completed via Complete Day. You cannot skip ahead. Backwards navigation (Day −) always allowed. Week +/− are manual overrides and remain unrestricted. |
| Push delivery mechanism | Vercel Cron Job — runs every minute, checks Supabase for users whose reminder time matches current time, sends push notification. |
| Branding | App displayed as "[Family Name]'s TIP Pal" in top left when logged in. Family name entered during initial setup flow. |

---

### Phase 2 PM Tickets

---

#### F1: Supabase Foundation — Shared State Replacing localStorage *(P0 carry-forward fix)*

**Status:** ✅ Complete — deployed to production 2026-05-23

---

#### F2: Supabase Auth — Email/Password, Two Accounts

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
- Anchor date for buffer calculation: `completed_at` timestamp of the most recent Day 7 "Complete Day" action

**Constraints:**
- No calendar picker UI — plain date input only
- One appointment date at a time — overwritten on change
- Buffer display is informational only — no blocking or triggering behavior

**Decision Gaps:**
- Buffer anchor date requires F4 to record Day-7 timestamps. If F3 is built before F4, buffer display is hidden until a Day-7 log row exists. Confirm build order enforces F4 before buffer calculation is active.

**Status:** ✅ Complete — deployed to production 2026-05-24

---

#### F4: Completion-Based Week Advancement

**Dependencies:** F1 and F2 complete and passing QA.

**Goal:** Automatically advance the week counter when 7 "Complete Day" actions are logged for the current week.

**Acceptance Criteria:**
- Every "Complete Day" confirmation writes a row to `dose_log` with `family_id`, `week`, `day`, `session`, `checked_foods`, `completed_at`, `is_skipped: false`
- After "Complete Day," count non-skipped log rows for the current week
- Count reaches 7 → week increments by 1, day resets to 1, `checkedFoods` cleared
- Manual +/− controls remain and work as overrides — do not write to dose log
- Manual week adjustment resets the completion count

**Constraints:**
- 7-day count based on `dose_log` rows for the current `week` value — not calendar days
- Manual +/− adjustments create no dose log entries
- No "undo complete day"

**Decision Gaps:**
- Session model: Does "Complete Day" write one row (`session: 'day'`) or two? Recommended: single `session: 'day'` row per Complete Day. Confirm.
- `checked_foods` at log time = final checkbox state of all foods for that day. Confirm.

**Status:** ✅ Complete — deployed to production 2026-05-24

---

#### F5: Skip Session

**Dependencies:** F1, F2, and F4 complete and passing QA.

**Goal:** Let a parent mark a morning or evening session as skipped so the event is logged rather than silently absent.

**Acceptance Criteria:**
- "Skip" action available for morning and evening sessions on the daily view
- Tapping "Skip morning" writes a `dose_log` row: `session: 'morning'`, `checked_foods: {}`, `is_skipped: true`, `completed_at`
- Tapping "Skip evening" writes a `dose_log` row: `session: 'evening'`, `is_skipped: true` — does not require evening checkboxes
- Skipped session visually marked for remainder of that day
- Skipping evening → blocks Complete Day with error: "Evening session was skipped — give the same evening treatment foods again before advancing"
- Skipping both sessions + "Complete Day" → logs full day as complete and counts toward 7-day advancement

**Constraints:**
- No "un-skip" in the current day
- Skip does not delete or overwrite existing checkbox state
- Morning skip is purely informational — no impact on gate or week advancement

**Decision Gaps:** None — all resolved.
- Evening is the only completion gate (confirmed 2026-05-24)
- Skipping evening satisfies the gate and the day counts toward 7 (confirmed 2026-05-24)
- Morning skip has no behavioral consequence (confirmed 2026-05-24)

**Status:** Not Started

---

#### F6: Trailing 3-Day Edit

**Dependencies:** F1, F2, F4, and F5 complete and passing QA.

**Goal:** Let a parent correct checkbox state for the previous 3 completed days without affecting week advancement.

**Acceptance Criteria:**
- "Edit recent days" control accessible from main daily view
- Opens a view showing 3 most recently completed days with logged checkbox state
- Parent can toggle any checkbox — changes saved back to `dose_log` row's `checked_foods` field immediately
- Unchecking evening food → marks that log row as having an incomplete evening session — does not reverse week advancement
- Current in-progress day not shown in trailing edit view

**Constraints:**
- Checkbox state only — no dose amount, food name, or week/day edits
- Week advancement already recorded is never reversed by trailing edits
- Window = exactly 3 completed days, not 3 calendar days
- Skipped sessions shown but cannot be un-skipped via trailing edit

**Decision Gaps:**
- Post-hoc correction flag: Does updating `checked_foods` require a `corrected_at` timestamp? Recommend yes for audit trail. Architect must decide.

**Status:** Not Started

---

#### F7: Full Dose History Log

**Dependencies:** F1, F2, F4, and F5 complete and passing QA. Read-only view.

**Goal:** Provide a read-only chronological log of all dose sessions for parents to reference at clinic appointments.

**Acceptance Criteria:**
- "History" page or modal accessible from main daily view
- Shows all `dose_log` rows ordered by `completed_at` DESC
- Each row: date, week number, day number, session label, foods checked
- Skipped sessions: "Skipped" label in place of food list
- Unchecked foods shown as "Not given"
- Read-only — no editing from this view
- Empty state: "No doses logged yet"

**Constraints:**
- No export, share, filter, or search for MVP
- Family-scoped via RLS

**Status:** Not Started

---

#### F8: Web Push Notification Reminders

**Dependencies:** F1 and F2 complete and passing QA. Independent of F3–F7.

**Goal:** Deliver two daily push notifications (morning and evening) at parent-configured times.

**Acceptance Criteria:**
- Settings section allows each parent to set morning and evening reminder times (`<input type="time">`)
- Reminder times stored in Supabase per user — parents can set different times
- On first use, app requests browser push permission
- Notifications fire at configured times daily
- Notification body: "Time for Joshy's morning dose" / "Time for Joshy's evening dose"
- Tapping notification opens app to `/daily`

**Constraints:**
- Web push only
- No per-session conditional logic — fires at set time regardless of dose state

**Decision Gaps:**
- Push delivery mechanism: Vercel Cron Job vs. Supabase Edge Function. Architect selects and validates.
- VAPID key management: Generate and store as Vercel env vars.

**Status:** Not Started

---

#### F9: Onboarding Config Screen

**Dependencies:** F1 and F2 complete.

**Goal:** After parsing the schedule on first login, show a config screen to collect family name, appointment date, and current week/day position before landing on daily view.

**Acceptance Criteria:**
- Shown automatically after schedule parse is confirmed on first login
- Fields: family name (text input), next appointment date (plain date input), current week number (+/− or input), current day (1–7, +/− or input)
- Family name saved to `families.name` in Supabase — displayed as "[Family Name]'s TIP Pal" in top left of app when logged in
- Appointment date saved to `families.next_appointment_date`
- Week and day saved to `dose_state.current_week` and `dose_state.current_day`
- If week/day is set to a value greater than 1/1, app prompts: "Mark all days between Day 1 and your current position as complete?" — single confirmation tap yes/no. Yes = bulk catch-up log entries written. No = jump to position with no history.
- On confirm, navigate to `/daily`
- Config screen skipped on subsequent logins — only shown on first setup

**Constraints:**
- Family name is required — cannot proceed without it
- Bulk catch-up writes simplified `dose_log` rows (`is_skipped: false`, `checked_foods: {}`) — not a full food-by-food record
- Week/day fast-forward prompt only shown if position is ahead of Day 1, Week 1

**Status:** Not Started

---

#### F10: Settings Screen

**Dependencies:** F9 complete.

**Goal:** Allow parents to revisit and update family name, appointment date, and schedule after each clinic visit.

**Acceptance Criteria:**
- Settings accessible from daily view at any time (persistent nav or menu)
- Fields: family name, next appointment date, re-parse schedule option
- Changes saved to Supabase immediately on confirm
- Re-parse schedule → navigates to setup flow, preserves existing week/day position until new schedule is confirmed
- Week/day adjustment also available here with the same bulk catch-up prompt as F9

**Constraints:**
- No account management, no password change, no user deletion in Phase 2

**Status:** Not Started

---

### Backlog (future phases)

- **Recommended foods** — 3 to 5x per week frequency-based foods (per official FAI dosing schedule template). Separate from daily maintenance and weekly foods. Category sourced from clinic schedule.

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

## Execution Notes

**Stakes context (for agent team):** This manages active medical treatment for a 5-year-old in a food allergy tolerance induction program. Wrong doses or wrong week progression can set back treatment by weeks. The UI must be calm, clear, and unambiguous — it is used at 6am and 9pm by tired parents.

**CAPPED foods:** Exact doses — no more, no less. Must be visually labeled.

**Seeds:** All seeds must show a "crush/chop before serving" note inline. Medical requirement.

**Timing rules (informational only, not enforced):** Treatment foods given at least 4 hours after morning maintenance. Multiple treatment foods spaced 15 min apart. Followed by 1-hour rest — no exercise, showers, or sleeping.

**Weekly foods:** Shown in the morning section on Day 7 only — hidden on all other days.

**Branding:** App header displays "[Family Name]'s TIP Pal" when logged in. Family name set during onboarding (F9).

**Project Configuration:**
- **Project Name:** joshy-tip
- **Stack:** Next.js, Supabase, Vercel, Anthropic Claude API (server-side API route)
- **Key Ports / IPs:** N/A
- **Ground Rules:** No scope beyond features listed above. Persistence and auth are the Phase 2 foundation — everything else builds on top.