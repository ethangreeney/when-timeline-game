"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EVENTS, PRACTICE_PACKS, type EventItem } from "./events";

type Outcome = "correct" | "wrong";
type GameStatus = "playing" | "feedback" | "complete" | "lost";
type Screen = "home" | "game" | "results";

type Feedback = {
  eventId: string;
  correct: boolean;
  sameYear: boolean;
  selectedIndex: number;
  actualIndex: number;
};

type GameState = {
  mode: "daily" | "practice";
  packId: string;
  dateKey: string;
  puzzleNumber: number;
  timeline: string[];
  queue: string[];
  roundIndex: number;
  lives: number;
  outcomes: Outcome[];
  status: GameStatus;
  feedback?: Feedback;
  startedAt: number;
  endedAt?: number;
  streakApplied?: boolean;
};

type Profile = {
  streak: number;
  bestStreak: number;
  totalRuns: number;
  lastPlayedDate: string | null;
};

const EVENT_BY_ID = new Map(EVENTS.map((event) => [event.id, event]));
const PROFILE_KEY = "when.profile.v1";
const SOUND_KEY = "when.sound.v1";
const GAME_KEY_PREFIX = "when.daily.v1.";
const TOTAL_PLACEMENTS = 8;
const EMPTY_PROFILE: Profile = {
  streak: 0,
  bestStreak: 0,
  totalRuns: 0,
  lastPlayedDate: null,
};

