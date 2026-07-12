import assert from "node:assert/strict";
import {
  dailyEvents,
  dailyFactIndex,
  EXPANDED_SCHEDULE_START,
  matchesDailyEventSet,
  NO_REPEAT_DAYS,
} from "../app/daily-schedule";
import { DAILY_MANIFEST_DAYS } from "../app/event-data/daily-manifest";
import { EVENTS, PRACTICE_PACKS } from "../app/events";

const VALID_COLORS = new Set(["coral", "sun", "mint", "sky", "lilac"]);

function duplicates(values: readonly string[]) {
  const seen = new Set<string>();
  return [...new Set(values.filter((value) => seen.has(value) || !seen.add(value)))];
}

function dateKeyAt(offset: number) {
  const [year, month, day] = EXPANDED_SCHEDULE_START.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

assert(EVENTS.length >= 800 && EVENTS.length <= 1_000, `Expected 800–1,000 events, found ${EVENTS.length}.`);
assert.equal(duplicates(EVENTS.map((event) => event.id)).length, 0, "Event IDs must be unique.");
assert.equal(duplicates(EVENTS.map((event) => event.title.toLocaleLowerCase())).length, 0, "Event titles must be unique.");

const everyFact = EVENTS.flatMap((event) => [event.fact, ...(event.bonusFacts ?? [])]);
assert.equal(duplicates(everyFact.map((fact) => fact.toLocaleLowerCase())).length, 0, "Facts must be unique.");

for (const event of EVENTS) {
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.id), `Invalid event ID: ${event.id}`);
  assert(event.title.length >= 5 && event.title.length <= 80, `Unplayable title length: ${event.title}`);
  assert(Number.isInteger(event.year) && event.year !== 0, `Invalid year for ${event.id}`);
  assert(event.year >= -4000 && event.year <= 2025, `Out-of-range year for ${event.id}`);
  assert(event.emoji.trim().length > 0, `Missing emoji for ${event.id}`);
  assert(VALID_COLORS.has(event.color), `Unexpected color for ${event.id}`);
  assert(event.circa === undefined || typeof event.circa === "boolean", `Invalid circa flag for ${event.id}`);

  for (const fact of [event.fact, ...(event.bonusFacts ?? [])]) {
    assert(fact.length >= 25 && fact.length <= 260, `Fact length needs review for ${event.id}`);
    assert(/[.!?]$/.test(fact), `Fact needs terminal punctuation for ${event.id}`);
  }
}

const categoryCounts = Object.fromEntries(
  (["tech", "culture", "discovery", "world"] as const).map((category) => [
    category,
    EVENTS.filter((event) => event.category === category).length,
  ]),
);

for (const [category, count] of Object.entries(categoryCounts)) {
  assert(count >= 100, `${category} needs at least 100 events; found ${count}.`);
}

const alternateFactEvents = EVENTS.filter((event) => (event.bonusFacts?.length ?? 0) > 0).length;
assert(alternateFactEvents >= 250, `Expected alternate facts for at least 250 events; found ${alternateFactEvents}.`);

for (const pack of PRACTICE_PACKS.filter((item) => item.id !== "mixed")) {
  assert(pack.eventIds.length >= 100, `${pack.name} is too small at ${pack.eventIds.length} events.`);
}

const LEGACY_SNAPSHOTS: Record<string, string[]> = {
  "2026-01-01": [
    "oreo-debut", "titanic-sinks", "neptune-discovered", "south-pole", "sputnik",
    "jurassic-park", "falcon-heavy", "webb-first-images", "beatles-first-single", "transistor",
  ],
  "2026-04-15": [
    "beatles-first-single", "spacewar", "smallpox-vaccine", "south-pole", "disneyland-opens",
    "microprocessor", "minecraft-public", "bitcoin-paper", "first-crossword", "incandescent-light",
  ],
  "2026-07-12": [
    "animal-crossing-new-horizons", "mrna-vaccines", "copernicus-revolutions", "periodic-table",
    "second-world-war-ends", "simpsons-premiere", "webb-launch", "gangnam-style",
    "uranus-discovered", "youtube-launch",
  ],
};

for (const [dateKey, expected] of Object.entries(LEGACY_SNAPSHOTS)) {
  assert.deepEqual(
    dailyEvents(dateKey).map((event) => event.id),
    expected,
    `Legacy daily puzzle changed for ${dateKey}.`,
  );
}

assert.equal(EXPANDED_SCHEDULE_START, "2026-07-13", "Published expanded-schedule cutover changed.");
const finalLegacyIds = new Set(dailyEvents("2026-07-12").map((event) => event.id));
assert.deepEqual(
  dailyEvents(EXPANDED_SCHEDULE_START)
    .map((event) => event.id)
    .filter((eventId) => finalLegacyIds.has(eventId)),
  [],
  "The first protected daily puzzle repeats an event from the final legacy puzzle.",
);
assert.equal(
  matchesDailyEventSet("2026-07-13", [
    "moon-landing", "arpanet", "frankenstein-published", "alice-wonderland",
    "dna-double-helix", "first-sms", "youtube-launch", "netflix-streaming",
    "copernicus-revolutions", "hamilton-broadway",
  ]),
  false,
  "The replaced 13 July puzzle must be rejected as stale saved progress.",
);
assert.equal(
  matchesDailyEventSet("2026-07-13", dailyEvents("2026-07-13").map((event) => event.id)),
  true,
  "The corrected 13 July puzzle must remain valid saved progress.",
);

