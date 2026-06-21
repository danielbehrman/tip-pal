// scripts/verify-position-formula.js
// Manual regression check for the calendar-position formula (no test framework in this repo).
// Run: node scripts/verify-position-formula.js

const MS_PER_DAY = 1000 * 60 * 60 * 24

function parseDateOnly(s) {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}
function formatDateOnly(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
function addDays(dateStr, n) {
  const d = parseDateOnly(dateStr)
  d.setDate(d.getDate() + n)
  return formatDateOnly(d)
}
function positionIndexOf(week, day) {
  return (week - 1) * 7 + (day - 1)
}
function positionFromIndex(index) {
  return { week: Math.floor(index / 7) + 1, day: (index % 7) + 1 }
}
function getCalendarPosition(cycleStartDate, skipCount, asOfDateStr) {
  const start = parseDateOnly(cycleStartDate)
  const asOf = parseDateOnly(asOfDateStr)
  const dayIndex = Math.round((asOf.getTime() - start.getTime()) / MS_PER_DAY)
  const positionIndex = Math.max(0, dayIndex - skipCount)
  return positionFromIndex(positionIndex)
}

let failures = 0
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures++
    console.error(`FAIL ${label}: expected ${e}, got ${a}`)
  } else {
    console.log(`PASS ${label}`)
  }
}

// cycle_start_date = 2026-01-01 (Day 1). No skips.
assertEqual(getCalendarPosition("2026-01-01", 0, "2026-01-01"), { week: 1, day: 1 }, "day 1, no skip")
assertEqual(getCalendarPosition("2026-01-01", 0, "2026-01-08"), { week: 2, day: 1 }, "day 8 rolls to week 2 day 1")
assertEqual(getCalendarPosition("2026-01-01", 0, "2026-01-07"), { week: 1, day: 7 }, "day 7 stays week 1")

// Spec example: cycle starts such that 2026-06-13 (Sat) = Week 3, Day 2 (positionIndex 15).
// cycle_start_date = 2026-06-13 - 15 days = 2026-05-29.
const start = "2026-05-29"
assertEqual(getCalendarPosition(start, 0, "2026-06-13"), { week: 3, day: 2 }, "Saturday pre-skip = W3D2")
// Skip happens on Saturday (2026-06-13) -> skip_count becomes 1 from Sunday onward.
assertEqual(getCalendarPosition(start, 1, "2026-06-14"), { week: 3, day: 2 }, "Sunday repeats W3D2 after skip")
assertEqual(getCalendarPosition(start, 1, "2026-06-15"), { week: 3, day: 3 }, "Monday advances to W3D3")

if (failures > 0) {
  console.error(`${failures} failure(s)`)
  process.exit(1)
}
console.log("All formula checks passed")
