'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RestaurantWithDetails, RestaurantRecommendation } from '@/lib/types'

const GROUP_SIZE_OPTIONS = ['小桌(≤6人)', '大桌(7-12人)', '包间(12+人)']
const COMMON_CUISINES = ['中餐', '日料', '韩餐', '美式', '墨西哥', '越南菜', '泰餐', '其他']

const EMPTY_FORM = {
  name: '',
  cuisine: '',
  distance: '',
  address: '',
  hours: '',
  yelp_url: '',
  google_maps_url: '',
  has_wait: false,
  accepts_reservation: false,
  group_size: '',
}

const RESTAURANT_SELECT = `
  *,
  adder:profiles!added_by(id, nickname, avatar_url),
  dishes:restaurant_dishes(id, name, added_by),
  recommendations:restaurant_recommendations(id, user_id, recommended),
  tags:restaurant_tags(id, name, added_by)
`

// ── Open-now helpers ──────────────────────────────────────────────────────────

function parseMinutes(s: string): number {
  const m = s.trim().match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return -1
  let h = parseInt(m[1])
  const min = parseInt(m[2])
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
  return h * 60 + min
}

function isOpenNow(hours: string | null | undefined): boolean {
  if (!hours) return false
  const lower = hours.toLowerCase()
  if (lower.includes('open 24 hours') || lower.includes('24/7')) return true

  const now = new Date()
  const currentMins = now.getHours() * 60 + now.getMinutes()

  function checkRange(range: string): boolean {
    const r = range.toLowerCase().trim()
    if (r === 'closed') return false
    if (r.includes('open 24')) return true
    const parts = range.split(/\s[–\-]\s/)
    if (parts.length !== 2) return false
    const open = parseMinutes(parts[0])
    let close = parseMinutes(parts[1])
    if (open === -1 || close === -1) return false
    if (close <= open) close += 24 * 60
    return currentMins >= open && currentMins < close
  }

  if (hours.startsWith('Daily ')) return checkRange(hours.slice(6))

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const today = dayNames[now.getDay()]
  for (const line of hours.split('\n')) {
    if (line.startsWith(today + ':')) return checkRange(line.slice(today.length + 2))
  }
  return false
}

// ── RestaurantCard ────────────────────────────────────────────────────────────

interface CardProps {
  r: RestaurantWithDetails
  currentUserId: string
  onRecommend: (id: string, val: boolean) => void
  onEdit: (r: RestaurantWithDetails) => void
  onDelete?: (id: string) => void
}

