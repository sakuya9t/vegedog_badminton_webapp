import { NextRequest, NextResponse } from 'next/server'

function decodeHtml(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

// Extract <meta name/property="key" content="..."> value, attribute order doesn't matter
function getMeta(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"'<>]+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"'<>]+)["'][^>]+(?:name|property)=["']${escaped}["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m?.[1]) return decodeHtml(m[1])
  }
  return ''
}

// Find an address-like segment within a delimited string
// Accepts: starts with a street number OR contains state+zip OR ends with state abbreviation
function extractAddress(text: string): string | undefined {
  const parts = text.split(/[·•|]/).map(s => s.trim()).filter(s => s.length > 4)
  for (const part of parts) {
    if (/^\d+\s+\S/.test(part)) return part                    // "123 Main St..."
    if (/\b[A-Z]{2}\s+\d{5}\b/.test(part)) return part        // "...CA 91234"
    if (/,\s*[A-Z]{2}(?:\s+\d{5})?$/.test(part)) return part  // "..., CA" or "..., CA 91234"
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url || !/^https?:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps)/.test(url)) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    })

    const html = await res.text()
    const finalUrl = res.url
    const result: { name?: string; address?: string; hours?: string } = {}

    // ── 1. Name ─────────────────────────────────────────────────────────────
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (titleMatch?.[1]) {
      result.name = titleMatch[1]
        .replace(/\s*[-–—]\s*Google Maps\s*$/i, '')
        .replace(/\s*\|[^|]*$/, '')
        .trim()
    }
    // Fallback: extract name from URL path
    const pathMatch = finalUrl.match(/\/maps\/place\/([^/@?&#]+)/)
    if (pathMatch && (!result.name || result.name.length < 2)) {
      result.name = decodeURIComponent(pathMatch[1].replace(/\+/g, ' ')).trim()
    }

    // ── 2. JSON-LD (most reliable when present) ──────────────────────────────
    const BUSINESS_TYPES = new Set([
      'LocalBusiness', 'Restaurant', 'FoodEstablishment',
      'CafeOrCoffeeShop', 'BarOrPub', 'Bakery', 'IceCreamShop',
    ])
    const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    let m: RegExpExecArray | null
    while ((m = jsonLdRe.exec(html)) !== null) {
      try {
        const ld = JSON.parse(m[1])
        const items: Record<string, unknown>[] = Array.isArray(ld) ? ld : [ld]
        for (const item of items) {
          if (!BUSINESS_TYPES.has(item['@type'] as string)) continue
          if (!result.name && item.name) result.name = String(item.name)
          if (item.address) {
            const a = item.address as Record<string, string>
            result.address = typeof a === 'string'
              ? a
              : [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
                  .filter(Boolean).join(', ')
          }
          const DAY_SHORT: Record<string, string> = {
            'https://schema.org/Monday': 'Mon', 'https://schema.org/Tuesday': 'Tue',
            'https://schema.org/Wednesday': 'Wed', 'https://schema.org/Thursday': 'Thu',
            'https://schema.org/Friday': 'Fri', 'https://schema.org/Saturday': 'Sat',
            'https://schema.org/Sunday': 'Sun',
          }
          if (item.openingHoursSpecification) {
            const specs = Array.isArray(item.openingHoursSpecification)
              ? item.openingHoursSpecification : [item.openingHoursSpecification]
            result.hours = (specs as Record<string, unknown>[]).map(s => {
              const days = (Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek])
                .map((d: unknown) => DAY_SHORT[String(d)] ?? String(d).replace('https://schema.org/', ''))
                .join('/')
              return `${days} ${s.opens ?? ''}–${s.closes ?? ''}`
            }).join(', ')
          } else if (item.openingHours) {
            result.hours = Array.isArray(item.openingHours)
              ? (item.openingHours as string[]).join(', ')
              : String(item.openingHours)
          }
          break
        }
      } catch {}
      if (result.address) break
    }

    // ── 3. Meta tags fallback (address + hours) ──────────────────────────────
    if (!result.address) {
      // Google Maps puts address in name="description", not just og:description
      const candidates = [
        getMeta(html, 'description'),
        getMeta(html, 'og:description'),
        getMeta(html, 'twitter:description'),
      ]
      for (const text of candidates) {
        const addr = extractAddress(text)
        if (addr) { result.address = addr; break }
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[parse-gmaps]', err)
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}
