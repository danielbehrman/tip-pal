# Shipyard — Project Brief

## Project
Joshy's TIP Dosing Assistant — paste a dosing schedule, see exactly what to give today

## Current Phase
Phase: Phase 1 — Demo
Mode: Dogfooding
Last Updated: 2026-05-17
Blocker: None
Next Action: Use the app, gather feedback, open a new session to kick off Phase 2 when ready

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

## Phase 2 — Production 📋 Planned
> First draft only. Details locked after Phase 1 demo is validated.

- Supabase for shared state (Dan + wife see same data in real time)
- Supabase Auth (email/password, two accounts)
- Appointment date entry and buffer day calculation
- Completion-based treatment week advancement (7 logged doses advances week automatically)
- Skip session (morning or evening)
- Trailing 3-day edit
- Push notification reminders (morning and evening dose times)
- Full dose history log

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