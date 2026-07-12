import { CORE_EVENTS, EVENTS, type EventCategory, type EventItem } from "./events";
import {
  DAILY_MANIFEST,
  DAILY_MANIFEST_DAYS,
  DAILY_MANIFEST_EVENT_IDS,
  DAILY_MANIFEST_START,
} from "./event-data/daily-manifest";

export const DAILY_EVENT_COUNT = 10;
export const NO_REPEAT_DAYS = 60;
export const EXPANDED_SCHEDULE_START = "2026-07-16";

const DAY_MS = 86_400_000;
const EXPANDED_START_MS = Date.UTC(2026, 6, 16);
const MANIFEST_DAY_WIDTH = DAILY_EVENT_COUNT * 2;
const EVENT_BY_ID = new Map(EVENTS.map((event) => [event.id, event]));

const ERA_RULES = [
  { minimum: 1, matches: (event: EventItem) => event.year < 1850 },
  { minimum: 1, matches: (event: EventItem) => event.year >= 1850 && event.year < 1930 },
  { minimum: 1, matches: (event: EventItem) => event.year >= 1930 && event.year < 1970 },
  { minimum: 1, matches: (event: EventItem) => event.year >= 1970 && event.year < 1995 },
  { minimum: 2, matches: (event: EventItem) => event.year >= 1995 },
] as const;

const scheduleCache: EventItem[][] = [];
const lastSeenDay = new Map<string, number>();
const appearanceCounts = new Map<string, number>();
let cooldownInitialized = false;

export function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function shuffled<T>(items: readonly T[], seed: number) {
  const random = mulberry32(seed);
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function uniqueEvents(items: readonly EventItem[]) {
  return [...new Map(items.map((event) => [event.id, event])).values()];
}

function legacyDailyEvents(seed: number) {
  const eventsByYear = new Map<number, EventItem[]>();
  CORE_EVENTS.forEach((event) => {
    eventsByYear.set(event.year, [...(eventsByYear.get(event.year) ?? []), event]);
  });
  const sameYearGroups = [...eventsByYear.values()].filter((group) => group.length > 1);
  const collision = shuffled(sameYearGroups, seed + 11)[0].slice(0, 2);
  const selected: EventItem[] = [...collision];
  const eras = [
    CORE_EVENTS.filter((event) => event.year < 1850),
    CORE_EVENTS.filter((event) => event.year >= 1850 && event.year < 1930),
    CORE_EVENTS.filter((event) => event.year >= 1930 && event.year < 1970),
    CORE_EVENTS.filter((event) => event.year >= 1970 && event.year < 1995),
    CORE_EVENTS.filter((event) => event.year >= 1995),
  ];
  eras.forEach((era, index) => {
    const available = shuffled(era, seed + 101 * (index + 1)).filter(
      (event) => !selected.some((chosen) => chosen.id === event.id),
    );
    selected.push(...available.slice(0, index === 4 ? 2 : 1));
  });
  const fill = shuffled(CORE_EVENTS, seed + 909).filter(
    (event) => !selected.some((chosen) => chosen.id === event.id),
  );
  return uniqueEvents([...selected, ...fill]).slice(0, DAILY_EVENT_COUNT);
}

function dateKeyAt(dayIndex: number) {
  return new Date(EXPANDED_START_MS + dayIndex * DAY_MS).toISOString().slice(0, 10);
}

function expandedDayIndex(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.floor((Date.UTC(year, month - 1, day) - EXPANDED_START_MS) / DAY_MS);
}

function rankEvent(dateKey: string, event: EventItem, salt: string) {
  return hashString(`${salt}|${dateKey}|${event.id}`);
}

export function hasApproximateDateConflict(event: EventItem, selected: readonly EventItem[]) {
  return selected.some(
    (placed) =>
      event.circa &&
      placed.circa &&
      event.year !== placed.year &&
      Math.abs(event.year - placed.year) <= 100,
  );
}

function ranked(dateKey: string, items: readonly EventItem[], salt: string) {
  return [...items].sort(
    (left, right) =>
      (appearanceCounts.get(left.id) ?? 0) - (appearanceCounts.get(right.id) ?? 0) ||
      rankEvent(dateKey, left, salt) - rankEvent(dateKey, right, salt) ||
      left.id.localeCompare(right.id),
  );
}

function chooseCollision(dateKey: string, eligible: readonly EventItem[]) {
  const byYear = new Map<number, EventItem[]>();
  eligible.forEach((event) => {
    byYear.set(event.year, [...(byYear.get(event.year) ?? []), event]);
  });

  const pairs: Array<[EventItem, EventItem]> = [];
  for (const group of byYear.values()) {
    if (group.length < 2) continue;
    for (let left = 0; left < group.length - 1; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        pairs.push([group[left], group[right]]);
      }
    }
  }

  const crossCategory = pairs.filter(([left, right]) => left.category !== right.category);
  const candidates = crossCategory.length > 0 ? crossCategory : pairs;
  return candidates.sort((left, right) => {
    const leftKey = `${left[0].id}|${left[1].id}`;
    const rightKey = `${right[0].id}|${right[1].id}`;
    const leftMax = Math.max(
      appearanceCounts.get(left[0].id) ?? 0,
      appearanceCounts.get(left[1].id) ?? 0,
    );
    const rightMax = Math.max(
      appearanceCounts.get(right[0].id) ?? 0,
      appearanceCounts.get(right[1].id) ?? 0,
    );
    const leftTotal =
      (appearanceCounts.get(left[0].id) ?? 0) + (appearanceCounts.get(left[1].id) ?? 0);
    const rightTotal =
      (appearanceCounts.get(right[0].id) ?? 0) + (appearanceCounts.get(right[1].id) ?? 0);
    return (
      leftMax - rightMax ||
      leftTotal - rightTotal ||
      hashString(`collision|${dateKey}|${leftKey}`) -
        hashString(`collision|${dateKey}|${rightKey}`) ||
      leftKey.localeCompare(rightKey)
    );
  })[0];
}

