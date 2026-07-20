"use client";

import { useRef, useCallback, useMemo, useState, useEffect } from "react";
import { useApp } from "./AppContext";
import {
  dateKey,
  isToday,
  DAY_HEADERS,
  MONTHS,
  APP_YEAR,
  getMonthStats,
  hexToRgba,
  resolveProgressColor,
} from "./utils";
import { generateShareCardDataUri } from "./ShareCardModal";
import { addGalleryItem } from "./GalleryModal";
import { useUpcomingReminderDates } from "./useUpcomingReminderDates";
import type { DayData } from "./types";
import type { GalleryItem } from "./GalleryModal";

// ─── Social platform definitions ─────────────────────────────────────────────

interface Platform {
  id: string;
  label: string;
  sublabel?: string;
  color: string;
  bg: string;
  abbr: string;
}

const PLATFORMS: Platform[] = [
  {
    id: "ig-story",
    label: "Instagram",
    sublabel: "Story",
    color: "#fff",
    bg: "linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)",
    abbr: "IG",
  },
  {
    id: "ig-post",
    label: "Instagram",
    sublabel: "Post",
    color: "#fff",
    bg: "linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)",
    abbr: "IG",
  },
  {
    id: "fb-story",
    label: "Facebook",
    sublabel: "Story",
    color: "#fff",
    bg: "#1877F2",
    abbr: "f",
  },
  {
    id: "fb-post",
    label: "Facebook",
    sublabel: "Post",
    color: "#fff",
    bg: "#1877F2",
    abbr: "f",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    sublabel: "Post",
    color: "#fff",
    bg: "#0A66C2",
    abbr: "in",
  },
  {
    id: "x",
    label: "X",
    sublabel: "Post",
    color: "#fff",
    bg: "#000000",
    abbr: "X",
  },
  {
    id: "tiktok",
    label: "TikTok",
    sublabel: "",
    color: "#fff",
    bg: "#010101",
    abbr: "TT",
  },
];

