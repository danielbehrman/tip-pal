"use client"

import { useState } from "react"
import { ParsedSchedule } from "@/lib/types"

interface RecommendedFoodsViewProps {
  schedule: ParsedSchedule
  currentWeek: number
  counts: Record<string, Record<string, number>>
  onGive: (foodName: string) => void
  onUndo: (foodName: string) => void
}

const PIP_COUNT = 5

function PipRow({
  count,
  interactive,
  onGive,
  onUndo,
}: {
  count: number
  interactive: boolean
  onGive: () => void
  onUndo: () => void
}) {
  return (
    <div className="flex gap-1.5 items-center">
      {Array.from({ length: PIP_COUNT }, (_, i) => {
        const pipNum = i + 1
        const filled = count >= pipNum
        const isLastFilled = count === pipNum
        const isNextEmpty = !filled && count === pipNum - 1
        const tappable = interactive && (isLastFilled || isNextEmpty)
        return (
          <button
            key={pipNum}
            onClick={() => {
              if (!interactive) return
              if (isLastFilled) onUndo()
              else if (isNextEmpty) onGive()
            }}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: filled ? "#ff6b35" : "#f0ddd4",
              border: "none",
              padding: 0,
              cursor: tappable ? "pointer" : "default",
              flexShrink: 0,
            }}
            aria-label={filled ? (isLastFilled && interactive ? "Undo serving" : undefined) : (isNextEmpty && interactive ? "Log serving" : undefined)}
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
    <div className="flex flex-col min-h-screen" style={{ background: "#fffbf7" }}>
      {/* Orange header */}
      <header style={{ background: "#ff6b35" }}>
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
            {recommendedFoods.length === 0 ? (
              <p className="text-sm" style={{ color: "#9a6a55" }}>
                No recommended foods in your current schedule. Re-parse your plan of care to update.
              </p>
            ) : (
              recommendedFoods.map(food => {
                const count = weekCounts[food.name] ?? 0
                return (
                  <div
                    key={food.name}
                    className="bg-white rounded-xl p-4"
                    style={{ border: "0.5px solid #f0ddd4" }}
                  >
                    <p
                      className="font-semibold mb-0.5"
                      style={{ fontSize: 15, color: "#2d1a0e" }}
                    >
                      {food.name}
                    </p>
                    <p className="text-sm mb-3" style={{ color: "#9a6a55" }}>
                      {food.dose} {food.unit}
                    </p>
                    <PipRow
                      count={count}
                      interactive={true}
                      onGive={() => onGive(food.name)}
                      onUndo={() => onUndo(food.name)}
                    />
                    <p className="text-xs mt-1.5" style={{ color: "#c4927a" }}>
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
              <p className="px-4 pt-4 text-sm" style={{ color: "#9a6a55" }}>
                No history yet. Log some servings this week to see them here.
              </p>
            ) : (
              historyWeeks.map(wk => {
                const wkCounts = counts[wk] ?? {}
                const totalServings = Object.values(wkCounts).reduce((s, c) => s + c, 0)
                const isExpanded = expandedWeeks.has(wk)
                const isCurrent = wk === weekKey
                return (
                  <div key={wk} style={{ borderBottom: "0.5px solid #f0ddd4" }}>
                    <button
                      onClick={() => toggleWeek(wk)}
                      className="w-full flex items-center justify-between px-4 py-3"
                      style={{ background: "#fff8f5" }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="font-medium text-sm"
                          style={{ color: "#2d1a0e" }}
                        >
                          Week {wk}
                        </span>
                        {isCurrent && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: "#ff6b35", color: "#fff", fontSize: 10 }}
                          >
                            Current
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: "#9a6a55" }}>
                          {totalServings} served
                        </span>
                        <span style={{ color: "#c4927a", fontSize: 10 }}>
                          {isExpanded ? "▲" : "▼"}
                        </span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-4 py-3 flex flex-col gap-3 bg-white">
                        {recommendedFoods.length === 0 ? (
                          <p className="text-sm" style={{ color: "#9a6a55" }}>
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
                                  style={{ color: "#2d1a0e" }}
                                >
                                  {food.name}
                                </span>
                                <PipRow
                                  count={count}
                                  interactive={false}
                                  onGive={() => {}}
                                  onUndo={() => {}}
                                />
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
