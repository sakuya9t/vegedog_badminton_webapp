'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { defaultStartsAt, defaultWithdrawDeadline, localToPacificISO } from '@/lib/dates'
import DateTimePicker from '@/components/DateTimePicker'
import { PRESET_LOCATIONS } from '@/lib/locations'
import type { Profile } from '@/lib/types'

const DEFAULT_NOTES = `周三6pm前只接受一位+1
之后不限量+1
+1 需标注姓名
费用：$18
10-11pm: ~$2（估算）`

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button type="button" onClick={copy} title="复制地址"
      className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600
                 hover:bg-gray-100 transition-colors">
      {copied ? (
        <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      )}
    </button>
  )
}

/** Blocks browser close/refresh; calls onBlock(href) for in-app link clicks. */
function useNavigationGuard(
  dirtyRef: React.RefObject<boolean>,
  onBlock: (href: string) => void,
) {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    const onLinkClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return
      const anchor = (e.target as Element).closest('a[href]')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      if (!href || href.startsWith('#')) return
      e.preventDefault()
      e.stopPropagation()
      onBlock(href)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onLinkClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onLinkClick, true)
    }
  }, [dirtyRef, onBlock])
}

export default function NewSessionPage() {
  const router   = useRouter()
  const supabase = createClient()

  // Navigation guard — becomes active on first user input, cleared on submit
  const dirtyRef = useRef(false)
  const [blockedHref, setBlockedHref] = useState<string | null>(null)
  const handleBlock = useCallback((href: string) => setBlockedHref(href), [])
  useNavigationGuard(dirtyRef, handleBlock)

  // Location state
  const [locDropOpen,    setLocDropOpen]    = useState(false)
  const [locationPreset, setLocationPreset] = useState(PRESET_LOCATIONS[0].name)
  const [isCustom,       setIsCustom]       = useState(false)
  const [customNickname, setCustomNickname] = useState('')
  const [customAddress,  setCustomAddress]  = useState('')
  const locRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (locRef.current && !locRef.current.contains(e.target as Node)) setLocDropOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const selectedPreset = PRESET_LOCATIONS.find(p => p.name === locationPreset)
  const displayedAddress = isCustom ? customAddress : (selectedPreset?.address ?? '')
  const displayedName    = isCustom ? (customNickname || '自定义地点') : locationPreset

  // Form state
  const [form, setForm] = useState({
    title:             '周五菜狗',
    starts_at:         defaultStartsAt(),
    withdraw_deadline: '',
    max_participants:  '8',
    court_count:       '2',
    notes:             DEFAULT_NOTES,
  })
  useState(() => {
    setForm(f => ({ ...f, withdraw_deadline: defaultWithdrawDeadline(f.starts_at) }))
  })

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [notifyFollowers, setNotifyFollowers] = useState(true)

  // Co-admin picker
  const [coAdmins,          setCoAdmins]          = useState<Profile[]>([])
  const [adminSearch,       setAdminSearch]       = useState('')
  const [adminCandidates,   setAdminCandidates]   = useState<Profile[]>([])
  const [adminDropOpen,     setAdminDropOpen]     = useState(false)
  const adminInputRef = useRef<HTMLInputElement>(null)

  const searchAdmins = useCallback(async (q: string) => {
    if (!q.trim()) { setAdminCandidates([]); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('profiles') as any)
      .select('id, nickname, avatar_url')
      .ilike('nickname', `%${q.trim()}%`)
      .limit(6)
    setAdminCandidates(
      (data ?? []).filter((p: Profile) => !coAdmins.some(a => a.id === p.id))
    )
  }, [coAdmins, supabase])

  useEffect(() => {
    const timer = setTimeout(() => searchAdmins(adminSearch), 200)
    return () => clearTimeout(timer)
  }, [adminSearch, searchAdmins])

  function set(key: string, value: string) {
    dirtyRef.current = true
    setForm(f => ({ ...f, [key]: value }))
  }

  function handleStartsAtChange(value: string) {
    set('starts_at', value)
    set('withdraw_deadline', defaultWithdrawDeadline(value))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const maxP   = parseInt(form.max_participants)
      const courtC = parseInt(form.court_count)
      const loc    = isCustom ? customNickname.trim() : locationPreset
      const addr   = isCustom ? (customAddress.trim() || null) : null

      if (!form.title.trim()) throw new Error('标题不能为空')
      if (!loc)               throw new Error('地点不能为空')
      if (isCustom && !customNickname.trim()) throw new Error('请输入地点昵称')
      if (isNaN(maxP)   || maxP < 1)   throw new Error('满员人数必须大于 0')
      if (isNaN(courtC) || courtC < 1) throw new Error('场地数必须大于 0')

      const startsAtISO = localToPacificISO(form.starts_at)
      const deadlineISO = localToPacificISO(form.withdraw_deadline)

      if (new Date(deadlineISO) > new Date(startsAtISO)) {
        throw new Error('退出截止时间必须早于开始时间')
      }

      const { data, error: dbErr } = await supabase
        .from('sessions')
        .insert({
          title:             form.title.trim(),
          location:          loc,
          location_address:  addr,
          starts_at:         startsAtISO,
          withdraw_deadline: deadlineISO,
          max_participants:  maxP,
          court_count:       courtC,
          notes:             form.notes.trim() || null,
          status:            'open',
          initiator_id:      user.id,
        })
        .select()
        .single() as { data: { id: string } | null; error: unknown }

      if (dbErr) throw dbErr
      const sessionId = (data as { id: string }).id

      // Insert co-admins (initiator already added by DB trigger)
      if (coAdmins.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('session_admins') as any).insert(
          coAdmins.map(p => ({ session_id: sessionId, user_id: p.id }))
        )
      }

      // Notify followers (fire-and-forget)
      if (notifyFollowers) {
        fetch('/api/notify-followers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        }).catch(() => {})
      }

      dirtyRef.current = false  // clear guard before navigating
      router.push(`/sessions/${sessionId}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '出现错误，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">创建场次</h1>

      <form onSubmit={submit} className="space-y-4">

        {/* Basic */}
        <div className="card space-y-3">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">基本信息</h2>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">标题</label>
            <input className="input" placeholder="周五菜狗"
              value={form.title} onChange={e => set('title', e.target.value)} required />
          </div>

          {/* Location picker */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">地点</label>
            <div ref={locRef} className="relative">
              {/* Trigger button */}
              <button
                type="button"
                onClick={() => setLocDropOpen(o => !o)}
                className="input w-full flex items-center justify-between text-left"
              >
                <span className={isCustom && !customNickname ? 'text-gray-400' : ''}>
                  {displayedName}
                </span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${locDropOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
                </svg>
              </button>

              {/* Dropdown */}
              {locDropOpen && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-100
                                rounded-xl shadow-lg overflow-hidden">
                  {PRESET_LOCATIONS.map(loc => (
                    <button
                      key={loc.name}
                      type="button"
                      onMouseDown={() => {
                        dirtyRef.current = true
                        setLocationPreset(loc.name)
                        setIsCustom(false)
                        setLocDropOpen(false)
                      }}
                      className={`w-full text-left px-4 py-3 transition-colors hover:bg-gray-50
                        ${!isCustom && locationPreset === loc.name ? 'bg-brand-50' : ''}`}
                    >
                      <p className="text-sm font-semibold text-gray-900">{loc.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{loc.address}</p>
                    </button>
                  ))}
                  <button
                    type="button"
                    onMouseDown={() => { setIsCustom(true); setLocDropOpen(false) }}
                    className="w-full text-left px-4 py-3 border-t border-gray-100
                               text-sm text-brand-600 font-semibold hover:bg-brand-50 transition-colors"
                  >
                    + 添加其他地点
                  </button>
                </div>
              )}
            </div>

            {/* Address row for preset */}
            {!isCustom && displayedAddress && (
              <div className="flex items-center gap-2 mt-2">
                <p className="text-xs text-gray-400 flex-1 select-all leading-relaxed">
                  {displayedAddress}
                </p>
                <CopyButton text={displayedAddress} />
              </div>
            )}

            {/* Custom location inputs */}
            {isCustom && (
              <div className="mt-2 space-y-2 border border-gray-100 rounded-xl p-3">
                <input
                  className="input"
                  placeholder="地点昵称（如：菜狗村）"
                  value={customNickname}
                  onChange={e => setCustomNickname(e.target.value)}
                  required={isCustom}
                />
                <div className="flex items-center gap-2">
                  <input
                    className="input flex-1"
                    placeholder="详细地址（可选）"
                    value={customAddress}
                    onChange={e => setCustomAddress(e.target.value)}
                  />
                  {customAddress && <CopyButton text={customAddress} />}
                </div>
                <button
                  type="button"
                  onClick={() => { setIsCustom(false); setCustomNickname(''); setCustomAddress('') }}
                  className="text-xs text-gray-400 underline"
                >
                  返回预设地点
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Schedule */}
        <div className="card space-y-3 overflow-hidden">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
            时间 <span className="font-normal normal-case text-gray-400">（太平洋时区）</span>
          </h2>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">开始时间</label>
            <DateTimePicker label="开始时间" value={form.starts_at} onChange={handleStartsAtChange} />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">退出截止时间</label>
            <DateTimePicker label="退出截止时间" value={form.withdraw_deadline} onChange={v => set('withdraw_deadline', v)} />
          </div>
        </div>

        {/* Capacity */}
        <div className="card space-y-3">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">人数</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">场地数</label>
              <input type="number" className="input" min="1" max="20"
                value={form.court_count}
                onChange={e => set('court_count', e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">满员</label>
              <input type="number" className="input" min="1" max="200"
                value={form.max_participants}
                onChange={e => set('max_participants', e.target.value)} />
            </div>
          </div>
        </div>

        {/* 注意事项 */}
        <div className="card space-y-3">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">注意事项</h2>
          <textarea
            className="input min-h-[120px] resize-y"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="费用、规则、注意事项等…"
          />
        </div>

        {/* Co-admin picker */}
        <div className="card space-y-3">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">管理员</h2>
          <p className="text-xs text-gray-400">你会自动成为管理员，可在此添加其他人。</p>

          {coAdmins.length > 0 && (
            <div className="space-y-1.5">
              {coAdmins.map(p => (
                <div key={p.id} className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${p.id}`}
                    alt="" className="w-6 h-6 rounded-full bg-gray-100 shrink-0 object-cover" />
                  <span className="text-sm text-gray-700 flex-1">{p.nickname}</span>
                  <button type="button" onClick={() => setCoAdmins(prev => prev.filter(a => a.id !== p.id))}
                    className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded transition-colors">
                    移除
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="relative">
            <input
              ref={adminInputRef}
              type="text"
              value={adminSearch}
              onChange={e => { setAdminSearch(e.target.value); setAdminDropOpen(true) }}
              onFocus={() => setAdminDropOpen(true)}
              onBlur={() => setTimeout(() => { setAdminDropOpen(false); setAdminSearch(''); setAdminCandidates([]) }, 150)}
              placeholder="搜索用户昵称…"
              className="input text-sm"
            />
            {adminDropOpen && adminCandidates.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-gray-100
                              rounded-xl shadow-lg overflow-hidden">
                {adminCandidates.map(p => (
                  <button key={p.id} type="button"
                    onMouseDown={() => {
                      setCoAdmins(prev => [...prev, p])
                      setAdminSearch(''); setAdminCandidates([]); setAdminDropOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${p.id}`}
                      alt="" className="w-6 h-6 rounded-full bg-gray-100 shrink-0 object-cover" />
                    <span>{p.nickname}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <label className="card flex items-center justify-between cursor-pointer select-none">
          <span className="text-sm font-medium text-gray-700">通知关注我的人</span>
          <input
            type="checkbox"
            checked={notifyFollowers}
            onChange={e => setNotifyFollowers(e.target.checked)}
            className="w-4 h-4 rounded accent-brand-600"
          />
        </label>

        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>
        )}

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? '创建中…' : '创建场次'}
        </button>

      </form>

      {/* Custom leave-confirm dialog */}
      {blockedHref && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setBlockedHref(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <p className="text-base font-semibold text-gray-900">确定要退出吗？</p>
            <p className="text-sm text-gray-500">内容不会保存。</p>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setBlockedHref(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 active:bg-gray-50">
                取消
              </button>
              <button
                type="button"
                onClick={() => { dirtyRef.current = false; router.push(blockedHref) }}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold active:opacity-80">
                退出
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
