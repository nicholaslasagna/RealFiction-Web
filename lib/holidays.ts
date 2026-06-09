/**
 * Seasonal holiday theming registry.
 *
 * Each holiday has (1) a date window, (2) a CSS palette scoped to a
 * `theme-<id>` class on <html>, (3) a canvas effect, (4) a top stripe,
 * (5) a greeting, and (6) a Store banner line. An inline boot script
 * (THEME_BOOT_SCRIPT) decides the active holiday before first paint and adds
 * `theme-active theme-<id>` to <html>; the React layer (<Seasonal/>,
 * <HolidayStoreBanner/>) reads that class and renders from this registry — so
 * the boot script is the single source of truth and nothing drifts.
 *
 * Preview any holiday on any date with `?holiday=<id>` (e.g. ?holiday=halloween),
 * or `?holiday=off` to disable. `?fireworks=1` stays as a July 4th alias.
 */

export type HolidayEffect =
  | { kind: "fireworks"; colors?: string[] }
  | { kind: "snow"; colors: string[]; count: number }
  | { kind: "glyphs"; glyphs: string[]; count: number; spin: boolean }

export type Holiday = {
  id: string
  name: string
  greeting: string
  greetingEmoji: string
  /** Top stripe colors, evenly distributed (2+; 6 = a pride rainbow). */
  stripe: string[]
  /** Short festive line shown on the Store page during the window. */
  storeBanner: string
  effect: HolidayEffect
}

