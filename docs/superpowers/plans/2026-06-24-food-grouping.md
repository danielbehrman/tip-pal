# Food Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let families define named groups of morning foods (e.g., "Jam" for all seeds) that appear as a single collapsible row on the daily view — one tap checks all members; expand to check individually.

**Architecture:** Groups are stored as JSONB on the `families` table — a flat array of `FoodGroup` objects keyed by food name (string match against the parsed schedule). Groups are a pure display/interaction layer; the underlying `checked_foods` state continues tracking individual food names unchanged. Groups slot into the morning section at the position of their first member in the schedule order.

**Tech Stack:** Next.js 16 (App Router, client components), Supabase (Postgres + JSONB), TypeScript, Tailwind CSS 4

## Global Constraints

- No scope beyond food grouping: no treatment food groups, no evening section changes
- App name is "Tip Pal" — not "TIP Pal" — in all new UI copy
- No personal names in the codebase or app
- A food can belong to at most one group
- Groups reference foods by name (string match) — they survive re-parses automatically if the food name is unchanged
- Foods in a group that are missing from the current schedule are silently skipped in the daily view (membership is preserved for when a re-parse adds the food back)
- `checked_foods` keys remain unchanged (`morning-{foodName}`, `morning-weekly-{foodName}`) — groups are display-only
- No test runner exists in this project — verification is `npm run build` (TypeScript compile) + live smoke check via `curl` against `https://tippal.behrman.dev`
- This project has no existing test files — skip test-file creation steps; replace with build verification

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260624_food_groups.sql` | Create | Add `food_groups` JSONB column to `families` |
| `lib/types.ts` | Modify | Add `FoodGroup` interface |
| `lib/supabase.ts` | Modify | Add `fetchFoodGroups`, `saveFoodGroups` |
| `components/FoodGroupRow.tsx` | Create | Collapsed/expanded group row for daily view |
| `components/GroupsManager.tsx` | Create | Group CRUD UI embedded in Settings |
| `components/MorningSection.tsx` | Modify | Partition foods by group; render `FoodGroupRow` + standalone `FoodItem` |
| `components/DailyView.tsx` | Modify | Accept `foodGroups` prop; pass to `MorningSection` |
| `app/daily/page.tsx` | Modify | Fetch food groups on load; pass to `DailyView` |
| `app/settings/page.tsx` | Modify | Fetch food groups + schedule; embed `GroupsManager` |

---

## Task 1: DB Migration + Types + Supabase Functions

**Files:**
- Create: `supabase/migrations/20260624_food_groups.sql`
- Modify: `lib/types.ts` (add `FoodGroup`)
- Modify: `lib/supabase.ts` (add `fetchFoodGroups`, `saveFoodGroups`)

**Interfaces:**
- Produces:
  - `FoodGroup` type (used by Tasks 2, 3, 4, 5, 6)
  - `fetchFoodGroups(): Promise<FoodGroup[]>` (used by Tasks 4, 6)
  - `saveFoodGroups(groups: FoodGroup[]): Promise<void>` (used by Tasks 5, 6)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260624_food_groups.sql`:

```sql
-- Phase 3: user-defined food groups for the morning section.
-- Stored as JSONB on families — one row per family, small dataset, no separate table needed.
-- Each group: { id, name, foodNames: string[], sortOrder: number }

ALTER TABLE families
  ADD COLUMN IF NOT EXISTS food_groups JSONB NOT NULL DEFAULT '[]'::jsonb;
```

- [ ] **Step 2: Run the migration against production Supabase**

In the Supabase dashboard SQL editor, paste and run the migration SQL.

Verify with:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'families' AND column_name = 'food_groups';
```
Expected: one row, `data_type = jsonb`, `column_default = '[]'::jsonb`.

- [ ] **Step 3: Add `FoodGroup` type to `lib/types.ts`**

Add after the `Medication` interface (before `ParsedSchedule`):

```ts
export interface FoodGroup {
  id: string           // client-generated UUID — never changes for the life of the group
  name: string         // display name, e.g. "Jam"
  foodNames: string[]  // matches MaintenanceFood.name or WeeklyFood.name exactly
  sortOrder: number    // display order within the group list (not used in daily view ordering)
}
```

- [ ] **Step 4: Add `fetchFoodGroups` and `saveFoodGroups` to `lib/supabase.ts`**

Add after `fetchFamilyName`:

```ts
export async function fetchFoodGroups(): Promise<FoodGroup[]> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("food_groups")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return (data.food_groups ?? []) as FoodGroup[]
}

