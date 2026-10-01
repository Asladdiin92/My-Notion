import "server-only";

export type PrayerTimeName = "Fajr" | "Dhuhr" | "Asr" | "Maghrib" | "Isha";
export type PrayerTimes = Record<PrayerTimeName, string>;

const PRAYERS: PrayerTimeName[] = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
const PRAYER_API = "https://api.aladhan.com/v1/timingsByCity";

type PrayerResponse = {
  code?: number;
  data?: {
    timings?: Partial<Record<PrayerTimeName, string>>;
    meta?: { timezone?: string };
  };
};

function formatPrayerTime(value: string | undefined, name: PrayerTimeName): string {
  const match = value?.match(/^(\d{1,2}):(\d{2})/);
  if (!match) throw new Error(`Prayer-time service returned an invalid ${name} time.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Prayer-time service returned an invalid ${name} time.`);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export async function fetchHararPrayerTimes(date: string): Promise<{ date: string; timezone: string; times: PrayerTimes }> {
  const [year, month, day] = date.split("-");
  const apiDate = `${day}-${month}-${year}`;
  const url = new URL(`${PRAYER_API}/${encodeURIComponent(apiDate)}`);
  url.searchParams.set("city", "Harar");
  url.searchParams.set("country", "Ethiopia");

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Prayer-time service request failed (${response.status}).`);
  const result = await response.json() as PrayerResponse;
  if (result.code !== 200 || !result.data?.timings) {
    throw new Error("Prayer-time service returned no times for Harar.");
  }
  const times = Object.fromEntries(PRAYERS.map((name) => [
    name,
    formatPrayerTime(result.data?.timings?.[name], name),
  ])) as PrayerTimes;
  return {
    date,
    timezone: result.data.meta?.timezone ?? "Africa/Addis_Ababa",
    times,
  };
}

function timezoneDateParts(instant: Date, timezone: string): number[] {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return ["year", "month", "day", "hour", "minute"].map((type) =>
    Number(parts.find((part) => part.type === type)?.value),
  );
}

export function convertPrayerTimesToTimezone(
  date: string,
  prayerTimezone: string,
  targetTimezone: string,
  times: PrayerTimes,
): PrayerTimes {
  const [year, month, day] = date.split("-").map(Number);
  return Object.fromEntries(PRAYERS.map((name) => {
    const [hour, minute] = times[name].split(":").map(Number);
    const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    let instant = localAsUtc;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [localYear, localMonth, localDay, localHour, localMinute] = timezoneDateParts(new Date(instant), prayerTimezone);
      const representedAsUtc = Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute);
      instant += localAsUtc - representedAsUtc;
    }
    const [targetHour, targetMinute] = timezoneDateParts(new Date(instant), targetTimezone).slice(3);
    return [name, `${String(targetHour).padStart(2, "0")}:${String(targetMinute).padStart(2, "0")}`];
  })) as PrayerTimes;
}