function categoryCount(selected: readonly EventItem[], category: EventCategory) {
  return selected.filter((event) => event.category === category).length;
}

function eraIndex(event: EventItem) {
  return ERA_RULES.findIndex((era) => era.matches(event));
}

function chooseBalanced(
  dateKey: string,
  eligible: readonly EventItem[],
  selected: readonly EventItem[],
) {
  const selectedIds = new Set(selected.map((event) => event.id));
  return [...eligible]
    .filter(
      (event) => !selectedIds.has(event.id) && !hasApproximateDateConflict(event, selected),
    )
    .sort((left, right) => {
      const categoryDifference =
        categoryCount(selected, left.category) - categoryCount(selected, right.category);
      if (categoryDifference !== 0) return categoryDifference;

      const leftEra = eraIndex(left);
      const rightEra = eraIndex(right);
      const eraDifference =
        selected.filter((event) => eraIndex(event) === leftEra).length -
        selected.filter((event) => eraIndex(event) === rightEra).length;
      if (eraDifference !== 0) return eraDifference;

      const appearanceDifference =
        (appearanceCounts.get(left.id) ?? 0) - (appearanceCounts.get(right.id) ?? 0);
      if (appearanceDifference !== 0) return appearanceDifference;

      return (
        rankEvent(dateKey, left, "fill") - rankEvent(dateKey, right, "fill") ||
        left.id.localeCompare(right.id)
      );
    })[0];
}

function buildExpandedDay(dayIndex: number) {
  const dateKey = dateKeyAt(dayIndex);
  const eligible = EVENTS.filter((event) => {
    const lastSeen = lastSeenDay.get(event.id);
    return lastSeen === undefined || dayIndex - lastSeen > NO_REPEAT_DAYS;
  });

  if (eligible.length < DAILY_EVENT_COUNT) {
    throw new Error(`Daily library exhausted on ${dateKey}; only ${eligible.length} events are eligible.`);
  }

  const collision = chooseCollision(dateKey, eligible);
  const selected: EventItem[] = collision ? [...collision] : [];

  ERA_RULES.forEach((era, index) => {
    let current = selected.filter((event) => era.matches(event)).length;
    const available = ranked(
      dateKey,
      eligible.filter(
        (event) =>
          era.matches(event) &&
          !selected.some((chosen) => chosen.id === event.id) &&
          !hasApproximateDateConflict(event, selected),
      ),
      `era-${index}`,
    );
    while (current < era.minimum && available.length > 0) {
      selected.push(available.shift()!);
      current += 1;
    }
  });

  while (selected.length < DAILY_EVENT_COUNT) {
    const next = chooseBalanced(dateKey, eligible, selected);
    if (!next) break;
    selected.push(next);
  }

  if (selected.length !== DAILY_EVENT_COUNT) {
    throw new Error(`Could not build a complete daily puzzle for ${dateKey}.`);
  }

  selected.forEach((event) => {
    lastSeenDay.set(event.id, dayIndex);
    appearanceCounts.set(event.id, (appearanceCounts.get(event.id) ?? 0) + 1);
  });
  return selected;
}

