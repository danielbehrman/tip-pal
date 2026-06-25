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
