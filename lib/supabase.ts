import { createClient, SupabaseClient, Session } from "@supabase/supabase-js"
import { ParsedSchedule, DoseState, DoseLogDay, DayRecord, FoodGroup, FoodProgress, TreatmentFood } from "./types"
import { getCalendarPosition, todayDateString } from "./schedule"

// Captured at module evaluation time so Turbopack can inline them as literals
// during static export builds — process.env is not available at runtime in Capacitor.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

let _client: SupabaseClient | null = null

export function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  }
  return _client
}

export async function getSession(): Promise<Session | null> {
  const { data: { session } } = await getClient().auth.getSession()
  return session
}

export async function signOut(): Promise<void> {
  const { error } = await getClient().auth.signOut()
  if (error) throw error
}

async function getFamilyId(): Promise<string> {
  const { data: { session }, error: sessionError } = await getClient().auth.getSession()
  if (sessionError || !session) throw new Error("Not authenticated")
  const { data, error } = await getClient()
    .from("profiles")
    .select("family_id")
    .eq("id", session.user.id)
    .single()
  if (error || !data) throw new Error("Profile not found for authenticated user")
  return data.family_id as string
}

export async function fetchSchedule(): Promise<ParsedSchedule | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("schedules")
    .select("parsed_data")
    .eq("family_id", familyId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return data.parsed_data as ParsedSchedule
}

export async function saveSchedule(schedule: ParsedSchedule): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("schedules")
    .upsert(
      { family_id: familyId, parsed_data: schedule, updated_at: new Date().toISOString() },
      { onConflict: "family_id" }
    )
  if (error) throw error
}

export async function fetchDoseState(): Promise<DoseState | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_state")
    .select("checked_foods, completed_days, morning_skipped, evening_skipped, cycle_start_date, skip_count, floor_week, floor_day, recommended_food_counts")
    .eq("family_id", familyId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const cycleStartDate = data.cycle_start_date as string
  const skipCount = (data.skip_count as number) ?? 0
  const { week, day } = getCalendarPosition(cycleStartDate, skipCount)
  return {
    currentWeek: week,
    currentDay: day,
    checkedFoods: data.checked_foods as Record<string, boolean>,
    completedDays: (data.completed_days ?? {}) as Record<string, Record<string, boolean>>,
    morningSkipped: data.morning_skipped ?? false,
    eveningSkipped: data.evening_skipped ?? false,
    cycleStartDate,
    skipCount,
    floorWeek: (data.floor_week as number) ?? 1,
    floorDay: (data.floor_day as number) ?? 1,
    recommendedFoodCounts: (data.recommended_food_counts ?? {}) as Record<string, Record<string, number>>,
  }
}

export async function saveRecommendedGiven(counts: Record<string, Record<string, number>>): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_state")
    .update({
      recommended_food_counts: counts,
      updated_at: new Date().toISOString(),
    })
    .eq("family_id", familyId)
  if (error) throw error
}

export async function fetchFamilyName(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("name")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return (data.name as string | null) || null
}

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

export async function saveFamilyConfig(
  name: string,
  appointmentDate: string | null
): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ name, next_appointment_date: appointmentDate })
    .eq("id", familyId)
  if (error) throw error
}

export async function saveFamilyName(name: string): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ name })
    .eq("id", familyId)
  if (error) throw error
}

export async function saveBulkCatchUpLog(toWeek: number, toDay: number): Promise<void> {
  const familyId = await getFamilyId()
  const now = new Date().toISOString()
  const rows: object[] = []
  for (let w = 1; w <= toWeek; w++) {
    const maxDay = w === toWeek ? toDay - 1 : 7
    for (let d = 1; d <= maxDay; d++) {
      rows.push({
        family_id: familyId,
        week: w,
        day: d,
        session: "day",
        checked_foods: {},
        completed_at: now,
        is_skipped: false,
      })
    }
  }
  if (rows.length === 0) return
  const { error } = await getClient().from("dose_log").insert(rows)
  if (error) throw error
}

export async function fetchAppointmentDate(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("next_appointment_date")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return data.next_appointment_date as string | null
}

export async function saveAppointmentDate(date: string | null): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ next_appointment_date: date })
    .eq("id", familyId)
  if (error) throw error
}