export async function saveFoodGroups(groups: FoodGroup[]): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ food_groups: groups })
    .eq("id", familyId)
  if (error) throw error
}
```

Add `FoodGroup` to the import in `lib/supabase.ts`:
```ts
import { ParsedSchedule, DoseState, DoseLogDay, DayRecord, FoodGroup } from "./types"
```

- [ ] **Step 5: Verify the build compiles**

```bash
npm run build
```
Expected: `✓ Compiled successfully` with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260624_food_groups.sql lib/types.ts lib/supabase.ts
git commit -m "feat: food groups — DB migration, FoodGroup type, fetch/save functions"
```

---

## Task 2: FoodGroupRow Component

**Files:**
- Create: `components/FoodGroupRow.tsx`

**Interfaces:**
- Consumes:
  - `FoodGroup` from `lib/types.ts`
  - `MaintenanceFood`, `WeeklyFood` from `lib/types.ts`
  - `FoodItem` from `components/FoodItem.tsx`
- Produces:
  - `FoodGroupRow` component consumed by `MorningSection` (Task 3)

**Props:**
```ts
interface FoodGroupRowProps {
  group: FoodGroup
  // foods are the resolved schedule objects matching group.foodNames — in schedule order
  foods: Array<{ food: MaintenanceFood | WeeklyFood; prefix: 'morning' | 'morning-weekly' }>
  checkedFoods: Record<string, boolean>
  disabled: boolean
  onCheck: (key: string, val: boolean) => void
}
```

**Group checkbox states:**
- All checked → checked (✓)
- None checked → unchecked (□)
- Some checked → indeterminate (−) rendered as a partial visual since HTML indeterminate requires a ref

- [ ] **Step 1: Create `components/FoodGroupRow.tsx`**

```tsx
"use client"

import { useState } from "react"
import { FoodGroup, MaintenanceFood, WeeklyFood } from "@/lib/types"
import FoodItem from "./FoodItem"

interface FoodGroupRowProps {
  group: FoodGroup
  foods: Array<{ food: MaintenanceFood | WeeklyFood; prefix: "morning" | "morning-weekly" }>
  checkedFoods: Record<string, boolean>
  disabled: boolean
  onCheck: (key: string, val: boolean) => void
}

export default function FoodGroupRow({
  group,
  foods,
  checkedFoods,
  disabled,
  onCheck,
}: FoodGroupRowProps) {
  const [expanded, setExpanded] = useState(false)

  const keys = foods.map(({ food, prefix }) => `${prefix}-${food.name}`)
  const checkedCount = keys.filter((k) => !!checkedFoods[k]).length
  const allChecked = checkedCount === keys.length && keys.length > 0
  const someChecked = checkedCount > 0 && !allChecked

  function handleGroupCheck(val: boolean) {
    keys.forEach((k) => onCheck(k, val))
  }

  return (
    <div className="py-1">
      <div className="flex items-center gap-3 py-2 min-h-[44px]">
        {/* Group checkbox */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleGroupCheck(!allChecked)}
          className={`w-6 h-6 shrink-0 rounded border-2 flex items-center justify-center
            ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
            ${allChecked
              ? "bg-slate-900 border-slate-900"
              : someChecked
              ? "bg-slate-300 border-slate-400"
              : "border-gray-400 bg-white"
            }`}
          aria-label={`${allChecked ? "Uncheck" : "Check"} all ${group.name} foods`}
        >
          {allChecked && (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {someChecked && <span className="text-white text-xs font-bold leading-none">−</span>}
        </button>

        {/* Group label */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex-1 flex items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <span className={`text-base font-medium ${allChecked ? "line-through text-gray-400" : ""}`}>
            {group.name}
          </span>
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
            {foods.length} foods
          </span>
          <span className="text-gray-400 text-sm ml-auto">{expanded ? "▲" : "▼"}</span>
        </button>
      </div>

      {expanded && (
        <div className="ml-9 border-l-2 border-gray-100 pl-3">
          {foods.map(({ food, prefix }) => (
            <FoodItem
              key={`${prefix}-${food.name}`}
              name={food.name}
              dose={food.dose}
              unit={food.unit}
              prepNote={food.prepNote ?? null}
              capped={"capped" in food ? food.capped : false}
              isWeekly={prefix === "morning-weekly"}
              isContinuing={false}
              checked={!!checkedFoods[`${prefix}-${food.name}`]}
              disabled={disabled}
              onChange={(val) => onCheck(`${prefix}-${food.name}`, val)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
npm run build
```
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
git add components/FoodGroupRow.tsx
git commit -m "feat: FoodGroupRow — collapsible group row for morning section"
```

---

## Task 3: MorningSection Group Partitioning

**Files:**
- Modify: `components/MorningSection.tsx`

**Interfaces:**
- Consumes:
  - `FoodGroup` from `lib/types.ts`
  - `FoodGroupRow` from `components/FoodGroupRow.tsx`
- Produces:
  - Updated `MorningSection` accepting `foodGroups: FoodGroup[]` prop (consumed by `DailyView`, Task 4)

**Partitioning logic:**

Given `schedule.maintenanceFoods = [A, B, C, D, E]` and group "Jam" = `{ foodNames: ["C", "E"] }`:

Walk foods in schedule order. At each position:
- If this food is the **first group member** encountered in the schedule → emit the group row (which contains all matching members in schedule order)
- If this food is a **non-first group member** → skip (already emitted inside the group row)
- Otherwise → emit as a standalone `FoodItem`

Result order: `[A, B, Jam (C+E), D]` — group appears at C's original position.

- [ ] **Step 1: Update `components/MorningSection.tsx`**

Replace the entire file content:

```tsx
"use client"

