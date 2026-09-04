# History Calendar + Unified Day Editing — Design Spec

**Date:** 2026-09-04
**Phase:** Dogfooding fix/redesign (found during live use, not a planned Phase 4 backlog item)
**Status:** Approved by Project Owner (including a visual mockup of the calendar day-cell icons), pending implementation plan

## Background — root cause this design fixes

Systematic-debugging investigation (2026-09-03) found that the Today tab's back-arrow (`components/DailyView.tsx` `handleNavigate`/`handleCheck`) only reads/writes a local client-side scratch value (`doseState.completedDays`, keyed by `week-day`) — it never touches `dose_log` or `FoodProgress`, so checking a box on a past day viewed this way can never advance or regress the dosing position. The feature that actually does real position advancement already existed at `/history/edit` (`app/history/edit/page.tsx`'s `handleToggle` — recomputes `getGlobalPosition()` via a treatment food's `FoodProgress`, persists via `saveDoseState`), but operated on real `dose_log` rows fetched via `fetchRecentCompletedDays` (limited to the 3 most recently logged days, forward-only: unchecked→checked). Nothing on the Daily page linked to it. An immediate discoverability fix already shipped (commit `ff653fb`) — the missed-day banner now links to `/history/edit`. This spec is the proper redesign that replaces both surfaces.

## Goal

One correct, discoverable way to view and correct any past day's dosing record — from a quick 10-day shortcut on the Today tab, and from a comprehensive calendar in History that reaches any date ever logged — without the two-data-source split that caused the original bug.

## Data Model

