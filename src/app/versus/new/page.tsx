'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { defaultNowLocal, localToPacificISO } from '@/lib/dates'
import DateTimePicker from '@/components/DateTimePicker'
import MemberPicker, { type PickedMember } from '@/components/MemberPicker'
import type { MatchType, ParticipantInput } from '@/lib/types'

/** Pulls a readable message out of a Supabase/PostgREST error object or Error. */
function errMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string }
    const parts = [e.message, e.details, e.hint].filter(Boolean)
    if (parts.length) return parts.join(' — ') + (e.code ? ` (${e.code})` : '')
  }
  return '创建失败，请重试'
}

export default function NewMatchPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [me, setMe] = useState<{ id: string; nickname: string } | null>(null)
  const [type, setType]         = useState<MatchType>('doubles')
  const [teammate, setTeammate] = useState<PickedMember | null>(null)
  const [opp1, setOpp1]         = useState<PickedMember | null>(null)
  const [opp2, setOpp2]         = useState<PickedMember | null>(null)
  const [playedAt, setPlayedAt] = useState(defaultNowLocal())
  const [isPublic, setIsPublic] = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data } = await supabase.from('profiles').select('id, nickname').eq('id', user.id).single()
      setMe(data as { id: string; nickname: string })
    })()
  }, [supabase, router])

  // IDs already chosen, so the same member can't be picked twice.
  const chosen = [teammate, opp1, opp2]
    .filter((m): m is PickedMember => !!m?.user_id)
    .map(m => m.user_id as string)
  const excludeFor = (self: PickedMember | null) =>
    [me?.id, ...chosen.filter(id => id !== self?.user_id)].filter(Boolean) as string[]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!me) return
    if (!opp1) { setError('请选择对手'); return }
    if (type === 'doubles' && !teammate) { setError('请选择队友'); return }
    if (type === 'doubles' && !opp2) { setError('请选择第二位对手'); return }

    const participants: ParticipantInput[] = [
      { user_id: me.id, is_guest: false, team: 1, is_recorder: true, display_name: me.nickname },
    ]
    if (type === 'doubles' && teammate) {
      participants.push({ ...teammate, team: 1, is_recorder: false })
    }
    participants.push({ ...opp1, team: 2, is_recorder: false })
    if (type === 'doubles' && opp2) {
      participants.push({ ...opp2, team: 2, is_recorder: false })
    }

    setSaving(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: rpcErr } = await (supabase.rpc as any)('create_match', {
        p_type:         type,
        p_is_public:    isPublic,
        p_played_at:    localToPacificISO(playedAt),
        p_participants: participants,
      })
      if (rpcErr) throw rpcErr
      router.push(`/versus/${(data as { id: string }).id}`)
    } catch (err: unknown) {
      setError(errMessage(err))
      setSaving(false)
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">新对局</h1>

      <form onSubmit={submit} className="space-y-4">
        {/* Type */}
        <div className="card space-y-3">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">类型</h2>
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {(['singles', 'doubles'] as MatchType[]).map(t => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors
                  ${type === t ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500'}`}>
                {t === 'singles' ? '单打' : '双打'}
              </button>
            ))}
          </div>
        </div>

        {/* Players */}
        <div className="card space-y-3">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">选手</h2>
          <p className="text-xs text-gray-400">
            你（{me?.nickname ?? '…'}）是录入者。选手优先选注册会员；若是某人的 +1 可强制输入访客。
          </p>

          {type === 'doubles' && (
            <MemberPicker label="队友" value={teammate} onChange={setTeammate}
              excludeIds={excludeFor(teammate)} placeholder="搜索队友昵称…" />
          )}
          <MemberPicker label={type === 'doubles' ? '对手 1' : '对手'} value={opp1} onChange={setOpp1}
            excludeIds={excludeFor(opp1)} placeholder="搜索对手昵称…" />
          {type === 'doubles' && (
            <MemberPicker label="对手 2" value={opp2} onChange={setOpp2}
              excludeIds={excludeFor(opp2)} placeholder="搜索对手昵称…" />
          )}
        </div>

        {/* When + privacy */}
        <div className="card space-y-3">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
            对局时间 <span className="font-normal normal-case text-gray-400">（太平洋时区）</span>
          </h2>
          <DateTimePicker label="对局时间" value={playedAt} onChange={setPlayedAt} />
        </div>

        <label className="card flex items-center justify-between cursor-pointer select-none">
          <span>
            <span className="text-sm font-medium text-gray-700">公开此对战</span>
            <span className="block text-xs text-gray-400 mt-0.5">
              关闭后仅参与方可在对战历史看到
            </span>
          </span>
          <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)}
            className="w-4 h-4 rounded accent-brand-600 shrink-0" />
        </label>

        {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? '创建中…' : '创建并录入比分'}
        </button>
      </form>
    </main>
  )
}
