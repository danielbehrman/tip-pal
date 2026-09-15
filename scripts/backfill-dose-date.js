#!/usr/bin/env node
// One-time backfill: populates dose_log.dose_date for every existing row
// from completed_at, using the exact same local-date derivation the app
// has always used to decide "which calendar day is this row for"
// (lib/schedule.ts's formatDateOnly). A raw SQL timezone cast is not safe
// here — it could silently reattribute a historical row to the wrong
// calendar day if it doesn't match what was already shown to the family.
//
// Usage:
//   node scripts/backfill-dose-date.js            (dry run — prints only)
//   node scripts/backfill-dose-date.js --apply     (writes for real)
//
// Dry-run output must be reviewed against known dates for the production
// family (00000000-0000-0000-0000-000000000001) before --apply is ever
// run against production — see this plan's Task 2 Step 5.

const path = require("path")
const fs = require("fs")
const { createClient } = require("@supabase/supabase-js")

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const vars = {}
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx < 1) continue
    vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
  }
  return vars
}

// Mirrors lib/schedule.ts's formatDateOnly exactly — kept in sync manually
// since this script runs outside the Next.js/TS build and can't import a
// .ts module directly. If lib/schedule.ts's formatDateOnly ever changes,
// this must change with it.
function formatDateOnly(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

async function main() {
  const root = path.join(__dirname, "..")
  const envLocal = loadEnvFile(path.join(root, ".env.local"))
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envLocal.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked process.env and .env.local)")
    process.exit(1)
  }

  const apply = process.argv.includes("--apply")
  const client = createClient(url, serviceKey)

  const { data: rows, error } = await client
    .from("dose_log")
    .select("id, family_id, session, completed_at, dose_date")
    .order("completed_at", { ascending: true })
  if (error) {
    console.error("Fetch failed:", error.message)
    process.exit(1)
  }

  console.log(`${rows.length} total dose_log rows. Mode: ${apply ? "APPLY" : "DRY RUN"}`)

  let updated = 0
  let skipped = 0
  // family_id -> dose_date -> [row ids], scoped to session='day' rows only —
  // the same scope as dose_log_family_dose_date_day_idx (the partial unique
  // index Task 3 leaves dormant until this backfill is verified clean), so
  // any group with more than one id here is exactly what that index would
  // hard-fail on if applied. This is the shape the 2026-09-14 incident left:
  // two fragmented 'day' rows for one real evening.
  const dayRowsByFamilyAndDate = new Map()
  for (const row of rows) {
    const computedDoseDate = formatDateOnly(new Date(row.completed_at))
    if (row.dose_date === computedDoseDate) {
      skipped++
    } else {
      console.log(`${row.id}: completed_at=${row.completed_at} -> dose_date=${computedDoseDate} (was ${row.dose_date ?? "null"})`)
      if (apply) {
        const { error: updateError } = await client
          .from("dose_log")
          .update({ dose_date: computedDoseDate })
          .eq("id", row.id)
        if (updateError) {
          console.error(`  FAILED to update ${row.id}:`, updateError.message)
          process.exit(1)
        }
      }
      updated++
    }

    if (row.session !== "day") continue
    const familyKey = dayRowsByFamilyAndDate.get(row.family_id) ?? new Map()
    dayRowsByFamilyAndDate.set(row.family_id, familyKey)
    const ids = familyKey.get(computedDoseDate) ?? []
    ids.push(row.id)
    familyKey.set(computedDoseDate, ids)
  }

  console.log(`${apply ? "Updated" : "Would update"}: ${updated}. Already correct: ${skipped}.`)

  let collisionCount = 0
  for (const [familyId, byDate] of dayRowsByFamilyAndDate) {
    for (const [doseDate, ids] of byDate) {
      if (ids.length <= 1) continue
      collisionCount++
      console.log(`COLLISION: family_id=${familyId} dose_date=${doseDate} rows=${ids.join(", ")}`)
    }
  }
  if (collisionCount > 0) {
    console.log(`${collisionCount} dose_date collision(s) found — resolve these before applying the NOT NULL/unique index migration (20260915_dose_log_dose_date_constraint.sql).`)
  } else {
    console.log("No dose_date collisions found among session='day' rows.")
  }
}

main()