export async function saveSkipLog(
  week: number,
  day: number,
  session: "morning" | "evening"
): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_log")
    .insert({
      family_id: familyId,
      week,
      day,
      session,
      checked_foods: {},
      completed_at: new Date().toISOString(),
      is_skipped: true,
    })
  if (error) throw error
}

export async function saveDoseLog(
  week: number,
  day: number,
  checkedFoods: Record<string, boolean>,
  completedAt: string,
  scheduleSnapshot: object
): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_log")
    .insert({
      family_id: familyId,
      week,
      day,
      session: "day",
      checked_foods: checkedFoods,
      completed_at: completedAt,
      is_skipped: false,
      schedule_snapshot: scheduleSnapshot,
    })
  if (error) throw error
}

export async function saveSkipDay(week: number, day: number): Promise<void> {
  const familyId = await getFamilyId()
  const { error: logError } = await getClient()
    .from("dose_log")
    .insert({
      family_id: familyId,
      week,
      day,
      session: "day",
      checked_foods: {},
      completed_at: new Date().toISOString(),
      is_skipped: true,
    })
  if (logError) throw logError

  const { error: incrementError } = await getClient().rpc("increment_skip_count", {
    p_family_id: familyId,
  })
  if (incrementError) throw incrementError
}

export async function fetchCompletedPositions(): Promise<Set<string>> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("week, day")
    .eq("family_id", familyId)
    .eq("session", "day")
  if (error) throw error
  const set = new Set<string>()
  for (const row of data ?? []) {
    set.add(`${row.week as number}-${row.day as number}`)
  }
  return set
}

export async function fetchDayRecords(): Promise<Map<string, DayRecord>> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("week, day, completed_at, is_skipped")
    .eq("family_id", familyId)
    .eq("session", "day")
    .order("completed_at", { ascending: true })
  if (error) throw error
  const map = new Map<string, DayRecord>()
  for (const row of data ?? []) {
    // ascending order: last row per position wins (most recent) — see Design Note above
    map.set(`${row.week as number}-${row.day as number}`, {
      date: row.completed_at as string,
      skipped: row.is_skipped as boolean,
    })
  }
  return map
}

export async function fetchDateHasDayRecord(dateStr: string): Promise<boolean> {
  const familyId = await getFamilyId()
  const { count, error } = await getClient()
    .from("dose_log")
    .select("*", { count: "exact", head: true })
    .eq("family_id", familyId)
    .eq("session", "day")
    .gte("completed_at", `${dateStr}T00:00:00`)
    .lt("completed_at", `${dateStr}T23:59:59.999`)
  if (error) throw error
  return (count ?? 0) > 0
}

export async function fetchRecentCompletedDays(): Promise<DoseLogDay[]> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("id, week, day, session, checked_foods, completed_at, is_skipped, schedule_snapshot")
    .eq("family_id", familyId)
    .order("completed_at", { ascending: false })
    .limit(50)
  if (error) throw error
  if (!data) return []
  const completedDayRows = data.filter(r => r.session === "day" && !r.is_skipped)
  const topThree = completedDayRows.slice(0, 3)
  return topThree.map(dayRow => ({
    id: dayRow.id as string,
    week: dayRow.week as number,
    day: dayRow.day as number,
    completedAt: dayRow.completed_at as string,
    checkedFoods: (dayRow.checked_foods ?? {}) as Record<string, boolean>,
    scheduleSnapshot: (dayRow.schedule_snapshot ?? null) as import("./types").ParsedSchedule | null,
    morningSkipped: data.some(
      r => r.week === dayRow.week && r.day === dayRow.day && r.session === "morning" && r.is_skipped
    ),
    eveningSkipped: data.some(
      r => r.week === dayRow.week && r.day === dayRow.day && r.session === "evening" && r.is_skipped
    ),
  }))
}

