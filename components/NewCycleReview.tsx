"use client"

import { ParsedSchedule, MaintenanceFood, WeeklyFood } from "@/lib/types"

interface NewCycleReviewProps {
  currentSchedule: ParsedSchedule | null
  newSchedule: ParsedSchedule
  onBack: () => void
  onConfirm: () => void
  confirming: boolean
}

type DiffTag = "new" | "changed" | "updated" | null

interface ChangedMeta { prevDose: number; prevUnit: string }

function getMFTag(
  food: MaintenanceFood | WeeklyFood,
  current: (MaintenanceFood | WeeklyFood)[] | undefined
): { tag: DiffTag; meta?: ChangedMeta } {
  if (!current) return { tag: "new" }
  const existing = current.find(f => f.name === food.name)
  if (!existing) return { tag: "new" }
  if (existing.dose !== food.dose || existing.unit !== food.unit) {
    return { tag: "changed", meta: { prevDose: existing.dose, prevUnit: existing.unit } }
  }
  return { tag: null }
}

function Badge({ tag, meta }: { tag: DiffTag; meta?: ChangedMeta }) {
  if (!tag) return null
  if (tag === "new") return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">NEW</span>
  if (tag === "updated") return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">UPDATED</span>
  return (
    <span className="flex items-center gap-1">
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">CHANGED</span>
      {meta && <span className="text-xs text-gray-400">(was {meta.prevDose} {meta.prevUnit})</span>}
    </span>
  )
}

export default function NewCycleReview({
  currentSchedule,
  newSchedule,
  onBack,
  onConfirm,
  confirming,
}: NewCycleReviewProps) {
  const cur = currentSchedule

  return (
    <div className="flex flex-col gap-6">
      <button onClick={onBack} className="text-sm text-slate-600 underline text-left">
        ← Edit pasted text
      </button>

      {newSchedule.visitNumber && (
        <p className="text-sm text-gray-500">Visit {newSchedule.visitNumber}</p>
      )}

      {newSchedule.maintenanceFoods.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Morning (daily)</h2>
          {newSchedule.maintenanceFoods.map((food, i) => {
            const { tag, meta } = getMFTag(food, cur?.maintenanceFoods)
            return (
              <div key={i} className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {food.name}{food.capped ? " · CAPPED" : ""}
                  </span>
                  <span className="text-xs text-gray-500">
                    {food.dose} {food.unit}{food.prepNote ? ` · ${food.prepNote}` : ""}
                  </span>
                </div>
                <Badge tag={tag} meta={meta} />
              </div>
            )
          })}
        </section>
      )}

      {newSchedule.weeklyFoods.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Morning (weekly — Day 7 only)</h2>
          {newSchedule.weeklyFoods.map((food, i) => {
            const { tag, meta } = getMFTag(food, cur?.weeklyFoods)
            return (
              <div key={i} className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{food.name}</span>
                  <span className="text-xs text-gray-500">
                    {food.dose} {food.unit}{food.prepNote ? ` · ${food.prepNote}` : ""}
                  </span>
                </div>
                <Badge tag={tag} meta={meta} />
              </div>
            )
          })}
        </section>
      )}

      {newSchedule.treatmentFoods.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Evening (treatment)</h2>
          {newSchedule.treatmentFoods.map((food, fi) => {
            const existsInCurrent = cur?.treatmentFoods.some(f => f.name === food.name)
            const tag: DiffTag = existsInCurrent ? "updated" : "new"
            return (
              <div key={fi} className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{food.name}</span>
                  <Badge tag={tag} />
                </div>
                <div className="ml-2 border-l-2 border-gray-200 pl-3">
                  {food.weeks.map((week, wi) => (
                    <div key={wi} className="text-xs text-gray-500 py-1 border-b border-gray-100 last:border-0">
                      Week {week.week}: {week.dose} {week.unit}{week.isFinal ? " · final dose" : ""}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {(newSchedule.recommendedFoods ?? []).length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Recommended foods</h2>
          {(newSchedule.recommendedFoods ?? []).map((food, i) => {
            const existsInCurrent = cur?.recommendedFoods?.some(f => f.name === food.name)
            const tag: DiffTag = existsInCurrent ? null : "new"
            return (
              <div key={i} className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{food.name}</span>
                  <span className="text-xs text-gray-500">
                    {food.dose} {food.unit} · {food.frequencyPerWeek}×/week
                  </span>
                </div>
                <Badge tag={tag} />
              </div>
            )
          })}
        </section>
      )}

      {(newSchedule.medications ?? []).length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Daily medications</h2>
          {(newSchedule.medications ?? []).map((med, i) => {
            const existsInCurrent = cur?.medications?.some(m => m.name === med.name)
            const tag: DiffTag = existsInCurrent ? null : "new"
            return (
              <div key={i} className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{med.name}</span>
                  <span className="text-xs text-gray-500">
                    {med.dose} {med.unit} · {med.frequency}
                  </span>
                </div>
                <Badge tag={tag} />
              </div>
            )
          })}
        </section>
      )}

      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
        <p className="text-sm text-amber-900">
          Confirming will archive your current schedule and reset your position to Week 1, Day 1.
          Your dosing history is preserved in Supabase.
        </p>
      </div>

      <button
        onClick={onConfirm}
        disabled={confirming}
        className="w-full py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl disabled:opacity-50"
      >
        {confirming ? "Saving…" : "Confirm & Start New Cycle"}
      </button>
    </div>
  )
}
