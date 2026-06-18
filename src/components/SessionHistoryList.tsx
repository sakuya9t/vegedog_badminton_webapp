'use client'

import { useState } from 'react'
import SessionCard from '@/components/SessionCard'
import type { SessionWithInitiator } from '@/lib/types'

interface MonthGroup {
  label: string   // e.g. "2026年4月"
  key: string     // e.g. "2026-04"
  sessions: SessionWithInitiator[]
}

function groupByMonth(sessions: SessionWithInitiator[]): MonthGroup[] {
  const map = new Map<string, MonthGroup>()
  for (const s of sessions) {
    const d = new Date(s.starts_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${d.getFullYear()}年${d.getMonth() + 1}月`
    if (!map.has(key)) map.set(key, { key, label, sessions: [] })
    map.get(key)!.sessions.push(s)
  }
  return Array.from(map.values())
}

export default function SessionHistoryList({
  sessions,
  joinedBySession,
}: {
  sessions: SessionWithInitiator[]
  joinedBySession: Record<string, number>
}) {
  const groups = groupByMonth(sessions)
  // Most recent month starts expanded so the latest sessions are visible.
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set(groups.length ? [groups[0].key] : []))

  function toggle(key: string) {
    setOpenKeys(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  if (sessions.length === 0) {
    return (
      <div className="card text-center py-12 text-gray-400">
        <p className="text-3xl mb-2">📋</p>
        <p className="text-sm">暂无历史场次</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {groups.map(group => {
        const isOpen = openKeys.has(group.key)
        return (
          <div key={group.key}>
            <button
              onClick={() => toggle(group.key)}
              className="w-full flex items-center justify-between px-1 py-1.5 text-base font-semibold text-gray-700 hover:text-gray-900 transition-colors"
            >
              <span>{group.label}</span>
              <span className="flex items-center gap-1.5">
                <span className="text-sm font-normal text-gray-400">{group.sessions.length} 场</span>
                <svg
                  className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </span>
            </button>
            {isOpen && (
              <div className="space-y-3 mt-1">
                {group.sessions.map(s => (
                  <SessionCard key={s.id} session={s} joinedCount={joinedBySession[s.id] ?? 0} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
