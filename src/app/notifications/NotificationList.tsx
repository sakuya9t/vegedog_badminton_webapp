'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatSessionDate } from '@/lib/dates'
import type { Notification } from '@/lib/types'

const ICON: Record<string, string> = {
  follow_session:    '🏸',
  waitlist_promoted: '🎉',
  match_confirm:     '✅',
  match_published:   '🏆',
}

export default function NotificationList({ userId }: { userId: string }) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Notification[]>([])

  useEffect(() => {
    let active = true
    async function load() {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (!active) return
      const list = (data ?? []) as Notification[]
      setItems(list)
      setLoading(false)
      // Opening the center marks everything read.
      if (list.some(n => !n.read)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('notifications') as any)
          .update({ read: true }).eq('user_id', userId).eq('read', false)
      }
    }
    load()
    return () => { active = false }
  }, [supabase, userId])

  if (loading) return <div className="card animate-pulse h-48" />
  if (items.length === 0) {
    return (
      <div className="card text-center py-12 text-gray-400">
        <p className="text-3xl mb-2">🔔</p>
        <p className="text-sm">还没有通知</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {items.map(n => {
        const body = (
          <div className={`card flex items-start gap-3 ${!n.read ? 'border-l-4 border-brand-400' : ''}`}>
            <span className="text-xl leading-none mt-0.5 shrink-0">{ICON[n.type] ?? '🔔'}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">{n.title}</p>
              {n.body && <p className="text-sm text-gray-500 mt-0.5 break-words">{n.body}</p>}
              <p className="text-[11px] text-gray-400 mt-1">{formatSessionDate(n.created_at)}</p>
            </div>
          </div>
        )
        return n.link
          ? <Link key={n.id} href={n.link} className="block transition-colors active:opacity-80">{body}</Link>
          : <div key={n.id}>{body}</div>
      })}
    </div>
  )
}
