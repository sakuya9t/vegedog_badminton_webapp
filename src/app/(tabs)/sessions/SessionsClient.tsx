'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import SessionCard from '@/components/SessionCard'
import SessionHistoryList from '@/components/SessionHistoryList'
import type { SessionWithInitiator } from '@/lib/types'

type Tab = 'active' | 'history'

export default function SessionsClient({
  active,
  history,
  joinedBySession,
}: {
  active: SessionWithInitiator[]
  history: SessionWithInitiator[]
  joinedBySession: Record<string, number>
}) {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'history' ? 'history' : 'active')

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {([['active', '进行中'], ['history', '历史']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors
              ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'active' ? (
        active.length === 0 ? (
          <div className="card text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">🏸</p>
            <p className="text-sm">暂无进行中的接龙</p>
            <p className="text-xs mt-1">快来发起一场吧！</p>
          </div>
        ) : (
          <div className="space-y-3">
            {active.map(s => (
              <SessionCard key={s.id} session={s} joinedCount={joinedBySession[s.id] ?? 0} />
            ))}
          </div>
        )
      ) : (
        <SessionHistoryList sessions={history} joinedBySession={joinedBySession} />
      )}
    </div>
  )
}
