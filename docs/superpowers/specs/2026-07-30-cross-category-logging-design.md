# Cross-Category Logging (Recommended Foods)

## Context

BRIEF.md's Phase 5+ backlog previously listed "Food Grouping" as unbuilt. It is not — it shipped 2026-06-24 (commit `d3a7cbf`): `FoodGroup` data model, `GroupsManager.tsx` (Settings), `FoodGroupRow.tsx` + `MorningSection.tsx` (daily view group check/expand). BRIEF.md was corrected 2026-07-30 to reflect this.

The one piece from that backlog block that was never built: checking a food on the daily view — whether via a group or standalone — does not credit the Recommended Foods weekly counter (`dose_state.recommended_food_counts`). That counter is currently only written from the Recommended Foods screen's own direct +/− buttons (`app/foods/page.tsx`, shipped via commit `01b66e0`). This spec covers building that missing credit path.

## Goal

Any food checkbox on the daily view — a standalone maintenance/weekly/treatment food, or a member of a group (toggled individually or via the group's bulk checkbox) — that matches a food on the Recommended Foods list by name should credit or debit that food's weekly count, symmetrically, in real time.

## Scope

- **In scope:** cross-category credit for every checkbox on the live daily view (`/daily`) and every checkbox in Trailing Edit (`/history/edit`, the last-3-days corrector).
- **Out of scope:** any change to Food Grouping itself (already shipped, untouched), any change to which food categories can belong to a group (maintenance + weekly only, per existing behavior — treatment foods are not groupable, but they ARE still subject to cross-category credit as standalone checkboxes, see below), any change to the Recommended Foods screen's own direct-logging UI.

## Behavior

**Trigger — no new UI, hook into existing checkbox plumbing.** Every checkbox on the daily view already funnels through one of two existing per-key toggle functions:
- `DailyView.tsx`'s `handleCheck(key, val)` — used for every checkbox: standalone maintenance/weekly foods, treatment (evening) foods, medications, and group members (both the group-level bulk toggle and an individual member toggle in the expanded view — a group-level click calls this once per member key).
- `app/history/edit/page.tsx`'s `handleToggle(id, key, val, current)` — the equivalent for Trailing Edit's last-3-days corrector (`RecentDaysEditor.tsx`). Groups are not rendered in Trailing Edit today (no `FoodGroupRow` there), so this only ever fires for standalone food keys, but the same credit logic applies.

Both call sites get credit logic added inline — no new callback prop, no change to `FoodGroupRow`'s or `MorningSection`'s interfaces. A group check/uncheck already produces one `onCheck`/`onToggle` call per member key, so hooking the shared per-key credit logic into these two existing functions is sufficient to cover standalone foods, group members, and treatment foods alike.

**Matching.** Given a checkbox key, recover the food name by stripping its category prefix, checked longest-first: `morning-weekly-`, `morning-med-`, `evening-med-`, `morning-`, `evening-`. Keys with a `-med-` prefix are skipped entirely — medications are never food and can't match a recommended food. The recovered name is compared case-insensitively against `schedule.recommendedFoods[].name`. No match → no-op, nothing written.

**Credit.** Match + transitioning to checked → +1. Match + transitioning to unchecked → −1, floored at 0. Same math as the existing `handleGive`/`handleUndo` in `app/foods/page.tsx`.

**Transition guard (correctness-critical).** Credit must only apply when the checkbox's value actually changes for that key — compare against the previous `checkedFoods[key]`, not just the incoming `val`. This matters because `FoodGroupRow.handleGroupCheck` sets **every** member key to `newVal = !allChecked` unconditionally, including members that are already at that value in a partial-check state (e.g. 2 of 3 members already checked; clicking the group checkbox re-sends `true` for those 2 as well as the 1 newly-checked member). Without this guard, completing a partially-checked group would double-credit the already-checked members. Both `handleCheck` (which has `prev.checkedFoods` in scope) and `handleToggle` (which already receives `current` as a parameter) can implement this guard directly.

**Which week.**
- Live daily view: `treatmentAnchor.week` — the week currently displayed (same value driving the header).
- Trailing Edit: the edited day's **own** week (`entry.week`, i.e. the `DoseLogDay` being corrected), not today's displayed week — a correction to a past day must credit that day's week, not whatever week is showing today. These can differ.

**Persistence.** No new migration — `dose_state.recommended_food_counts` already exists and is exactly the right shape (`Record<week, Record<foodName, count>>`). Both call sites need to:
1. Have the current counts available (fetch `dose_state` on load if not already fetched; `app/daily/page.tsx` doesn't currently fetch `recommendedFoodCounts` at all, `app/history/edit/page.tsx` doesn't either — both need it added to their initial load).
2. Keep a ref to the latest counts (mirroring the existing `countsRef` pattern in `app/foods/page.tsx`) so rapid sequential toggles (e.g. bulk group check) don't race against stale closures.
3. On a credit-worthy transition, compute the updated counts and persist via the existing `saveRecommendedGiven` (fire-and-forget, matching every other checkbox-toggle save in this codebase — errors are swallowed, next load re-fetches truth).

**Shared logic.** The matching + credit computation (prefix strip, case-insensitive match, ±1 floored at 0) is written once as a pure function (e.g. `applyCrossCategoryCredit` in `lib/schedule.ts`, alongside the existing pure helpers like `getGlobalPosition`/`parseFrequencyLow`) and called from both `handleCheck` and `handleToggle`. It takes `(recommendedFoods, counts, weekKey, key, val, wasChecked)` and returns either updated counts or `null` (no match / no transition — caller skips the write).

## Data flow summary

```
Daily view checkbox toggle (any key, any category)
  → DailyView.handleCheck(key, val)
      → existing: update checkedFoods in dose_state (unchanged)
      → new: applyCrossCategoryCredit(...) → if non-null, update ref + saveRecommendedGiven(...)

Trailing Edit checkbox toggle (last 3 days)
  → app/history/edit/page.tsx handleToggle(id, key, val, current)
      → existing: updateDoseLogCheckedFoods(...) (unchanged)
      → existing: treatment-food position advance (unchanged, evening-only)
      → new: applyCrossCategoryCredit(..., weekKey = entry.week) → if non-null, update ref + saveRecommendedGiven(...)
```

## Edge cases

- **Group completes a partial state:** handled by the transition guard above — only the newly-toggled members credit/debit.
- **A food shares a name with a recommended food but isn't in any group:** still credits/debits — matching is per-checkbox, not group-specific, per the requirement that this applies "regardless of it being maintenance or treatment."
- **Live daily view vs. Recommended Foods screen show different "current week"** (`treatmentAnchor.week` / `getGlobalPosition` vs. the Recommended Foods screen's own `getFurthestAheadPosition`): a cross-logged credit can land in a different week bucket than a direct log made the same moment, if treatment foods are currently out of sync. Accepted — matches the daily view's own displayed week, which is the simpler and more predictable mental model for the parent doing the checking.
- **Same food logged both directly (Recommended Foods screen) and via cross-category (daily view) the same week:** both credits stack. This is correct — the food was given twice (or the same serving was logged twice by mistake, symmetric undo lets a parent correct it either way).
- **`saveRecommendedGiven` write failure:** swallowed, consistent with every other checkbox-save in this codebase (`saveCheckedState`, `updateDoseLogCheckedFoods`) — local state is optimistic, next load re-fetches truth from Supabase.

## QA

- Check a standalone maintenance food that matches a recommended food → counter +1 for the displayed week; uncheck → −1.
- Check a treatment (evening) food that matches a recommended food → same, confirming category-independence.
- Check a group where 1 of 3 members matches a recommended food → only that food's counter moves.
- Partially check a group (some members already checked), then click the group checkbox to complete it → already-checked matching members do NOT double-credit; only newly-checked members credit.
- Uncheck a fully-checked group → every matching member's counter decrements by 1 (floored at 0).
- Check a matching food in Trailing Edit on a past day whose week differs from today's displayed week → credit lands under the edited day's week, not today's.
- Case-insensitive match: group/food name differing only in case from the `recommendedFoods` entry still matches.
- Medication checkboxes never affect the counter.
- Direct log on Recommended Foods screen + cross-category log on daily view for the same food, same week → counts stack (additive, not deduplicated).
