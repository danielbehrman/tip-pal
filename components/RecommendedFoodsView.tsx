"use client"

import { useState } from "react"
import { ParsedSchedule } from "@/lib/types"
import { parseFrequencyLow } from "@/lib/schedule"

interface RecommendedFoodsViewProps {
  schedule: ParsedSchedule
  currentWeek: number
  counts: Record<string, Record<string, number>>
  onGive: (foodName: string) => void
  onUndo: (foodName: string) => void
}

const PIP_COUNT = 5

function PipRow({ count }: { count: number }) {
  return (
    <div className="flex gap-1.5 items-center">
      {Array.from({ length: PIP_COUNT }, (_, i) => {
        const filled = count >= i + 1
        return (
          <div
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: filled ? "var(--color-primary-mid)" : "var(--color-primary-border)",
              flexShrink: 0,
            }}
          />
        )
      })}
    </div>
  )
}

export default function RecommendedFoodsView({
  schedule,
  currentWeek,
  counts,
  onGive,
  onUndo,
}: RecommendedFoodsViewProps) {
  const [activeTab, setActiveTab] = useState<"week" | "history">("week")
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(
    new Set([String(currentWeek)])
  )

  const recommendedFoods = schedule.recommendedFoods ?? []
  const weekKey = String(currentWeek)
  const weekCounts = counts[weekKey] ?? {}

  const historyWeeks = Object.keys(counts)
    .map(Number)
    .filter(n => !isNaN(n))
    .sort((a, b) => b - a)
    .map(String)

  function toggleWeek(wk: string) {
    setExpandedWeeks(prev => {
      const next = new Set(prev)
      if (next.has(wk)) next.delete(wk)
      else next.add(wk)
      return next
    })
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Orange header */}
      <header style={{ background: "var(--color-primary)", paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-4 pt-5 pb-0">
          <h1 className="text-xl font-semibold text-white">Recommended Foods</h1>
        </div>
        {/* Tabs */}
        <div className="flex px-4 pt-3">
          {(["week", "history"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex-1 py-2 text-sm font-medium"
              style={{
                color: activeTab === tab ? "#fff" : "rgba(255,255,255,0.65)",
                background: "transparent",
                border: "none",
                borderBottom: activeTab === tab ? "2px solid #fff" : "2px solid transparent",
              }}
            >
              {tab === "week" ? "This week" : "History"}
            </button>
          ))}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 pb-24">
        {activeTab === "week" && (
          <div className="px-4 pt-4 flex flex-col gap-3">
            {recommendedFoods.length > 0 &&
              recommendedFoods.every(food => (weekCounts[food.name] ?? 0) >= parseFrequencyLow(food.frequencyPerWeek)) && (
                <div className="rounded-xl px-4 py-3" style={{ background: "#dcfce7", border: "0.5px solid #86efac" }}>
                  <p className="text-sm font-medium" style={{ color: "#166534" }}>
                    Minimum reached for all recommended foods this week
                  </p>
                </div>
              )}
            {recommendedFoods.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                No recommended foods in your current schedule. Re-parse your plan of care to update.
              </p>
            ) : (
              recommendedFoods.map(food => {
                const count = weekCounts[food.name] ?? 0
                return (
                  <div
                    key={food.name}
                    className="bg-white rounded-xl p-4"
                    style={{ border: "0.5px solid var(--color-primary-border)" }}
                  >
                    <p
                      className="font-semibold mb-0.5"
                      style={{ fontSize: 15, color: "var(--color-text-primary)" }}
                    >
                      {food.name}
                    </p>
                    <p className="text-sm mb-3" style={{ color: "var(--color-text-secondary)" }}>
                      {food.dose} {food.unit}
                    </p>
                    <div className="flex items-center justify-between">
                      <PipRow count={count} />
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => onUndo(food.name)}
                          disabled={count <= 0}
                          aria-label={`Undo serving for ${food.name}`}
                          className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                          style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
                        >
                          −
                        </button>
                        <span className="text-base font-semibold w-6 text-center" style={{ color: "var(--color-text-primary)" }}>
                          {count}
                        </span>
                        <button
                          onClick={() => onGive(food.name)}
                          aria-label={`Log serving for ${food.name}`}
                          className="flex items-center justify-center text-lg font-bold"
                          style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <p className="text-xs mt-1.5" style={{ color: "var(--color-text-muted)" }}>
                      {food.frequencyPerWeek} per week
                    </p>
                  </div>
                )
              })
            )}
          </div>
        )}

        {activeTab === "history" && (
          <div className="flex flex-col">
            {historyWeeks.length === 0 ? (
              <p className="px-4 pt-4 text-sm" style={{ color: "var(--color-text-secondary)" }}>
                No history yet. Log some servings this week to see them here.
              </p>
            ) : (
              historyWeeks.map(wk => {
                const wkCounts = counts[wk] ?? {}
                const totalServings = Object.values(wkCounts).reduce((s, c) => s + c, 0)
                const isExpanded = expandedWeeks.has(wk)
                const isCurrent = wk === weekKey
                return (
                  <div key={wk} style={{ borderBottom: "0.5px solid var(--color-primary-border)" }}>
                    <button
                      onClick={() => toggleWeek(wk)}
                      className="w-full flex items-center justify-between px-4 py-3"
                      style={{ background: "var(--color-bg-secondary)" }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="font-medium text-sm"
                          style={{ color: "var(--color-text-primary)" }}
                        >
                          Week {wk}
                        </span>
                        {isCurrent && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: "var(--color-primary-mid)", color: "#fff", fontSize: 10 }}
                          >
                            Current
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                          {totalServings} served
                        </span>
                        <span style={{ color: "var(--color-text-muted)", fontSize: 10 }}>
                          {isExpanded ? "▲" : "▼"}
                        </span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-4 py-3 flex flex-col gap-3 bg-white">
                        {recommendedFoods.length === 0 ? (
                          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                            No recommended foods in schedule.
                          </p>
                        ) : (
                          recommendedFoods.map(food => {
                            const count = wkCounts[food.name] ?? 0
                            return (
                              <div
                                key={food.name}
                                className="flex items-center justify-between"
                              >
                                <span
                                  className="text-sm"
                                  style={{ color: "var(--color-text-primary)" }}
                                >
                                  {food.name}
                                </span>
                                <PipRow count={count} />
                              </div>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
