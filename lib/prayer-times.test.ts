import assert from "node:assert/strict";
import test from "node:test";

let prayerTimes: typeof import("./prayer-times");
test.before(async () => {
  prayerTimes = await import("./prayer-times");
});

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("fetches Harar prayer times and normalizes the service response", async () => {
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return Response.json({
      code: 200,
      data: {
        meta: { timezone: "Africa/Addis_Ababa" },
        timings: {
          Fajr: "04:48 (EAT)",
          Dhuhr: "12:01 (EAT)",
          Asr: "15:19 (EAT)",
          Maghrib: "18:02 (EAT)",
          Isha: "19:32 (EAT)",
        },
      },
    });
  };

  const result = await prayerTimes.fetchHararPrayerTimes("2026-10-01");

  assert.match(requestedUrl, /timingsByCity\/01-10-2026\?city=Harar&country=Ethiopia/);
  assert.equal(result.timezone, "Africa/Addis_Ababa");
  assert.deepEqual(result.times, {
    Fajr: "04:48",
    Dhuhr: "12:01",
    Asr: "15:19",
    Maghrib: "18:02",
    Isha: "19:32",
  });
});

test("converts Harar prayer anchors from East Africa Time to the device timezone", () => {
  const result = prayerTimes.convertPrayerTimesToTimezone(
    "2026-10-01",
    "Africa/Addis_Ababa",
    "America/New_York",
    { Fajr: "04:48", Dhuhr: "12:01", Asr: "15:19", Maghrib: "18:02", Isha: "19:32" },
  );

  assert.equal(result.Fajr, "21:48");
  assert.equal(result.Dhuhr, "05:01");
  assert.equal(result.Maghrib, "11:02");
});
