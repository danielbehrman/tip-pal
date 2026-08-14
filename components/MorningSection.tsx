"use client"

import { ParsedSchedule, FoodGroup, MaintenanceFood, WeeklyFood, Medication, RampDoseOverride } from "@/lib/types"
import { getMedicationSessions } from "@/lib/schedule"
import FoodItem from "./FoodItem"
import FoodGroupRow from "./FoodGroupRow"
import SectionHeader from "./ui/SectionHeader"

interface MorningSectionProps {
  schedule: ParsedSchedule
  currentDay: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
  isFutureDay: boolean
  foodGroups: FoodGroup[]
  maintenanceRampOverrides?: Map<string, RampDoseOverride>
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
  const foodToGroup = new Map<string, FoodGroup>()
  for (const group of groups) {
    for (const name of group.foodNames) foodToGroup.set(name, group)
  }

  const groupFoodsMap = new Map<string, Array<{ food: MaintenanceFood | WeeklyFood; prefix: "morning" | "morning-weekly" }>>()
  const emittedGroups = new Set<string>()

  function getGroupFoods(group: FoodGroup) {
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

  for (const food of maintenanceFoods) {
    const group = foodToGroup.get(food.name)
    if (group) {
      if (!emittedGroups.has(group.id)) {
        emittedGroups.add(group.id)
        const foods = getGroupFoods(group)
        if (foods.length > 0) items.push({ type: "group", group, foods })
      }
    } else {
      items.push({ type: "standalone", food, prefix: "morning" })
    }
  }

  if (showWeekly) {
    for (const food of weeklyFoods) {
      const group = foodToGroup.get(food.name)
      if (group) {
        if (!emittedGroups.has(group.id)) {
          emittedGroups.add(group.id)
          const foods = getGroupFoods(group)
          if (foods.length > 0) items.push({ type: "group", group, foods })
        }
      } else {
        items.push({ type: "weekly", food, prefix: "morning-weekly" })
      }
    }
  }

  return items
}

function getMorningMedications(medications: Medication[] | undefined): Medication[] {
  if (!medications?.length) return []
  return medications.filter(med => getMedicationSessions(med.frequency).includes("morning"))
}

export default function MorningSection({
  schedule,
  currentDay,
  checkedFoods,
  onCheck,
  isFutureDay,
  foodGroups,
  maintenanceRampOverrides = new Map(),
}: MorningSectionProps) {
  const showWeekly = currentDay === 7
  const items = buildMorningItems(
    schedule.maintenanceFoods,
    schedule.weeklyFoods,
    showWeekly,
    foodGroups
  )
  const morningMeds = getMorningMedications(schedule.medications)

  // Count: all food items (groups count as 1) + medications
  const itemCount = items.length + morningMeds.length

  return (
    <section className="mb-5">
      <SectionHeader session="morning" label="Morning" count={itemCount} />
      <div>
        {items.map(item => {
          if (item.type === "group") {
            return (
              <FoodGroupRow
                key={`group-${item.group.id}`}
                group={item.group}
                foods={item.foods}
                checkedFoods={checkedFoods}
                disabled={isFutureDay}
                onCheck={onCheck}
                maintenanceRampOverrides={maintenanceRampOverrides}
              />
            )
          }
          const isWeekly = item.type === "weekly"
          const key = `${item.prefix}-${item.food.name}`
          const rampOverride = item.type === "standalone" ? maintenanceRampOverrides.get(item.food.name) : undefined
          return (
            <FoodItem
              key={key}
              name={item.food.name}
              dose={rampOverride?.dose ?? item.food.dose}
              unit={rampOverride?.unit ?? item.food.unit}
              prepNote={item.food.prepNote ?? null}
              capped={"capped" in item.food ? item.food.capped : false}
              session="morning"
              isWeekly={isWeekly}
              isContinuing={false}
              checked={!!checkedFoods[key]}
              disabled={isFutureDay}
              onChange={val => onCheck(key, val)}
            />
          )
        })}
        {morningMeds.map(med => {
          const key = `morning-med-${med.name}`
          return (
            <FoodItem
              key={key}
              name={med.name}
              dose={med.dose}
              unit={med.unit}
              prepNote={null}
              capped={false}
              session="med"
              checked={!!checkedFoods[key]}
              disabled={isFutureDay}
              onChange={val => onCheck(key, val)}
            />
          )
        })}
      </div>
    </section>
  )
}