function currentTimestamp() {
  return Date.now();
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dailyNumber(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const start = Date.UTC(2026, 0, 1);
  const current = Date.UTC(year, month - 1, day);
  return Math.max(1, Math.floor((current - start) / 86_400_000) + 1);
}

function hashString(value: string) {
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

function shuffled<T>(items: T[], seed: number) {
  const random = mulberry32(seed);
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function uniqueEvents(items: EventItem[]) {
  return [...new Map(items.map((event) => [event.id, event])).values()];
}

function pickDailyEvents(seed: number) {
  const eventsByYear = new Map<number, EventItem[]>();
  EVENTS.forEach((event) => {
    eventsByYear.set(event.year, [...(eventsByYear.get(event.year) ?? []), event]);
  });
  const sameYearGroups = [...eventsByYear.values()].filter((group) => group.length > 1);
  const collision = shuffled(sameYearGroups, seed + 11)[0].slice(0, 2);
  const selected: EventItem[] = [...collision];
  const eras = [
    EVENTS.filter((event) => event.year < 1850),
    EVENTS.filter((event) => event.year >= 1850 && event.year < 1930),
    EVENTS.filter((event) => event.year >= 1930 && event.year < 1970),
    EVENTS.filter((event) => event.year >= 1970 && event.year < 1995),
    EVENTS.filter((event) => event.year >= 1995),
  ];
  eras.forEach((era, index) => {
    const available = shuffled(era, seed + 101 * (index + 1)).filter(
      (event) => !selected.some((chosen) => chosen.id === event.id),
    );
    selected.push(...available.slice(0, index === 4 ? 2 : 1));
  });
  const fill = shuffled(EVENTS, seed + 909).filter(
    (event) => !selected.some((chosen) => chosen.id === event.id),
  );
  return uniqueEvents([...selected, ...fill]).slice(0, 10);
}

function pickPracticeEvents(packId: string, seed: number) {
  const pack = PRACTICE_PACKS.find((item) => item.id === packId) ?? PRACTICE_PACKS[0];
  const allowed = new Set(pack.eventIds);
  const pool = EVENTS.filter((event) => allowed.size === 0 || allowed.has(event.id));
  const fallbackPool = pool.length >= 10 ? pool : EVENTS;
  const practiceByYear = new Map<number, EventItem[]>();
  fallbackPool.forEach((event) => {
    practiceByYear.set(event.year, [...(practiceByYear.get(event.year) ?? []), event]);
  });
  const collisions = [...practiceByYear.values()].filter((group) => group.length > 1);
  const collision = shuffled(collisions, seed + 313)[0]?.slice(0, 2) ?? [];
  const rest = shuffled(fallbackPool, seed).filter(
    (event) => !collision.some((chosen) => chosen.id === event.id),
  );
  return [...collision, ...rest].slice(0, 10);
}

function makeRun(
  mode: GameState["mode"],
  dateKey: string,
  puzzleNumber: number,
  packId = "mixed",
  practiceSeed = Date.now(),
): GameState {
  const seed = mode === "daily" ? hashString(`when-${dateKey}`) : practiceSeed >>> 0;
  const selected =
    mode === "daily" ? pickDailyEvents(seed) : pickPracticeEvents(packId, seed);
  const anchorOrder = shuffled(selected, seed + 2_021);
  const firstAnchor = anchorOrder[0];
  const secondAnchor =
    anchorOrder.find((event) => event.id !== firstAnchor.id && event.year !== firstAnchor.year) ??
    anchorOrder[1];
  const anchors = [firstAnchor, secondAnchor].sort(
    (left, right) => left.year - right.year || left.title.localeCompare(right.title),
  );
  const anchorIds = new Set(anchors.map((event) => event.id));
  const queue = shuffled(
    selected.filter((event) => !anchorIds.has(event.id)),
    seed + 7_777,
  );

  return {
    mode,
    packId,
    dateKey,
    puzzleNumber,
    timeline: anchors.map((event) => event.id),
    queue: queue.map((event) => event.id),
    roundIndex: 0,
    lives: 2,
    outcomes: [],
    status: "playing",
    startedAt: Date.now(),
  };
}

function getEvent(id: string) {
  return EVENT_BY_ID.get(id)!;
}

function isValidGame(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const game = value as GameState;
  return (
    (game.mode === "daily" || game.mode === "practice") &&
    Array.isArray(game.timeline) &&
    Array.isArray(game.queue) &&
    game.timeline.every((id) => EVENT_BY_ID.has(id)) &&
    game.queue.every((id) => EVENT_BY_ID.has(id)) &&
    typeof game.roundIndex === "number" &&
    game.roundIndex >= 0 &&
    game.roundIndex <= game.queue.length &&
    ["playing", "feedback", "complete", "lost"].includes(game.status)
  );
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The game remains fully playable when storage is unavailable.
  }
}

function previousDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function updateProfile(profile: Profile, dateKey: string) {
  if (profile.lastPlayedDate === dateKey) return profile;
  const streak = profile.lastPlayedDate === previousDateKey(dateKey) ? profile.streak + 1 : 1;
  return {
    streak,
    bestStreak: Math.max(profile.bestStreak, streak),
    totalRuns: profile.totalRuns + 1,
    lastPlayedDate: dateKey,
  };
}

function formatGap(timeline: EventItem[], index: number) {
  if (index === 0) return `Before ${timeline[0].title}`;
  if (index === timeline.length) return `After ${timeline[timeline.length - 1].title}`;
  return `Between ${timeline[index - 1].title} and ${timeline[index].title}`;
}

function formatYear(year: number) {
  return new Intl.NumberFormat("en-US", { useGrouping: false }).format(year);
}

function outcomeGrid(outcomes: Outcome[]) {
  return Array.from({ length: TOTAL_PLACEMENTS }, (_, index) => {
    if (!outcomes[index]) return "⬛";
    return outcomes[index] === "correct" ? "🟩" : "🟥";
  }).join("");
}

function useGameSound(enabled: boolean) {
  const contextRef = useRef<AudioContext | null>(null);

  return useCallback(
    (kind: "correct" | "wrong" | "same" | "finish") => {
      if (!enabled || typeof window === "undefined") return;
      const AudioContextClass =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = contextRef.current ?? new AudioContextClass();
      contextRef.current = context;
      const notes =
        kind === "wrong"
          ? [165, 130]
          : kind === "same"
            ? [659, 988]
            : kind === "finish"
              ? [523, 659, 784, 1047]
              : [523, 784];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = kind === "wrong" ? "triangle" : "sine";
        oscillator.frequency.value = frequency;
        const start = context.currentTime + index * 0.075;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.09, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.18);
      });
    },
    [enabled],
  );
}

