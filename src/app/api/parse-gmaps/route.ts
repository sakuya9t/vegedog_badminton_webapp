import { NextRequest, NextResponse } from 'next/server'

const API_KEY = process.env.GOOGLE_PLACES_API_KEY

// Maps Google place primary types to Chinese cuisine labels
const TYPE_TO_CUISINE: Record<string, string> = {
  chinese_restaurant:        '中餐',
  taiwanese_restaurant:      '中餐',
  dim_sum_restaurant:        '中餐',
  hot_pot_restaurant:        '火锅',
  japanese_restaurant:       '日料',
  sushi_restaurant:          '日料',
  ramen_restaurant:          '日料',
  korean_restaurant:         '韩餐',
  american_restaurant:       '美式',
  burger_restaurant:         '汉堡',
  mexican_restaurant:        '墨西哥',
  vietnamese_restaurant:     '越南菜',
  thai_restaurant:           '泰餐',
  pizza_restaurant:          '披萨',
  italian_restaurant:        '意式',
  indian_restaurant:         '印度菜',
  seafood_restaurant:        '海鲜',
  french_restaurant:         '法餐',
  mediterranean_restaurant:  '地中海菜',
  barbecue_restaurant:       '烤肉',
  cafe:                      '咖啡厅',
  bakery:                    '烘焙',
  ice_cream_shop:            '冰淇淋',
}

// Extract the raw Place ID from a Google Maps URL (after !1s in data= param)
function extractPlaceId(url: string): string | null {
  try {
    const decoded = decodeURIComponent(url)
    return decoded.match(/!1s([^!&\s]+)/)?.[1] ?? null
  } catch {
    return null
  }
}

// Compact hours: "Daily 11:00 AM – 10:00 PM" if all days same, otherwise full list
function formatHours(weekdayDescriptions: string[]): string {
  if (!weekdayDescriptions.length) return ''
  const timeParts = weekdayDescriptions.map(d => d.split(': ').slice(1).join(': '))
  if (timeParts.every(t => t === timeParts[0])) return `Daily ${timeParts[0]}`
  return weekdayDescriptions.join('\n')
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url || !/^https?:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps)/.test(url)) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }
  if (!API_KEY) {
    console.error('[parse-gmaps] GOOGLE_PLACES_API_KEY is not set')
    return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY not configured' }, { status: 500 })
  }

  // Resolve short URLs (maps.app.goo.gl → full google.com/maps URL)
  let fullUrl = url
  if (url.includes('maps.app.goo.gl')) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'curl/7.68.0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      })
      fullUrl = r.url
    } catch {
      return NextResponse.json({ error: 'Could not resolve short URL' }, { status: 500 })
    }
  }

  // Try to get Place ID from URL data parameter
  let placeId = extractPlaceId(fullUrl)

  // Fallback: text search using the name in the URL path
  if (!placeId) {
    const pathName = fullUrl.match(/\/maps\/place\/([^/@?&#]+)/)?.[1]
    const query = pathName ? decodeURIComponent(pathName.replace(/\+/g, ' ')) : null
    if (!query) return NextResponse.json({ error: 'Cannot extract place from URL' }, { status: 400 })

    const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id',
      },
      body: JSON.stringify({ textQuery: query }),
      signal: AbortSignal.timeout(6000),
    })
    const searchData = await searchRes.json()
    placeId = searchData?.places?.[0]?.id
    if (!placeId) return NextResponse.json({ error: 'Place not found' }, { status: 404 })
  }

  // Fetch place details
  const FIELDS = [
    'displayName',
    'formattedAddress',
    'location',
    'regularOpeningHours',
    'rating',
    'userRatingCount',
    'priceLevel',
    'primaryType',
    'types',
    'internationalPhoneNumber',
    'websiteUri',
  ].join(',')

  const detailRes = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': FIELDS,
    },
    signal: AbortSignal.timeout(6000),
  })

  if (!detailRes.ok) {
    const err = await detailRes.json().catch(() => ({}))
    console.error('[parse-gmaps] Places API error', err)
    return NextResponse.json({ error: 'Places API error' }, { status: 502 })
  }

  const place = await detailRes.json()

  // Detect cuisine from primaryType / types array
  let cuisine: string | undefined
  const typesToCheck: string[] = [place.primaryType, ...(place.types ?? [])].filter(Boolean)
  for (const t of typesToCheck) {
    if (TYPE_TO_CUISINE[t]) { cuisine = TYPE_TO_CUISINE[t]; break }
  }

  return NextResponse.json({
    // Fields that auto-fill the form
    name:     place.displayName?.text,
    address:  place.formattedAddress,
    hours:    formatHours(place.regularOpeningHours?.weekdayDescriptions ?? []),
    cuisine,
    // Extra info shown as a preview (not stored in current schema)
    rating:          place.rating,
    userRatingCount: place.userRatingCount,
    priceLevel:      place.priceLevel,   // e.g. "PRICE_LEVEL_MODERATE"
    phone:           place.internationalPhoneNumber,
    website:         place.websiteUri,
    location:        place.location,     // { latitude, longitude }
  })
}
