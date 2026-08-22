const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; secs: number }> = [
  { unit: "year", secs: 31536000 },
  { unit: "month", secs: 2592000 },
  { unit: "day", secs: 86400 },
  { unit: "hour", secs: 3600 },
  { unit: "minute", secs: 60 },
  { unit: "second", secs: 1 }
]

/** Human-readable "3 days ago" for a past timestamp, in the viewer's locale.
 *  `now` is injectable so callers can render against a fixed clock in tests. */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.floor((now - timestamp) / 1000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

  for (const candidate of UNITS) {
    // Seconds is the floor: a sub-second gap has no smaller unit to fall through to.
    if (seconds >= candidate.secs || candidate.unit === "second") {
      return rtf.format(-Math.round(seconds / candidate.secs), candidate.unit)
    }
  }

  return "just now"
}