const lastSeen = new Map<string, number>();
const exposureCounts = new Map(EVENTS.map((event) => [event.id, 0]));
const appearanceDates = new Map(EVENTS.map((event) => [event.id, [] as string[]]));
const signatures = new Set<string>();
let duplicateDailySets = 0;
const SIMULATED_DAYS = DAILY_MANIFEST_DAYS;

for (let legacyDay = -NO_REPEAT_DAYS; legacyDay < 0; legacyDay += 1) {
  dailyEvents(dateKeyAt(legacyDay)).forEach((event) => lastSeen.set(event.id, legacyDay));
}

for (let dayIndex = 0; dayIndex < SIMULATED_DAYS; dayIndex += 1) {
  const dateKey = dateKeyAt(dayIndex);
  const first = dailyEvents(dateKey);
  const second = dailyEvents(dateKey);
  const ids = first.map((event) => event.id);

  assert.equal(first.length, 10, `${dateKey} does not contain 10 events.`);
  assert.equal(new Set(ids).size, 10, `${dateKey} contains duplicate events.`);
  assert.deepEqual(ids, second.map((event) => event.id), `${dateKey} is not deterministic.`);
  assert(new Set(first.map((event) => event.category)).size >= 3, `${dateKey} lacks category variety.`);

  const years = new Map<number, number>();
  first.forEach((event) => years.set(event.year, (years.get(event.year) ?? 0) + 1));
  assert([...years.values()].some((count) => count >= 2), `${dateKey} has no same-year collision.`);

  for (let left = 0; left < first.length - 1; left += 1) {
    for (let right = left + 1; right < first.length; right += 1) {
      const gap = Math.abs(first[left].year - first[right].year);
      assert(
        !first[left].circa || !first[right].circa || gap === 0 || gap > 100,
        `${dateKey} places two approximate dates only ${gap} years apart.`,
      );
    }
  }

  const eraCounts = [
    first.filter((event) => event.year < 1850).length,
    first.filter((event) => event.year >= 1850 && event.year < 1930).length,
    first.filter((event) => event.year >= 1930 && event.year < 1970).length,
    first.filter((event) => event.year >= 1970 && event.year < 1995).length,
    first.filter((event) => event.year >= 1995).length,
  ];
  assert(eraCounts[0] >= 1 && eraCounts[1] >= 1 && eraCounts[2] >= 1 && eraCounts[3] >= 1 && eraCounts[4] >= 2, `${dateKey} lacks era variety.`);

  for (const event of first) {
    const previous = lastSeen.get(event.id);
    if (previous !== undefined) {
      assert(dayIndex - previous > NO_REPEAT_DAYS, `${event.id} repeated after ${dayIndex - previous} days.`);
    }
    lastSeen.set(event.id, dayIndex);
    exposureCounts.set(event.id, (exposureCounts.get(event.id) ?? 0) + 1);
    appearanceDates.get(event.id)!.push(dateKey);
  }

  const signature = [...ids].sort().join("|");
  if (signatures.has(signature)) duplicateDailySets += 1;
  signatures.add(signature);
}

const exposureValues = [...exposureCounts.values()];
assert(Math.min(...exposureValues) > 0, "At least one event never appears in the five-year schedule.");
assert.equal(duplicateDailySets, 0, "A complete daily event set repeats within five years.");

for (const event of EVENTS.filter((item) => (item.bonusFacts?.length ?? 0) > 0)) {
  const dates = appearanceDates.get(event.id)!;
  assert(dates.length >= 2, `${event.id} does not appear often enough to verify fact rotation.`);
  const factCount = 1 + event.bonusFacts!.length;
  assert.notEqual(
    dailyFactIndex(dates[0], event.id, factCount),
    dailyFactIndex(dates[1], event.id, factCount),
    `${event.id} does not rotate facts between appearances.`,
  );
}

const sameYearGroups = new Map<number, number>();
EVENTS.forEach((event) => sameYearGroups.set(event.year, (sameYearGroups.get(event.year) ?? 0) + 1));

console.log(
  JSON.stringify(
    {
      events: EVENTS.length,
      facts: everyFact.length,
      alternateFactEvents,
      categories: categoryCounts,
      sameYearCollisionGroups: [...sameYearGroups.values()].filter((count) => count >= 2).length,
      practicePacks: Object.fromEntries(
        PRACTICE_PACKS.map((pack) => [pack.name, pack.eventIds.length || EVENTS.length]),
      ),
      schedule: {
        simulatedDays: SIMULATED_DAYS,
        noRepeatDays: NO_REPEAT_DAYS,
        duplicateDailySets,
        minimumAppearances: Math.min(...exposureValues),
        maximumAppearances: Math.max(...exposureValues),
      },
    },
    null,
    2,
  ),
);
