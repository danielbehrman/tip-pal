# Reaction Ramp

## Context

BRIEF.md's Phase 4 backlog specs a manual mid-cycle dose-ramp workflow: when a reaction occurs, a parent enters a clinic-prescribed ramp-back plan for affected treatment and/or maintenance foods. The week/day counter freezes for the duration; treatment food doses are overridden per the ramp plan; the counter resumes only once all treatment food ramp steps complete. Full narrative spec, data model sketch, and QA list: BRIEF.md → Phase 4 → Backlog → "Reaction Ramp".

This spec resolves the three architecture decisions the backlog entry flagged as open (storage location, `dose_log` migration, maintenance dose-resolution modeling), plus two gaps found during design that the backlog's example JSON didn't fully cover.

## Goal

A parent can start, edit, and cancel a reaction ramp from Settings. While active, the daily view shows ramp-overridden doses for affected foods and freezes the global week/day counter. Each Complete Day advances per-food ramp step counters. When all treatment food steps complete, the counter resumes from where it froze; maintenance food ramps may continue independently after that point.

## Scope

- **In scope:** `reaction_ramp` + `previous_ramps` data model on `families`, `dose_log.ramp_active` migration, Settings setup/edit/cancel flow, daily view dose override + banner, Complete Day step-advancement logic, ramp-completion history record.
- **Out of scope:** rendering `previous_ramps` anywhere in the History screen (data is stored, UI is a future ticket — not in this ticket's QA or Definition of Done). Supabase Realtime (confirmed unnecessary — see Architecture Decisions).

## Architecture decisions (locked)

| Decision | Resolution |
|---|---|
| Storage location | JSONB column `reaction_ramp` on `families` — matches the existing `food_groups`/`previous_cycles` precedent (small structured blob, one row per family, replaced wholesale, already read whenever the family row loads). Rejected: dedicated table — no query/locking need surfaces, breaks convention. |
| Per-food step tracking | Embedded inside `reaction_ramp` JSONB (`currentStep`/`daysInStep`/`complete` per food), not added to `treatment_food_progress`. Ramp progress is temporary and orthogonal to `treatment_food_progress`'s permanent week/day position, which stays untouched (frozen) throughout the ramp. |
| `dose_log.ramp_active` | New migration required — `dose_log` has no JSONB column and no generic flag mechanism today; `is_skipped` is the only existing boolean and is semantically dedicated. Follows the exact `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` convention used by every prior migration in this repo. |
| Cross-device sync | Fetch-on-load only, piggybacking on the existing `families` fetch. No Realtime subscription. The whole app — including `dose_state` and `treatment_food_progress`, which have the identical "both users see shared state" requirement — already relies on refresh-fetches-latest with zero Realtime infrastructure (confirmed: zero matches for `.channel(`/`postgres_changes`/realtime anywhere in the codebase). Introducing Realtime for one feature would be a new, inconsistent pattern, not a fix to a real gap. |
| "Same ramp for all" maintenance resolution | UI captures either "same for all" or "per food" entry mode, but on confirm the app always resolves to fully-populated per-food `steps` arrays in `reaction_ramp.maintenanceFoods[]` — downstream code (Complete Day, dose override) never needs to know which entry mode was used. |

## Data model

**Migration** (`supabase/migrations/20260813_reaction_ramp.sql`):
```sql
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS reaction_ramp JSONB NOT NULL DEFAULT '{"active": false}'::jsonb;

ALTER TABLE families
  ADD COLUMN IF NOT EXISTS previous_ramps JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE dose_log
  ADD COLUMN IF NOT EXISTS ramp_active BOOLEAN NOT NULL DEFAULT false;
```

**TypeScript types** (`lib/types.ts`):
```ts
export interface RampStep {
  dose: number
  unit: string
  days: number
}

export interface RampTreatmentFood {
  name: string
  steps: RampStep[]
  returnDose: number
  returnUnit: string
  wasCapped: boolean       // captured at ramp creation from the food's current schedule entry —
                            // not in BRIEF's example JSON, added to satisfy the explicit
                            // "CAPPED label preserved" requirement
  currentStep: number
  daysInStep: number
  complete: boolean
}

export interface RampMaintenanceFood {
  name: string
  steps: RampStep[]
  currentStep: number
  daysInStep: number
  complete: boolean
  // no returnDose/returnUnit — maintenance foods return to their normally
  // scheduled dose automatically on completion, no stored "return to" value needed
}

export interface ReactionRamp {
  active: boolean
  rampDay: number
  startedAtWeek: number
  startedAtDay: number
  treatmentFoods: RampTreatmentFood[]
  maintenanceFoods: RampMaintenanceFood[]
}

export interface PreviousRamp {
  startedAt: string          // ISO timestamp
  endedAt: string             // ISO timestamp — written when the derived "treatment complete" condition (below) fires
  rampDayCount: number
  treatmentFoods: RampTreatmentFood[]   // full snapshot at end
  maintenanceFoods: RampMaintenanceFood[]  // full snapshot at end, may still have complete: false entries
}
```

## Behavior

### `active` semantics (Gap #1)

BRIEF's spec has a single `active` flag but also requires maintenance ramps to outlast treatment ramps without "blocking the counter" — a single boolean can't cleanly gate both "banner/counter-freeze" (tied to treatment) and "maintenance dose override" (can continue after treatment finishes).

**Resolution:** `active` means "this ramp object is still live" — stays `true` until **both** sides are fully complete. Everything tied to the treatment side (banner visibility, counter freeze, whether Complete Day skips `treatment_food_progress` advancement for ramp foods) is governed by a **derived**, not stored, condition:

```ts
const treatmentRampDone = (ramp: ReactionRamp) =>
  ramp.treatmentFoods.length === 0 || ramp.treatmentFoods.every(f => f.complete)
```

The moment this flips `true` (checked after every Complete Day's step-advancement): banner disappears, `treatment_food_progress` advancement resumes for those foods, a `PreviousRamp` history entry is written. `ramp.active` itself only flips to `false` once maintenance is also fully done (`maintenanceFoods.every(f => f.complete)`), at which point `reaction_ramp` is reset to `{"active": false}` — no second history entry.

A second derived value gates the treatment side's per-food behavior (both dose override and Complete Day advancement) on any given day:

```ts
const treatmentRampActive = (ramp: ReactionRamp) => ramp.active && !treatmentRampDone(ramp)
```

This is `true` for as long as at least one treatment food still has `complete: false`, and flips `false` the instant the last one finishes — at which point **every** treatment food in the ramp (including ones that finished their own steps earlier and were holding at `returnDose`) stops being overridden at all, on the same day. This matters: an individual food reaching `complete: true` does not let it resume early — it holds at `returnDose` waiting for its slower siblings, because the counter is a single frozen value (`getGlobalPosition`'s minimum across all foods) and letting one food's `treatment_food_progress` advance ahead of others still ramping would desync the resume point out from under `started_at_week`/`started_at_day`.

`dose_log.ramp_active` is written `true` on any Complete Day where `reactionRamp.active` was `true` at the start of that day's processing — this covers the maintenance-only tail after treatment completes.

### Dose override (`applyRampOverrides`)

Pure function in `lib/schedule.ts`, alongside `getGlobalPosition`/`applyCrossCategoryCredit`. Takes `(schedule: ParsedSchedule, ramp: ReactionRamp | null)`, returns a schedule-shaped object with doses substituted. Existing render components (`MorningSection`, `TreatmentSection`, etc.) consume the transformed schedule unchanged — override logic stays isolated to this one function, called once in `app/daily/page.tsx`.

Per-food branching (Gap #2, confirmed explicitly), using `treatmentRampActive(ramp)` from above:
- **Treatment food, in ramp, `treatmentRampActive` true, `complete: false`** → `{ dose: steps[currentStep].dose, unit: steps[currentStep].unit, capped: wasCapped }`
- **Treatment food, in ramp, `treatmentRampActive` true, `complete: true`** → `{ dose: returnDose, unit: returnUnit, capped: wasCapped }` — holds here while other ramp treatment foods are still stepping. Must be an explicit branch: `steps[currentStep]` is out of bounds once `currentStep` has advanced past the array end, so falling through to it would crash or show a stale value.
- **Treatment food, in ramp, `treatmentRampActive` false** (whole treatment side finished, including on the very day it finishes) → no override at all, for every treatment food in the ramp regardless of its own `complete` value — normal schedule-derived dose for the now-resuming position takes over.
- **Maintenance food, in ramp, `complete: false`** → `{ dose: steps[currentStep].dose, unit: steps[currentStep].unit }` — gated only on the food's own `complete`, independent of `treatmentRampActive`.
- **Maintenance food, in ramp, `complete: true`** → no override — food is excluded from the substitution map entirely and falls through to the normal schedule-derived maintenance dose (matches spec: "return to the scheduled maintenance dose automatically," no `returnDose` field exists for maintenance foods).
- **Food not present in either ramp array** → no override, normal schedule dose, unaffected.

### Complete Day integration (`app/daily/page.tsx`, `handleCompleteDay`)

- `reactionRamp` fetched once in the page's existing `load()` (new `fetchReactionRamp()` call alongside `dose_state`/`food_groups`), held in state + a ref (mirroring the existing `foodProgressRef` pattern to avoid stale-closure races on rapid taps).
- Compute `wasTreatmentRampActive = treatmentRampActive(reactionRamp)` from the ramp state **as loaded at the start of this Complete Day**, before any of today's updates — this is the gate used for all of today's per-food branching below, so a food doesn't get treated inconsistently mid-computation.
- Per checked evening treatment food: match against `reactionRamp.treatmentFoods` by name, case-insensitive (matching the convention `applyCrossCategoryCredit` already uses).
  - **Matched, `wasTreatmentRampActive` true, entry's `complete: false`:** skip `treatment_food_progress` advancement for this food (stays frozen); increment its `daysInStep`; if `daysInStep >= steps[currentStep].days` → advance `currentStep`, reset `daysInStep` to 0; if no next step → set `complete: true`.
  - **Matched, `wasTreatmentRampActive` true, entry's `complete: true`:** skip `treatment_food_progress` advancement (still frozen, waiting on slower siblings); no step increment — nothing left to increment.
  - **Not matched, or `wasTreatmentRampActive` false** (food was never in the ramp, or the whole treatment side already finished on a prior day): advance `treatment_food_progress` exactly as today, unchanged.
- Per maintenance food in `reactionRamp.maintenanceFoods` with `complete: false`: same `daysInStep`/`currentStep`/`complete` advancement, every Complete Day, independent of `wasTreatmentRampActive`.
- `rampDay += 1` while `ramp.active`.
- `globalBefore = getGlobalPosition(foodProgress)` computed exactly as today — naturally reflects the frozen position with no special-casing, since ramp foods' `treatment_food_progress` simply isn't advancing while `wasTreatmentRampActive` holds (their entry stays the minimum, which is what `getGlobalPosition` selects).
- `saveDoseLog(...)` gets one new argument, `rampActive: boolean = reactionRamp?.active ?? false`.
- After the per-food updates: check `treatmentRampDone(updatedRamp)`. If it just flipped `true` this Complete Day (i.e. `wasTreatmentRampActive` was true going in, and every treatment food's `complete` is now `true`) → append a `PreviousRamp` snapshot to `families.previous_ramps`, matching the `treatmentFoods`/`maintenanceFoods` state at that moment. From the *next* Complete Day onward, `wasTreatmentRampActive` computes `false` for these foods and they fall into the "advance `treatment_food_progress` normally" branch above — this is how the counter resumes, with no separate resume step needed. If maintenance is also fully done at the moment `treatmentRampDone` flips, reset `reaction_ramp` to `{"active": false}`; otherwise persist the updated ramp with treatment-side foods left in their `complete: true` holding state (kept only so `previous_ramps`/display logic has a consistent final snapshot — they no longer drive any override or advancement decision once `treatmentRampDone` is true).
- Persist via `saveReactionRamp(updatedRamp)`.

### Data access layer (`lib/supabase.ts`)

```ts
fetchReactionRamp(): Promise<ReactionRamp | null>   // reads families.reaction_ramp, returns null when active is false
saveReactionRamp(ramp: ReactionRamp): Promise<void>  // single UPDATE families SET reaction_ramp = $1 — used for start, edit-replace, Complete Day increments, cancel, and end-state
appendPreviousRamp(entry: PreviousRamp): Promise<void>  // read-modify-write families.previous_ramps (append), same pattern as archiveAndStartNewCycle's previous_cycles append
```

`saveDoseLog` signature gains one parameter:
```ts
export async function saveDoseLog(
  week: number,
  day: number,
  checkedFoods: Record<string, boolean>,
  completedAt: string,
  scheduleSnapshot: object,
  isSkipped: boolean,
  rampActive: boolean   // new
): Promise<void>
```

### Settings UI flow

New route `app/reaction-ramp/page.tsx`, following the New Food Cycle convention exactly (`app/new-cycle/page.tsx`): one component, a local `View` union type (`"treatment" | "maintenance" | "review" | "success"`), wizard data as sibling `useState` hooks, terminal write via `saveReactionRamp`. No separate per-step routes.

- **Screen 1 — Treatment foods:** every current treatment food listed; current week's scheduled dose shown read-only (from `currentSchedule` + `treatment_food_progress`); step editor (dose/unit/days per step, add/remove step rows); any food can be excluded from the ramp (excluded foods simply don't appear in the written `treatmentFoods` array). `returnDose`/`returnUnit`/`wasCapped` are captured automatically per included food from its current schedule entry at this screen — not user-entered.
- **Screen 2 — Maintenance foods:** toggle "Also adjusting maintenance foods?" (default off). If on: choice of "Same ramp for all" (single step editor, resolved into per-food `steps` arrays for every selected maintenance food on confirm) or "Different per food" (individual step editors per food). Current maintenance dose shown read-only per food as reference.
- **Screen 3 — Review + Confirm:** full summary of every included food and its steps. Confirm calls `saveReactionRamp` with a freshly-built `ReactionRamp` (`active: true`, `rampDay: 0`, `startedAtWeek`/`startedAtDay = getGlobalPosition(foodProgress)` captured at this moment, both food arrays as built across screens 1–2).
- **Edit path:** same route/component, initial state pre-populated from `fetchReactionRamp()`. Per Gap #2: on confirm, `rampDay`/`startedAtWeek`/`startedAtDay` are carried over unchanged from the existing ramp; `treatmentFoods`/`maintenanceFoods` are fully replaced with whatever the parent re-enters, `currentStep`/`daysInStep` reset to 0 for the new step plan.
- **Cancel:** single-confirm action directly in Settings (no wizard) — `saveReactionRamp({ active: false, rampDay: 0, startedAtWeek: 0, startedAtDay: 0, treatmentFoods: [], maintenanceFoods: [] })`. Counter resumes immediately (next `getGlobalPosition` call reflects `treatment_food_progress`, which was never touched). No `previous_ramps` entry written for a cancel — only for natural treatment-side completion.

Settings screen gets one conditional entry: "Start Reaction Ramp" (no active ramp) or "Edit Reaction Ramp" / "Cancel Reaction Ramp" (active ramp present), placed below New Food Cycle per the backlog spec.

### Daily view banner

Rendered when `reactionRamp?.active && !treatmentRampDone(reactionRamp)`, below the visit/week/day header: `"Reaction Ramp · Day {rampDay} — Edit"`. Tapping Edit routes to `/reaction-ramp`. Once `treatmentRampDone` flips true, the banner disappears even if `active` is still true (maintenance tail) — matches spec: "remove banner" is tied to treatment completion, not full closure.

## Data flow summary

```
Daily view load
  → fetchReactionRamp() (alongside existing dose_state/food_groups fetch)
  → applyRampOverrides(schedule, ramp) → transformed schedule passed to render components (unchanged)
  → banner rendered if active && !treatmentRampDone

Settings → Start/Edit Reaction Ramp
  → app/reaction-ramp/page.tsx wizard
  → saveReactionRamp(ramp) on confirm

Complete Day (handleCompleteDay)
  → wasTreatmentRampActive = treatmentRampActive(reactionRamp)   // computed from state as loaded, before today's updates
  → per treatment food:
      matched && wasTreatmentRampActive && !entry.complete → increment daysInStep/currentStep, skip treatment_food_progress
      matched && wasTreatmentRampActive && entry.complete  → no-op (holding, waiting on siblings), skip treatment_food_progress
      not matched, or !wasTreatmentRampActive               → advance treatment_food_progress as today
  → per maintenance food: entry.complete === false? → advance ramp step (independent of wasTreatmentRampActive)
  → rampDay += 1 (if active)
  → globalBefore = getGlobalPosition(foodProgress)   // unchanged call, naturally reflects freeze
  → saveDoseLog(..., rampActive)
  → treatmentRampDone(updatedRamp) just flipped true this Complete Day?
      → appendPreviousRamp(snapshot)
      → maintenanceFoods also all complete? → reset reaction_ramp to {active: false}
                                              → else persist with treatment side held complete (inert — treatmentRampActive now false, so next Complete Day's foods take the "advance treatment_food_progress as today" branch automatically)
  → saveReactionRamp(updatedRamp)

Settings → Cancel Reaction Ramp
  → saveReactionRamp({active: false, ...cleared})
  → counter resumes immediately (treatment_food_progress untouched throughout)
```

## Edge cases

- **A treatment food finishes its steps before other ramp foods:** handled by the per-food `complete` branch in `applyRampOverrides` — shows `returnDose` while waiting, not a crash from indexing past the step array.
- **Maintenance ramp outlasts treatment ramp:** `treatmentRampDone` is independent of `maintenanceFoods` state; banner/counter resume on the treatment condition alone, maintenance overrides and step-advancement continue on subsequent Complete Days regardless.
- **Cancel mid-ramp:** no history entry written (only natural treatment completion writes one) — matches spec's cancel behavior ("all foods return to scheduled doses" with no mention of a history record).
- **Edit while treatment side already done but maintenance still active:** `treatmentFoods` array in the edit wizard would be empty/all-excluded in practice (nothing left to edit on that side) — Screen 1 simply shows no foods to configure; Screen 2 maintenance re-edit works normally. Edge case is a UI no-op, not a logic branch.
- **Two treatment foods with different step counts:** each advances independently per its own `currentStep`/`daysInStep` — `treatmentRampDone` only fires once every one of them individually reaches `complete: true`.
- **`saveReactionRamp`/`appendPreviousRamp` write failure:** swallowed, consistent with every other checkbox/state save in this codebase (`saveCheckedState`, `saveDoseLog`) — optimistic local state, next load re-fetches truth.
- **7-day minimum rule "restarts" after ramp ends:** this rule is informational-only copy today, not enforced anywhere in code (confirmed — no stateful 7-day clock exists in the codebase). Nothing to build for this constraint; no behavior change needed.

## QA

(Carried from BRIEF.md's Reaction Ramp backlog entry, mapped to this design)

- Start ramp → counter freezes, banner appears, affected foods show ramp doses, unaffected foods unchanged.
- Complete Day during ramp → `rampDay` +1, `daysInStep` increments per food, week/day counter unchanged.
- Step completion → food auto-advances to next step dose after the correct number of Complete Days.
- All treatment food steps complete → counter resumes from frozen position, banner removed, all treatment ramp foods (including any that finished early and were holding at `returnDose`) immediately show normal schedule-derived doses, not `returnDose`.
- Maintenance ramp outlasts treatment ramp → maintenance foods continue showing ramp dose after treatment-side completion, counter moves freely for treatment foods.
- Cancel → counter resumes immediately, all foods return to scheduled doses, no history entry written.
- Edit mid-stream → ramp replaced entirely, `rampDay`/`startedAtWeek`/`startedAtDay` preserved, step positions reset, counter remains frozen.
- `dose_log` entries during ramp (including the maintenance-only tail after treatment completes) carry `ramp_active: true`.
- Both users see identical ramp state after a refresh/reload (fetch-on-load, no Realtime).
- "Same ramp for all" maintenance: each food stores resolved doses, correct dose shown regardless of differing units.
- CAPPED label preserved on ramp dose (via `wasCapped`) for treatment foods still stepping and for treatment foods holding at `returnDose`.
- A treatment food that completes its steps before others shows `returnDose`, not a crash or stale last-step value.
- `previous_ramps` entry written on natural treatment completion includes both `treatmentFoods` and `maintenanceFoods` snapshots (maintenance may show incomplete entries if still ongoing).