import { ParsedSchedule, FoodGroup, MaintenanceFood, WeeklyFood } from "@/lib/types"
import FoodItem from "./FoodItem"
import FoodGroupRow from "./FoodGroupRow"

interface MorningSectionProps {
  schedule: ParsedSchedule
  currentDay: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
  isFutureDay: boolean
  foodGroups: FoodGroup[]
}

type MorningItem =
  | { type: "standalone"; food: MaintenanceFood; prefix: "morning" }
  | { type: "weekly"; food: WeeklyFood; prefix: "morning-weekly" }
  | { type: "group"; group: FoodGroup; foods: Array<{ food: MaintenanceFood | WeeklyFood; prefix: "morning" | "morning-weekly" }> }

function buildMorningItems(
  maintenanceFoods: MaintenanceFood[],
  weeklyFoods: WeeklyFood[],
  showWeekly: boolean,
  groups: FoodGroup[]
): MorningItem[] {
  // Build a lookup: foodName → group (for foods that appear in any group)
  const foodToGroup = new Map<string, FoodGroup>()
  for (const group of groups) {
    for (const name of group.foodNames) {
      foodToGroup.set(name, group)
    }
  }

  // For each group, collect its resolved foods in schedule order (maintenance first, then weekly)
  const groupFoodsMap = new Map<string, Array<{ food: MaintenanceFood | WeeklyFood; prefix: "morning" | "morning-weekly" }>>()
  const emittedGroups = new Set<string>()

  function getGroupFoods(group: FoodGroup): Array<{ food: MaintenanceFood | WeeklyFood; prefix: "morning" | "morning-weekly" }> {
    if (groupFoodsMap.has(group.id)) return groupFoodsMap.get(group.id)!
    const result: Array<{ food: MaintenanceFood | WeeklyFood; prefix: "morning" | "morning-weekly" }> = []
    for (const food of maintenanceFoods) {
      if (group.foodNames.includes(food.name)) result.push({ food, prefix: "morning" })
    }
    if (showWeekly) {
      for (const food of weeklyFoods) {
        if (group.foodNames.includes(food.name)) result.push({ food, prefix: "morning-weekly" })
      }
    }
    groupFoodsMap.set(group.id, result)
    return result
  }

  const items: MorningItem[] = []

  // Walk maintenance foods in schedule order
  for (const food of maintenanceFoods) {
    const group = foodToGroup.get(food.name)
    if (group) {
      if (!emittedGroups.has(group.id)) {
        // First member of this group in schedule order — emit the group row
        emittedGroups.add(group.id)
        const foods = getGroupFoods(group)
        if (foods.length > 0) {
          items.push({ type: "group", group, foods })
        }
      }
      // Non-first members: skip (already included in the group row above)
    } else {
      items.push({ type: "standalone", food, prefix: "morning" })
    }
  }

  // Walk weekly foods (Day 7 only)
  if (showWeekly) {
    for (const food of weeklyFoods) {
      const group = foodToGroup.get(food.name)
      if (group) {
        if (!emittedGroups.has(group.id)) {
          emittedGroups.add(group.id)
          const foods = getGroupFoods(group)
          if (foods.length > 0) {
            items.push({ type: "group", group, foods })
          }
        }
      } else {
        items.push({ type: "weekly", food, prefix: "morning-weekly" })
      }
    }
  }

  return items
}

