import { createClient, SupabaseClient, Session } from "@supabase/supabase-js"
import { ParsedSchedule, DoseState, DoseLogDay, DayRecord, FoodGroup, FoodProgress, ReactionRamp, PreviousRamp } from "./types"
import { getCalendarPosition, todayDateString, addDays, formatDateOnly } from "./schedule"

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
    .select("child_name, name")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return (data.child_name as string | null) || (data.name as string | null) || null
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
    .update({ name, child_name: name, next_appointment_date: appointmentDate })
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

export async function saveChildName(name: string): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ child_name: name })
    .eq("id", familyId)
  if (error) throw error
}

export async function uploadChildPhoto(file: File): Promise<string> {
  const familyId = await getFamilyId()
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""
  const form = new FormData()
  form.append("file", file)
  form.append("familyId", familyId)
  const res = await fetch(`${apiBase}/api/upload-photo`, { method: "POST", body: form })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error ?? "Upload failed")
  return data.url as string
}

export async function saveChildPhotoUrl(url: string): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ child_photo_url: url })
    .eq("id", familyId)
  if (error) throw error
}

export async function fetchChildPhotoUrl(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("child_photo_url")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return (data.child_photo_url as string | null) || null
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

export async function fetchFliesToAppointments(): Promise<boolean> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("flies_to_appointments")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return data.flies_to_appointments as boolean
}

export async function saveFliesToAppointments(value: boolean): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ flies_to_appointments: value })
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
  scheduleSnapshot: object,
  isSkipped: boolean,
  rampActive: boolean
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
      is_skipped: isSkipped,
      schedule_snapshot: scheduleSnapshot,
      ramp_active: rampActive,
    })
  if (error) throw error
}

export async function saveSkipMorning(week: number, day: number): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_log")
    .insert({
      family_id: familyId,
      week,
      day,
      session: "morning",
      is_skipped: true,
      checked_foods: {},
      completed_at: new Date().toISOString(),
    })
  if (error) throw error
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

export async function fetchLastLoggedDate(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("completed_at")
    .eq("family_id", familyId)
    .eq("session", "day")
    .order("completed_at", { ascending: false })
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) return null
  return (data[0].completed_at as string).slice(0, 10)
}

export async function fetchDoseLogDaysInRange(startDate: string, endDate: string): Promise<DoseLogDay[]> {
  const familyId = await getFamilyId()
  // Widen the query bounds by a day on each side to catch rows whose UTC
  // completed_at falls just outside [startDate, endDate] but whose LOCAL
  // calendar date (the public contract of this function) falls within it —
  // e.g. a dose logged at 6:30pm PDT has a UTC completed_at on the next day.
  const queryStart = addDays(startDate, -1)
  const queryEnd = addDays(endDate, 1)
  const { data, error } = await getClient()
    .from("dose_log")
    .select("id, week, day, session, checked_foods, completed_at, is_skipped, schedule_snapshot")
    .eq("family_id", familyId)
    .gte("completed_at", `${queryStart}T00:00:00.000Z`)
    .lte("completed_at", `${queryEnd}T23:59:59.999Z`)
    .order("completed_at", { ascending: false })
  if (error) throw error
  if (!data) return []
  const dayRows = data.filter(r => {
    if (r.session !== "day") return false
    const localDate = formatDateOnly(new Date(r.completed_at as string))
    return localDate >= startDate && localDate <= endDate
  })
  return dayRows.map(dayRow => ({
    id: dayRow.id as string,
    week: dayRow.week as number,
    day: dayRow.day as number,
    completedAt: dayRow.completed_at as string,
    checkedFoods: (dayRow.checked_foods ?? {}) as Record<string, boolean>,
    scheduleSnapshot: (dayRow.schedule_snapshot ?? null) as ParsedSchedule | null,
    morningSkipped: data.some(
      r => r.week === dayRow.week && r.day === dayRow.day && r.session === "morning" && r.is_skipped
    ),
    eveningSkipped: data.some(
      r => r.week === dayRow.week && r.day === dayRow.day && r.session === "evening" && r.is_skipped
    ),
  }))
}

export async function fetchEarliestDoseLogDate(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("completed_at")
    .eq("family_id", familyId)
    .eq("session", "day")
    .order("completed_at", { ascending: true })
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) return null
  return formatDateOnly(new Date(data[0].completed_at as string))
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

export async function deleteDoseLogDays(ids: string[]): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_log")
    .delete()
    .eq("family_id", familyId)
    .in("id", ids)
  if (error) throw error
}

export async function deleteAllDoseLogDays(): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_log")
    .delete()
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

export async function saveVisitNumber(visitNumber: string | null): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ visit_number: visitNumber })
    .eq("id", familyId)
  if (error) throw error
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

  // 2. Update families: archive, visit number, appointment date, and clear
  // any active reaction ramp — a new cycle means the old cycle's exceptions
  // no longer apply (silent, same as the treatment_food_progress/dose_state
  // resets below).
  const clearedRamp: ReactionRamp = {
    active: false,
    startedAt: "",
    rampDay: 0,
    startedAtWeek: 0,
    startedAtDay: 0,
    treatmentFoods: [],
    maintenanceFoods: [],
  }
  const { error: familyUpdateError } = await getClient()
    .from("families")
    .update({
      previous_cycles: newCycles,
      visit_number: visitNumber,
      next_appointment_date: newAppointmentDate,
      reaction_ramp: clearedRamp,
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
  entries: { foodName: string; week: number; day: number }[]
): Promise<Map<string, FoodProgress>> {
  const progress = new Map<string, FoodProgress>()
  for (const entry of entries) {
    progress.set(entry.foodName, {
      foodName: entry.foodName,
      week: entry.week,
      day: entry.day,
      completedDays: entry.day - 1,
      lastCompletedAt: null,
    })
  }
  await saveFoodProgress(progress)
  return progress
}

export async function clearFoodProgress(): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("treatment_food_progress")
    .delete()
    .eq("family_id", familyId)
  if (error) throw error
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

export async function fetchReactionRamp(): Promise<ReactionRamp | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("reaction_ramp")
    .eq("id", familyId)
    .single()
  if (error) throw error
  const ramp = data.reaction_ramp as ReactionRamp | { active: false }
  if (!ramp || !ramp.active) return null
  return ramp as ReactionRamp
}

export async function saveReactionRamp(ramp: ReactionRamp): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ reaction_ramp: ramp })
    .eq("id", familyId)
  if (error) throw error
}

export async function appendPreviousRamp(entry: PreviousRamp): Promise<void> {
  const familyId = await getFamilyId()
  const { data: familyData, error: readError } = await getClient()
    .from("families")
    .select("previous_ramps")
    .eq("id", familyId)
    .single()
  if (readError) throw readError
  const existing = (familyData.previous_ramps ?? []) as PreviousRamp[]
  if (existing.some(r => r.startedAt === entry.startedAt)) return
  const { error: writeError } = await getClient()
    .from("families")
    .update({ previous_ramps: [...existing, entry] })
    .eq("id", familyId)
  if (writeError) throw writeError
}
