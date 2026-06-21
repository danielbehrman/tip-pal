# Phase 3 F0.1 — Calendar-Anchored Day Dating — Design

**Date:** 2026-06-20
**Status:** Approved by Project Owner, pending implementation plan
**Ticket:** BRIEF.md → Phase 3 → F0.1

## Problem

F0 (shipped 2026-06-09) locked "treatment day advances only via completion — calendar time never advances it." Dogfooding showed this makes dates hard to follow: an incomplete day sits at the same position indefinitely while its date label drifts forward, so "Week 3, Day 2" can mean three different real-world dates depending on when it was actually done. This ticket reverses that rule: position now advances with calendar time by default, with an explicit Skip Day action as the only way to freeze it.

This also supersedes Phase 2 F4's completion-count week-increment, since week is now derived from the same calendar formula as day position.

## Architecture

### Core formula

Position is **fully derived**, never advanced by a write-on-load or write-on-timer path:

```
dayIndex(date)      = date − cycle_start_date, in days (date ≥ cycle_start_date)
positionIndex(date)  = dayIndex(date) − skipOffsetAsOf(date)
week                 = floor(positionIndex / 7) + 1
day                  = (positionIndex mod 7) + 1
```

For computing **today's live position**, `skipOffsetAsOf(today)` is just `dose_state.skip_count` (the running total — no scan needed). For computing a **past calendar date's position** (history/navigation), `skipOffsetAsOf(date)` is the count of Skip Day events whose `completed_at` < `date` — a bounded query against `dose_log` rows shaped `session:'day', is_skipped:true`, not a heuristic gap-scan. This is categorically different from the abandoned `getTreatmentPosition()` approach (walking dose_log to find the first gap, which drifted under resets/bulk-catchups) — this counts a specific, intentional event type to do exact arithmetic, not to infer position via absence of records.

