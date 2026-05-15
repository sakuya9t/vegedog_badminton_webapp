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

interface Props {
  initialRestaurants: RestaurantWithDetails[]
  currentUserId: string
}

export default function PostMatchClient({ initialRestaurants, currentUserId }: Props) {
  const supabase = createClient()
  const [restaurants, setRestaurants] = useState<RestaurantWithDetails[]>(initialRestaurants)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [dishes, setDishes] = useState<string[]>([])
  const [newDish, setNewDish] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parseMsg, setParseMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [parseExtra, setParseExtra] = useState<{
    rating?: number; userRatingCount?: number; priceLevel?: string; phone?: string; website?: string
  } | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const cuisineOptions = useMemo(() => {
    const seen = new Set(COMMON_CUISINES)
    const extras: string[] = []
    for (const r of restaurants) {
      if (r.cuisine && !seen.has(r.cuisine)) {
        seen.add(r.cuisine)
        extras.push(r.cuisine)
      }
    }
    return [...COMMON_CUISINES, ...extras]
  }, [restaurants])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  function openModal() {
    setForm(EMPTY_FORM)
    setDishes([])
    setNewDish('')
    setParseMsg(null)
    setParseExtra(null)
    setShowModal(true)
  }

  async function handleParseGMaps() {
    const url = form.google_maps_url.trim()
    if (!url) return
    setParsing(true)
    setParseMsg(null)
    try {
      const res = await fetch(`/api/parse-gmaps?url=${encodeURIComponent(url)}`)
      const data = await res.json()
      if (data.error) {
        setParseMsg({ text: '解析失败，请手动填写', ok: false })
        return
      }
      const filled: string[] = []
      const updates: Partial<typeof EMPTY_FORM> = {}
      if (data.name    && !form.name.trim())    { updates.name    = data.name;    filled.push('店名') }
      if (data.address && !form.address.trim()) { updates.address = data.address; filled.push('地址') }
      if (data.hours   && !form.hours.trim())   { updates.hours   = data.hours;   filled.push('营业时间') }
      if (data.cuisine && !form.cuisine.trim()) { updates.cuisine = data.cuisine; filled.push('菜系') }

      if (filled.length > 0) {
        setForm(f => ({ ...f, ...updates }))
        setParseMsg({ text: `已自动填入：${filled.join('、')}`, ok: true })
      } else if (!data.name && !data.address && !data.hours && !data.cuisine) {
        setParseMsg({ text: '未能识别内容，请手动填写', ok: false })
      } else {
        setParseMsg({ text: '字段已有内容，未覆盖', ok: true })
      }

      if (data.rating || data.phone || data.website) {
        setParseExtra({
          rating: data.rating,
          userRatingCount: data.userRatingCount,
          priceLevel: data.priceLevel,
          phone: data.phone,
          website: data.website,
        })
      }
    } catch {
      setParseMsg({ text: '解析失败，请手动填写', ok: false })
    } finally {
      setParsing(false)
    }
  }

  function addDish() {
    const d = newDish.trim()
    if (!d || dishes.includes(d)) return
    setDishes(prev => [...prev, d])
    setNewDish('')
  }

  async function handleSubmit() {
    if (!form.name.trim()) return
    setSubmitting(true)
    try {
      const { data: restaurant, error } = await supabase
        .from('restaurants')
        .insert({
          name: form.name.trim(),
          cuisine: form.cuisine.trim() || null,
          distance: form.distance.trim() || null,
          address: form.address.trim() || null,
          hours: form.hours.trim() || null,
          yelp_url: form.yelp_url.trim() || null,
          google_maps_url: form.google_maps_url.trim() || null,
          has_wait: form.has_wait,
          accepts_reservation: form.accepts_reservation,
          group_size: form.group_size || null,
          added_by: currentUserId,
        })
        .select('id')
        .single()

      if (error || !restaurant) {
        showToast('添加失败，请重试', false)
        return
      }

      if (dishes.length > 0) {
        await supabase.from('restaurant_dishes').insert(
          dishes.map(d => ({ restaurant_id: restaurant.id, name: d, added_by: currentUserId }))
        )
      }

      const { data: full } = await supabase
        .from('restaurants')
        .select(`
          *,
          adder:profiles!added_by(id, nickname, avatar_url),
          dishes:restaurant_dishes(id, name, added_by),
          recommendations:restaurant_recommendations(id, user_id, recommended)
        `)
        .eq('id', restaurant.id)
        .single()

      if (full) {
        setRestaurants(prev => [full as unknown as RestaurantWithDetails, ...prev])
      }
      setShowModal(false)
      showToast('餐厅已添加！')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRecommend(restaurantId: string, value: boolean) {
    const r = restaurants.find(r => r.id === restaurantId)
    if (!r) return
    const existing = r.recommendations.find(rec => rec.user_id === currentUserId)

    if (existing?.recommended === value) {
      setRestaurants(prev => prev.map(r =>
        r.id !== restaurantId ? r : {
          ...r, recommendations: r.recommendations.filter(rec => rec.user_id !== currentUserId)
        }
      ))
      await supabase.from('restaurant_recommendations')
        .delete()
        .eq('restaurant_id', restaurantId)
        .eq('user_id', currentUserId)
    } else {
      const newRec: RestaurantRecommendation = {
        id: existing?.id ?? crypto.randomUUID(),
        restaurant_id: restaurantId,
        user_id: currentUserId,
        recommended: value,
        created_at: new Date().toISOString(),
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

  function getMapsUrl(r: RestaurantWithDetails) {
    if (r.google_maps_url) return r.google_maps_url
    if (r.address) return `https://maps.google.com/maps?q=${encodeURIComponent(r.address)}`
    return null
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">赛后总结</h1>
        <button
          onClick={openModal}
          className="text-sm font-semibold text-white bg-brand-600 px-3 py-1.5 rounded-lg active:bg-brand-700 transition-colors"
        >
          + 添加餐厅
        </button>
      </div>

      {restaurants.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          <p className="text-3xl mb-2">🍜</p>
          <p className="text-sm">还没有推荐的餐厅</p>
          <p className="text-xs mt-1">赛后一起去吃饭吧！</p>
        </div>
      ) : (
        <div className="space-y-4">
          {restaurants.map(r => {
            const thumbsUp = r.recommendations.filter(rec => rec.recommended).length
            const thumbsDown = r.recommendations.filter(rec => !rec.recommended).length
            const myRec = r.recommendations.find(rec => rec.user_id === currentUserId)
            const mapsUrl = getMapsUrl(r)

            return (
              <div key={r.id} className="card space-y-3">
                {/* Name row + vote buttons */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-gray-900 leading-snug">{r.name}</h2>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {r.cuisine && (
                        <span className="badge bg-brand-100 text-brand-700">{r.cuisine}</span>
                      )}
                      {r.distance && (
                        <span className="badge bg-gray-100 text-gray-600">{r.distance}</span>
                      )}
                      {r.group_size && (
                        <span className="badge bg-blue-50 text-blue-600">{r.group_size}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleRecommend(r.id, true)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm transition-colors ${
                        myRec?.recommended === true
                          ? 'bg-brand-100 text-brand-700'
                          : 'bg-gray-100 text-gray-500 active:bg-gray-200'
                      }`}
                    >
                      👍 <span className="tabular-nums">{thumbsUp}</span>
                    </button>
                    <button
                      onClick={() => handleRecommend(r.id, false)}
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

                {/* Info rows */}
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

                {/* Tag chips */}
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

                {/* Dishes */}
                {r.dishes.length > 0 && (
                  <div className="pt-2.5 border-t border-gray-100">
                    <p className="text-xs text-gray-400 mb-1.5">推荐菜</p>
                    <div className="flex flex-wrap gap-1.5">
                      {r.dishes.map(d => (
                        <span key={d.id} className="text-sm bg-orange-50 text-orange-700 border border-orange-100 px-2.5 py-0.5 rounded-full">
                          {d.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Added by */}
                {r.adder && (
                  <div className="pt-2 border-t border-gray-100 flex items-center gap-1.5">
                    {r.adder.avatar_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.adder.avatar_url} alt="" className="w-4 h-4 rounded-full" />
                    )}
                    <span className="text-xs text-gray-400">{r.adder.nickname} 添加</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add Restaurant Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <h2 className="font-semibold text-gray-900">添加餐厅</h2>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 text-lg leading-none"
              >
                ×
              </button>
            </div>

            {/* Scrollable form */}
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
                  <button
                    type="button"
                    onClick={handleParseGMaps}
                    disabled={!form.google_maps_url.trim() || parsing}
                    className="shrink-0 px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm font-medium disabled:opacity-40 active:bg-gray-50 transition-colors"
                  >
                    {parsing ? '解析中…' : '解析'}
                  </button>
                </div>
                {parseMsg && (
                  <p className={`text-xs mt-1.5 ${parseMsg.ok ? 'text-brand-600' : 'text-red-500'}`}>
                    {parseMsg.text}
                  </p>
                )}
                {parseExtra && (
                  <div className="mt-2 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                    {parseExtra.rating !== undefined && (
                      <span>⭐ {parseExtra.rating.toFixed(1)} ({parseExtra.userRatingCount?.toLocaleString()} 评价)</span>
                    )}
                    {parseExtra.priceLevel && (
                      <span>{'$'.repeat({ PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 }[parseExtra.priceLevel] ?? 2)}</span>
                    )}
                    {parseExtra.phone && <span>📞 {parseExtra.phone}</span>}
                    {parseExtra.website && (
                      <a href={parseExtra.website} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline underline-offset-1">官网</a>
                    )}
                  </div>
                )}
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  店名 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="餐厅名称"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="input text-sm"
                />
              </div>

              {/* Cuisine */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">菜系</label>
                <input
                  type="text"
                  placeholder="输入或从下方选择..."
                  value={form.cuisine}
                  onChange={e => setForm(f => ({ ...f, cuisine: e.target.value }))}
                  className="input text-sm"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {cuisineOptions.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, cuisine: f.cuisine === c ? '' : c }))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        form.cuisine === c
                          ? 'border-brand-400 bg-brand-50 text-brand-700'
                          : 'border-gray-200 bg-white text-gray-500 active:bg-gray-50'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Distance */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">距离</label>
                <input
                  type="text"
                  placeholder="0.3 mi / 5分钟车程"
                  value={form.distance}
                  onChange={e => setForm(f => ({ ...f, distance: e.target.value }))}
                  className="input text-sm"
                />
              </div>

              {/* Address */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">地址</label>
                <input
                  type="text"
                  placeholder="123 Main St, City, CA 91234"
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="input text-sm"
                />
              </div>

              {/* Hours */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">营业时间</label>
                <input
                  type="text"
                  placeholder="Mon–Sun 11am–10pm"
                  value={form.hours}
                  onChange={e => setForm(f => ({ ...f, hours: e.target.value }))}
                  className="input text-sm"
                />
              </div>

              {/* Yelp */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Yelp 链接</label>
                <input
                  type="url"
                  placeholder="https://www.yelp.com/biz/..."
                  value={form.yelp_url}
                  onChange={e => setForm(f => ({ ...f, yelp_url: e.target.value }))}
                  className="input text-sm"
                />
              </div>

              {/* Tags */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-gray-500">标签</p>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, has_wait: !f.has_wait }))}
                    className={`flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors ${
                      form.has_wait
                        ? 'border-amber-400 bg-amber-50 text-amber-700'
                        : 'border-gray-200 bg-white text-gray-400'
                    }`}
                  >
                    {form.has_wait ? '✓' : '○'} 需要等位
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, accepts_reservation: !f.accepts_reservation }))}
                    className={`flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors ${
                      form.accepts_reservation
                        ? 'border-green-400 bg-green-50 text-green-700'
                        : 'border-gray-200 bg-white text-gray-400'
                    }`}
                  >
                    {form.accepts_reservation ? '✓' : '○'} 可以预约
                  </button>
                </div>

                <div>
                  <p className="text-xs text-gray-400 mb-2">适合规模</p>
                  <div className="flex flex-wrap gap-2">
                    {GROUP_SIZE_OPTIONS.map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, group_size: f.group_size === opt ? '' : opt }))}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                          form.group_size === opt
                            ? 'border-blue-400 bg-blue-50 text-blue-700'
                            : 'border-gray-200 bg-white text-gray-500'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Dishes */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500">推荐菜</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="输入菜名，按回车添加"
                    value={newDish}
                    onChange={e => setNewDish(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDish() } }}
                    className="input flex-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={addDish}
                    className="px-4 py-2 bg-brand-600 text-white text-sm rounded-xl active:bg-brand-700 shrink-0"
                  >
                    添加
                  </button>
                </div>
                {dishes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {dishes.map(d => (
                      <span
                        key={d}
                        className="flex items-center gap-1 text-sm bg-orange-50 text-orange-700 border border-orange-100 px-2.5 py-0.5 rounded-full"
                      >
                        {d}
                        <button
                          onClick={() => setDishes(prev => prev.filter(x => x !== d))}
                          className="text-orange-400 hover:text-orange-600 leading-none ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom padding so last field isn't hidden behind footer */}
              <div className="h-2" />
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-100 flex gap-3 shrink-0">
              <button
                onClick={() => setShowModal(false)}
                className="btn-secondary flex-1 py-2.5 text-sm"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!form.name.trim() || submitting}
                className="btn-primary flex-1 py-2.5 text-sm"
              >
                {submitting ? '添加中...' : '添加餐厅'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-medium text-white shadow-lg ${
          toast.ok ? 'bg-brand-600' : 'bg-red-500'
        }`}>
          {toast.msg}
        </div>
      )}
    </main>
  )
}
