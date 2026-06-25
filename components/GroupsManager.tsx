"use client"

import { useState } from "react"
import { FoodGroup, ParsedSchedule } from "@/lib/types"

interface GroupsManagerProps {
  schedule: ParsedSchedule
  groups: FoodGroup[]
  onChange: (groups: FoodGroup[]) => void
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function GroupsManager({ schedule, groups, onChange }: GroupsManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [creatingName, setCreatingName] = useState("")
  const [creatingFoods, setCreatingFoods] = useState<string[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)

  // All morning-eligible foods (maintenance + weekly), deduped by name
  const allFoods = Array.from(new Set([
    ...schedule.maintenanceFoods.map((f) => f.name),
    ...schedule.weeklyFoods.map((f) => f.name),
  ]))

  // foodName → group.id for foods already claimed
  const claimedBy = new Map<string, string>()
  for (const group of groups) {
    for (const name of group.foodNames) {
      claimedBy.set(name, group.id)
    }
  }

  function handleDeleteGroup(id: string) {
    onChange(groups.filter((g) => g.id !== id))
  }

  function handleStartEdit(group: FoodGroup) {
    setEditingId(group.id)
    setEditingName(group.name)
    if (showCreateForm) setShowCreateForm(false)
  }

  function handleEditToggleFood(groupId: string, foodName: string, checked: boolean) {
    const updated = groups.map((g) => {
      if (g.id !== groupId) return g
      const foodNames = checked
        ? [...g.foodNames, foodName]
        : g.foodNames.filter((n) => n !== foodName)
      return { ...g, foodNames }
    })
    onChange(updated)
  }

  function handleSaveEditName(groupId: string) {
    const trimmed = editingName.trim()
    if (!trimmed) return
    onChange(groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)))
    setEditingId(null)
  }

  function handleCreateToggleFood(foodName: string, checked: boolean) {
    setCreatingFoods((prev) =>
      checked ? [...prev, foodName] : prev.filter((n) => n !== foodName)
    )
  }

  function handleCreateGroup() {
    const trimmed = creatingName.trim()
    if (!trimmed || creatingFoods.length === 0) return
    const newGroup: FoodGroup = {
      id: generateId(),
      name: trimmed,
      foodNames: creatingFoods,
      sortOrder: groups.length,
    }
    onChange([...groups, newGroup])
    setCreatingName("")
    setCreatingFoods([])
    setShowCreateForm(false)
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 && !showCreateForm && (
        <p className="text-sm text-gray-500">No groups yet. Create one to combine foods like seeds into a single checkbox.</p>
      )}

      {groups.map((group) => {
        const isEditing = editingId === group.id
        // Foods in this schedule that are in this group
        const matchedFoods = group.foodNames.filter((n) => allFoods.includes(n))
        const staleFoods = group.foodNames.filter((n) => !allFoods.includes(n))

        return (
          <div key={group.id} className="border border-gray-200 rounded-xl p-4">
            {isEditing ? (
              <div className="flex gap-2 mb-3">
                <input
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveEditName(group.id) }}
                  autoFocus
                />
                <button
                  onClick={() => handleSaveEditName(group.id)}
                  className="px-3 py-2 bg-slate-900 text-white text-sm rounded-lg"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-medium text-slate-900">{group.name}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {matchedFoods.length} food{matchedFoods.length !== 1 ? "s" : ""}
                    {staleFoods.length > 0 && ` · ${staleFoods.length} not in current schedule`}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleStartEdit(group)}
                    className="text-xs text-gray-500 underline"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => handleDeleteGroup(group.id)}
                    className="text-xs text-red-500 underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              {allFoods.map((foodName) => {
                const inThisGroup = group.foodNames.includes(foodName)
                const inOtherGroup = !inThisGroup && claimedBy.has(foodName)
                return (
                  <label
                    key={foodName}
                    className={`flex items-center gap-2 text-sm py-1 ${inOtherGroup ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-slate-900"
                      checked={inThisGroup}
                      disabled={inOtherGroup}
                      onChange={(e) => handleEditToggleFood(group.id, foodName, e.target.checked)}
                    />
                    <span>{foodName}</span>
                    {inOtherGroup && (
                      <span className="text-xs text-gray-400">
                        (in {groups.find((g) => claimedBy.get(foodName) === g.id)?.name})
                      </span>
                    )}
                  </label>
                )
              })}
              {staleFoods.map((name) => (
                <label key={name} className="flex items-center gap-2 text-sm py-1 opacity-40">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-slate-900"
                    checked={true}
                    onChange={(e) => handleEditToggleFood(group.id, name, e.target.checked)}
                  />
                  <span>{name}</span>
                  <span className="text-xs text-gray-400">(not in current schedule)</span>
                </label>
              ))}
            </div>
          </div>
        )
      })}

      {showCreateForm ? (
        <div className="border border-gray-200 rounded-xl p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">New group</p>
          <input
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full mb-3"
            placeholder="Group name (e.g. Jam)"
            value={creatingName}
            onChange={(e) => setCreatingName(e.target.value)}
            autoFocus
          />
          <div className="flex flex-col gap-1 mb-3">
            {allFoods.map((foodName) => {
              const inOtherGroup = claimedBy.has(foodName)
              return (
                <label
                  key={foodName}
                  className={`flex items-center gap-2 text-sm py-1 ${inOtherGroup ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-slate-900"
                    checked={creatingFoods.includes(foodName)}
                    disabled={inOtherGroup}
                    onChange={(e) => handleCreateToggleFood(foodName, e.target.checked)}
                  />
                  <span>{foodName}</span>
                  {inOtherGroup && (
                    <span className="text-xs text-gray-400">
                      (in {groups.find((g) => claimedBy.get(foodName) === g.id)?.name})
                    </span>
                  )}
                </label>
              )
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreateGroup}
              disabled={!creatingName.trim() || creatingFoods.length === 0}
              className="flex-1 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg disabled:opacity-40"
            >
              Create group
            </button>
            <button
              onClick={() => { setShowCreateForm(false); setCreatingName(""); setCreatingFoods([]) }}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setShowCreateForm(true); setEditingId(null) }}
          className="text-sm text-slate-700 underline text-left"
        >
          + New group
        </button>
      )}
    </div>
  )
}