/** Effect / greeting / stripe / banner metadata, keyed by theme id. */
export const HOLIDAYS: Record<string, Holiday> = {
  newyear: {
    id: "newyear",
    name: "New Year",
    greeting: "Happy New Year",
    greetingEmoji: "🎉",
    stripe: ["#ffd86b", "#f6f4ef", "#6ea8ff"],
    storeBanner: "🎉 New Year — start the year with a fresh look",
    effect: { kind: "fireworks", colors: ["#ffd86b", "#f6f4ef", "#6ea8ff", "#ffe6a3"] }
  },
  valentines: {
    id: "valentines",
    name: "Valentine's Day",
    greeting: "Happy Valentine's Day",
    greetingEmoji: "💝",
    stripe: ["#ff5d8f", "#ffe0ec", "#e23e76"],
    storeBanner: "💝 Valentine's — treat someone (or yourself)",
    effect: { kind: "glyphs", glyphs: ["❤️", "💕", "💗"], count: 60, spin: false }
  },
  mardigras: {
    id: "mardigras",
    name: "Mardi Gras",
    greeting: "Happy Mardi Gras",
    greetingEmoji: "🎭",
    stripe: ["#7b2cbf", "#ffd23f", "#3aa35a"],
    storeBanner: "🎭 Mardi Gras — let the good times roll",
    effect: { kind: "glyphs", glyphs: ["🎭", "💜", "💚", "💛"], count: 52, spin: true }
  },
  lunarnewyear: {
    id: "lunarnewyear",
    name: "Lunar New Year",
    greeting: "Happy Lunar New Year",
    greetingEmoji: "🧧",
    stripe: ["#d32f2f", "#ffd24d", "#d32f2f"],
    storeBanner: "🧧 Lunar New Year — fortune favors a fresh look",
    effect: { kind: "glyphs", glyphs: ["🏮", "🧧", "🐉"], count: 48, spin: false }
  },
  stpatricks: {
    id: "stpatricks",
    name: "St. Patrick's Day",
    greeting: "Happy St. Patrick's Day",
    greetingEmoji: "🍀",
    stripe: ["#2fae57", "#f6f4ef", "#ffce54"],
    storeBanner: "☘️ Lucky days — cosmetics & ranks",
    effect: { kind: "glyphs", glyphs: ["☘️", "🍀"], count: 55, spin: true }
  },
  easter: {
    id: "easter",
    name: "Easter",
    greeting: "Happy Easter",
    greetingEmoji: "🐣",
    stripe: ["#f8bbd0", "#fff3c4", "#b3e5c9"],
    storeBanner: "🐰 Easter — hop into something new",
    effect: { kind: "glyphs", glyphs: ["🐰", "🥚", "🌷"], count: 52, spin: true }
  },
  pride: {
    id: "pride",
    name: "Pride Month",
    greeting: "Happy Pride",
    greetingEmoji: "🏳️‍🌈",
    stripe: ["#e40303", "#ff8c00", "#ffed00", "#008026", "#004dff", "#750787"],
    storeBanner: "🌈 Pride Month — celebrate with color",
    effect: { kind: "glyphs", glyphs: ["🌈", "❤️", "🧡", "💛", "💚", "💙", "💜"], count: 60, spin: false }
  },
  july4: {
    id: "july4",
    name: "Independence Day",
    greeting: "Happy Independence Day",
    greetingEmoji: "🎆",
    stripe: ["#e5304a", "#f6f4ef", "#4d8bf0"],
    storeBanner: "🎆 Independence Day — celebrate in style",
    effect: { kind: "fireworks" }
  },
  halloween: {
    id: "halloween",
    name: "Halloween",
    greeting: "Happy Halloween",
    greetingEmoji: "🎃",
    stripe: ["#ff7518", "#1a1024", "#a767ff"],
    storeBanner: "🎃 Spooky season — deck out your profile",
    effect: { kind: "glyphs", glyphs: ["🦇", "🎃", "👻"], count: 46, spin: false }
  },
  thanksgiving: {
    id: "thanksgiving",
    name: "Thanksgiving",
    greeting: "Happy Thanksgiving",
    greetingEmoji: "🦃",
    stripe: ["#d9821f", "#f3e3c4", "#8a4b1f"],
    storeBanner: "🦃 Thankful season — grab something nice",
    effect: { kind: "glyphs", glyphs: ["🍂", "🍁"], count: 55, spin: true }
  },
  hanukkah: {
    id: "hanukkah",
    name: "Hanukkah",
    greeting: "Happy Hanukkah",
    greetingEmoji: "🕎",
    stripe: ["#2f6fd6", "#f6f4ef", "#2f6fd6"],
    storeBanner: "🕎 Hanukkah — eight days of fresh looks",
    effect: { kind: "snow", colors: ["#ffffff", "#9cc4ff"], count: 90 }
  },
  christmas: {
    id: "christmas",
    name: "Christmas",
    greeting: "Merry Christmas",
    greetingEmoji: "🎄",
    stripe: ["#d32f2f", "#f6f4ef", "#2e9e54"],
    storeBanner: "🎄 Happy Holidays — gift a friend a cosmetic or rank",
    effect: { kind: "snow", colors: ["#ffffff"], count: 110 }
  },
  anniversary: {
    id: "anniversary",
    name: "RealFiction Anniversary",
    greeting: "Happy Anniversary",
    greetingEmoji: "🎂",
    stripe: ["#ffd166", "#f6f4ef", "#6ea8ff"],
    storeBanner: "🎂 RealFiction Anniversary — celebrating another year together",
    effect: { kind: "fireworks", colors: ["#ffd166", "#ffe6a3", "#f6f4ef", "#ffb347"] }
  }
}

/**
 * Serializable schedule, evaluated in order (first match wins). Fixed windows
 * use `r: [startMonth, startDay, endMonth, endDay]` (1-based month, inclusive,
 * wrap-around supported). Lunar/computed holidays (Lunar New Year, Easter,
 * Mardi Gras, Hanukkah) use explicit `d: [startISO, endISO]` ranges per year.
 */
export type HolidaySchedule = {
  id: string
  r?: Array<[number, number, number, number]>
  d?: Array<[string, string]>
}

