import { toZonedTime, format as tzFormat } from 'date-fns-tz'

const PACIFIC = 'America/Los_Angeles'

const WEEKDAYS_ZH = ['周日','周一','周二','周三','周四','周五','周六']

/** "04/14/26 (周二), 8:15pm PDT" */
export function formatSessionDate(isoString: string): string {
  const d    = new Date(isoString)
  const zd   = toZonedTime(d, PACIFIC)
  const date = tzFormat(zd, 'MM/dd/yy', { timeZone: PACIFIC })
  const time = tzFormat(zd, 'h:mmaa',   { timeZone: PACIFIC }).toLowerCase()
  const dow  = zd.getDay()
  // Compute offset explicitly to avoid locale-dependent abbreviation (PDT vs GMT-7)
  const tz = getPacificOffsetMs(d) === -7 * 3600 * 1000 ? 'PDT' : 'PST'
  return `${date} (${WEEKDAYS_ZH[dow]}), ${time} ${tz}`
}

/** Next Friday 8 PM Pacific as a local datetime-local string for <input> */
export function defaultStartsAt(): string {
  const now = new Date()
  const zd  = toZonedTime(now, PACIFIC)
  // Roll forward to next Friday
  const daysUntilFriday = (5 - zd.getDay() + 7) % 7 || 7
  zd.setDate(zd.getDate() + daysUntilFriday)
  zd.setHours(20, 0, 0, 0)
  return toDatetimeLocal(zd)
}

/** 48h before starts_at, 5 PM Pacific */
export function defaultWithdrawDeadline(startsAtLocal: string): string {
  const d  = new Date(startsAtLocal)
  const zd = toZonedTime(d, PACIFIC)
  zd.setDate(zd.getDate() - 2)
  zd.setHours(17, 0, 0, 0)
  return toDatetimeLocal(zd)
}

/** Now, in Pacific time, as a "YYYY-MM-DDTHH:mm" datetime-local string */
export function defaultNowLocal(): string {
  return toDatetimeLocal(toZonedTime(new Date(), PACIFIC))
}

/** Round a datetime-local string to nearest 15 minutes */
export function roundTo15(value: string): string {
  const d = new Date(value)
  const m = d.getMinutes()
  d.setMinutes(Math.round(m / 15) * 15, 0, 0)
  return toDatetimeLocal(d)
}

/** Convert a Date (in any TZ) to "YYYY-MM-DDTHH:mm" for datetime-local input */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Convert a datetime-local input value (treated as Pacific time) to a UTC ISO string.
 * datetime-local inputs have no timezone; we assume Pacific.
 */
export function localToPacificISO(datetimeLocal: string): string {
  // Append a fake offset to parse correctly, then re-interpret in Pacific
  // Simplest: use the Intl API to find the current Pacific offset and apply it.
  const d = new Date(datetimeLocal)           // parsed as local device time
  const pacificOffset = getPacificOffsetMs(d)  // offset in ms (negative west of UTC)
  const deviceOffset  = -d.getTimezoneOffset() * 60 * 1000 // device offset in ms
  // Shift so the wall-clock time is interpreted as Pacific
  return new Date(d.getTime() - deviceOffset + pacificOffset).toISOString()
}

function getPacificOffsetMs(d: Date): number {
  // Use Intl to get the UTC offset for America/Los_Angeles at the given instant
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC, timeZoneName: 'shortOffset',
  })
  const parts = fmt.formatToParts(d)
  const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT-8'
  // offsetPart is like "GMT-7" or "GMT-8"
  const match = offsetPart.match(/GMT([+-]\d+)/)
  const hours = match ? parseInt(match[1]) : -8
  return hours * 3600 * 1000
}