function RestaurantCard({ r, currentUserId, onRecommend, onEdit, onDelete }: CardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const thumbsUp = r.recommendations.filter(rec => rec.recommended).length
  const thumbsDown = r.recommendations.filter(rec => !rec.recommended).length
  const myRec = r.recommendations.find(rec => rec.user_id === currentUserId)
  const mapsUrl = r.google_maps_url
    || (r.address ? `https://maps.google.com/maps?q=${encodeURIComponent(r.address)}` : null)

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-gray-900 leading-snug">{r.name}</h2>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {r.cuisine && <span className="badge bg-brand-100 text-brand-700">{r.cuisine}</span>}
            {r.distance && <span className="badge bg-gray-100 text-gray-600">{r.distance}</span>}
            {r.group_size && <span className="badge bg-blue-50 text-blue-600">{r.group_size}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onRecommend(r.id, true)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm transition-colors ${
              myRec?.recommended === true
                ? 'bg-brand-100 text-brand-700'
                : 'bg-gray-100 text-gray-500 active:bg-gray-200'
            }`}
          >
            👍 <span className="tabular-nums">{thumbsUp}</span>
          </button>
          <button
            onClick={() => onRecommend(r.id, false)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm transition-colors ${
              myRec?.recommended === false
                ? 'bg-red-100 text-red-600'
                : 'bg-gray-100 text-gray-500 active:bg-gray-200'
            }`}
          >
            👎 <span className="tabular-nums">{thumbsDown}</span>
          </button>
        </div>
      </div>

      <div className="space-y-1.5 text-sm text-gray-600">
        {r.address && (
          <div className="flex items-start gap-2">
            <span className="shrink-0 mt-px">📍</span>
            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 underline underline-offset-2 leading-snug"
              >
                {r.address}
              </a>
            ) : (
              <span className="leading-snug">{r.address}</span>
            )}
          </div>
        )}
        {r.hours && (
          <div className="flex items-center gap-2">
            <span>⏰</span>
            <span>{r.hours}</span>
          </div>
        )}
        {r.yelp_url && (
          <div className="flex items-center gap-2">
            <span>🔗</span>
            <a
              href={r.yelp_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 underline underline-offset-2"
            >
              Yelp 链接
            </a>
          </div>
        )}
      </div>

      {/* System tags */}
      {(r.has_wait || r.accepts_reservation) && (
        <div className="flex flex-wrap gap-1.5">
          {r.has_wait && (
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
              需要等位
            </span>
          )}
          {r.accepts_reservation && (
            <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">
              可以预约
            </span>
          )}
        </div>
      )}

      {/* Custom tags */}
      {r.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.tags.map(t => (
            <span
              key={t.id}
              className="text-xs bg-violet-50 text-violet-700 border border-violet-100 px-2 py-0.5 rounded-full"
            >
              {t.name}
            </span>
          ))}
        </div>
      )}

      {r.dishes.length > 0 && (
        <div className="pt-2.5 border-t border-gray-100">
          <p className="text-xs text-gray-400 mb-1.5">推荐菜</p>
          <div className="flex flex-wrap gap-1.5">
            {r.dishes.map(d => (
              <span
                key={d.id}
                className="text-sm bg-orange-50 text-orange-700 border border-orange-100 px-2.5 py-0.5 rounded-full"
              >
                {d.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer row: adder + actions */}
      <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {r.adder && (
            <>
              {r.adder.avatar_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.adder.avatar_url} alt="" className="w-4 h-4 rounded-full shrink-0" />
              )}
              <span className="text-xs text-gray-400 truncate">{r.adder.nickname} 添加</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onDelete && (
            confirmDelete ? (
              <>
                <button
                  onClick={() => { onDelete(r.id); setConfirmDelete(false) }}
                  className="text-xs text-red-600 font-medium hover:text-red-700 transition-colors"
                >
                  确认删除
                </button>
                <span className="text-gray-200">|</span>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  取消
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-gray-300 hover:text-red-400 transition-colors flex items-center gap-0.5"
              >
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M6 2h4a1 1 0 0 1 1 1H5a1 1 0 0 1 1-1zM2 4h12v1H2V4zm2 2h8l-.8 8H4.8L4 6zm2 1v6h1V7H6zm3 0v6h1V7H9z"/>
                </svg>
                删除
              </button>
            )
          )}
          {currentUserId && (
            <button
              onClick={() => onEdit(r)}
              className="text-xs text-gray-400 hover:text-brand-600 transition-colors flex items-center gap-0.5"
            >
              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z"/>
              </svg>
              补充/编辑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Filter helpers ────────────────────────────────────────────────────────────

interface AppliedFilters {
  cuisine: string
  groupSize: string
  reserveOnly: boolean
  openNow: boolean
}

function applyFilters(list: RestaurantWithDetails[], f: AppliedFilters) {
  return list.filter(r => {
    if (f.cuisine && r.cuisine !== f.cuisine) return false
    if (f.groupSize && r.group_size !== f.groupSize) return false
    if (f.reserveOnly && !r.accepts_reservation) return false
    if (f.openNow && !isOpenNow(r.hours)) return false
    return true
  })
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  initialRestaurants: RestaurantWithDetails[]
  currentUserId: string
  isAdmin: boolean
}

export default function PostMatchClient({ initialRestaurants, currentUserId, isAdmin }: Props) {
  const supabase = createClient()
  const [restaurants, setRestaurants] = useState<RestaurantWithDetails[]>(initialRestaurants)

  // Add modal
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [dishes, setDishes] = useState<string[]>([])
  const [newDish, setNewDish] = useState('')
  const [addTags, setAddTags] = useState<string[]>([])
  const [newAddTag, setNewAddTag] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parseMsg, setParseMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [parseExtra, setParseExtra] = useState<{
    rating?: number; userRatingCount?: number; priceLevel?: string; phone?: string; website?: string
  } | null>(null)

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingRestaurant = editingId ? (restaurants.find(r => r.id === editingId) ?? null) : null
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [editNewTag, setEditNewTag] = useState('')
  const [editNewTags, setEditNewTags] = useState<string[]>([])
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editParsing, setEditParsing] = useState(false)
  const [editParseMsg, setEditParseMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // Filter / random
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [rfCuisine, setRfCuisine] = useState('')
  const [rfGroupSize, setRfGroupSize] = useState('')
  const [rfReserveOnly, setRfReserveOnly] = useState(false)
  const [rfOpenNow, setRfOpenNow] = useState(false)
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters | null>(null)
  const [pickedId, setPickedId] = useState<string | null>(null)

  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const displayedRestaurants = useMemo(
    () => appliedFilters ? applyFilters(restaurants, appliedFilters) : restaurants,
    [restaurants, appliedFilters]
  )
  const picked = pickedId ? (restaurants.find(r => r.id === pickedId) ?? null) : null

  const cuisineOptions = useMemo(() => {
    const seen = new Set(COMMON_CUISINES)
    const extras: string[] = []
    for (const r of restaurants) {
      if (r.cuisine && !seen.has(r.cuisine)) { seen.add(r.cuisine); extras.push(r.cuisine) }
    }
    return [...COMMON_CUISINES, ...extras]
  }, [restaurants])

  const existingCuisines = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const r of restaurants) {
      if (r.cuisine && !seen.has(r.cuisine)) { seen.add(r.cuisine); result.push(r.cuisine) }
    }
    return result
  }, [restaurants])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Parse Google Maps (shared logic) ──────────────────────────────────────

  async function fetchGMaps(url: string) {
    const res = await fetch(`/api/parse-gmaps?url=${encodeURIComponent(url)}`)
    return res.json()
  }

  async function handleParseGMaps() {
    const url = form.google_maps_url.trim()
    if (!url) return
    setParsing(true); setParseMsg(null)
    try {
      const data = await fetchGMaps(url)
      if (data.error) { setParseMsg({ text: '解析失败，请手动填写', ok: false }); return }
      const filled: string[] = []
      const updates: Partial<typeof EMPTY_FORM> = {}
      if (data.name    && !form.name.trim())    { updates.name    = data.name;    filled.push('店名') }
      if (data.address && !form.address.trim()) { updates.address = data.address; filled.push('地址') }
      if (data.hours   && !form.hours.trim())   { updates.hours   = data.hours;   filled.push('营业时间') }
      if (data.cuisine && !form.cuisine.trim()) { updates.cuisine = data.cuisine; filled.push('菜系') }
      if (filled.length > 0) {
        setForm(f => ({ ...f, ...updates }))
        setParseMsg({ text: `已自动填入：${filled.join('、')}`, ok: true })
      } else if (!data.name && !data.address) {
        setParseMsg({ text: '未能识别内容，请手动填写', ok: false })
      } else {
        setParseMsg({ text: '字段已有内容，未覆盖', ok: true })
      }
      if (data.rating || data.phone || data.website) {
        setParseExtra({ rating: data.rating, userRatingCount: data.userRatingCount, priceLevel: data.priceLevel, phone: data.phone, website: data.website })
      }
    } catch {
      setParseMsg({ text: '解析失败，请手动填写', ok: false })
    } finally {
      setParsing(false)
    }
  }

  async function handleEditParseGMaps() {
    const url = editForm.google_maps_url.trim()
    if (!url) return
    setEditParsing(true); setEditParseMsg(null)
    try {
      const data = await fetchGMaps(url)
      if (data.error) { setEditParseMsg({ text: '解析失败', ok: false }); return }
      const filled: string[] = []
      const updates: Partial<typeof EMPTY_FORM> = {}
      if (data.name)    { updates.name    = data.name;    filled.push('店名') }
      if (data.address) { updates.address = data.address; filled.push('地址') }
      if (data.hours)   { updates.hours   = data.hours;   filled.push('营业时间') }
      if (data.cuisine) { updates.cuisine = data.cuisine; filled.push('菜系') }
      if (filled.length > 0) {
        setEditForm(f => ({ ...f, ...updates }))
        setEditParseMsg({ text: `已填入：${filled.join('、')}`, ok: true })
      } else {
        setEditParseMsg({ text: '未能识别内容', ok: false })
      }
    } catch {
      setEditParseMsg({ text: '解析失败', ok: false })
    } finally {
      setEditParsing(false)
    }
  }

  // ── Add modal ─────────────────────────────────────────────────────────────

  function openModal() {
    setForm(EMPTY_FORM); setDishes([]); setNewDish(''); setAddTags([]); setNewAddTag('')
    setParseMsg(null); setParseExtra(null); setShowModal(true)
  }

  function addDish() {
    const d = newDish.trim()
    if (!d || dishes.includes(d)) return
    setDishes(prev => [...prev, d]); setNewDish('')
  }

  function addTagToList() {
    const t = newAddTag.trim()
    if (!t || addTags.includes(t)) return
    setAddTags(prev => [...prev, t]); setNewAddTag('')
  }

  async function handleSubmit() {
    if (!form.name.trim()) return
    setSubmitting(true)
    try {
      const { data: restaurant, error } = await supabase
        .from('restaurants')
        .insert({
          name: form.name.trim(), cuisine: form.cuisine.trim() || null,
          distance: form.distance.trim() || null, address: form.address.trim() || null,
          hours: form.hours.trim() || null, yelp_url: form.yelp_url.trim() || null,
          google_maps_url: form.google_maps_url.trim() || null,
          has_wait: form.has_wait, accepts_reservation: form.accepts_reservation,
          group_size: form.group_size || null, added_by: currentUserId,
        })
        .select('id').single()
      if (error || !restaurant) { showToast('添加失败，请重试', false); return }
      if (dishes.length > 0) {
        await supabase.from('restaurant_dishes').insert(
          dishes.map(d => ({ restaurant_id: restaurant.id, name: d, added_by: currentUserId }))
        )
      }
      if (addTags.length > 0) {
        await supabase.from('restaurant_tags').insert(
          addTags.map(t => ({ restaurant_id: restaurant.id, name: t, added_by: currentUserId }))
        )
      }
      const { data: full } = await supabase
        .from('restaurants').select(RESTAURANT_SELECT).eq('id', restaurant.id).single()
      if (full) setRestaurants(prev => [full as unknown as RestaurantWithDetails, ...prev])
      setShowModal(false); showToast('餐厅已添加！')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Edit modal ────────────────────────────────────────────────────────────

  function openEditModal(r: RestaurantWithDetails) {
    setEditingId(r.id)
    setEditForm({
      name: r.name, cuisine: r.cuisine ?? '', distance: r.distance ?? '',
      address: r.address ?? '', hours: r.hours ?? '', yelp_url: r.yelp_url ?? '',
      google_maps_url: r.google_maps_url ?? '', has_wait: r.has_wait,
      accepts_reservation: r.accepts_reservation, group_size: r.group_size ?? '',
    })
    setEditNewTag(''); setEditNewTags([]); setEditParseMsg(null); setShowEditModal(true)
  }

  function addEditTag() {
    const t = editNewTag.trim()
    if (!t || editNewTags.includes(t)) return
    if (editingRestaurant?.tags.some(tag => tag.name === t)) return
    setEditNewTags(prev => [...prev, t]); setEditNewTag('')
  }

  async function handleEditSubmit() {
    if (!editingRestaurant || !editForm.name.trim()) return
    setEditSubmitting(true)
    try {
      const { error } = await supabase
        .from('restaurants')
        .update({
          name: editForm.name.trim(), cuisine: editForm.cuisine.trim() || null,
          distance: editForm.distance.trim() || null, address: editForm.address.trim() || null,
          hours: editForm.hours.trim() || null, yelp_url: editForm.yelp_url.trim() || null,
          google_maps_url: editForm.google_maps_url.trim() || null,
          has_wait: editForm.has_wait, accepts_reservation: editForm.accepts_reservation,
          group_size: editForm.group_size || null,
          last_updated_by: currentUserId,
        })
        .eq('id', editingRestaurant.id)
      if (error) { showToast('保存失败，请重试', false); return }
      if (editNewTags.length > 0) {
        await supabase.from('restaurant_tags').upsert(
          editNewTags.map(t => ({ restaurant_id: editingRestaurant.id, name: t, added_by: currentUserId })),
          { onConflict: 'restaurant_id,name', ignoreDuplicates: true }
        )
      }
      const { data: full } = await supabase
        .from('restaurants').select(RESTAURANT_SELECT).eq('id', editingRestaurant.id).single()
      if (full) {
        setRestaurants(prev => prev.map(r =>
          r.id === editingRestaurant.id ? full as unknown as RestaurantWithDetails : r
        ))
      }
      setShowEditModal(false); showToast('信息已更新！')
    } finally {
      setEditSubmitting(false)
    }
  }

  // ── Recommend ─────────────────────────────────────────────────────────────

  async function handleRecommend(restaurantId: string, value: boolean) {
    const r = restaurants.find(r => r.id === restaurantId)
    if (!r) return
    const existing = r.recommendations.find(rec => rec.user_id === currentUserId)
    if (existing?.recommended === value) {
      setRestaurants(prev => prev.map(r =>
        r.id !== restaurantId ? r : { ...r, recommendations: r.recommendations.filter(rec => rec.user_id !== currentUserId) }
      ))
      await supabase.from('restaurant_recommendations').delete()
        .eq('restaurant_id', restaurantId).eq('user_id', currentUserId)
    } else {
      const newRec: RestaurantRecommendation = {
        id: existing?.id ?? crypto.randomUUID(), restaurant_id: restaurantId,
        user_id: currentUserId, recommended: value, created_at: new Date().toISOString(),
      }
      setRestaurants(prev => prev.map(r =>
        r.id !== restaurantId ? r : {
          ...r,
          recommendations: existing
            ? r.recommendations.map(rec => rec.user_id === currentUserId ? newRec : rec)
            : [...r.recommendations, newRec],
        }
      ))
      await supabase.from('restaurant_recommendations').upsert(
        { restaurant_id: restaurantId, user_id: currentUserId, recommended: value },
        { onConflict: 'restaurant_id,user_id' }
      )
    }
  }

  // ── Filter / random ───────────────────────────────────────────────────────

  function getDraftFilters(): AppliedFilters {
    return { cuisine: rfCuisine, groupSize: rfGroupSize, reserveOnly: rfReserveOnly, openNow: rfOpenNow }
  }

  async function handleDelete(restaurantId: string) {
    const { error } = await supabase.from('restaurants').delete().eq('id', restaurantId)
    if (error) { showToast('删除失败，请重试', false); return }
    setRestaurants(prev => prev.filter(r => r.id !== restaurantId))
    if (pickedId === restaurantId) setPickedId(null)
    showToast('餐厅已删除')
  }

  function handleFilter() {
    const f = getDraftFilters()
    setAppliedFilters(f); setPickedId(null); setShowFilterPanel(false)
    if (!applyFilters(restaurants, f).length) showToast('没有符合条件的餐厅', false)
  }

  function handleRandom() {
    const f = getDraftFilters()
    setAppliedFilters(f); setShowFilterPanel(false)
    const candidates = applyFilters(restaurants, f)
    if (!candidates.length) { showToast('没有符合条件的餐厅', false); return }
    setPickedId(candidates[Math.floor(Math.random() * candidates.length)].id)
  }

  function handleReRandom() {
    if (!displayedRestaurants.length) return
    setPickedId(displayedRestaurants[Math.floor(Math.random() * displayedRestaurants.length)].id)
  }

  function clearFilters() {
    setAppliedFilters(null); setPickedId(null)
    setRfCuisine(''); setRfGroupSize(''); setRfReserveOnly(false); setRfOpenNow(false)
  }

  const chipCls = (active: boolean) =>
    `text-xs px-2.5 py-1 rounded-full border transition-colors ${
      active ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-500 active:bg-gray-50'
    }`

  const toggleCls = (active: boolean) =>
    `flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors ${
      active ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-400'
    }`

  const hasActiveFilters = appliedFilters && (
    appliedFilters.cuisine || appliedFilters.groupSize || appliedFilters.reserveOnly || appliedFilters.openNow
  )

  // ── Shared form sections ──────────────────────────────────────────────────

  function CuisineField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">菜系</label>
        <input
          type="text"
          placeholder="输入或从下方选择..."
          value={value}
          onChange={e => onChange(e.target.value)}
          className="input text-sm"
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {cuisineOptions.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(value === c ? '' : c)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                value === c ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-500 active:bg-gray-50'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    )
  }

  function TagsField({
    existingTags, newTags, newInput,
    onNewInput, onAdd, onRemove,
  }: {
    existingTags: { id: string; name: string }[]
    newTags: string[]
    newInput: string
    onNewInput: (v: string) => void
    onAdd: () => void
    onRemove: (t: string) => void
  }) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500">自定义标签</p>
        {existingTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {existingTags.map(t => (
              <span key={t.id} className="text-xs bg-violet-50 text-violet-700 border border-violet-100 px-2.5 py-0.5 rounded-full">
                {t.name}
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="输入标签，按回车添加"
            value={newInput}
            onChange={e => onNewInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAdd() } }}
            className="input flex-1 text-sm"
          />
          <button type="button" onClick={onAdd} className="px-4 py-2 bg-violet-600 text-white text-sm rounded-xl active:bg-violet-700 shrink-0">
            添加
          </button>
        </div>
        {newTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {newTags.map(t => (
              <span key={t} className="flex items-center gap-1 text-xs bg-violet-50 text-violet-700 border border-violet-100 px-2.5 py-0.5 rounded-full">
                {t}
                <button onClick={() => onRemove(t)} className="text-violet-400 hover:text-violet-600 leading-none ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-gray-900">赛后总结</h1>
          {restaurants.length > 0 && (
            <button
              onClick={() => setShowFilterPanel(p => !p)}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1 ${
                showFilterPanel || hasActiveFilters
                  ? 'border-amber-400 bg-amber-50 text-amber-600'
                  : 'border-gray-200 bg-white text-gray-500 active:bg-gray-50'
              }`}
            >
              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.5 3h13a.5.5 0 0 1 .4.8L10 9.4V14a.5.5 0 0 1-.8.4l-3-2A.5.5 0 0 1 6 12V9.4L1.1 3.8A.5.5 0 0 1 1.5 3z"/>
              </svg>
              筛选
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 ml-0.5" />}
            </button>
          )}
        </div>
        <button
          onClick={openModal}
          className="text-sm font-semibold text-white bg-brand-600 px-3 py-1.5 rounded-lg active:bg-brand-700 transition-colors"
        >
          + 添加餐厅
        </button>
      </div>

      {/* Filter panel */}
      {showFilterPanel && (
        <div className="card space-y-3 border-amber-200 bg-amber-50/30">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">筛选条件</p>
          {existingCuisines.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">口味</p>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setRfCuisine('')} className={chipCls(rfCuisine === '')}>不限</button>
                {existingCuisines.map(c => (
                  <button key={c} onClick={() => setRfCuisine(rfCuisine === c ? '' : c)} className={chipCls(rfCuisine === c)}>{c}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-500 mb-1.5">适合人数</p>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setRfGroupSize('')} className={chipCls(rfGroupSize === '')}>不限</button>
              {GROUP_SIZE_OPTIONS.map(g => (
                <button key={g} onClick={() => setRfGroupSize(rfGroupSize === g ? '' : g)} className={chipCls(rfGroupSize === g)}>{g}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setRfReserveOnly(p => !p)} className={toggleCls(rfReserveOnly)}>
              {rfReserveOnly ? '✓' : '○'} 可以预约
            </button>
            <button onClick={() => setRfOpenNow(p => !p)} className={toggleCls(rfOpenNow)}>
              {rfOpenNow ? '✓' : '○'} 当前营业
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={handleFilter} className="flex-1 py-2.5 rounded-xl border border-amber-400 bg-white text-amber-600 font-semibold text-sm active:bg-amber-50 transition-colors">
              筛选确认
            </button>
            <button onClick={handleRandom} className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white font-semibold text-sm active:bg-amber-600 transition-colors">
              🎲 随机抽签
            </button>
          </div>
        </div>
      )}

      {/* Filter status */}
      {appliedFilters && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">
            {displayedRestaurants.length === 0 ? '无符合条件的餐厅' : `${displayedRestaurants.length} 家符合条件`}
          </span>
          <button onClick={clearFilters} className="text-gray-400 underline underline-offset-2">清除筛选</button>
        </div>
      )}

      {/* Picked result */}
      {picked && (
        <div className="card border-2 border-amber-400 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-amber-600 uppercase tracking-wide">🎲 今日推荐</p>
            <button onClick={() => setPickedId(null)} className="w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 text-lg leading-none">×</button>
          </div>
          <RestaurantCard r={picked} currentUserId={currentUserId} onRecommend={handleRecommend} onEdit={openEditModal} onDelete={
              isAdmin || (r.added_by === currentUserId && (!r.last_updated_by || r.last_updated_by === currentUserId))
                ? handleDelete
                : undefined
            } />
          <div className="flex gap-2 pt-1 border-t border-amber-100">
            <button onClick={handleReRandom} className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold active:bg-amber-600 transition-colors">
              再来一次
            </button>
            <button onClick={() => setPickedId(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm active:bg-gray-50 transition-colors">
              取消
            </button>
          </div>
        </div>
      )}

      {/* Restaurant list */}
      {displayedRestaurants.length === 0 && !appliedFilters ? (
        <div className="card text-center py-12 text-gray-400">
          <p className="text-3xl mb-2">🍜</p>
          <p className="text-sm">还没有推荐的餐厅</p>
          <p className="text-xs mt-1">赛后一起去吃饭吧！</p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayedRestaurants.map(r => (
            <div key={r.id} className="card space-y-3">
              <RestaurantCard r={r} currentUserId={currentUserId} onRecommend={handleRecommend} onEdit={openEditModal} onDelete={
              isAdmin || (r.added_by === currentUserId && (!r.last_updated_by || r.last_updated_by === currentUserId))
                ? handleDelete
                : undefined
            } />
            </div>
          ))}
        </div>
      )}

      {/* ── Add Restaurant Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <h2 className="font-semibold text-gray-900">添加餐厅</h2>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 text-lg leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-4">

              {/* Google Maps import */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Google Maps 链接 <span className="text-gray-400 font-normal">（可选）</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    placeholder="粘贴 Google Maps 链接..."
                    value={form.google_maps_url}
                    onChange={e => { setParseMsg(null); setParseExtra(null); setForm(f => ({ ...f, google_maps_url: e.target.value })) }}
                    className="input flex-1 text-sm"
                  />
                  <button type="button" onClick={handleParseGMaps} disabled={!form.google_maps_url.trim() || parsing}
                    className="shrink-0 px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm font-medium disabled:opacity-40 active:bg-gray-50 transition-colors">
                    {parsing ? '解析中…' : '解析'}
                  </button>
                </div>
                {parseMsg && <p className={`text-xs mt-1.5 ${parseMsg.ok ? 'text-brand-600' : 'text-red-500'}`}>{parseMsg.text}</p>}
                {parseExtra && (
                  <div className="mt-2 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                    {parseExtra.rating !== undefined && <span>⭐ {parseExtra.rating.toFixed(1)} ({parseExtra.userRatingCount?.toLocaleString()} 评价)</span>}
                    {parseExtra.priceLevel && <span>{'$'.repeat({ PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 }[parseExtra.priceLevel] ?? 2)}</span>}
                    {parseExtra.phone && <span>📞 {parseExtra.phone}</span>}
                    {parseExtra.website && <a href={parseExtra.website} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline underline-offset-1">官网</a>}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">店名 <span className="text-red-400">*</span></label>
                <input type="text" placeholder="餐厅名称" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input text-sm" />
              </div>

              <CuisineField value={form.cuisine} onChange={v => setForm(f => ({ ...f, cuisine: v }))} />

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">距离</label>
                <input type="text" placeholder="0.3 mi / 5分钟车程" value={form.distance} onChange={e => setForm(f => ({ ...f, distance: e.target.value }))} className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">地址</label>
                <input type="text" placeholder="123 Main St, City, CA 91234" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">营业时间</label>
                <input type="text" placeholder="Mon–Sun 11am–10pm" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Yelp 链接</label>
                <input type="url" placeholder="https://www.yelp.com/biz/..." value={form.yelp_url} onChange={e => setForm(f => ({ ...f, yelp_url: e.target.value }))} className="input text-sm" />
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium text-gray-500">标签</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setForm(f => ({ ...f, has_wait: !f.has_wait }))}
                    className={`flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors ${form.has_wait ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-400'}`}>
                    {form.has_wait ? '✓' : '○'} 需要等位
                  </button>
                  <button type="button" onClick={() => setForm(f => ({ ...f, accepts_reservation: !f.accepts_reservation }))}
                    className={`flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors ${form.accepts_reservation ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-400'}`}>
                    {form.accepts_reservation ? '✓' : '○'} 可以预约
                  </button>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-2">适合规模</p>
                  <div className="flex flex-wrap gap-2">
                    {GROUP_SIZE_OPTIONS.map(opt => (
                      <button key={opt} type="button" onClick={() => setForm(f => ({ ...f, group_size: f.group_size === opt ? '' : opt }))}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${form.group_size === opt ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-500'}`}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <TagsField
                existingTags={[]}
                newTags={addTags}
                newInput={newAddTag}
                onNewInput={setNewAddTag}
                onAdd={addTagToList}
                onRemove={t => setAddTags(prev => prev.filter(x => x !== t))}
              />

              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500">推荐菜</p>
                <div className="flex gap-2">
                  <input type="text" placeholder="输入菜名，按回车添加" value={newDish} onChange={e => setNewDish(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDish() } }} className="input flex-1 text-sm" />
                  <button type="button" onClick={addDish} className="px-4 py-2 bg-brand-600 text-white text-sm rounded-xl active:bg-brand-700 shrink-0">添加</button>
                </div>
                {dishes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {dishes.map(d => (
                      <span key={d} className="flex items-center gap-1 text-sm bg-orange-50 text-orange-700 border border-orange-100 px-2.5 py-0.5 rounded-full">
                        {d}
                        <button onClick={() => setDishes(prev => prev.filter(x => x !== d))} className="text-orange-400 hover:text-orange-600 leading-none ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="h-2" />
            </div>
            <div className="px-4 py-3 border-t border-gray-100 flex gap-3 shrink-0">
              <button onClick={() => setShowModal(false)} className="btn-secondary flex-1 py-2.5 text-sm">取消</button>
              <button onClick={handleSubmit} disabled={!form.name.trim() || submitting} className="btn-primary flex-1 py-2.5 text-sm">
                {submitting ? '添加中...' : '添加餐厅'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {showEditModal && editingRestaurant && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowEditModal(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <div>
                <h2 className="font-semibold text-gray-900">补充/编辑信息</h2>
                <p className="text-xs text-gray-400 mt-0.5">{editingRestaurant.name}</p>
              </div>
              <button onClick={() => setShowEditModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 text-lg leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-4">

              {/* Google Maps parse */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Google Maps 链接 <span className="text-gray-400 font-normal">（解析后覆盖对应字段）</span>
                </label>
                <div className="flex gap-2">
                  <input type="url" placeholder="粘贴 Google Maps 链接..." value={editForm.google_maps_url}
                    onChange={e => { setEditParseMsg(null); setEditForm(f => ({ ...f, google_maps_url: e.target.value })) }}
                    className="input flex-1 text-sm" />
                  <button type="button" onClick={handleEditParseGMaps} disabled={!editForm.google_maps_url.trim() || editParsing}
                    className="shrink-0 px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm font-medium disabled:opacity-40 active:bg-gray-50 transition-colors">
                    {editParsing ? '解析中…' : '解析'}
                  </button>
                </div>
                {editParseMsg && <p className={`text-xs mt-1.5 ${editParseMsg.ok ? 'text-brand-600' : 'text-red-500'}`}>{editParseMsg.text}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">店名 <span className="text-red-400">*</span></label>
                <input type="text" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="input text-sm" />
              </div>

              <CuisineField value={editForm.cuisine} onChange={v => setEditForm(f => ({ ...f, cuisine: v }))} />

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">距离</label>
                <input type="text" placeholder="0.3 mi / 5分钟车程" value={editForm.distance} onChange={e => setEditForm(f => ({ ...f, distance: e.target.value }))} className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">地址</label>
                <input type="text" value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">营业时间</label>
                <input type="text" value={editForm.hours} onChange={e => setEditForm(f => ({ ...f, hours: e.target.value }))} className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Yelp 链接</label>
                <input type="url" value={editForm.yelp_url} onChange={e => setEditForm(f => ({ ...f, yelp_url: e.target.value }))} className="input text-sm" />
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium text-gray-500">标签</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditForm(f => ({ ...f, has_wait: !f.has_wait }))}
                    className={`flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors ${editForm.has_wait ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-400'}`}>
                    {editForm.has_wait ? '✓' : '○'} 需要等位
                  </button>
                  <button type="button" onClick={() => setEditForm(f => ({ ...f, accepts_reservation: !f.accepts_reservation }))}
                    className={`flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors ${editForm.accepts_reservation ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-400'}`}>
                    {editForm.accepts_reservation ? '✓' : '○'} 可以预约
                  </button>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-2">适合规模</p>
                  <div className="flex flex-wrap gap-2">
                    {GROUP_SIZE_OPTIONS.map(opt => (
                      <button key={opt} type="button" onClick={() => setEditForm(f => ({ ...f, group_size: f.group_size === opt ? '' : opt }))}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${editForm.group_size === opt ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-500'}`}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <TagsField
                existingTags={editingRestaurant.tags ?? []}
                newTags={editNewTags}
                newInput={editNewTag}
                onNewInput={setEditNewTag}
                onAdd={addEditTag}
                onRemove={t => setEditNewTags(prev => prev.filter(x => x !== t))}
              />

              <div className="h-2" />
            </div>
            <div className="px-4 py-3 border-t border-gray-100 flex gap-3 shrink-0">
              <button onClick={() => setShowEditModal(false)} className="btn-secondary flex-1 py-2.5 text-sm">取消</button>
              <button onClick={handleEditSubmit} disabled={!editForm.name.trim() || editSubmitting} className="btn-primary flex-1 py-2.5 text-sm">
                {editSubmitting ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-medium text-white shadow-lg ${toast.ok ? 'bg-brand-600' : 'bg-red-500'}`}>
          {toast.msg}
        </div>
      )}
    </main>
  )
}