function expandedDailyEvents(dayIndex: number) {
  if (!cooldownInitialized) {
    for (let legacyDay = -NO_REPEAT_DAYS; legacyDay < 0; legacyDay += 1) {
      const dateKey = dateKeyAt(legacyDay);
      legacyDailyEvents(dailySeed(dateKey)).forEach((event) => {
        lastSeenDay.set(event.id, legacyDay);
      });
    }
    cooldownInitialized = true;
  }

  while (scheduleCache.length <= dayIndex) {
    scheduleCache.push(buildExpandedDay(scheduleCache.length));
  }
  return scheduleCache[dayIndex];
}

function manifestedDailyEvents(dayIndex: number) {
  if (dayIndex < 0 || dayIndex >= DAILY_MANIFEST_DAYS) return null;
  const offset = dayIndex * MANIFEST_DAY_WIDTH;
  const selected: EventItem[] = [];

  for (let index = 0; index < DAILY_EVENT_COUNT; index += 1) {
    const encodedIndex = DAILY_MANIFEST.slice(offset + index * 2, offset + index * 2 + 2);
    const eventId = DAILY_MANIFEST_EVENT_IDS[Number.parseInt(encodedIndex, 36)];
    const event = EVENT_BY_ID.get(eventId);
    if (!event) throw new Error(`Frozen daily event is missing: ${eventId}`);
    selected.push(event);
  }

  return selected;
}

export function generateExpandedSchedule(dayCount: number) {
  if (!Number.isInteger(dayCount) || dayCount < 1) {
    throw new Error("Schedule length must be a positive whole number.");
  }
  expandedDailyEvents(dayCount - 1);
  return scheduleCache.slice(0, dayCount).map((day) => [...day]);
}

export function dailySeed(dateKey: string) {
  return hashString(`when-${dateKey}`);
}

export function dailyFactIndex(dateKey: string, eventId: string, factCount: number) {
  if (factCount <= 1) return 0;
  const dayIndex = expandedDayIndex(dateKey);
  if (dayIndex < 0) return hashString(`fact|${dateKey}|${eventId}`) % factCount;

  const frozenIndex = DAILY_MANIFEST_EVENT_IDS.indexOf(
    eventId as (typeof DAILY_MANIFEST_EVENT_IDS)[number],
  );
  let occurrence = 0;

  if (dayIndex < DAILY_MANIFEST_DAYS && frozenIndex >= 0) {
    const token = frozenIndex.toString(36).padStart(2, "0");
    for (let index = 0; index <= dayIndex; index += 1) {
      const offset = index * MANIFEST_DAY_WIDTH;
      for (let item = 0; item < DAILY_EVENT_COUNT; item += 1) {
        if (DAILY_MANIFEST.slice(offset + item * 2, offset + item * 2 + 2) === token) {
          occurrence += 1;
        }
      }
    }
  } else {
    expandedDailyEvents(dayIndex);
    for (let index = 0; index <= dayIndex; index += 1) {
      if (scheduleCache[index].some((event) => event.id === eventId)) occurrence += 1;
    }
  }

  const startingPoint = hashString(`fact-start|${eventId}`) % factCount;
  return (startingPoint + Math.max(0, occurrence - 1)) % factCount;
}

export function dailyEvents(dateKey: string) {
  const dayIndex = expandedDayIndex(dateKey);
  if (dayIndex < 0) return legacyDailyEvents(dailySeed(dateKey));
  if (DAILY_MANIFEST_START !== EXPANDED_SCHEDULE_START) {
    throw new Error("Daily manifest start does not match the expanded schedule start.");
  }
  return manifestedDailyEvents(dayIndex) ?? [...expandedDailyEvents(dayIndex)];
}
