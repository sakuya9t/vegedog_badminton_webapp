'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { matchWinner } from '@/lib/match'
import type { Profile } from '@/lib/types'
import dynamic from 'next/dynamic'

const AvatarCropper = dynamic(() => import('@/components/AvatarCropper'), { ssr: false })

export type ChangelogEntry = { version: string; date: string; notes: string[] }

type Tab = '账户' | '统计' | '关注' | '关于'

// ── Account tab ────────────────────────────────────────────────────────────
function AccountTab({ onSignOut, setup }: { onSignOut: () => void; setup?: boolean }) {
  const supabase = createClient()
  const router   = useRouter()
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')
  const [nickname,      setNickname]      = useState('')
  const [venmoUsername, setVenmoUsername] = useState('')
  const [avatarUrl,     setAvatarUrl]     = useState('')
  const [email,         setEmail]         = useState('')

  const [editingNickname, setEditingNickname] = useState(!!setup)
  const [editingVenmo,    setEditingVenmo]    = useState(false)
  const [editingPassword, setEditingPassword] = useState(false)
  const [confirmSignOut,  setConfirmSignOut]  = useState(false)
  const [draftNickname,   setDraftNickname]   = useState('')
  const [draftVenmo,      setDraftVenmo]      = useState('')
  const [draftPassword,   setDraftPassword]   = useState('')
  const [draftPassword2,  setDraftPassword2]  = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [cropSrc,         setCropSrc]         = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setEmail(user.email ?? '')
      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', user.id).single() as { data: Profile | null; error: unknown }
      if (profile) {
        setNickname(profile.nickname ?? '')
        setVenmoUsername(profile.venmo_username ?? '')
        setAvatarUrl(profile.avatar_url ?? '')
      }
      setLoading(false)
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Allows letters (all scripts: CJK, Latin, Korean, Arabic…), numbers,
  // combining marks, spaces, hyphens, underscores, and periods.
  // Blocks emojis, symbols, and other non-language characters.
  const NICKNAME_RE = /^[\p{L}\p{N}\p{M}\s\-_.]+$/u

  async function saveField(field: 'nickname' | 'venmo') {
    setError('')
    const newNickname = field === 'nickname' ? draftNickname.trim() : nickname
    const newVenmo    = field === 'venmo'    ? draftVenmo.trim()    : venmoUsername
    if (!newNickname) { setError('接龙昵称不能为空'); return }
    if (field === 'nickname' && !NICKNAME_RE.test(newNickname)) {
      setError('为了方便接龙与查账，请不要使用特殊字符或emoji。谢谢！')
      return
    }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const upsertData: Record<string, unknown> = {
        id:             user.id,
        nickname:       newNickname,
        venmo_username: newVenmo || null,
        updated_at:     new Date().toISOString(),
      }
      if (user.user_metadata?.avatar_url) upsertData.avatar_url = user.user_metadata.avatar_url
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: dbErr } = await (supabase.from('profiles') as any).upsert(upsertData)
      if (dbErr) throw dbErr
      if (field === 'nickname') {
        setNickname(newNickname); setEditingNickname(false)
        if (setup) router.push('/sessions')
      } else {
        setVenmoUsername(newVenmo); setEditingVenmo(false)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '出现错误，请重试')
    } finally {
      setSaving(false)
    }
  }

  async function savePassword() {
    setError('')
    if (draftPassword.length < 6) { setError('密码至少需要6位'); return }
    if (draftPassword !== draftPassword2) { setError('两次密码不一致'); return }
    setSaving(true)
    try {
      const { error: authErr } = await supabase.auth.updateUser({ password: draftPassword })
      if (authErr) throw authErr
      setEditingPassword(false); setDraftPassword(''); setDraftPassword2('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '出现错误，请重试')
    } finally {
      setSaving(false)
    }
  }

  function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setCropSrc(url)
    if (avatarInputRef.current) avatarInputRef.current.value = ''
  }

  async function handleCropConfirm(blob: Blob) {
    setCropSrc(null)
    setError('')
    setUploadingAvatar(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const path = `${user.id}/avatar.jpg`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      // bust cache so the new image loads
      const busted = `${publicUrl}?t=${Date.now()}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: dbErr } = await (supabase.from('profiles') as any)
        .update({ avatar_url: busted, updated_at: new Date().toISOString() })
        .eq('id', user.id)
      if (dbErr) throw dbErr
      setAvatarUrl(busted)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '上传失败，请重试')
    } finally {
      setUploadingAvatar(false)
    }
  }

  if (loading) return <div className="card animate-pulse h-48" />

  return (
    <div className="space-y-4">
      {setup && (
        <div className="rounded-xl bg-brand-50 border border-brand-200 px-4 py-3 text-sm text-brand-800 space-y-1">
          <p className="font-semibold">欢迎来到菜狗群App！请先设置你的昵称，然后就可以参与接龙了。</p>
          <p className="text-brand-600">→ 点击右上角{' '}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              className="w-4 h-4 inline-block align-middle mb-0.5">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
              <polyline points="16 6 12 2 8 6"/>
              <line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
            {' '}安装App
          </p>
        </div>
      )}
      <div className="flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl || `https://api.dicebear.com/9.x/thumbs/svg?seed=default`}
          alt="avatar"
          className="w-20 h-20 rounded-full border-2 border-brand-200 shadow object-cover"
        />
        <input ref={avatarInputRef} type="file" accept="image/*" className="hidden"
          onChange={handleAvatarPick} />
        <button
          type="button"
          onClick={() => avatarInputRef.current?.click()}
          disabled={uploadingAvatar}
          className="text-xs text-brand-600 font-medium px-3 py-1 rounded-lg hover:bg-brand-50 transition-colors disabled:opacity-50">
          {uploadingAvatar ? '上传中…' : '更换头像'}
        </button>
      </div>

      {/* Crop modal */}
      {cropSrc && (
        <AvatarCropper
          imageSrc={cropSrc}
          onConfirm={handleCropConfirm}
          onCancel={() => { setCropSrc(null); URL.revokeObjectURL(cropSrc) }}
        />
      )}

      <div className="card space-y-3">
        {/* Email + set password */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">邮箱</label>
            {!editingPassword && (
              <button
                onClick={() => { setEditingPassword(true); setError('') }}
                className="text-xs text-brand-600 font-medium px-2 py-1 rounded hover:bg-brand-50 transition-colors">
                设置密码（可选）
              </button>
            )}
          </div>
          <p className="text-sm text-gray-500">{email}</p>
          {editingPassword && (
            <>
              <input className="input" type="password" placeholder="新密码（至少6位）"
                value={draftPassword} onChange={e => setDraftPassword(e.target.value)} autoFocus />
              <input className="input" type="password" placeholder="确认新密码"
                value={draftPassword2} onChange={e => setDraftPassword2(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => { setEditingPassword(false); setDraftPassword(''); setDraftPassword2(''); setError('') }}
                  className="flex-1 py-1.5 text-sm rounded-xl border border-gray-200 text-gray-600 font-medium">
                  取消
                </button>
                <button onClick={savePassword} disabled={saving}
                  className="btn-primary py-1.5 text-sm flex-1">
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </>
          )}
        </div>

        <hr className="border-gray-100" />

        {/* Nickname */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">接龙昵称<span className="ml-1 font-normal text-red-400">（必填）</span></label>
            {!editingNickname && (
              <button
                onClick={() => { setDraftNickname(nickname); setEditingNickname(true); setError('') }}
                className="text-xs text-brand-600 font-medium px-2 py-1 rounded hover:bg-brand-50 transition-colors">
                编辑
              </button>
            )}
          </div>
          {editingNickname ? (
            <>
              <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
                为了方便接龙与查账，请不要使用特殊字符或emoji。谢谢！
              </p>
              <input className="input" placeholder="别人看到的名字"
                value={draftNickname} onChange={e => setDraftNickname(e.target.value)} autoFocus />
              <div className="flex gap-2">
                <button onClick={() => { setEditingNickname(false); setError('') }}
                  className="flex-1 py-1.5 text-sm rounded-xl border border-gray-200 text-gray-600 font-medium">
                  取消
                </button>
                <button onClick={() => saveField('nickname')} disabled={saving}
                  className="btn-primary py-1.5 text-sm flex-1">
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-800">{nickname || <span className="text-gray-400">未设置</span>}</p>
          )}
        </div>

        <hr className="border-gray-100" />

        {/* Venmo */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              Venmo 账号<span className="ml-1 font-normal text-gray-400">（选填）</span>
            </label>
            {!editingVenmo && (
              <button
                onClick={() => { setDraftVenmo(venmoUsername); setEditingVenmo(true); setError('') }}
                className="text-xs text-brand-600 font-medium px-2 py-1 rounded hover:bg-brand-50 transition-colors">
                编辑
              </button>
            )}
          </div>
          {editingVenmo ? (
            <>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                <input className="input pl-7" placeholder="your-venmo-handle"
                  value={draftVenmo} onChange={e => setDraftVenmo(e.target.value.replace(/^@/, ''))} autoFocus />
              </div>
              <p className="text-xs text-gray-400">其他人在场次中可以看到你的付款按钮</p>
              <div className="flex gap-2">
                <button onClick={() => { setEditingVenmo(false); setError('') }}
                  className="flex-1 py-1.5 text-sm rounded-xl border border-gray-200 text-gray-600 font-medium">
                  取消
                </button>
                <button onClick={() => saveField('venmo')} disabled={saving}
                  className="btn-primary py-1.5 text-sm flex-1">
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-800">
              {venmoUsername ? `@${venmoUsername}` : <span className="text-gray-400">未设置</span>}
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}
      </div>

      <div className="card">
        <button onClick={() => setConfirmSignOut(true)}
          className="w-full text-sm text-red-500 font-medium py-1 hover:text-red-700 transition-colors">
          退出登录
        </button>
      </div>

      {confirmSignOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmSignOut(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3">
            <h3 className="text-base font-bold text-gray-900 text-center">退出登录</h3>
            <p className="text-sm text-gray-500 leading-relaxed text-center">你确定要退出登录吗？</p>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setConfirmSignOut(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold
                           active:bg-gray-200 transition-colors">
                取消
              </button>
              <button onClick={onSignOut}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold
                           active:opacity-80 transition-colors">
                退出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Stats tab ──────────────────────────────────────────────────────────────
const toLocalDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function StatsTab() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [stats,   setStats]   = useState({ joined: 0, plusOne: 0, waitlisted: 0, initiated: 0, stayedLate: 0 })
  const [versus,  setVersus]  = useState({ played: 0, wins: 0, losses: 0 })
  const [participatedDates, setParticipatedDates] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [
        { data: activeRows },
        { count: waitlisted },
        { count: initiated },
        { data: myMatchRows },
      ] = await Promise.all([
        supabase.from('participants')
          .select('session_id, stayed_late, sessions(starts_at)')
          .eq('user_id', user.id)
          .in('status', ['joined', 'withdrawn', 'late_withdraw']),
        supabase.from('participants').select('*', { count: 'exact', head: true })
          .eq('user_id', user.id).eq('status', 'waitlist'),
        supabase.from('sessions').select('*', { count: 'exact', head: true })
          .eq('initiator_id', user.id),
        supabase.from('match_participants').select('match_id').eq('user_id', user.id),
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (activeRows ?? []) as any[]
      const joinedSessions     = new Set(rows.map(r => r.session_id))
      const stayedLateSessions = new Set(rows.filter(r => r.stayed_late).map(r => r.session_id))

      const dates = new Set<string>()
      rows.forEach(r => {
        if (r.sessions?.starts_at)
          dates.add(toLocalDateStr(new Date(r.sessions.starts_at)))
      })

      setStats({
        joined:     joinedSessions.size,
        plusOne:    rows.length - joinedSessions.size,
        waitlisted: waitlisted ?? 0,
        initiated:  initiated  ?? 0,
        stayedLate: stayedLateSessions.size,
      })
      setParticipatedDates(dates)

      // 对战情况: published matches I took part in, with win/loss from my team.
      const matchIds = [...new Set((myMatchRows ?? []).map(r => r.match_id))]
      if (matchIds.length > 0) {
        const { data: matches } = await supabase
          .from('matches')
          .select('id, participants:match_participants(user_id, team), games:match_games(team1_score, team2_score)')
          .in('id', matchIds)
          .eq('status', 'published')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ms = (matches ?? []) as any[]
        let wins = 0, losses = 0
        for (const m of ms) {
          const mine = (m.participants ?? []).find((p: any) => p.user_id === user.id) // eslint-disable-line @typescript-eslint/no-explicit-any
          const w = matchWinner(m.games ?? [])
          if (!mine || w === 0) continue
          if (w === mine.team) wins++; else losses++
        }
        setVersus({ played: ms.length, wins, losses })
      }
      setLoading(false)
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="card animate-pulse h-48" />

  const today    = new Date()
  const todayStr = toLocalDateStr(today)
  const gridStart = new Date(today)
  gridStart.setMonth(gridStart.getMonth() - 5)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())

  const weeks: Date[][] = []
  const cur = new Date(gridStart)
  while (cur <= today) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) { week.push(new Date(cur)); cur.setDate(cur.getDate() + 1) }
    weeks.push(week)
  }

  const items = [
    { label: '参与接龙次数', value: stats.joined,     emoji: '🏸' },
    { label: '帮助+1人数',   value: stats.plusOne,    emoji: '👥' },
    { label: '加时次数',     value: stats.stayedLate, emoji: '⏰' },
    { label: '发起接龙次数', value: stats.initiated,  emoji: '📋' },
    { label: '候补次数',     value: stats.waitlisted, emoji: '⏳' },
    { label: '菜狗杯参与',   value: '—',              emoji: '🏆' },
  ]

  const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']

  const monthLabels: string[] = weeks.map(() => '')
  weeks.forEach((week, wi) => {
    const newMonth = wi === 0 || week[0].getMonth() !== weeks[wi - 1][0].getMonth()
    if (newMonth) {
      const nextBoundary = weeks.findIndex((w, i) => i > wi && w[0].getMonth() !== week[0].getMonth())
      const roomAhead = nextBoundary === -1 ? weeks.length - wi : nextBoundary - wi
      if (roomAhead >= 3) {
        monthLabels[wi] = week[0].toLocaleString('en-US', { month: 'short' })
      }
    }
  })

  return (
    <div className="space-y-3">
      <div className="card">
        <div className="grid grid-cols-3 gap-2">
          {items.map(({ label, value, emoji }, i) => (
            <div key={label}
              className="bg-gray-50 rounded-xl px-2 py-2 text-center">
              <p className="text-base leading-none mb-0.5">{emoji}</p>
              <p className="text-xl font-bold text-gray-900 leading-tight">{value}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <Link href="/versus?tab=history"
        className="card block transition-colors hover:bg-gray-50 active:bg-gray-100">
        <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3 flex items-center justify-between">
          对战情况
          <span className="text-xs font-normal normal-case text-gray-300">对战历史 ›</span>
        </h2>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: '对战场次', value: versus.played },
            { label: '胜',       value: versus.wins },
            { label: '负',       value: versus.losses },
            { label: '胜率',     value: versus.wins + versus.losses === 0
                                          ? '—'
                                          : `${Math.round((versus.wins / (versus.wins + versus.losses)) * 100)}%` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-xl px-2 py-2">
              <p className="text-xl font-bold text-gray-900 leading-tight tabular-nums">{value}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">仅统计已发布（全员确认）的对局</p>
      </Link>

      <div className="card">
        <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3">参与记录</h2>
        <div className="overflow-x-auto">
          <div className="flex gap-1 min-w-fit">
            <div className="flex flex-col gap-[3px] pt-[18px] mr-1">
              {DAY_LABELS.map((label, i) => (
                <div key={i} className="h-[10px] w-5 text-[9px] text-gray-400 leading-[10px] text-right">
                  {label}
                </div>
              ))}
            </div>
            <div>
              <div className="flex gap-[3px] mb-1">
                {weeks.map((week, wi) => (
                  <div key={wi} className="w-[10px] text-[9px] text-gray-400 overflow-visible whitespace-nowrap">
                    {monthLabels[wi]}
                  </div>
                ))}
              </div>
              <div className="flex gap-[3px]">
                {weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-[3px]">
                    {week.map((day, di) => {
                      const ds = toLocalDateStr(day)
                      const future = ds > todayStr
                      const active = !future && participatedDates.has(ds)
                      return (
                        <div key={di} className={`w-[10px] h-[10px] rounded-[2px] ${
                          future ? 'bg-gray-50' : active ? 'bg-green-500' : 'bg-gray-100'
                        }`} />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Follow tab ─────────────────────────────────────────────────────────────
function FollowTab() {
  const supabase = createClient()
  const router   = useRouter()
  const [loading,    setLoading]    = useState(true)
  const [following,  setFollowing]  = useState<Profile[]>([])
  const [followerCount, setFollowerCount] = useState(0)
  const [search,     setSearch]     = useState('')
  const [candidates, setCandidates] = useState<Profile[]>([])
  const [dropOpen,   setDropOpen]   = useState(false)
  const [userId,     setUserId]     = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      const [{ data: followingData }, { count }] = await Promise.all([
        supabase
          .from('follows')
          .select('following:profiles!following_id(id, nickname, avatar_url)')
          .eq('follower_id', user.id),
        supabase.from('follows').select('*', { count: 'exact', head: true })
          .eq('following_id', user.id),
      ])

      setFollowing((followingData ?? []).map((f: any) => f.following as Profile))
      setFollowerCount(count ?? 0)
      setLoading(false)
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const searchProfiles = useCallback(async (q: string) => {
    if (!q.trim()) { setCandidates([]); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('profiles') as any)
      .select('id, nickname, avatar_url')
      .ilike('nickname', `%${q.trim()}%`)
      .limit(6)
    setCandidates(
      (data ?? []).filter((p: Profile) =>
        p.id !== userId && !following.some(f => f.id === p.id)
      )
    )
  }, [following, userId, supabase])

  useEffect(() => {
    const timer = setTimeout(() => searchProfiles(search), 200)
    return () => clearTimeout(timer)
  }, [search, searchProfiles])

  async function follow(profile: Profile) {
    if (!userId) return
    setSearch(''); setCandidates([]); setDropOpen(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('follows') as any)
      .insert({ follower_id: userId, following_id: profile.id })
    if (!error) setFollowing(prev => [...prev, profile])
  }

  async function unfollow(profileId: string) {
    if (!userId) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('follows') as any)
      .delete().eq('follower_id', userId).eq('following_id', profileId)
    if (!error) setFollowing(prev => prev.filter(f => f.id !== profileId))
  }

  if (loading) return <div className="card animate-pulse h-48" />

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">我的关注</h2>
          <span className="text-xs text-gray-400">{followerCount} 人关注你</span>
        </div>

        {following.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">还没有关注任何人</p>
        ) : (
          <div className="space-y-2">
            {following.map(p => (
              <div key={p.id} className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${p.id}`}
                  alt="" className="w-8 h-8 rounded-full bg-gray-100 shrink-0 object-cover" />
                <span className="text-sm text-gray-800 flex-1">{p.nickname}</span>
                <button onClick={() => unfollow(p.id)}
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded transition-colors">
                  取消关注
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative">
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setDropOpen(true) }}
            onFocus={() => setDropOpen(true)}
            onBlur={() => setTimeout(() => { setDropOpen(false); setSearch(''); setCandidates([]) }, 150)}
            placeholder="搜索用户昵称来关注…"
            className="input text-sm"
          />
          {dropOpen && candidates.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100
                            rounded-xl shadow-lg overflow-hidden">
              {candidates.map(p => (
                <button key={p.id} onMouseDown={() => follow(p)}
                  className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 hover:bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${p.id}`}
                    alt="" className="w-6 h-6 rounded-full bg-gray-100 shrink-0 object-cover" />
                  <span>{p.nickname}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400">关注后，对方发起新接龙时你将收到邮件通知。</p>
      </div>
    </div>
  )
}

// ── PWA install button ─────────────────────────────────────────────────────
function PwaInstallButton() {
  const [standalone, setStandalone] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const [isIos, setIsIos] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && (window.navigator as any).standalone === true)
    setStandalone(isStandalone)
    setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent))

    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (standalone) return null

  async function handleInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      await deferredPrompt.userChoice
      setDeferredPrompt(null)
    } else {
      setShowGuide(true)
    }
  }

  return (
    <>
      <button onClick={handleInstall}
        className="flex items-center gap-1 text-xs text-gray-400 font-medium px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        安装App
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowGuide(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3">
            <h3 className="text-base font-bold text-gray-900 text-center">添加到主屏幕</h3>
            <div className="text-sm text-gray-500 space-y-2">
              {isIos ? (
                <>
                  <p>1. 点击 Safari 底部
                    {' '}<span className="font-medium text-gray-700">共享</span>
                    {' '}按钮
                    {/* iPhone share icon */}
                    {' '}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round"
                      className="w-4 h-4 inline-block align-middle mb-0.5">
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                      <polyline points="16 6 12 2 8 6"/>
                      <line x1="12" y1="2" x2="12" y2="15"/>
                    </svg>
                  </p>
                  <p>2. 查看更多，选择
                    {' '}<span className="font-medium text-gray-700">添加至主屏幕</span>
                    {/* iPhone add-to-homescreen icon */}
                    {' '}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round"
                      className="w-4 h-4 inline-block align-middle mb-0.5">
                      <rect x="3" y="3" width="18" height="18" rx="3"/>
                      <line x1="12" y1="8" x2="12" y2="16"/>
                      <line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                  </p>
                  <p>3. 请 toggle on <span className="font-medium text-gray-700">作为网页App打开</span>，然后点击右上角 <span className="font-medium text-gray-700">添加</span>。</p>
                </>
              ) : (
                <p>请使用浏览器菜单中的"安装应用"或"添加到主屏幕"选项。</p>
              )}
            </div>
            <button onClick={() => setShowGuide(false)}
              className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold active:bg-gray-200 transition-colors">
              知道了
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ── About tab ──────────────────────────────────────────────────────────────
function AboutTab({ changelog, version }: { changelog: ChangelogEntry[]; version: string }) {
  return (
    <div className="px-1 py-2 space-y-6">
      {/* Meta */}
      <div className="text-sm text-gray-600 space-y-1">
        <p>Version: {version}</p>
        <p>Author: Yang</p>
        <p className="break-all">Github: <a href="https://github.com/leotralino/vegedog_badminton_webapp" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">github.com/leotralino/vegedog_badminton_webapp</a></p>
        <p>Contributors: 茶茶不吃饭, Vega</p>
      </div>

      <hr className="border-gray-200" />

      {/* Changelog — document style */}
      <div className="space-y-6">
        {changelog.map(({ version: v, date, notes }) => (
          <div key={v}>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-sm text-gray-900">v{v}</span>
              <span className="text-sm text-gray-400">{date}</span>
            </div>
            <ul className="space-y-1.5">
              {notes.map((note, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-600 leading-snug">
                  <span className="text-gray-300 shrink-0 mt-px">·</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main client component ──────────────────────────────────────────────────
export default function SettingsClient({
  changelog,
  version,
  setup,
}: {
  changelog: ChangelogEntry[]
  version: string
  setup?: boolean
}) {
  const supabase = createClient()
  const router   = useRouter()
  const [tab, setTab] = useState<Tab>('账户')

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const tabs: Tab[] = ['账户', '统计', '关注', '关于']

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">设置</h1>
        <PwaInstallButton />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/dog_coding.png" alt="" aria-hidden="true"
        className="fixed bottom-16 left-1/2 -translate-x-1/2 w-80 h-80 object-contain pointer-events-none opacity-30 z-0" />

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors
              ${tab === t
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === '账户' && <AccountTab onSignOut={signOut} setup={setup} />}
      {tab === '统计' && <StatsTab />}
      {tab === '关注' && <FollowTab />}
      {tab === '关于' && <AboutTab changelog={changelog} version={version} />}
    </main>
  )
}
