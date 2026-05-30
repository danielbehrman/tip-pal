import { createClient, SupabaseClient, Session } from "@supabase/supabase-js"
import { ParsedSchedule, DoseState, DoseLogDay } from "./types"

let _client: SupabaseClient | null = null

export function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) throw new Error("Supabase env vars not set")
    _client = createClient(url, key)
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
    .select("current_week, current_day, checked_foods, completed_days, morning_skipped, evening_skipped")
    .eq("family_id", familyId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    currentWeek: data.current_week,
    currentDay: data.current_day,
    checkedFoods: data.checked_foods as Record<string, boolean>,
    completedDays: (data.completed_days ?? {}) as Record<string, Record<string, boolean>>,
    morningSkipped: data.morning_skipped ?? false,
    eveningSkipped: data.evening_skipped ?? false,
  }
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

export async function saveFamilyConfig(
  name: string,
  appointmentDate: string | null
): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .upsert(
      { id: familyId, name, next_appointment_date: appointmentDate },
      { onConflict: "id" }
    )
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

export async function fetchLastDay7Completion(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("completed_at")
    .eq("family_id", familyId)
    .eq("day", 7)
    .eq("is_skipped", false)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return data.completed_at as string
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
  completedAt: string
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
    })
  if (error) throw error
}

export async function fetchCompletedPositions(): Promise<Set<string>> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("week, day")
    .eq("family_id", familyId)
    .eq("is_skipped", false)
  if (error) throw error
  const set = new Set<string>()
  for (const row of data ?? []) {
    set.add(`${row.week as number}-${row.day as number}`)
  }
  return set
}

export async function countCompletedDaysInWeek(week: number): Promise<number> {
  const familyId = await getFamilyId()
  const { count, error } = await getClient()
    .from("dose_log")
    .select("*", { count: "exact", head: true })
    .eq("family_id", familyId)
    .eq("week", week)
    .eq("is_skipped", false)
  if (error) throw error
  return count ?? 0
}

export async function fetchRecentCompletedDays(): Promise<DoseLogDay[]> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("id, week, day, session, checked_foods, completed_at, is_skipped")
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
    .select("id, week, day, session, checked_foods, completed_at, is_skipped")
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
        updated_at: new Date().toISOString(),
      },
      { onConflict: "family_id" }
    )
  if (error) throw error
}