`dose_log` becomes the single source of truth for "what was checked on a past day." `doseState.completedDays` is retired for past-day purposes (today's own live checkbox flow is unchanged — this only concerns days strictly before today).

This is safe because every day before today already has a real `dose_log` row by the time it could be viewed: either written by Complete Day when that day was current, or by the existing lazy auto-rollover reconciliation (`app/daily/page.tsx`, the "Lazy auto-rollover: finalize only the single most recent missed day" block) on the very next day's load.

## Two Entry Points, One Mechanism

- **Today tab back-arrow** (`components/DailyView.tsx`): trailing **10 calendar days**, replacing whatever the current `floorSeq`-bounded range effectively allows. A fast shortcut for recent corrections.
- **History calendar** (`app/history/page.tsx`, replacing its current flat/list view): a **continuous month-by-month calendar**, reachable back to any date the family has ever logged. The comprehensive surface — not bounded to 10 days, not bounded to 3 days like the old `/history/edit`.

Both use the identical view → Edit → Save → confirm flow described below. There is exactly one implementation of "edit a past day," consumed from two places.

## Calendar Day-Cell Icons

Visually approved via mockup (see `.superpowers/brainstorm/91361-1788554608/content/calendar-icons.html` for the approved reference). Four states per day, computed from that day's `dose_log.checked_foods` against the schedule snapshot for that day:

| State | Condition | Icon |
|---|---|---|
| Fully complete | Every maintenance/weekly food (`morning-*`, non-med), every treatment food (`evening-*`, non-med), and every medication (`*-med-*`) checked | Green circle with checkmark |
| Treatment complete only | All treatment foods (`evening-*`, non-med) checked, but at least one maintenance food or medication was missed | Green checkmark alone |
| Treatment partial | At least one treatment food checked, but not all | Green horizontal line |
| Treatment missed | Zero treatment foods checked, and at least one was scheduled that day | Red X |
| No treatment scheduled | Zero treatment foods were scheduled for that day at all (e.g. a day before treatment foods started) | No icon — neutral/blank cell, not a red X (a day with nothing due isn't a miss) |

Today and future days show no status icon — today is live/in-progress (its own existing UI), future days are unreached.

**Clicking today's cell** navigates to the Today tab rather than opening the view/edit modal, since today already has its own live interface — confirmed assumption, not re-litigated during brainstorming but stated explicitly here per the spec self-review requirement.

## Interaction Flow

1. User clicks a past day (Today-tab arrow, within the last 10 days, or any calendar cell in History).
2. Day opens **read-only**, showing that day's real historical state per food, sourced from its `dose_log.checked_foods` row and the schedule snapshot stored on that row.
3. User taps **Edit**. For each food on that day:
   - If that food is exactly at its current edge — the next day it's waiting on (still unchecked, can be checked to advance) or the single most recent day it completed (checked, can be unchecked to regress) — its checkbox becomes interactive.
   - Every other food on that day remains locked/historical, in edit mode or not. A food that has already advanced past this day, or hasn't reached it yet, has no well-defined single-step toggle here (see Position Logic).
4. User toggles the live checkbox(es) and taps **Save**.
5. If any toggle changes an edge food's position, a **confirmation screen** appears first: states plainly that the current week/day position will change as a result of this edit, and asks the user to confirm before committing. Declining returns to the edit view with the pending toggle still staged, uncommitted.
6. On confirm: the day's `dose_log.checked_foods` row is updated for every toggled food (edge or not — the checked-state itself is always saved; only the *position* recompute is gated to edge foods), and for each food that toggled at its edge, `FoodProgress` is updated and `getGlobalPosition()`/`dose_state` (`currentWeek`, `currentDay`, `floorWeek`, `floorDay`) are re-derived and persisted, exactly matching the existing `/history/edit` write pattern for the forward case.

## Position Logic

A new pure, tested function in `lib/schedule.ts`, replacing the forward-only math currently inlined in `/history/edit`'s `handleToggle` (lines 106-117 of `app/history/edit/page.tsx`):

- **Advance** (unchecked → checked at the food's next-day edge): `completedDays + 1`; if the result reaches 7, roll to `{ week: week + 1, day: 1, completedDays: 0 }`.
- **Regress** (checked → unchecked at the food's most-recently-completed edge): `completedDays − 1`; if `completedDays` was `0`, roll back to `{ week: week − 1, day: 7, completedDays: 6 }`.

These are exact inverses of each other, so a check followed immediately by an uncheck (or vice versa) at the same edge returns a food's `FoodProgress` to exactly where it started.

**Edge determination is per-food, not per-day:** a food is "at its edge" on a given calendar day if that day is either the immediate next day the food is waiting on, or the immediate most-recent day it completed — regardless of which day (today, or any day within the 10-day/calendar reach) is being viewed. Because `getGlobalPosition()` always reports the *slowest* food's position, no food can be behind that anchor — so every food's own edge is always reachable via the calendar's unlimited reach, even if a particular food has fallen behind by more than 10 days (the Today tab's 10-day shortcut may not reach it, but History's calendar always will).

## Removed: `/history/edit`

The dedicated 3-day, forward-only editor (`app/history/edit/page.tsx`, `components/RecentDaysEditor.tsx`) is removed. The calendar supersedes it entirely — same underlying mechanism, no range limit, both directions. Any inbound links to `/history/edit` (the banner fix from commit `ff653fb`, and the "Edit Recent Days" entry in `app/history/page.tsx`) are updated to point at the new calendar flow instead.

## Constraints Carried Forward

- Only treatment-food state affects position; maintenance/medication checkbox state remains informational-only, same as today's Complete Day rule.
- No change to how Complete Day itself works for the current live day — this redesign only concerns days strictly before today.
- No change to the lazy auto-rollover reconciliation mechanism itself — it continues to write the initial `dose_log` row for a missed day exactly as it does today; this spec only changes how that row is later viewed and corrected.

## Testing

- Unit tests in `lib/schedule.test.ts` for the new advance/regress function: forward rollover at week boundary, backward rollover at week boundary, a mid-week single step each direction, and confirming advance-then-regress (or regress-then-advance) at the same edge is a no-op.
- Unit tests for the day-status icon classification function: all four states, plus the "no treatment scheduled that day" neutral case.
- Manual QA: full click → view → Edit → toggle → Save → confirm round trip from both the Today tab (within 10 days) and the History calendar (beyond 10 days); confirm a non-edge food's checkbox stays locked in edit mode; confirm declining the confirmation screen leaves the edit un-committed; confirm today's calendar cell navigates to the Today tab instead of opening the modal.

## Clarifications from Spec Self-Review

- The calendar's earliest navigable month is the family's onboarding/account-creation date — there is nothing to render before that, so the calendar simply doesn't allow navigating earlier than the month dosing began.
- The confirmation screen in step 5 of the Interaction Flow can be a modal or a dedicated screen — left to the implementation plan, since it doesn't affect the underlying data flow.

## Out of Scope

- No change to the "current week" concept — this spec explicitly replaces "current dosing week" scoping (considered and dropped during brainstorming) with a fixed 10-calendar-day window for the Today tab shortcut.
- No visit-grouping in the calendar (a separate "collapse by visit" idea was raised earlier in this same conversation and explicitly superseded by the calendar redesign — visits are not shown or grouped in the calendar view).
- No changes to Reaction Ramp or Travel Day Buffer logic — this spec is independent of both.