export async function fetchAllDoseLogDays(): Promise<DoseLogDay[]> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("id, week, day, session, checked_foods, completed_at, is_skipped, schedule_snapshot")
    .eq("family_id", familyId)
    .order("completed_at", { ascending: false })
    .limit(500)
  if (error) throw error
  if (!data) return []
  const completedDayRows = data.filter(r => r.session === "day" && !r.is_skipped)
  return completedDayRows.map(dayRow => ({
    id: dayRow.id as string,
    week: dayRow.week as number,
    day: dayRow.day as number,
    completedAt: dayRow.completed_at as string,
    checkedFoods: (dayRow.checked_foods ?? {}) as Record<string, boolean>,
    scheduleSnapshot: (dayRow.schedule_snapshot ?? null) as import("./types").ParsedSchedule | null,
    morningSkipped: data.some(
      r => r.week === dayRow.week && r.day === dayRow.day && r.session === "morning" && r.is_skipped
    ),
    eveningSkipped: data.some(
      r => r.week === dayRow.week && r.day === dayRow.day && r.session === "evening" && r.is_skipped
    ),
  }))
}

export async function updateDoseLogCheckedFoods(
  id: string,
  checkedFoods: Record<string, boolean>
): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_log")
    .update({ checked_foods: checkedFoods })
    .eq("id", id)
    .eq("family_id", familyId)
  if (error) throw error
}

export async function savePushSubscription(sub: {
  endpoint: string
  p256dh: string
  auth: string
}): Promise<void> {
  const familyId = await getFamilyId()
  const { data: { session } } = await getClient().auth.getSession()
  if (!session) throw new Error("Not authenticated")
  const { error } = await getClient()
    .from("push_subscriptions")
    .upsert(
      { user_id: session.user.id, family_id: familyId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { onConflict: "user_id,endpoint" }
    )
  if (error) throw error
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const { data: { session } } = await getClient().auth.getSession()
  if (!session) return
  const { error } = await getClient()
    .from("push_subscriptions")
    .delete()
    .eq("user_id", session.user.id)
    .eq("endpoint", endpoint)
  if (error) throw error
}

export async function fetchNotificationSettings(): Promise<{
  morningReminder: string
  eveningReminder: string
  timezone: string
}> {
  const { data: { session } } = await getClient().auth.getSession()
  if (!session) throw new Error("Not authenticated")
  const { data, error } = await getClient()
    .from("profiles")
    .select("morning_reminder, evening_reminder, reminder_timezone")
    .eq("id", session.user.id)
    .single()
  if (error) throw error
  return {
    morningReminder: (data.morning_reminder as string | null)?.slice(0, 5) ?? "08:00",
    eveningReminder: (data.evening_reminder as string | null)?.slice(0, 5) ?? "18:00",
    timezone: (data.reminder_timezone as string | null) ?? "America/New_York",
  }
}

export async function saveTimezone(timezone: string): Promise<void> {
  const { data: { session } } = await getClient().auth.getSession()
  if (!session) return
  await getClient()
    .from("profiles")
    .update({ reminder_timezone: timezone })
    .eq("id", session.user.id)
}

export async function saveNotificationSettings(
  morningReminder: string,
  eveningReminder: string,
  timezone: string
): Promise<void> {
  const { data: { session } } = await getClient().auth.getSession()
  if (!session) throw new Error("Not authenticated")
  const { error } = await getClient()
    .from("profiles")
    .update({ morning_reminder: morningReminder, evening_reminder: eveningReminder, reminder_timezone: timezone })
    .eq("id", session.user.id)
  if (error) throw error
}

export async function saveCheckedState(
  checkedFoods: Record<string, boolean>,
  completedDays: Record<string, Record<string, boolean>>
): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_state")
    .update({
      checked_foods: checkedFoods,
      completed_days: completedDays,
      updated_at: new Date().toISOString(),
    })
    .eq("family_id", familyId)
  if (error) throw error
}

export async function saveDoseState(state: DoseState): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_state")
    .upsert(
      {
        family_id: familyId,
        current_week: state.currentWeek,
        current_day: state.currentDay,
        checked_foods: state.checkedFoods,
        completed_days: state.completedDays ?? {},
        morning_skipped: state.morningSkipped ?? false,
        evening_skipped: state.eveningSkipped ?? false,
        cycle_start_date: state.cycleStartDate,
        skip_count: state.skipCount,
        floor_week: state.floorWeek,
        floor_day: state.floorDay,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "family_id" }
    )
  if (error) throw error
}

export async function fetchVisitNumber(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("visit_number")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return (data.visit_number as string | null) ?? null
}

