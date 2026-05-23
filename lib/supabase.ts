import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { ParsedSchedule, DoseState } from "./types"

let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) throw new Error("Supabase env vars not set")
    _client = createClient(url, key)
  }
  return _client
}

export function getMvpFamilyId(): string {
  const id = process.env.NEXT_PUBLIC_MVP_FAMILY_ID
  if (!id) throw new Error("NEXT_PUBLIC_MVP_FAMILY_ID is not set")
  return id
}

export async function fetchSchedule(): Promise<ParsedSchedule | null> {
  const familyId = getMvpFamilyId()
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
  const familyId = getMvpFamilyId()
  const { error } = await getClient()
    .from("schedules")
    .upsert(
      { family_id: familyId, parsed_data: schedule, updated_at: new Date().toISOString() },
      { onConflict: "family_id" }
    )
  if (error) throw error
}

export async function fetchDoseState(): Promise<DoseState | null> {
  const familyId = getMvpFamilyId()
  const { data, error } = await getClient()
    .from("dose_state")
    .select("current_week, current_day, checked_foods")
    .eq("family_id", familyId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    currentWeek: data.current_week,
    currentDay: data.current_day,
    checkedFoods: data.checked_foods as Record<string, boolean>,
  }
}

export async function saveDoseState(state: DoseState): Promise<void> {
  const familyId = getMvpFamilyId()
  const { error } = await getClient()
    .from("dose_state")
    .upsert(
      {
        family_id: familyId,
        current_week: state.currentWeek,
        current_day: state.currentDay,
        checked_foods: state.checkedFoods,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "family_id" }
    )
  if (error) throw error
}
