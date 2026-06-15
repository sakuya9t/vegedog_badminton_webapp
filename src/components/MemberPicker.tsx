'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types'

export interface PickedMember {
  user_id:      string | null   // null → guest (+1)
  is_guest:     boolean
  display_name: string
  avatar_url:   string | null
}

function avatarOf(m: PickedMember) {
  return m.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${m.user_id ?? m.display_name}`
}

/**
 * Single-slot member picker. Searches registered members by nickname (same
 * mechanism as the follow/subscription picker). When no member matches, the
 * user may force-input the typed name as a guest (+1) after a double-confirm.
 */
export default function MemberPicker({
  label,
  value,
  onChange,
  excludeIds = [],
  placeholder = '搜索昵称…',
}: {
  label:        string
  value:        PickedMember | null
  onChange:     (m: PickedMember | null) => void
  excludeIds?:  string[]
  placeholder?: string
}) {
  const supabase = createClient()
  const [search, setSearch]         = useState('')
  const [candidates, setCandidates] = useState<Profile[]>([])
  const [dropOpen, setDropOpen]     = useState(false)
  const [guestPrompt, setGuestPrompt] = useState<string | null>(null)

  const searchProfiles = useCallback(async (q: string) => {
    if (!q.trim()) { setCandidates([]); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('profiles') as any)
      .select('id, nickname, avatar_url')
      .ilike('nickname', `%${q.trim()}%`)
      .limit(6)
    setCandidates((data ?? []).filter((p: Profile) => !excludeIds.includes(p.id)))
  }, [excludeIds, supabase])

  useEffect(() => {
    const timer = setTimeout(() => searchProfiles(search), 200)
    return () => clearTimeout(timer)
  }, [search, searchProfiles])

  function pickMember(p: Profile) {
    onChange({ user_id: p.id, is_guest: false, display_name: p.nickname, avatar_url: p.avatar_url })
    setSearch(''); setCandidates([]); setDropOpen(false)
  }

  function confirmGuest(name: string) {
    onChange({ user_id: null, is_guest: true, display_name: name.trim(), avatar_url: null })
    setGuestPrompt(null); setSearch(''); setCandidates([]); setDropOpen(false)
  }

  return (
    <div>
      <label className="text-sm font-medium text-gray-700 mb-1 block">{label}</label>

      {value ? (
        <div className="flex items-center gap-2 input">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarOf(value)} alt=""
            className="w-6 h-6 rounded-full bg-gray-100 shrink-0 object-cover" />
          <span className="text-sm text-gray-800 flex-1">
            {value.display_name}
            {value.is_guest && (
              <span className="ml-1.5 text-xs text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">访客 +1</span>
            )}
          </span>
          <button type="button" onClick={() => onChange(null)}
            className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded transition-colors">
            移除
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setDropOpen(true) }}
            onFocus={() => setDropOpen(true)}
            onBlur={() => setTimeout(() => setDropOpen(false), 150)}
            placeholder={placeholder}
            className="input text-sm"
          />
          {dropOpen && search.trim() && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-gray-100
                            rounded-xl shadow-lg overflow-hidden">
              {candidates.map(p => (
                <button key={p.id} type="button" onMouseDown={() => pickMember(p)}
                  className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 hover:bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${p.id}`}
                    alt="" className="w-6 h-6 rounded-full bg-gray-100 shrink-0 object-cover" />
                  <span>{p.nickname}</span>
                </button>
              ))}
              {/* Force-input as guest */}
              <button type="button"
                onMouseDown={() => setGuestPrompt(search.trim())}
                className="w-full text-left px-3 py-2.5 text-sm border-t border-gray-100
                           text-amber-700 hover:bg-amber-50 transition-colors">
                使用「{search.trim()}」为访客 (+1)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Guest double-confirm */}
      {guestPrompt !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setGuestPrompt(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-3">
            <p className="text-base font-semibold text-gray-900">确认添加访客？</p>
            <p className="text-sm text-gray-500">
              「<span className="font-medium text-gray-700">{guestPrompt}</span>」不是注册会员。
              访客<strong>不计积分</strong>、<strong>无法在 app 内确认</strong>对局。
              请确认没有填错昵称。
            </p>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setGuestPrompt(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 active:bg-gray-50">
                再找找
              </button>
              <button type="button" onClick={() => confirmGuest(guestPrompt)}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold active:opacity-80">
                确认为访客
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
