// Time zone helpers built on Intl, so the slot logic follows config.schedule.timezone.

export type WallTime = { year: number; month: number; day: number; hour: number; minute: number };

export function wallTime(date: Date, timeZone: string): WallTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** The instant at which the wall clock in `timeZone` shows the given time. */
export function fromWallTime(w: WallTime, timeZone: string): Date {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const offset = (d: number) => {
    const s = wallTime(new Date(d), timeZone);
    return Date.UTC(s.year, s.month - 1, s.day, s.hour, s.minute) - d;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

/** "2026-10-19T21:00:00" in the given zone (no offset), for calendar APIs that take a timezone. */
export function localIso(date: Date, timeZone: string): string {
  const w = wallTime(date, timeZone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${p(w.month)}-${p(w.day)}T${p(w.hour)}:${p(w.minute)}:00`;
}

/** "Today 21:00" / "Tomorrow 08:00" / "Oct 22 09:30" relative to `now`. */
export function friendlyTime(date: Date, now: Date, timeZone: string): string {
  const w = wallTime(date, timeZone);
  const hhmm = `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
  const day = (d: Date) => {
    const x = wallTime(d, timeZone);
    return Date.UTC(x.year, x.month - 1, x.day);
  };
  const diff = Math.round((day(date) - day(now)) / 86_400_000);
  if (diff === 0) return `Today ${hhmm}`;
  if (diff === 1) return `Tomorrow ${hhmm}`;
  const month = new Intl.DateTimeFormat("en-US", { timeZone, month: "short" }).format(date);
  return `${month} ${w.day} ${hhmm}`;
}

/** Parses "23:00-08:00" into minutes of day. */
export function parseRange(range: string): { start: number; end: number } {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(range.trim());
  if (!m) throw new Error(`Bad time range "${range}", expected like "23:00-08:00"`);
  return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) };
}

export function inRange(minuteOfDay: number, range: { start: number; end: number }): boolean {
  return range.start <= range.end
    ? minuteOfDay >= range.start && minuteOfDay < range.end
    : minuteOfDay >= range.start || minuteOfDay < range.end;
}