// localStorage connection state
const CONN_KEY = "xp9_connections";
function getConnections(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CONN_KEY) || "{}");
  } catch {
    return {};
  }
}
function markConnected(id: string) {
  const c = getConnections();
  c[id] = true;
  localStorage.setItem(CONN_KEY, JSON.stringify(c));
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const ShareIcon = () => (
  <svg
    viewBox="0 0 20 18"
    fill="none"
    width="14"
    height="13"
    aria-hidden="true"
  >
    <circle cx="16" cy="2" r="2" fill="currentColor" />
    <circle cx="16" cy="15" r="2" fill="currentColor" />
    <circle cx="4" cy="9" r="2" fill="currentColor" />
    <line
      x1="5.8"
      y1="8"
      x2="14.3"
      y2="3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <line
      x1="5.8"
      y1="10"
      x2="14.3"
      y2="15"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

function PlatformLogo({ p }: { p: Platform }) {
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        flexShrink: 0,
        background: p.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: p.abbr === "in" ? 11 : p.abbr === "TT" ? 9 : 14,
        fontWeight: 800,
        color: p.color,
        fontStyle: p.abbr === "f" ? "italic" : "normal",
        letterSpacing: p.abbr === "in" ? -0.5 : 0,
      }}
    >
      {p.abbr}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function isStreakDay(data: DayData | undefined): boolean {
  if (!data) return false;
  return !!(data.productive || data.hyper || data.milestone || data.goal);
}

// ─── Reminder ring overlay ────────────────────────────────────────────────────

function ReminderRing({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <>
      <div
        aria-label={count === 1 ? 'Has 1 upcoming reminder' : `Has ${count} upcoming reminders`}
        className="absolute inset-[26%] sm:inset-[23%] rounded-full pointer-events-none"
        style={{
          border: '2px solid rgba(239,68,68,0.55)',
          boxShadow: '0 0 0 2px rgba(239,68,68,0.08)',
          zIndex: 2,
          transition: 'opacity 200ms ease',
        }}
      />
      {count > 1 && (
        <span
          aria-hidden="true"
          className="absolute flex items-center justify-center pointer-events-none"
          style={{
            top: '14%', right: '14%',
            minWidth: 9, height: 9,
            padding: '0 1.5px',
            borderRadius: 5,
            background: 'rgba(239,68,68,0.90)',
            fontSize: 5, fontWeight: 800, color: 'white',
            lineHeight: '9px',
            zIndex: 5,
          }}
        >
          {count > 9 ? '9+' : count}
        </span>
      )}
    </>
  )
}

// ─── MonthCard ────────────────────────────────────────────────────────────────

interface MonthCardProps {
  month: number;
  isCurrentMonth: boolean;
  isZoomed?: boolean;
  onDayDoubleClick?: (key: string, month: number, day: number) => void;
  onMonthZoom?: (month: number) => void;
}

interface Cell {
  day: number;
  key: string;
  dayOfWeek: number;
  isGhost: boolean;
}

export function MonthCard({
  month,
  isCurrentMonth,
  isZoomed = false,
  onDayDoubleClick,
  onMonthZoom,
}: MonthCardProps) {
  const { calData, updateDay, setToast, isDark, progressColor: _rawColor, reminders } = useApp();
  const progressColor = resolveProgressColor(_rawColor, isDark);
  const reminderDates = useUpcomingReminderDates(reminders, calData);
  // Match the actual card surface so the productive-circle inner ring blends in
  const gapColor = isCurrentMonth ? "#eff6ff" : (isDark ? "#1a1a28" : "#ffffff");

  // Ring animation — tracks the key of a day that just became productive
  const [titleHovered, setTitleHovered] = useState(false);
  const [newlyMarkedKey, setNewlyMarkedKey] = useState<string | null>(null);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const calDataRef = useRef(calData);
  calDataRef.current = calData;

  useEffect(
    () => () => {
      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    },
    [],
  );

  // ── Button hover state ─────────────────────────────────────────────────────
  const [shareHov, setShareHov] = useState(false);

  // ── Share panel state ──────────────────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelAnim, setPanelAnim] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [connectTarget, setConnectTarget] = useState<Platform | null>(null);

  function openPanel() {
    setPanelOpen(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setPanelAnim(true)),
    );
  }
  function closePanel() {
    setPanelAnim(false);
    setTimeout(() => setPanelOpen(false), 380);
  }

  // Escape key closes
  useEffect(() => {
    if (!panelOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  async function executeShare() {
    if (sharing) return;
    setSharing(true);
    try {
      const stats = getMonthStats(calData, APP_YEAR, month);
      const uri = await generateShareCardDataUri(month, stats);
      const monthName = MONTHS[month];
      const item: GalleryItem = {
        id: "card-" + Date.now(),
        type: "month-share",
        createdAt: Date.now(),
        title: `${monthName} ${APP_YEAR}`,
        month,
        year: APP_YEAR,
        dataUri: uri,
        stats: {
          productiveDays: stats.productiveDays,
          totalDays: stats.totalDays,
          hyperDays: stats.hyperDays,
          milestoneDays: stats.milestoneDays,
          goalDays: stats.goalDays,
          completionRate: stats.completionRate,
        },
      };
      addGalleryItem(item);
      setToast(`${monthName} share card saved to Gallery ✓`);
      const shareText = `${monthName} ${APP_YEAR}: ${stats.completionRate}% completion — XPadite`;
      if (navigator.share) {
        try {
          const res = await fetch(uri);
          const blob = await res.blob();
          const file = new File(
            [blob],
            `xpadite-${monthName.toLowerCase()}-${APP_YEAR}.png`,
            { type: "image/png" },
          );
          const canFiles = navigator.canShare?.({ files: [file] });
          await navigator.share(
            canFiles
              ? {
                  title: `${monthName} XPadite`,
                  text: shareText,
                  files: [file],
                }
              : { title: `${monthName} XPadite`, text: shareText },
          );
        } catch {
          const a = document.createElement("a");
          a.href = uri;
          a.download = `xpadite-${monthName.toLowerCase()}-${APP_YEAR}.png`;
          a.click();
        }
      } else {
        const a = document.createElement("a");
        a.href = uri;
        a.download = `xpadite-${monthName.toLowerCase()}-${APP_YEAR}.png`;
        a.click();
      }
      closePanel();
    } finally {
      setSharing(false);
    }
  }

  function handlePlatformClick(p: Platform) {
    const connections = getConnections();
    if (!connections[p.id]) {
      setConnectTarget(p);
    } else {
      executeShare();
    }
  }

  function handleConnect() {
    if (!connectTarget) return;
    markConnected(connectTarget.id);
    setConnectTarget(null);
    executeShare();
  }

  // ── Calendar cells ─────────────────────────────────────────────────────────
  const clickRef = useRef<{
    key: string | null;
    count: number;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ key: null, count: 0, timer: null });

  const { cells, totalDays } = useMemo<{
    cells: Cell[];
    totalDays: number;
  }>(() => {
    const fd = new Date(APP_YEAR, month, 1).getDay();
    const td = new Date(APP_YEAR, month + 1, 0).getDate();
    const prevTd = new Date(APP_YEAR, month, 0).getDate();
    const result: Cell[] = [];

    for (let i = fd - 1; i >= 0; i--) {
      result.push({
        day: prevTd - i,
        key: `ghost-prev-${month}-${i}`,
        dayOfWeek: fd - 1 - i === -1 ? 6 : fd - 1 - i,
        isGhost: true,
      });
    }
    for (let d = 1; d <= td; d++) {
      result.push({
        day: d,
        key: dateKey(APP_YEAR, month, d),
        dayOfWeek: (fd + d - 1) % 7,
        isGhost: false,
      });
    }
    // Always pad to 42 cells (6 rows) with ghost dates from the next month
    let nextDay = 1;
    while (result.length < 42) {
      result.push({
        day: nextDay++,
        key: `ghost-next-${month}-${nextDay}`,
        dayOfWeek: result.length % 7,
        isGhost: true,
      });
    }
    return { cells: result, totalDays: td };
  }, [month]);

  const handleCellClick = useCallback(
    (key: string, day: number, wasStreak: boolean) => {
      if (clickRef.current.key !== key) {
        if (clickRef.current.timer) clearTimeout(clickRef.current.timer);
        clickRef.current = { key, count: 0, timer: null };
      }
      clickRef.current.count++;
      if (clickRef.current.count === 1) {
        clickRef.current.timer = setTimeout(() => {
          clickRef.current = { key: null, count: 0, timer: null };
          if (wasStreak) {
            // Status already set — locked on the calendar.
            // Direct the user to the Task Manager to change it.
            setToast('Change this status from the Task Manager.');
            return;
          }
          const wasProductive = !!calDataRef.current[key]?.productive;
          updateDay(key, (prev) => ({
            ...prev,
            productive: !prev.productive,
            hyper: prev.productive ? false : prev.hyper,
          }));
          if (!wasProductive) {
            if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
            setNewlyMarkedKey(key);
            ringTimerRef.current = setTimeout(
              () => setNewlyMarkedKey(null),
              600,
            );
          }
          setToast("Day Complete ✅  Great work. See you tomorrow.");
        }, 260);
      } else if (clickRef.current.count === 2) {
        if (clickRef.current.timer) clearTimeout(clickRef.current.timer);
        clickRef.current = { key: null, count: 0, timer: null };
        onDayDoubleClick?.(key, month, day);
      }
    },
    [updateDay, setToast, onDayDoubleClick, month, setNewlyMarkedKey],
  );

  return (
    <>
      {/* ── Card ────────────────────────────────────────────────────────────── */}
      <div
        className="rounded-xl p-1 sm:p-2 transition-all duration-200 flex flex-col h-full"
        style={{
          background: isCurrentMonth ? "#eff6ff" : "var(--xp-card)",
          border: isCurrentMonth
            ? "1px solid #bfdbfe"
            : "0.5px solid var(--xp-bdr)",
          boxShadow: isCurrentMonth
            ? `0 2px 8px rgba(59,130,246,0.08)${isDark ? `, 0 0 28px 8px ${hexToRgba(progressColor, 0.21)}, 0 0 56px 20px ${hexToRgba(progressColor, 0.11)}` : ''}`
            : "none",
        }}
      >
        {/* Month header */}
        <div className="flex items-center justify-center px-0.5 sm:px-2 mb-1 sm:mb-3">
          <button
            onClick={() => onMonthZoom?.(month)}
            onMouseEnter={() => setTitleHovered(true)}
            onMouseLeave={() => setTitleHovered(false)}
            className="whitespace-nowrap"
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: 8,
              cursor: 'pointer',
              background: isZoomed
                ? '#7c3aed'
                : titleHovered
                  ? (isDark ? '#7c3aed' : '#111111')
                  : isCurrentMonth
                    ? '#ffffff'
                    : (isDark ? 'rgba(255,255,255,0.06)' : '#f3f4f6'),
              color: isZoomed
                ? '#ffffff'
                : titleHovered
                  ? '#ffffff'
                  : isCurrentMonth
                    ? '#374151'
                    : (isDark ? 'rgba(255,255,255,0.72)' : '#374151'),
              border: isZoomed
                ? '1px solid rgba(167,139,250,0.50)'
                : titleHovered
                  ? (isDark ? '1px solid rgba(167,139,250,0.60)' : '1px solid #111111')
                  : isCurrentMonth
                    ? '1px solid #c4cdd6'
                    : (isDark ? '1px solid rgba(255,255,255,0.16)' : '1px solid #d1d5db'),
              boxShadow: isZoomed
                ? '0 0 0 3px rgba(124,58,237,0.18), 0 2px 12px rgba(124,58,237,0.35)'
                : 'none',
              transition: 'background 170ms ease, color 170ms ease, border-color 170ms ease, box-shadow 170ms ease',
            }}
          >
            <span className="hidden sm:inline">{MONTHS[month]}</span>
            <span className="sm:hidden">{MONTHS[month].slice(0, 3)}</span>
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-0.5 sm:mb-1">
          {DAY_HEADERS.map((d, i) => (
            <div
              key={d}
              className="text-center text-[8px] font-medium"
              style={{ color: i === 0 ? "#f97316" : "var(--xp-txt3)" }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid — natural compact height; spacer below pushes Share button to bottom */}
        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            if (cell.isGhost) {
              return (
                <div
                  key={cell.key}
                  className="aspect-square flex items-center justify-center text-[8px]"
                  style={{
                    color: isDark
                      ? (isCurrentMonth ? "#94a3b8" : "rgba(255,255,255,0.45)")
                      : "#8f98a6",
                  }}
                >
                  {cell.day}
                </div>
              );
            }

            const dayData = calData[cell.key];
            const streak = isStreakDay(dayData);
            const productive = !!dayData?.productive;
            const hyper = !!dayData?.hyper;
            const milestone = !!dayData?.milestone;
            const goal = !!dayData?.goal;
            const todayCell = isToday(APP_YEAR, month, cell.day);
            const isSun = cell.dayOfWeek === 0;
            const reminderCount = reminderDates.get(cell.key) ?? 0;

            const prevKey =
              cell.day > 1 ? dateKey(APP_YEAR, month, cell.day - 1) : null;
            const nextKey =
              cell.day < totalDays
                ? dateKey(APP_YEAR, month, cell.day + 1)
                : null;
            const connectLeft =
              streak &&
              cell.dayOfWeek !== 0 &&
              !!prevKey &&
              isStreakDay(calData[prevKey]);
            const connectRight =
              streak &&
              cell.dayOfWeek !== 6 &&
              !!nextKey &&
              isStreakDay(calData[nextKey]);

            const connEdge = hyper || milestone || goal ? "50%" : "85%";
            const connL = connectLeft && (
              <div
                className="xp-streak-conn"
                style={{
                  position: "absolute",
                  left: 0,
                  right: connEdge,
                  top: "50%",
                  height: 2,
                  background: progressColor,
                  boxShadow: isDark ? `0 0 7px 2px ${hexToRgba(progressColor, 0.28)}` : undefined,
                  transform: "translateY(-50%)",
                  zIndex: 0,
                  pointerEvents: "none",
                }}
              />
            );
            const connR = connectRight && (
              <div
                className="xp-streak-conn"
                style={{
                  position: "absolute",
                  left: connEdge,
                  right: -1,
                  top: "50%",
                  height: 2,
                  background: progressColor,
                  boxShadow: isDark ? `0 0 7px 2px ${hexToRgba(progressColor, 0.28)}` : undefined,
                  transform: "translateY(-50%)",
                  zIndex: 0,
                  pointerEvents: "none",
                }}
              />
            );

            if (hyper)
              return (
                <div
                  key={cell.key}
                  className="aspect-square relative cursor-pointer select-none group"
                  onClick={() => handleCellClick(cell.key, cell.day, streak)}
                  title="Change this status from the Task Manager."
                >
                  {connL}
                  {connR}
                  <ReminderRing count={reminderCount} />
                  <div
                    className="absolute inset-0 transition-transform duration-[160ms] group-hover:scale-110"
                    style={{ zIndex: 1 }}
                  >
                    <span
                      className="xp-emoji-fire"
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        fontSize: "30px",
                        lineHeight: 1,
                        userSelect: "none",
                      }}
                    >
                      🔥
                    </span>
                    <span
                      style={{
                        position: "absolute",
                        top: "65%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        zIndex: 2,
                        fontSize: "9px",
                        fontWeight: 700,
                        color: "#0a0a0a",
                        pointerEvents: "none",
                      }}
                    >
                      {cell.day}
                    </span>
                  </div>
                </div>
              );

            if (milestone)
              return (
                <div
                  key={cell.key}
                  className="aspect-square relative cursor-pointer select-none group"
                  onClick={() => handleCellClick(cell.key, cell.day, streak)}
                  title="Change this status from the Task Manager."
                >
                  {connL}
                  {connR}
                  <ReminderRing count={reminderCount} />
                  <div
                    className="absolute inset-0 transition-transform duration-[160ms] group-hover:scale-110"
                    style={{ zIndex: 1 }}
                  >
                    <span
                      className="xp-emoji-star"
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        fontSize: "24px",
                        color: "rgba(167,139,250,0.20)",
                        filter: "drop-shadow(0 0 5px rgba(167,139,250,0.55))",
                        userSelect: "none",
                        lineHeight: 1,
                        zIndex: 0,
                      }}
                    >
                      ★
                    </span>
                    <span
                      className="xp-emoji-trophy"
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        fontSize: "26px",
                        lineHeight: 1,
                        userSelect: "none",
                        zIndex: 1,
                      }}
                    >
                      🏆
                    </span>
                    <span
                      style={{
                        position: "absolute",
                        top: "37%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        zIndex: 2,
                        fontSize: "7px",
                        fontWeight: 700,
                        color: "#0a0a0a",
                        textShadow: "0 0 4px rgba(255,255,255,1)",
                        pointerEvents: "none",
                      }}
                    >
                      {cell.day}
                    </span>
                  </div>
                </div>
              );

            if (goal)
              return (
                <div
                  key={cell.key}
                  className="aspect-square relative cursor-pointer select-none group"
                  onClick={() => handleCellClick(cell.key, cell.day, streak)}
                  title="Change this status from the Task Manager."
                >
                  {connL}
                  {connR}
                  <ReminderRing count={reminderCount} />
                  <div
                    className="absolute inset-0 transition-transform duration-[160ms] group-hover:scale-110"
                    style={{ zIndex: 1 }}
                  >
                    <span
                      className="xp-emoji-goal"
                      style={{
                        position: "absolute",
                        top: "44%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        fontSize: "34px",
                        lineHeight: 1,
                        userSelect: "none",
                      }}
                    >
                      🎯
                    </span>
                    <span
                      style={{
                        position: "absolute",
                        top: "52%",
                        left: "46%",
                        transform: "translate(-50%, -50%)",
                        zIndex: 2,
                        fontSize: "10px",
                        fontWeight: 700,
                        color: "#000000",
                        textShadow: "0 0 4px rgba(255,255,255,1)",
                        pointerEvents: "none",
                      }}
                    >
                      {cell.day}
                    </span>
                  </div>
                </div>
              );

            let circleStyle: React.CSSProperties = {
              color: isSun ? "#f97316" : isDark ? "var(--xp-txt3)" : "#374151",
              fontSize: "9px",
            };

            if (productive)
              circleStyle = {
                background: progressColor,
                color: progressColor === '#ffffff' ? '#000000' : 'white',
                fontSize: "9px",
                fontWeight: 600,
                boxShadow: `0 0 0 2px ${gapColor}, 0 0 0 4.5px ${hexToRgba(progressColor, 0.7)}`,
              };
            else if (todayCell)
              circleStyle = {
                color: "var(--xp-acc)",
                background: "rgba(124,58,237,0.08)",
                outline: "1.5px solid var(--xp-acc)",
                outlineOffset: "-1px",
                fontSize: "9px",
              };

            return (
              <div
                key={cell.key}
                className="aspect-square relative cursor-pointer select-none group"
                onClick={() => handleCellClick(cell.key, cell.day, streak)}
                title={productive ? 'Change this status from the Task Manager.' : undefined}
              >
                {connL}
                {connR}
                <ReminderRing count={reminderCount} />
                <div
                  className="absolute inset-[26%] sm:inset-[23%] rounded-full flex items-center justify-center transition-all duration-150 group-hover:scale-110"
                  style={{ zIndex: 1, ...circleStyle }}
                >
                  {cell.day}
                </div>
                {productive && cell.key === newlyMarkedKey && (
                  <svg
                    viewBox="0 0 100 100"
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 3 }}
                  >
                    <circle
                      cx="50"
                      cy="50"
                      r="34"
                      transform="rotate(-90 50 50)"
                      fill="none"
                      stroke={hexToRgba(progressColor, 0.85)}
                      strokeWidth="3.5"
                      pathLength="1"
                      strokeDasharray="1"
                      strokeDashoffset="1"
                      className="xp-ring-draw-circle"
                      style={{
                        animation: "xp-ring-draw 440ms ease-in-out forwards",
                      }}
                    />
                  </svg>
                )}
              </div>
            );
          })}
        </div>

        {/* Spacer: absorbs remaining height so Share button sits at the bottom without stretching the calendar */}
        <div className="flex-1" />

        {/* Share button — pinned to bottom of card via flex-col layout */}
        <div className="flex justify-center pt-1 pb-1 sm:pt-3 sm:pb-2">
          <button
            onClick={openPanel}
            onMouseEnter={() => setShareHov(true)}
            onMouseLeave={() => setShareHov(false)}
            className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[9px] font-semibold active:scale-95"
            style={{
              background: shareHov ? "#7c3aed" : "rgba(124,58,237,0.08)",
              color:      shareHov ? "white"   : "#7c3aed",
              border:     shareHov ? "1px solid transparent" : "1px solid rgba(124,58,237,0.30)",
              boxShadow:  shareHov ? "0 1px 4px rgba(124,58,237,0.3)" : "none",
              transition: "background 0.18s ease, color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
            }}
          >
            <ShareIcon />
            Share
          </button>
        </div>
      </div>

      {/* ── Share panel — fixed bottom sheet, spring slide-up ────────────────── */}
      {panelOpen && (
        <div
          className="fixed inset-0 z-[55]"
          style={{
            background: panelAnim ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0)",
            transition: "background 0.25s ease",
          }}
          onClick={closePanel}
        >
          <div
            className="absolute left-0 right-0 bottom-0 rounded-t-2xl shadow-2xl"
            style={{
              background: "#111114",
              border: "0.5px solid rgba(255,255,255,0.10)",
              transform: panelAnim ? "translateY(0)" : "translateY(100%)",
              opacity: panelAnim ? 1 : 0,
              transition:
                "transform 0.38s cubic-bezier(0.34,1.4,0.64,1), opacity 0.22s ease",
              maxWidth: 480,
              margin: "0 auto",
              paddingBottom: "env(safe-area-inset-bottom, 8px)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  background: "rgba(255,255,255,0.15)",
                }}
              />
            </div>

            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-3"
              style={{ borderBottom: "0.5px solid rgba(255,255,255,0.07)" }}
            >
              <div>
                <p className="text-sm font-semibold text-white">
                  Share {MONTHS[month]}
                </p>
                <p
                  className="text-[10px] mt-0.5"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                >
                  Card saved to Gallery automatically
                </p>
              </div>
              <button
                onClick={closePanel}
                className="text-xs transition-colors"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                ✕
              </button>
            </div>

            {/* Platform grid */}
            <div className="grid grid-cols-4 gap-3 px-4 py-4">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handlePlatformClick(p)}
                  disabled={sharing}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl transition-all active:scale-95 disabled:opacity-40"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "0.5px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <PlatformLogo p={p} />
                  <div className="text-center" style={{ lineHeight: 1.2 }}>
                    <p
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.85)",
                      }}
                    >
                      {p.label}
                    </p>
                    {p.sublabel && (
                      <p
                        style={{ fontSize: 8, color: "rgba(255,255,255,0.4)" }}
                      >
                        {p.sublabel}
                      </p>
                    )}
                  </div>
                </button>
              ))}
              {/* Download PNG */}
              <button
                onClick={() => executeShare()}
                disabled={sharing}
                className="flex flex-col items-center gap-2 py-3 rounded-xl transition-all active:scale-95 disabled:opacity-40"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "0.5px solid rgba(255,255,255,0.08)",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: "#4f46e5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
                    <path
                      d="M8 2v9M4 7l4 5 4-5"
                      stroke="white"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <line
                      x1="2"
                      y1="14"
                      x2="14"
                      y2="14"
                      stroke="white"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div className="text-center" style={{ lineHeight: 1.2 }}>
                  <p
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      color: "rgba(255,255,255,0.85)",
                    }}
                  >
                    Download
                  </p>
                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.4)" }}>
                    PNG
                  </p>
                </div>
              </button>
            </div>

            {sharing && (
              <p
                className="text-center text-[10px] pb-3"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                Generating share card…
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Connect account dialog ───────────────────────────────────────────── */}
      {connectTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setConnectTarget(null)}
        >
          <div
            className="w-full max-w-[300px] rounded-2xl p-6 shadow-2xl"
            style={{
              background: "#111114",
              border: "0.5px solid rgba(255,255,255,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <PlatformLogo p={connectTarget} />
            </div>
            <h3 className="text-sm font-bold text-white text-center mb-1">
              Connect {connectTarget.label}?
            </h3>
            <p
              className="text-[11px] text-center mb-5"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              Allow XPadite to share your monthly progress to{" "}
              {connectTarget.label}.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConnectTarget(null)}
                className="flex-1 py-2 rounded-xl text-xs transition-all hover:opacity-80"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.55)",
                  border: "0.5px solid rgba(255,255,255,0.1)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-85"
                style={{
                  background: connectTarget.bg.startsWith("linear")
                    ? "#E1306C"
                    : connectTarget.bg,
                }}
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