export const HOLIDAY_SCHEDULE: HolidaySchedule[] = [
  { id: "newyear", r: [[12, 31, 12, 31], [1, 1, 1, 2]] },
  { id: "valentines", r: [[2, 13, 2, 15]] },
  {
    id: "mardigras",
    d: [
      ["2026-02-15", "2026-02-17"],
      ["2027-02-07", "2027-02-09"],
      ["2028-02-27", "2028-02-29"],
      ["2029-02-11", "2029-02-13"],
      ["2030-03-03", "2030-03-05"]
    ]
  },
  {
    id: "lunarnewyear",
    d: [
      ["2026-02-16", "2026-02-20"],
      ["2027-02-05", "2027-02-09"],
      ["2028-01-25", "2028-01-29"],
      ["2029-02-12", "2029-02-16"],
      ["2030-02-02", "2030-02-06"]
    ]
  },
  { id: "stpatricks", r: [[3, 16, 3, 18]] },
  {
    id: "easter",
    d: [
      ["2026-04-03", "2026-04-06"],
      ["2027-03-26", "2027-03-29"],
      ["2028-04-14", "2028-04-17"],
      ["2029-03-30", "2029-04-02"],
      ["2030-04-19", "2030-04-22"]
    ]
  },
  { id: "pride", r: [[6, 1, 6, 30]] },
  { id: "july4", r: [[7, 1, 7, 7]] },
  { id: "halloween", r: [[10, 24, 10, 31]] },
  { id: "thanksgiving", r: [[11, 22, 11, 28]] },
  {
    id: "hanukkah",
    d: [
      ["2025-12-14", "2025-12-22"],
      ["2026-12-04", "2026-12-12"],
      ["2027-12-24", "2028-01-01"],
      ["2028-12-12", "2028-12-20"],
      ["2029-12-01", "2029-12-09"],
      ["2030-12-20", "2030-12-28"]
    ]
  },
  { id: "christmas", r: [[12, 20, 12, 26]] },
  // TODO: set to RealFiction's real launch date (network launched 2018).
  { id: "anniversary", r: [[9, 1, 9, 3]] }
]

function localKey(date: Date): number {
  return (date.getMonth() + 1) * 100 + date.getDate()
}

function localIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/** Pure matcher mirrored by THEME_BOOT_SCRIPT. Returns the active theme id, or null. */
export function activeHolidayId(date: Date = new Date(), override?: string | null): string | null {
  if (override != null) {
    if (override === "off" || override === "0" || override === "false") return null
    return HOLIDAYS[override] ? override : null
  }
  const key = localKey(date)
  const iso = localIso(date)
  for (const holiday of HOLIDAY_SCHEDULE) {
    for (const [m1, d1, m2, d2] of holiday.r ?? []) {
      const start = m1 * 100 + d1
      const end = m2 * 100 + d2
      const hit = start <= end ? key >= start && key <= end : key >= start || key <= end
      if (hit) return holiday.id
    }
    for (const [start, end] of holiday.d ?? []) {
      if (iso >= start && iso <= end) return holiday.id
    }
  }
  return null
}

/**
 * Inline script (string) that sets the theme class on <html> before first paint,
 * so the CSS palette applies with no flash. Mirrors {@link activeHolidayId}.
 */
export const THEME_BOOT_SCRIPT =
  "(function(){try{var S=" +
  JSON.stringify(HOLIDAY_SCHEDULE) +
  ";var p=new URLSearchParams(location.search),q=p.get('holiday'),fw=p.get('fireworks'),id=null;" +
  "if(q!=null){id=(q==='off'||q==='0'||q==='false')?null:q;}" +
  "else if(fw==='1'||fw==='true'){id='july4';}" +
  "else{var dt=new Date(),k=(dt.getMonth()+1)*100+dt.getDate()," +
  "iso=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');" +
  "for(var i=0;i<S.length&&id==null;i++){var h=S[i];" +
  "if(h.r){for(var r=0;r<h.r.length;r++){var a=h.r[r],s=a[0]*100+a[1],e=a[2]*100+a[3];" +
  "if(s<=e?(k>=s&&k<=e):(k>=s||k<=e)){id=h.id;break;}}}" +
  "if(id==null&&h.d){for(var j=0;j<h.d.length;j++){if(iso>=h.d[j][0]&&iso<=h.d[j][1]){id=h.id;break;}}}}}" +
  "if(id&&/^[a-z0-9]+$/.test(id)){var el=document.documentElement;el.classList.add('theme-active');el.classList.add('theme-'+id);}" +
  "}catch(e){}})();"
