'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function NotificationBell({ userId }: { userId: string }) {
  const supabase = createClient()
  const [unread, setUnread] = useState(0)

  const refresh = useCallback(async () => {
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false)
    setUnread(count ?? 0)
  }, [supabase, userId])

  useEffect(() => {
    refresh()
    const ch = supabase
      .channel('notif-bell')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        refresh)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [supabase, userId, refresh])

  return (
    <Link href="/notifications" aria-label="通知"
      className="relative p-1.5 text-gray-600 hover:text-gray-900 transition-colors">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M10.268 21a2 2 0 0 0 3.464 0" />
        <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
      </svg>
      {unread > 0 && (
        <span className="absolute top-0 right-0 min-w-[16px] h-4 px-1 rounded-full bg-red-500
                         text-white text-[10px] font-bold flex items-center justify-center">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
