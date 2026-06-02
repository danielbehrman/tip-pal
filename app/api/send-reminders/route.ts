import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import webpush from "web-push"


if (process.env.VAPID_SUBJECT && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

function currentHHMM(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date())
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00"
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00"
  return `${hour}:${minute}`
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Service role key not configured" }, { status: 500 })
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: subs, error: subsError } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth, user_id, family_id")

  if (subsError) return NextResponse.json({ error: subsError.message }, { status: 500 })
  if (!subs?.length) return NextResponse.json({ sent: 0 })

  const userIds = [...new Set(subs.map((s) => s.user_id as string))]
  const familyIds = [...new Set(subs.map((s) => s.family_id as string))]

  const [{ data: profiles }, { data: families }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, morning_reminder, evening_reminder, reminder_timezone")
      .in("id", userIds),
    supabaseAdmin
      .from("families")
      .select("id, name")
      .in("id", familyIds),
  ])

  const profileMap = Object.fromEntries((profiles ?? []).map((p) => [p.id as string, p]))
  const familyMap = Object.fromEntries((families ?? []).map((f) => [f.id as string, f]))

  let sent = 0
  for (const sub of subs) {
    const profile = profileMap[sub.user_id as string]
    const family = familyMap[sub.family_id as string]
    if (!profile) continue

    const tz = (profile.reminder_timezone as string | null) ?? "America/New_York"
    const hhmm = currentHHMM(tz)
    const morning = (profile.morning_reminder as string | null)?.slice(0, 5)
    const evening = (profile.evening_reminder as string | null)?.slice(0, 5)
    const familyName = (family?.name as string | null) ?? "your child"

    let body: string | null = null
    if (morning === hhmm) body = `Time for ${familyName}'s morning dose`
    else if (evening === hhmm) body = `Time for ${familyName}'s evening dose`
    if (!body) continue

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint as string, keys: { p256dh: sub.p256dh as string, auth: sub.auth as string } },
        JSON.stringify({ title: "TIP Pal", body, url: "/daily" })
      )
      sent++
    } catch {
      // Subscription expired — could prune here in the future
    }
  }

  return NextResponse.json({ sent })
}