export default function MorningSection({
  schedule,
  currentDay,
  checkedFoods,
  onCheck,
  isFutureDay,
  foodGroups,
}: MorningSectionProps) {
  const showWeekly = currentDay === 7
  const items = buildMorningItems(
    schedule.maintenanceFoods,
    schedule.weeklyFoods,
    showWeekly,
    foodGroups
  )

  return (
    <section className="mb-6">
      <h2 className="text-xl font-bold mb-2">Morning</h2>
      <div className="divide-y divide-gray-100">
        {items.map((item) => {
          if (item.type === "group") {
            return (
              <FoodGroupRow
                key={`group-${item.group.id}`}
                group={item.group}
                foods={item.foods}
                checkedFoods={checkedFoods}
                disabled={isFutureDay}
                onCheck={onCheck}
              />
            )
          }
          const isWeekly = item.type === "weekly"
          return (
            <FoodItem
              key={`${item.prefix}-${item.food.name}`}
              name={item.food.name}
              dose={item.food.dose}
              unit={item.food.unit}
              prepNote={item.food.prepNote ?? null}
              capped={"capped" in item.food ? item.food.capped : false}
              isWeekly={isWeekly}
              isContinuing={false}
              checked={!!checkedFoods[`${item.prefix}-${item.food.name}`]}
              disabled={isFutureDay}
              onChange={(val) => onCheck(`${item.prefix}-${item.food.name}`, val)}
            />
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
npm run build
```

Expected: TypeScript error — `DailyView` still passes the old `MorningSection` props without `foodGroups`. That's correct — it will be fixed in Task 4.

If build fails for any reason *other* than the missing `foodGroups` prop, fix it before continuing.

- [ ] **Step 3: Commit**

```bash
git add components/MorningSection.tsx
git commit -m "feat: MorningSection — partition foods into groups and standalone, render FoodGroupRow"
```

---

## Task 4: Wire Food Groups Through DailyView and Daily Page

**Files:**
- Modify: `components/DailyView.tsx`
- Modify: `app/daily/page.tsx`

**Interfaces:**
- Consumes:
  - `FoodGroup` from `lib/types.ts`
  - `fetchFoodGroups` from `lib/supabase.ts`
  - Updated `MorningSection` from Task 3
- Produces:
  - `DailyView` accepts `foodGroups: FoodGroup[]` prop
  - Daily page loads and passes groups to `DailyView`

- [ ] **Step 1: Update `components/DailyView.tsx`**

Add `foodGroups` to the props interface (after `previousDayIncomplete`):

```ts
interface DailyViewProps {
  schedule: ParsedSchedule
  doseState: DoseState
  onStateChange: (updater: (prev: DoseState) => DoseState) => void
  onCompleteDay: () => void
  onSkipDay: () => void
  appointmentDate: string | null
  onAppointmentChange: (value: string) => void
  familyName: string | null
  completedPositions: Set<string>
  dayRecords: Map<string, DayRecord>
  treatmentAnchor: { week: number; day: number }
  previousDayIncomplete: boolean
  foodGroups: FoodGroup[]
}
```

Add `FoodGroup` to the import:
```ts
import { ParsedSchedule, DoseState, DayRecord, FoodGroup } from "@/lib/types"
```

Destructure `foodGroups` in the component:
```ts
export default function DailyView({
  schedule,
  doseState,
  onStateChange,
  onCompleteDay,
  onSkipDay,
  appointmentDate,
  onAppointmentChange,
  familyName,
  completedPositions,
  dayRecords,
  treatmentAnchor,
  previousDayIncomplete,
  foodGroups,
}: DailyViewProps) {
```

Pass `foodGroups` to `MorningSection`:
```tsx
<MorningSection
  schedule={schedule}
  currentDay={currentDay}
  checkedFoods={checkedFoods}
  onCheck={handleCheck}
  isFutureDay={isFutureDay}
  foodGroups={foodGroups}
/>
```

- [ ] **Step 2: Update `app/daily/page.tsx`**

Add `fetchFoodGroups` to the import:
```ts
import {
  fetchSchedule,
  fetchDoseState,
  saveDoseState,
  saveCheckedState,
  saveDoseLog,
  saveSkipDay,
  fetchCompletedPositions,
  fetchDayRecords,
  fetchDateHasDayRecord,
  fetchAppointmentDate,
  saveAppointmentDate,
  fetchFamilyName,
  fetchFoodGroups,
  saveTimezone,
  getSession,
} from "@/lib/supabase"
```

Add `FoodGroup` to the types import:
```ts
import { ParsedSchedule, DoseState, DayRecord, FoodGroup } from "@/lib/types"
```

Add state:
```ts
const [foodGroups, setFoodGroups] = useState<FoodGroup[]>([])
```

In the `load` function, add `fetchFoodGroups` to the parallel fetch (after `fetchDayRecords`):
```ts
const [ds, apptDate, name, positions, records, groups] = await Promise.all([
  fetchDoseState(),
  fetchAppointmentDate().catch(() => null),
  fetchFamilyName().catch(() => null),
  fetchCompletedPositions().catch(() => new Set<string>()),
  fetchDayRecords().catch(() => new Map<string, DayRecord>()),
  fetchFoodGroups().catch(() => []),
])
```

After `setDayRecords(records)`, add:
```ts
setFoodGroups(groups)
```

Pass `foodGroups` to `DailyView`:
```tsx
return (
  <DailyView
    schedule={schedule}
    doseState={doseState}
    onStateChange={handleStateChange}
    onCompleteDay={handleCompleteDay}
    onSkipDay={handleSkipDay}
    appointmentDate={appointmentDate}
    onAppointmentChange={handleAppointmentChange}
    familyName={familyName}
    completedPositions={completedPositions}
    dayRecords={dayRecords}
    treatmentAnchor={treatmentAnchor}
    previousDayIncomplete={previousDayIncomplete}
    foodGroups={foodGroups}
  />
)
```

- [ ] **Step 3: Verify the build compiles clean**

```bash
npm run build
```
Expected: `✓ Compiled successfully` — no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add components/DailyView.tsx app/daily/page.tsx
git commit -m "feat: wire food groups through DailyView and daily page load"
```

---

## Task 5: GroupsManager Component

**Files:**
- Create: `components/GroupsManager.tsx`

**Interfaces:**
- Consumes:
  - `FoodGroup` from `lib/types.ts`
  - `ParsedSchedule`, `MaintenanceFood`, `WeeklyFood` from `lib/types.ts`
  - `saveFoodGroups` from `lib/supabase.ts`
- Produces:
  - `GroupsManager` component consumed by `app/settings/page.tsx` (Task 6)

**Props:**
```ts
interface GroupsManagerProps {
  schedule: ParsedSchedule
  groups: FoodGroup[]
  onChange: (groups: FoodGroup[]) => void
}
```

**Behavior:**
- List existing groups: show name + food count + "Edit" + "Delete" buttons
- "New group" button → inline create form (name input + food checkboxes)
- Edit mode (per group): show group name (editable) + checkboxes for all morning foods
- Foods already in *another* group are shown grayed out and disabled in the picker
- Delete: immediate, no confirmation (destructive but recoverable by re-adding)
- `onChange` called on every create/edit/delete — Settings page persists via `saveFoodGroups`
- Groups with zero matching foods in the current schedule are shown with a note but not deleted automatically

**All morning foods available for grouping:** `schedule.maintenanceFoods` + `schedule.weeklyFoods`

- [ ] **Step 1: Create `components/GroupsManager.tsx`**

```tsx
"use client"

import { useState } from "react"
import { FoodGroup, ParsedSchedule } from "@/lib/types"

interface GroupsManagerProps {
  schedule: ParsedSchedule
  groups: FoodGroup[]
  onChange: (groups: FoodGroup[]) => void
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function GroupsManager({ schedule, groups, onChange }: GroupsManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [creatingName, setCreatingName] = useState("")
  const [creatingFoods, setCreatingFoods] = useState<string[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)

  // All morning-eligible foods (maintenance + weekly)
  const allFoods = [
    ...schedule.maintenanceFoods.map((f) => f.name),
    ...schedule.weeklyFoods.map((f) => f.name),
  ]

  // foodName → group.id for foods already claimed
  const claimedBy = new Map<string, string>()
  for (const group of groups) {
    for (const name of group.foodNames) {
      claimedBy.set(name, group.id)
    }
  }

  function handleDeleteGroup(id: string) {
    onChange(groups.filter((g) => g.id !== id))
  }

  function handleStartEdit(group: FoodGroup) {
    setEditingId(group.id)
    setEditingName(group.name)
    if (showCreateForm) setShowCreateForm(false)
  }

  function handleEditToggleFood(groupId: string, foodName: string, checked: boolean) {
    const updated = groups.map((g) => {
      if (g.id !== groupId) return g
      const foodNames = checked
        ? [...g.foodNames, foodName]
        : g.foodNames.filter((n) => n !== foodName)
      return { ...g, foodNames }
    })
    onChange(updated)
  }

  function handleSaveEditName(groupId: string) {
    const trimmed = editingName.trim()
    if (!trimmed) return
    onChange(groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)))
    setEditingId(null)
  }

  function handleCreateToggleFood(foodName: string, checked: boolean) {
    setCreatingFoods((prev) =>
      checked ? [...prev, foodName] : prev.filter((n) => n !== foodName)
    )
  }

  function handleCreateGroup() {
    const trimmed = creatingName.trim()
    if (!trimmed || creatingFoods.length === 0) return
    const newGroup: FoodGroup = {
      id: generateId(),
      name: trimmed,
      foodNames: creatingFoods,
      sortOrder: groups.length,
    }
    onChange([...groups, newGroup])
    setCreatingName("")
    setCreatingFoods([])
    setShowCreateForm(false)
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 && !showCreateForm && (
        <p className="text-sm text-gray-500">No groups yet. Create one to combine foods like seeds into a single checkbox.</p>
      )}

      {groups.map((group) => {
        const isEditing = editingId === group.id
        // Foods in this schedule that are in this group
        const matchedFoods = group.foodNames.filter((n) => allFoods.includes(n))
        const staleFoods = group.foodNames.filter((n) => !allFoods.includes(n))

        return (
          <div key={group.id} className="border border-gray-200 rounded-xl p-4">
            {isEditing ? (
              <div className="flex gap-2 mb-3">
                <input
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveEditName(group.id) }}
                  autoFocus
                />
                <button
                  onClick={() => handleSaveEditName(group.id)}
                  className="px-3 py-2 bg-slate-900 text-white text-sm rounded-lg"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-medium text-slate-900">{group.name}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {matchedFoods.length} food{matchedFoods.length !== 1 ? "s" : ""}
                    {staleFoods.length > 0 && ` · ${staleFoods.length} not in current schedule`}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleStartEdit(group)}
                    className="text-xs text-gray-500 underline"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => handleDeleteGroup(group.id)}
                    className="text-xs text-red-500 underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              {allFoods.map((foodName) => {
                const inThisGroup = group.foodNames.includes(foodName)
                const inOtherGroup = !inThisGroup && claimedBy.has(foodName)
                return (
                  <label
                    key={foodName}
                    className={`flex items-center gap-2 text-sm py-1 ${inOtherGroup ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-slate-900"
                      checked={inThisGroup}
                      disabled={inOtherGroup}
                      onChange={(e) => handleEditToggleFood(group.id, foodName, e.target.checked)}
                    />
                    <span>{foodName}</span>
                    {inOtherGroup && (
                      <span className="text-xs text-gray-400">
                        (in {groups.find((g) => claimedBy.get(foodName) === g.id)?.name})
                      </span>
                    )}
                  </label>
                )
              })}
              {staleFoods.map((name) => (
                <label key={name} className="flex items-center gap-2 text-sm py-1 opacity-40">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-slate-900"
                    checked={true}
                    onChange={(e) => handleEditToggleFood(group.id, name, e.target.checked)}
                  />
                  <span>{name}</span>
                  <span className="text-xs text-gray-400">(not in current schedule)</span>
                </label>
              ))}
            </div>
          </div>
        )
      })}

      {showCreateForm ? (
        <div className="border border-gray-200 rounded-xl p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">New group</p>
          <input
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full mb-3"
            placeholder="Group name (e.g. Jam)"
            value={creatingName}
            onChange={(e) => setCreatingName(e.target.value)}
            autoFocus
          />
          <div className="flex flex-col gap-1 mb-3">
            {allFoods.map((foodName) => {
              const inOtherGroup = claimedBy.has(foodName)
              return (
                <label
                  key={foodName}
                  className={`flex items-center gap-2 text-sm py-1 ${inOtherGroup ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-slate-900"
                    checked={creatingFoods.includes(foodName)}
                    disabled={inOtherGroup}
                    onChange={(e) => handleCreateToggleFood(foodName, e.target.checked)}
                  />
                  <span>{foodName}</span>
                  {inOtherGroup && (
                    <span className="text-xs text-gray-400">
                      (in {groups.find((g) => claimedBy.get(foodName) === g.id)?.name})
                    </span>
                  )}
                </label>
              )
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreateGroup}
              disabled={!creatingName.trim() || creatingFoods.length === 0}
              className="flex-1 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg disabled:opacity-40"
            >
              Create group
            </button>
            <button
              onClick={() => { setShowCreateForm(false); setCreatingName(""); setCreatingFoods([]) }}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setShowCreateForm(true); setEditingId(null) }}
          className="text-sm text-slate-700 underline text-left"
        >
          + New group
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
npm run build
```
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
git add components/GroupsManager.tsx
git commit -m "feat: GroupsManager — create, rename, delete food groups with food picker"
```

---

## Task 6: Settings Page Integration

**Files:**
- Modify: `app/settings/page.tsx`

**Interfaces:**
- Consumes:
  - `fetchFoodGroups`, `saveFoodGroups` from `lib/supabase.ts`
  - `fetchSchedule` from `lib/supabase.ts`
  - `FoodGroup` from `lib/types.ts`
  - `ParsedSchedule` from `lib/types.ts`
  - `GroupsManager` from `components/GroupsManager.tsx`

**Behavior:** On each `GroupsManager` `onChange`, immediately call `saveFoodGroups` (no "Save" button needed for groups — they save independently from other settings). Show a brief "Saved" confirmation inline next to the section header.

- [ ] **Step 1: Update `app/settings/page.tsx`**

Add to imports at the top:
```ts
import {
  getSession,
  fetchSchedule,
  fetchFamilyName,
  fetchAppointmentDate,
  fetchDoseState,
  fetchNotificationSettings,
  fetchFoodGroups,
  saveFamilyName,
  saveAppointmentDate,
  saveDoseState,
  saveBulkCatchUpLog,
  saveNotificationSettings,
  savePushSubscription,
  deletePushSubscription,
  saveFoodGroups,
} from "@/lib/supabase"
import { isNative } from "@/lib/platform"
import { DoseState, ParsedSchedule, FoodGroup } from "@/lib/types"
import GroupsManager from "@/components/GroupsManager"
```

Add state variables after existing state declarations:
```ts
const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
const [foodGroups, setFoodGroups] = useState<FoodGroup[]>([])
const [groupsSaved, setGroupsSaved] = useState(false)
const groupsSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

In the `load` function, add `fetchFoodGroups` and `fetchSchedule` to the parallel fetch:
```ts
const [name, ds, notifSettings, groups, sched] = await Promise.all([
  fetchFamilyName().catch(() => null),
  fetchDoseState().catch(() => null),
  fetchNotificationSettings().catch(() => null),
  fetchFoodGroups().catch(() => []),
  fetchSchedule().catch(() => null),
])
```

After `if (notifSettings) { ... }`, add:
```ts
setFoodGroups(groups)
if (sched) setSchedule(sched)
```

Add the `handleGroupsChange` function after `handleUnsubscribe`:
```ts
async function handleGroupsChange(groups: FoodGroup[]) {
  setFoodGroups(groups)
  try {
    await saveFoodGroups(groups)
    setGroupsSaved(true)
    if (groupsSavedTimerRef.current) clearTimeout(groupsSavedTimerRef.current)
    groupsSavedTimerRef.current = setTimeout(() => setGroupsSaved(false), 2000)
  } catch {
    // Silent fail — state is updated locally; will sync on next load
  }
}
```

Add the Food groups section to the JSX, after the "Re-parse schedule" link section and before `{saveError && ...}`:
```tsx
{schedule && (
  <div className="border-t border-gray-100 pt-5">
    <div className="flex items-center gap-2 mb-3">
      <p className="text-sm font-medium text-gray-700">Food groups</p>
      {groupsSaved && <span className="text-xs text-green-600">Saved</span>}
    </div>
    <GroupsManager
      schedule={schedule}
      groups={foodGroups}
      onChange={handleGroupsChange}
    />
  </div>
)}
```

- [ ] **Step 2: Verify the build compiles clean**

```bash
npm run build
```
Expected: `✓ Compiled successfully` — 14 pages, `/recommended` and `/settings` and `/daily` all present.

- [ ] **Step 3: Deploy to production**

```bash
git add app/settings/page.tsx
git commit -m "feat: Settings — Food groups section with GroupsManager"
vercel --prod
```

- [ ] **Step 4: Smoke check**

```bash
curl -s -o /dev/null -w "%{http_code}" https://tippal.behrman.dev/settings
curl -s -o /dev/null -w "%{http_code}" https://tippal.behrman.dev/daily
```
Expected: both `200`.

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| Groups are user-defined (not parser) | Task 5/6 — GroupsManager in Settings |
| Groups have names | Task 5 — `name` field + rename |
| Every food can be in a group (optional) | Task 5 — all morning foods listed in picker |
| Groups persist across plan changes (food name match) | Task 1 — stored in families JSONB, matched by string |
| Settings screen for management | Task 6 — embedded in /settings |
| Collapsed by default in daily view | Task 2 — `useState(false)` for expanded |
| Tap group row to check all | Task 2 — `handleGroupCheck(!allChecked)` |
| Expand to individual foods | Task 2 — expanded renders individual `FoodItem` rows |
| One food per group | Task 5 — `claimedBy` map disables foods already in another group |
| Foods missing from schedule silently skipped | Task 3 — `buildMorningItems` only resolves foods that exist in schedule |
| Stale group members shown with note in manager | Task 5 — `staleFoods` rendered with "(not in current schedule)" |
| `checked_foods` keys unchanged | Task 2 — groups use the same `morning-{name}` / `morning-weekly-{name}` keys |

### Placeholder Scan

No TBD or TODO phrases found. All code blocks are complete.

### Type Consistency

- `FoodGroup.id: string` — used consistently in Tasks 1, 2, 3, 4, 5, 6
- `FoodGroup.foodNames: string[]` — matched against `MaintenanceFood.name` / `WeeklyFood.name` in Tasks 3, 5
- `foodGroups: FoodGroup[]` prop name — consistent across DailyView (Task 4) and MorningSection (Task 3)
- `fetchFoodGroups` / `saveFoodGroups` — exact names used in Tasks 4, 6 match Task 1 definitions
- `buildMorningItems` return type — `MorningItem[]` with discriminated union — consumed correctly in Task 3 JSX render
