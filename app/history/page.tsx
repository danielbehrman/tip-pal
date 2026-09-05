"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import {
  getSession,
  fetchSchedule,
  fetchDoseLogDaysInRange,
  fetchEarliestDoseLogDate,
  deleteDoseLogDays,
  deleteAllDoseLogDays,
} from "@/lib/supabase"
import { todayDateString } from "@/lib/schedule"
import HistoryCalendar from "@/components/HistoryCalendar"
import DayEditor from "@/components/DayEditor"

export default function HistoryPage() {
  const router = useRouter()
  const now = new Date()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [month, setMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [monthDays, setMonthDays] = useState<DoseLogDay[]>([])
  const [earliestMonth, setEarliestMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [loading, setLoading] = useState(true)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmTarget, setConfirmTarget] = useState<"selection" | "all" | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editingEntry, setEditingEntry] = useState<DoseLogDay | null>(null)
  const [editingDateStr, setEditingDateStr] = useState<string | null>(null)

  async function loadMonth(target: { year: number; month: number }) {
    const start = `${target.year}-${String(target.month).padStart(2, "0")}-01`
    const lastDay = new Date(target.year, target.month, 0).getDate()
    const end = `${target.year}-${String(target.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
    const days = await fetchDoseLogDaysInRange(start, end).catch(() => [])
    setMonthDays(days)
  }

  useEffect(() => {
    async function load() {
      let session
      try {
        session = await getSession()
      } catch {
        router.replace("/login")
        return
      }
      if (!session) {
        router.replace("/login")
        return
      }
      try {
        const [s, earliestDate] = await Promise.all([
          fetchSchedule(),
          fetchEarliestDoseLogDate(),
        ])
        if (!s) {
          router.replace("/setup")
          return
        }
        setSchedule(s)
        if (earliestDate) {
          const [y, m] = earliestDate.split("-").map(Number)
          setEarliestMonth({ year: y, month: m })
        }
        await loadMonth(month)
      } catch {
        router.replace("/daily")
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleMonthChange(next: { year: number; month: number }) {
    setMonth(next)
    setSelectedIds(new Set())
    await loadMonth(next)
  }

  function handleDayClick(dateStr: string, entry: DoseLogDay | null) {
    if (dateStr === todayDateString()) {
      router.push("/daily")
      return
    }
    if (!entry) return
    setEditingEntry(entry)
    setEditingDateStr(dateStr)
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  async function handleConfirmDelete() {
    if (!confirmTarget) return
    setDeleting(true)
    try {
      if (confirmTarget === "all") {
        await deleteAllDoseLogDays()
        setMonthDays([])
      } else {
        const ids = [...selectedIds]
        await deleteDoseLogDays(ids)
        setMonthDays(prev => prev.filter(d => !selectedIds.has(d.id)))
      }
      exitSelectMode()
    } catch {
      // Delete failed — leave selection intact so the user can retry
    } finally {
      setDeleting(false)
      setConfirmTarget(null)
    }
  }

  if (loading || !schedule) return null

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      <header
        className="px-4 pb-4"
        style={{ background: "var(--color-primary)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-white">History</h1>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className="text-sm font-medium"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              {selectMode ? "Cancel" : "Select"}
            </button>
          </div>
        </div>
        {selectMode && (
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={() => setConfirmTarget("all")}
              className="text-sm font-medium disabled:opacity-40"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setConfirmTarget("selection")}
              disabled={selectedIds.size === 0}
              className="text-sm font-semibold disabled:opacity-40"
              style={{ color: "#fff" }}
            >
              Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </button>
          </div>
        )}
      </header>
      <HistoryCalendar
        schedule={schedule}
        monthDays={monthDays}
        month={month}
        onMonthChange={handleMonthChange}
        onDayClick={handleDayClick}
        selectMode={selectMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        earliestMonth={earliestMonth}
      />
      {editingEntry && editingDateStr && editingDateStr !== todayDateString() && (
        <DayEditor
          entry={editingEntry}
          fallbackSchedule={schedule}
          onClose={() => { setEditingEntry(null); setEditingDateStr(null) }}
          onSaved={updated => {
            setMonthDays(prev => prev.map(d => (d.id === updated.id ? updated : d)))
            setEditingEntry(null)
            setEditingDateStr(null)
            window.location.reload()
          }}
        />
      )}
      {confirmTarget && (
        <div className="fixed inset-0 z-[60] flex items-end" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div
            className="bg-white w-full rounded-t-2xl px-6 pt-6"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
          >
            <p className="text-base font-semibold mb-5" style={{ color: "var(--color-text-primary)" }}>
              {confirmTarget === "all"
                ? "Delete all logged history? This can't be undone."
                : `Delete ${selectedIds.size} selected day${selectedIds.size !== 1 ? "s" : ""}? This can't be undone.`}
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "#dc2626", color: "#fff" }}
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold"
                style={{ background: "var(--color-primary-border)", color: "var(--color-text-primary)" }}
                onClick={() => setConfirmTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