function Confetti({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => (
        <span key={index} style={{ "--i": index } as React.CSSProperties} />
      ))}
    </div>
  );
}

export default function Game() {
  const [mounted, setMounted] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [game, setGame] = useState<GameState | null>(null);
  const [dailyProgress, setDailyProgress] = useState<GameState | null>(null);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [modal, setModal] = useState<"how" | "packs" | null>(null);
  const [shareLabel, setShareLabel] = useState("Copy result");
  const [challengeVisit, setChallengeVisit] = useState(false);
  const interactionLocked = useRef(false);

  const dateKey = useMemo(() => localDateKey(), []);
  const puzzleNumber = useMemo(() => dailyNumber(dateKey), [dateKey]);
  const playSound = useGameSound(soundEnabled);

  useEffect(() => {
    const hydration = window.setTimeout(() => {
      const stored = readJson<GameState | null>(`${GAME_KEY_PREFIX}${dateKey}`, null);
      const nextProgress = isValidGame(stored) ? stored : null;
      setDailyProgress(nextProgress);
      setProfile(readJson<Profile>(PROFILE_KEY, EMPTY_PROFILE));
      setSoundEnabled(readJson<boolean>(SOUND_KEY, true));
      setChallengeVisit(new URLSearchParams(window.location.search).get("challenge") === "daily");
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(hydration);
  }, [dateKey]);

  useEffect(() => {
    if (!mounted || !game || game.mode !== "daily") return;
    writeJson(`${GAME_KEY_PREFIX}${dateKey}`, game);
  }, [dateKey, game, mounted]);

  useEffect(() => {
    if (!modal) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [modal]);

  useEffect(() => {
    if (!mounted) return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [mounted, screen]);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    writeJson(SOUND_KEY, next);
  };

  const startDaily = () => {
    const next = dailyProgress ?? makeRun("daily", dateKey, puzzleNumber);
    setGame(next);
    setDailyProgress(next);
    setScreen(next.status === "complete" || next.status === "lost" ? "results" : "game");
  };

  const startPractice = (packId: string) => {
    const next = makeRun("practice", dateKey, puzzleNumber, packId, currentTimestamp());
    setGame(next);
    setModal(null);
    setScreen("game");
  };

  const goHome = () => {
    setScreen("home");
    setGame(null);
    setShareLabel("Copy result");
  };

  const placeEvent = (selectedIndex: number) => {
    if (!game || game.status !== "playing" || interactionLocked.current) return;
    const event = getEvent(game.queue[game.roundIndex]);
    if (!event) return;
    interactionLocked.current = true;
    const timelineEvents = game.timeline.map(getEvent);
    const previous = timelineEvents[selectedIndex - 1];
    const next = timelineEvents[selectedIndex];
    const correct = (!previous || previous.year <= event.year) && (!next || event.year <= next.year);
    const sameYear = previous?.year === event.year || next?.year === event.year;
    const canonicalIndex = timelineEvents.findIndex((placed) => placed.year > event.year);
    const actualIndex = correct
      ? selectedIndex
      : canonicalIndex === -1
        ? timelineEvents.length
        : canonicalIndex;
    const nextTimeline = [...game.timeline];
    nextTimeline.splice(actualIndex, 0, event.id);
    const nextOutcomes: Outcome[] = [...game.outcomes, correct ? "correct" : "wrong"];
    const nextLives = Math.max(0, game.lives - (correct ? 0 : 1));
    const finishedAll = game.roundIndex + 1 >= game.queue.length;
    const nextStatus: GameStatus = finishedAll
      ? "complete"
      : nextLives === 0
        ? "lost"
        : "feedback";
    let nextGame: GameState = {
      ...game,
      timeline: nextTimeline,
      roundIndex: game.roundIndex + 1,
      lives: nextLives,
      outcomes: nextOutcomes,
      status: nextStatus,
      feedback: {
        eventId: event.id,
        correct,
        sameYear,
        selectedIndex,
        actualIndex,
      },
      endedAt: nextStatus === "complete" || nextStatus === "lost" ? currentTimestamp() : undefined,
    };

    if (game.mode === "daily" && (nextStatus === "complete" || nextStatus === "lost") && !game.streakApplied) {
      const nextProfile = updateProfile(profile, dateKey);
      nextGame = { ...nextGame, streakApplied: true };
      setProfile(nextProfile);
      writeJson(PROFILE_KEY, nextProfile);
    }

    setGame(nextGame);
    if (nextGame.mode === "daily") setDailyProgress(nextGame);
    playSound(correct ? (sameYear ? "same" : finishedAll ? "finish" : "correct") : "wrong");
    if (navigator.vibrate) navigator.vibrate(correct ? 25 : [45, 35, 45]);
    window.setTimeout(() => {
      interactionLocked.current = false;
    }, 280);
  };

  const continueAfterFeedback = () => {
    if (!game) return;
    if (game.status === "complete" || game.status === "lost") {
      setScreen("results");
      if (game.status === "complete") playSound("finish");
      return;
    }
    const nextGame = { ...game, status: "playing" as const, feedback: undefined };
    setGame(nextGame);
    if (nextGame.mode === "daily") setDailyProgress(nextGame);
  };

  const copyResult = async () => {
    if (!game) return;
    const score = game.outcomes.filter((outcome) => outcome === "correct").length;
    const result = [
      `WHEN? #${game.puzzleNumber}`,
      outcomeGrid(game.outcomes),
      `${score}/${TOTAL_PLACEMENTS} · ${game.lives > 0 ? `❤️${game.lives}` : "💔"} · 🔥${profile.streak}`,
      `${window.location.origin}/?challenge=daily`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(result);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = result;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setShareLabel("Copied!");
    window.setTimeout(() => setShareLabel("Copy result"), 1_800);
  };

  const shareResult = async () => {
    if (!game) return;
    const score = game.outcomes.filter((outcome) => outcome === "correct").length;
    const text = `WHEN? #${game.puzzleNumber}\n${outcomeGrid(game.outcomes)}\n${score}/${TOTAL_PLACEMENTS} · 🔥${profile.streak}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "WHEN?", text, url: `${window.location.origin}/?challenge=daily` });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copyResult();
  };

  if (!mounted) {
    return (
      <main className="loading-screen" aria-label="Loading WHEN?">
        <div className="logo-mark">WHEN?</div>
        <div className="loading-line" />
      </main>
    );
  }

  const header = (
    <header className="site-header">
      <button className="brand-button" onClick={goHome} aria-label="WHEN? home">
        <span className="brand-word">WHEN?</span>
        <span className="brand-dot" aria-hidden="true" />
      </button>
      <div className="header-actions">
        <button className="icon-button" onClick={() => setModal("how")} aria-label="How to play">
          ?
        </button>
        <button
          className="icon-button sound-button"
          onClick={toggleSound}
          aria-label={soundEnabled ? "Turn sound off" : "Turn sound on"}
          aria-pressed={soundEnabled}
        >
          {soundEnabled ? "♪" : "×"}
        </button>
      </div>
    </header>
  );

  let content: React.ReactNode;

  if (screen === "home") {
    const dailyDone = dailyProgress?.status === "complete" || dailyProgress?.status === "lost";
    const dailyStarted = Boolean(dailyProgress);
    content = (
      <main className="home-page">
        <section className="hero-copy">
          {challengeVisit && <div className="challenge-pill">A friend challenged you</div>}
          <p className="eyebrow">THE DAILY TIMELINE GAME</p>
          <h1>
            History has <span>weird neighbors.</span>
          </h1>
          <p className="hero-lede">
            Place surprising events in order. Watch completely unrelated worlds collide.
          </p>
        </section>

        <section className="daily-card" aria-labelledby="daily-title">
          <div className="daily-card-topline">
            <span>DAILY #{puzzleNumber}</span>
            <span className="streak-chip">{profile.streak > 0 ? `🔥 ${profile.streak} day streak` : "✦ New streak"}</span>
          </div>
          <div className="daily-illustration" aria-hidden="true">
            <span className="mini-card mini-one">1889</span>
            <span className="mini-line" />
            <span className="mini-card mini-two">?</span>
            <span className="mini-line" />
            <span className="mini-card mini-three">2007</span>
          </div>
          <h2 id="daily-title">
            {dailyDone ? "Today’s timeline is in the books." : "Build today’s strange timeline."}
          </h2>
          <p>10 events · 8 placements · 2 lives</p>
          <button className="primary-button" onClick={startDaily} data-testid="play-daily">
            {dailyDone
              ? "See today’s result"
              : dailyStarted
                ? `Continue round ${(dailyProgress?.roundIndex ?? 0) + 1}`
                : "Play today’s game"}
            <span aria-hidden="true">→</span>
          </button>
        </section>

        <section className="practice-strip">
          <div>
            <p className="eyebrow">NO WAITING AROUND</p>
            <h2>One more timeline?</h2>
          </div>
          <button className="secondary-button" onClick={() => setModal("packs")} data-testid="open-practice">
            Choose practice pack <span aria-hidden="true">↗</span>
          </button>
        </section>

        <p className="home-footnote">A new shared puzzle appears at midnight. No account needed.</p>
      </main>
    );
  } else if (screen === "game" && game) {
    const timelineEvents = game.timeline.map(getEvent);
    const currentEvent = game.status === "playing" ? getEvent(game.queue[game.roundIndex]) : null;
    const revealedEvent = game.feedback ? getEvent(game.feedback.eventId) : null;
    const score = game.outcomes.filter((outcome) => outcome === "correct").length;
    const packName = PRACTICE_PACKS.find((pack) => pack.id === game.packId)?.name ?? "Mixed bag";
    content = (
      <main className="game-page">
        <div className="game-statusbar">
          <button className="text-button" onClick={goHome}>← Exit</button>
          <div className="mode-label">
            {game.mode === "daily" ? `DAILY #${game.puzzleNumber}` : `PRACTICE · ${packName.toUpperCase()}`}
          </div>
          <div className="lives" aria-label={`${game.lives} ${game.lives === 1 ? "life" : "lives"} remaining`}>
            <span className={game.lives >= 1 ? "alive" : "lost"}>♥</span>
            <span className={game.lives >= 2 ? "alive" : "lost"}>♥</span>
          </div>
        </div>

        <div className="progress-track" aria-label={`Round ${Math.min(game.roundIndex + 1, TOTAL_PLACEMENTS)} of ${TOTAL_PLACEMENTS}`}>
          <span style={{ width: `${(game.roundIndex / TOTAL_PLACEMENTS) * 100}%` }} />
        </div>

        <div className="game-shell">
          <aside className="prompt-column">
            {currentEvent ? (
              <section
                className={`prompt-card color-${currentEvent.color}`}
                data-testid="current-event"
                data-event-id={currentEvent.id}
              >
                <div className="prompt-card-header">
                  <span className="round-pill">PLACE {game.roundIndex + 1} OF {TOTAL_PLACEMENTS}</span>
                  <span className="event-emoji" aria-hidden="true">{currentEvent.emoji}</span>
                </div>
                <p className="prompt-kicker">WHEN DID THIS HAPPEN?</p>
                <h2>{currentEvent.title}</h2>
                <div className="hidden-year" aria-label="Year hidden">????</div>
                <p className="prompt-help">Choose a gap in the timeline.</p>
              </section>
            ) : revealedEvent && game.feedback ? (
              <section
                className={`feedback-card ${game.feedback.correct ? "is-correct" : "is-wrong"}`}
                aria-live="polite"
                data-testid="feedback-card"
              >
                <Confetti active={game.feedback.correct} />
                <div className="feedback-symbol" aria-hidden="true">
                  {game.feedback.correct ? (game.feedback.sameYear ? "✦" : "✓") : "↘"}
                </div>
                <p className="eyebrow">
                  {game.feedback.correct
                    ? game.feedback.sameYear
                      ? "SAME YEAR!"
                      : "RIGHT ON THE LINE"
                    : "HERE’S WHERE IT LANDS"}
                </p>
                <h2>{game.feedback.correct ? (game.feedback.sameYear ? "Time twins!" : "Nailed it!") : "Not quite!"}</h2>
                <div className="reveal-year">{formatYear(revealedEvent.year)}</div>
                <h3>{revealedEvent.title}</h3>
                <p className="reveal-fact">{revealedEvent.fact}</p>
                <div className="score-note">{score} correct so far</div>
                <button className="primary-button dark" onClick={continueAfterFeedback} data-testid="continue-feedback">
                  {game.status === "complete" || game.status === "lost" ? "See my result" : "Next event"}
                  <span aria-hidden="true">→</span>
                </button>
              </section>
            ) : null}
          </aside>

          <section className="timeline-panel" aria-label="Your timeline">
            <div className="timeline-heading">
              <div>
                <p className="eyebrow">YOUR TIMELINE</p>
                <h2>{timelineEvents.length} events, in order</h2>
              </div>
              <span className="timeline-tip">Oldest at the top</span>
            </div>

            <div className="timeline-list">
              {timelineEvents.map((event, index) => {
                const isNew = game.feedback?.eventId === event.id;
                return (
                  <div className="timeline-chunk" key={event.id}>
                    {game.status === "playing" && !game.feedback && (
                      <button
                        className="gap-button"
                        onClick={() => placeEvent(index)}
                        aria-label={`Place ${currentEvent?.title ?? "event"} ${formatGap(timelineEvents, index)}`}
                        data-testid={`gap-${index}`}
                      >
                        <span>＋</span> PLACE HERE
                      </button>
                    )}
                    <article
                      className={`timeline-card color-${event.color} ${isNew ? "is-new" : ""} ${isNew && !game.feedback?.correct ? "was-wrong" : ""}`}
                      data-testid={`timeline-card-${event.id}`}
                    >
                      <span className="timeline-year">{formatYear(event.year)}</span>
                      <span className="timeline-emoji" aria-hidden="true">{event.emoji}</span>
                      <span className="timeline-title">{event.title}</span>
                    </article>
                  </div>
                );
              })}
              {game.status === "playing" && !game.feedback && (
                <button
                  className="gap-button"
                  onClick={() => placeEvent(timelineEvents.length)}
                  aria-label={`Place ${currentEvent?.title ?? "event"} ${formatGap(timelineEvents, timelineEvents.length)}`}
                  data-testid={`gap-${timelineEvents.length}`}
                >
                  <span>＋</span> PLACE HERE
                </button>
              )}
            </div>
          </section>
        </div>
      </main>
    );
  } else if (screen === "results" && game) {
    const score = game.outcomes.filter((outcome) => outcome === "correct").length;
    const won = game.status === "complete";
    const elapsed = Math.max(1, Math.round(((game.endedAt ?? game.startedAt) - game.startedAt) / 1000));
    content = (
      <main className="results-page">
        <Confetti active={won} />
        <section className={`results-card ${won ? "won" : "ended"}`}>
          <p className="eyebrow">{game.mode === "daily" ? `DAILY #${game.puzzleNumber}` : "PRACTICE COMPLETE"}</p>
          <div className="result-stamp" aria-hidden="true">{won ? "✓" : "↻"}</div>
          <h1>{won ? "Timeline complete!" : "History got you this time."}</h1>
          <p className="result-copy">
            {won
              ? "You put ten wildly different moments into one very satisfying line."
              : game.mode === "daily"
                ? "Two slips end the official run—but now you know something delightfully strange."
                : "Two slips end the run—but now you know something delightfully strange."}
          </p>
          <div className="big-score">
            <strong>{score}</strong><span>/{TOTAL_PLACEMENTS}</span>
            <small>CORRECT</small>
          </div>
          <div className="share-grid" aria-label={`${score} correct out of ${TOTAL_PLACEMENTS}`}>
            {Array.from({ length: TOTAL_PLACEMENTS }, (_, index) => (
              <span
                key={index}
                className={!game.outcomes[index] ? "unreached" : game.outcomes[index]}
              />
            ))}
          </div>
          <div className="result-stats">
            <div><strong>🔥 {game.mode === "daily" ? profile.streak : "—"}</strong><span>day streak</span></div>
            <div><strong>{game.timeline.length}/10</strong><span>events placed</span></div>
            <div><strong>{elapsed}s</strong><span>play time</span></div>
          </div>
          {game.mode === "daily" && (
            <div className="result-actions">
              <button className="primary-button" onClick={shareResult} data-testid="share-result">Share result <span>↗</span></button>
              <button className="secondary-button" onClick={copyResult} data-testid="copy-result">{shareLabel}</button>
            </div>
          )}
        </section>

        <section className="after-card">
          <div>
            <p className="eyebrow">KEEP TIME TRAVELLING</p>
            <h2>{game.mode === "daily" ? "Try a themed timeline." : "Go again with a fresh set."}</h2>
          </div>
          <div className="after-actions">
            <button className="primary-button dark" onClick={() => setModal("packs")}>Play practice <span>→</span></button>
            <button className="text-button" onClick={goHome}>Back home</button>
          </div>
        </section>
      </main>
    );
  } else {
    content = null;
  }

  return (
    <div className="app-shell">
      {header}
      {content}
      {modal === "how" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}>
          <section className="modal-card how-modal" role="dialog" aria-modal="true" aria-labelledby="how-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setModal(null)} aria-label="Close how to play">×</button>
            <p className="eyebrow">HOW TO PLAY</p>
            <h2 id="how-title">Put the world in order.</h2>
            <div className="how-steps">
              <div><span>1</span><p><strong>Read the mystery event.</strong> Its year stays hidden.</p></div>
              <div><span>2</span><p><strong>Choose a gap.</strong> Place it where you think it belongs.</p></div>
              <div><span>3</span><p><strong>Grow the line.</strong> Every answer stays, so each choice gets tighter.</p></div>
            </div>
            <div className="same-year-note"><strong>✦ Same-year rule</strong><span>If two events share a year, either side counts. We’re curious, not cruel.</span></div>
            <p className="modal-footnote">Two mistakes end the run. The daily puzzle is the same for everyone on your calendar day.</p>
            <button className="primary-button dark" onClick={() => setModal(null)}>Got it</button>
          </section>
        </div>
      )}
      {modal === "packs" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}>
          <section className="modal-card packs-modal" role="dialog" aria-modal="true" aria-labelledby="packs-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setModal(null)} aria-label="Close practice packs">×</button>
            <p className="eyebrow">UNLIMITED PRACTICE</p>
            <h2 id="packs-title">Pick your flavor of time.</h2>
            <div className="pack-grid">
              {PRACTICE_PACKS.map((pack) => (
                <button key={pack.id} className={`pack-card color-${pack.color}`} onClick={() => startPractice(pack.id)} data-testid={`pack-${pack.id}`}>
                  <span className="pack-emoji" aria-hidden="true">{pack.emoji}</span>
                  <strong>{pack.name}</strong>
                  <span>{pack.description}</span>
                  <em>Play now →</em>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