export async function archiveAndStartNewCycle(
  currentSchedule: ParsedSchedule | null,
  newSchedule: ParsedSchedule,
  visitNumber: string | null,
  newAppointmentDate: string | null
): Promise<void> {
  const familyId = await getFamilyId()

  // 1. Read current previous_cycles array
  const { data: familyData, error: familyReadError } = await getClient()
    .from("families")
    .select("previous_cycles")
    .eq("id", familyId)
    .single()
  if (familyReadError) throw familyReadError

  const existingCycles = (familyData.previous_cycles ?? []) as object[]
  const archivedEntry = currentSchedule
    ? { schedule: currentSchedule, archivedAt: new Date().toISOString() }
    : null
  const newCycles = archivedEntry ? [...existingCycles, archivedEntry] : existingCycles

  // 2. Update families: archive, visit number, appointment date
  const { error: familyUpdateError } = await getClient()
    .from("families")
    .update({
      previous_cycles: newCycles,
      visit_number: visitNumber,
      next_appointment_date: newAppointmentDate,
    })
    .eq("id", familyId)
  if (familyUpdateError) throw familyUpdateError

  // 3. Replace schedule
  const { error: scheduleError } = await getClient()
    .from("schedules")
    .upsert(
      { family_id: familyId, parsed_data: newSchedule, updated_at: new Date().toISOString() },
      { onConflict: "family_id" }
    )
  if (scheduleError) throw scheduleError

  // 4. Reset dose_state
  const today = todayDateString()
  const { error: doseError } = await getClient()
    .from("dose_state")
    .upsert(
      {
        family_id: familyId,
        current_week: 1,
        current_day: 1,
        checked_foods: {},
        completed_days: {},
        morning_skipped: false,
        evening_skipped: false,
        cycle_start_date: today,
        skip_count: 0,
        floor_week: 1,
        floor_day: 1,
        recommended_food_counts: {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "family_id" }
    )
  if (doseError) throw doseError
}

export async function fetchFoodProgress(): Promise<Map<string, FoodProgress>> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("treatment_food_progress")
    .select("food_name, week, day, completed_days, last_completed_at")
    .eq("family_id", familyId)
  if (error) throw error
  const map = new Map<string, FoodProgress>()
  for (const row of data ?? []) {
    map.set(row.food_name as string, {
      foodName: row.food_name as string,
      week: row.week as number,
      day: row.day as number,
      completedDays: row.completed_days as number,
      lastCompletedAt: row.last_completed_at as string | null,
    })
  }
  return map
}

export async function saveFoodProgress(
  progress: Map<string, FoodProgress>
): Promise<void> {
  const familyId = await getFamilyId()
  const now = new Date().toISOString()
  const rows = [...progress.values()].map(fp => ({
    family_id: familyId,
    food_name: fp.foodName,
    week: fp.week,
    day: fp.day,
    completed_days: fp.completedDays,
    last_completed_at: fp.lastCompletedAt,
    updated_at: now,
  }))
  const { error } = await getClient()
    .from("treatment_food_progress")
    .upsert(rows, { onConflict: "family_id,food_name" })
  if (error) throw error
}

export async function seedFoodProgress(
  treatmentFoods: TreatmentFood[],
  week: number,
  day: number
): Promise<Map<string, FoodProgress>> {
  const progress = new Map<string, FoodProgress>()
  for (const food of treatmentFoods) {
    progress.set(food.name, {
      foodName: food.name,
      week,
      day,
      completedDays: day - 1,
      lastCompletedAt: null,
    })
  }
  await saveFoodProgress(progress)
  return progress
}

export async function resetFoodProgress(week: number, day: number): Promise<void> {
  const familyId = await getFamilyId()
  const { data: existing, error: fetchError } = await getClient()
    .from("treatment_food_progress")
    .select("food_name")
    .eq("family_id", familyId)
  if (fetchError) throw fetchError
  if (!existing || existing.length === 0) return
  const now = new Date().toISOString()
  const rows = existing.map(row => ({
    family_id: familyId,
    food_name: row.food_name as string,
    week,
    day,
    completed_days: day - 1,
    last_completed_at: null as string | null,
    updated_at: now,
  }))
  const { error } = await getClient()
    .from("treatment_food_progress")
    .upsert(rows, { onConflict: "family_id,food_name" })
  if (error) throw error
}