Verified against the spec example: skip on day N affects day N+1 onward (`skipOffsetAsOf(N+1)` includes the day-N skip, `skipOffsetAsOf(N)` doesn't), so day N+1 repeats day N's position and day N+2 is one ahead of it — matches "Saturday skip → Sunday repeats W3D2 → Monday is W3D3."

### Data model

**`dose_state` table — add:**
- `cycle_start_date` (date) — calendar date Week 1, Day 1 maps to.
- `skip_count` (integer, default 0) — total Skip Day events this cycle.

**`dose_state.current_week`/`current_day`:** demoted to a denormalized cache, kept in sync at the same write points as the new fields (so any other code path reading them directly — e.g. the push-reminder cron — doesn't silently break), but no longer treated as authoritative anywhere in the daily-view/position logic.

**`dose_log` table:** no schema change. Skip Day writes `{family_id, week, day, session:'day', is_skipped:true, completed_at:<skip moment>}` — reuses the existing shape; unambiguous because the only other `is_skipped:true` rows in production use `session:'morning'/'evening'` (1 legacy row, informational, no collision).

### Write paths (who sets `cycle_start_date`/`skip_count`, and when)

| Action | Effect |
|---|---|
| Onboarding (F9), fresh start | `cycle_start_date = today`, `skip_count = 0` |
| Onboarding (F9), mid-protocol start | `cycle_start_date = today − positionIndexOf(enteredWeek, enteredDay)`, `skip_count = 0` |
| Skip Day | `skip_count += 1` (atomic increment, not read-modify-write), writes `dose_log` audit row. `cycle_start_date` untouched. |
| Settings manual override | Re-anchors exactly like onboarding: `cycle_start_date = today − positionIndexOf(newWeek, newDay)`, `skip_count` reset to 0. No new Settings UI field — reuses the existing week/day inputs. |
| F4 New Food Cycle (future, unchanged scope) | `cycle_start_date = today`, `skip_count = 0`, position resets to 1/1 — already implied by existing F4 spec |
| Page load, navigation (`handleStateChange`), `handleCompleteDay` | **Never writes either field.** `handleCompleteDay` no longer touches position at all — completion no longer advances anything. |

This structurally closes the bug class in `feedback_treatment_anchor` memory (navigation/load corrupting position) rather than adding a new write path that could repeat it — there is no "sync on load" step to get wrong.

### One-time production migration

The existing live account (single family, already mid-protocol) gets: `cycle_start_date = today − positionIndexOf(current_week, current_day)` (reading whatever is in `dose_state` right now), `skip_count = 0`. This is a one-time backend migration script, run once at deploy — distinct from the onboarding "undated before setup" rule below, since this account already has real history to ground it in.

## UI/UX

**Skip Day button:** Lives in `EveningSection`, same condition as the removed Skip Session button ("not all evening treatment foods checked"). Only rendered on **today's live current day** — no retroactive skip on past days (confirmed). Confirmation prompt before writing: *"Skip this day? Tomorrow will repeat Week X, Day Y. This can't be undone."*

**Warning banner:** Shown on the current day whenever yesterday's position has neither a completion row nor a skip row in `dose_log` — i.e., it was silently passed over. Non-blocking; food-checking stays enabled. Covers only the immediately-prior day, not a running list of every missed day further back.

**"Skipped" header:** Replaces "Week X, Day Y · date" with "Skipped · date" wherever a `dose_log` row matches `session:'day', is_skipped:true` for that **calendar date** (date is the disambiguator — a skipped position and its repeat share the same week/day, so date, not position, is the lookup key when rendering history).

**Undated history:** No new onboarding field. Falls out of the formula directly — positions before `cycle_start_date` are outside the addressable range (the formula is undefined before `dayIndex = 0`). Day − navigation simply stops at the entered starting position; there is nothing to render as a grayed-out "Undated" placeholder because the app has no record of, and makes no claim about, those days.

## Week-Increment & Buffer Redesign

**Week-increment:** No longer a discrete event. `week = floor(positionIndex/7) + 1`, continuously derived and displayed. The existing 7-completions counter (`app/daily/page.tsx` ~line 128) is deleted, not replaced.

**Buffer-day calc — corrected, not just ported:** Verified against the live code that `calculateBuffer()` (`lib/schedule.ts:14`) never actually used `completed_at` — `fetchLastDay7Completion()` is dead code, never called. The real implementation was `daysUntilAppointment − totalTreatmentWeeks * 7`, which overcounts remaining days for anyone already mid-treatment (it doesn't subtract progress already made). New design: `bufferDays = daysBetween(projectedFinalDay7Date, appointmentDate) − 1`, where `projectedFinalDay7Date` is computed via the same `cycle_start_date` formula projected forward to `(week = totalTreatmentWeeks, day = 7)`. This is a calendar projection, correct even on days the parent doesn't open the app, and fixes the overcounting bug as a side effect.

**Visible behavior change to flag:** buffer numbers will likely *increase* for the existing account compared to today's display, since the old calc was overcounting.

`calculateBuffer()` keeps its existing `BufferResult` return shape (`hidden`/`past`/`days`/`behind`) — only the internal `bufferDays` computation changes, not the function's contract with `DailyView.tsx`.

## Edge Cases

- **Timezone:** `cycle_start_date` stored and compared as a date string (`YYYY-MM-DD`), consistent with the existing `appointmentDateStr` handling in `calculateBuffer` — never as a timestamp, to avoid local-vs-UTC drift.
- **Skip Day race/double-click:** increment via DB-level atomic increment, not read-then-write.
- **Stale client clock at Skip Day click:** position is recomputed live at click time, not trusted from stale client state — no persisted client-side position to go stale.
- **Duplicate `dose_log` rows for one position** (already observed in production — 6 `day`-session rows at Week 1/Day 1 from dogfooding): keep the existing "most recent `completed_at` wins" dedup behavior for both completion and skip lookups.
- **Completion row and skip row both present for one calendar date** (shouldn't happen — UI disables Skip Day once auto-completed and vice versa, but defensively): completion takes display precedence over a stray skip row.
- **F4 New Food Cycle (not in this ticket):** hasn't shipped yet, so no migration risk, but its future implementation must reset `cycle_start_date`/`skip_count` — noted as a dependency, not built here.

## Testing Strategy

- Unit: `getCalendarPosition()` formula — date math, skip-offset application timing (day after skip vs skip day itself), week/day boundary rollover (day 7 → next week day 1).
- Unit: buffer projection against `projectedFinalDay7Date`.
- Integration: onboarding fresh-start vs mid-protocol-start produce correct `cycle_start_date`.
- Integration: Skip Day writes the `dose_log` row, increments `skip_count`, and the header reflects "Skipped" without requiring a reload.
- Integration: warning banner appears the day after an incomplete, non-skipped day; food-checking remains enabled.
- Integration: Settings manual override re-anchors `cycle_start_date`/`skip_count` correctly.
- Regression: assert navigation handlers (`handleStateChange`, Day ±/Week ± UI handlers) never call any function that writes `cycle_start_date`/`skip_count`/`current_week`/`current_day`.
- Migration: dry-run the one-time production migration script against the live `Joshy` family data, verify computed `cycle_start_date` and idempotency (safe to re-run without double-shifting).
