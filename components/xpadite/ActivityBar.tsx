"use client";

import { useState, useRef, useEffect } from "react";
import { useApp } from "./AppContext";
import { COLOR_PALETTE } from "./utils";
import type { Activity } from "./types";

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
    <line x1="12" y1="5" x2="12" y2="19" strokeLinecap="round" />
    <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
  </svg>
);

const MinusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
    <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
  </svg>
);

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
    <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ─── Emoji picker ─────────────────────────────────────────────────────────────

const EMOJI_CATS = [
  {
    tab: '💼',
    emojis: ['💻', '🖥️', '📱', '⌨️', '📂', '📊', '📈', '📝', '✏️', '🔬', '🎯', '💡', '🔑', '💼', '📋', '🗂️', '📞', '🖊️', '📎', '📌'],
  },
  {
    tab: '💪',
    emojis: ['🏋️', '🧘', '🚶', '🏃', '🚴', '🏊', '⚽', '🎾', '🧗', '💪', '🥗', '🍎', '😴', '🧠', '🏥', '🥦', '🏆', '🎽', '🤸', '🧬'],
  },
  {
    tab: '🎨',
    emojis: ['🎨', '🎵', '🎸', '🎹', '📸', '🎬', '✍️', '📖', '🎭', '🎮', '🎲', '🎧', '🎤', '🎻', '🎺', '🖌️', '📚', '🎼', '🎥', '🎞️'],
  },
  {
    tab: '🌍',
    emojis: ['☕', '🍳', '🛒', '🏠', '🚗', '✈️', '🌱', '🐾', '💰', '❤️', '🌟', '⭐', '🔥', '✅', '💫', '🌈', '🎁', '💎', '🌙', '⚡'],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClear: () => void;
}

function EmojiPicker({ onSelect, onClear }: EmojiPickerProps) {
  const [cat, setCat] = useState(0);

  return (
    <div
      className="absolute top-full left-0 mt-1 rounded-xl shadow-2xl z-50 overflow-hidden"
      style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', width: 228 }}
    >
      {/* Category tabs */}
      <div className="flex items-center gap-0.5 p-1.5 pb-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
        {EMOJI_CATS.map((c, i) => (
          <button
            key={i}
            onClick={() => setCat(i)}
            className="flex-1 h-7 rounded-lg text-base transition-all"
            style={{ background: cat === i ? 'rgba(124,58,237,0.12)' : 'transparent' }}
          >
            {c.tab}
          </button>
        ))}
        <button
          onClick={onClear}
          title="No emoji"
          className="w-7 h-7 rounded-lg text-[11px] flex items-center justify-center transition-colors hover:bg-black/5 flex-shrink-0"
          style={{ color: '#9ca3af', marginLeft: 2 }}
        >
          ✕
        </button>
      </div>

      {/* Emoji grid */}
      <div className="grid grid-cols-5 gap-0.5 p-2 max-h-36 overflow-y-auto">
        {EMOJI_CATS[cat].emojis.map(emoji => (
          <button
            key={emoji}
            onClick={() => onSelect(emoji)}
            className="aspect-square rounded-lg text-xl flex items-center justify-center hover:bg-black/5 transition-colors"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Shared color picker ──────────────────────────────────────────────────────

interface ColorPickerProps {
  color: string;
  onChange: (c: string) => void;
  takenColors: string[];
  duplicateError: boolean;
}

function ColorPicker({ color, onChange, takenColors, duplicateError }: ColorPickerProps) {
  const isCustom = !COLOR_PALETTE.includes(color as typeof COLOR_PALETTE[number]);
  const [showCustom, setShowCustom] = useState(isCustom);

  return (
    <div>
      {/* Preset swatches */}
      <div className="flex gap-1.5 flex-wrap items-center">
        {COLOR_PALETTE.map((c) => {
          const taken = takenColors.includes(c);
          const selected = color === c;
          return (
            <button
              key={c}
              onClick={() => { onChange(c); setShowCustom(false); }}
              title={taken ? "Already in use" : c}
              className="w-5 h-5 rounded-full transition-all duration-150"
              style={{
                background: c,
                border: selected ? "2.5px solid #0f172a" : "2.5px solid transparent",
                transform: selected ? "scale(1.2)" : "scale(1)",
                opacity: taken && !selected ? 0.3 : 1,
              }}
            />
          );
        })}

        {/* Custom toggle */}
        <button
          onClick={() => setShowCustom(s => !s)}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium transition-all duration-150"
          style={{
            background: isCustom ? color + '22' : '#f3f4f6',
            border: `1.5px solid ${isCustom ? color + '80' : '#e5e7eb'}`,
            color: isCustom ? color : '#9ca3af',
          }}
        >
          {isCustom && <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: color }} />}
          Custom
          <span style={{ display: 'inline-block', transform: showCustom ? 'rotate(180deg)' : 'none', transition: 'transform 180ms ease' }}>▾</span>
        </button>
      </div>

      {/* Native color picker */}
      {showCustom && (
        <div className="mt-2 rounded-xl p-3 flex items-center gap-3" style={{ background: 'rgba(0,0,0,0.04)', border: '0.5px solid rgba(0,0,0,0.09)' }}>
          <div
            className="relative w-9 h-9 rounded-xl flex-shrink-0 overflow-hidden cursor-pointer"
            style={{ background: color, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', border: '1px solid rgba(0,0,0,0.08)' }}
            title="Tap to pick a custom color"
          >
            <input
              type="color"
              value={color.startsWith('#') && color.length === 7 ? color : '#7c3aed'}
              onChange={e => onChange(e.target.value)}
              className="absolute inset-0 w-full h-full cursor-pointer"
              style={{ opacity: 0, padding: 0, margin: 0, border: 'none' }}
            />
          </div>
          <div>
            <p className="text-[10px] mb-0.5" style={{ color: '#9ca3af' }}>Tap to pick</p>
            <code className="text-[11px] font-mono" style={{ color: '#6b7280' }}>{color}</code>
          </div>
        </div>
      )}

      {duplicateError && (
        <p className="text-[11px] mt-2" style={{ color: "#dc2626" }}>
          This color is already in use. Please choose another color.
        </p>
      )}
    </div>
  );
}

// ─── Add modal ────────────────────────────────────────────────────────────────

function AddActivityModal({ onClose }: { onClose: () => void }) {
  const { addActivity, setSelectedActId, activities } = useApp();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(COLOR_PALETTE[0]);
  const [emoji, setEmoji] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [duplicateError, setDuplicateError] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);

  const takenColors = activities.map((a) => a.color.toLowerCase());

  useEffect(() => {
    if (!showEmojiPicker) return;
    function onOutside(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmojiPicker(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [showEmojiPicker]);

  function handleColorChange(c: string) {
    setColor(c);
    setDuplicateError(false);
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (takenColors.includes(color.toLowerCase())) {
      setDuplicateError(true);
      return;
    }
    const newAct: Activity = { id: "a" + Date.now(), name: trimmed, color, emoji: emoji || undefined };
    addActivity(newAct);
    setSelectedActId(newAct.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className="bg-white rounded-2xl p-5 w-full max-w-[300px] shadow-2xl"
        style={{ border: "0.5px solid rgba(0,0,0,0.08)" }}
      >
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Add Activity</h3>

        {/* Emoji picker */}
        <label className="block text-xs text-gray-500 mb-1">Emoji</label>
        <div className="relative mb-4" ref={emojiRef}>
          <button
            type="button"
            onClick={() => setShowEmojiPicker(s => !s)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border w-full text-left transition-all"
            style={{
              borderColor: emoji ? color + '60' : '#e5e7eb',
              background: emoji ? color + '0d' : '#f9fafb',
            }}
          >
            <span className="text-xl w-6 text-center leading-none">{emoji || '🙂'}</span>
            <span className="text-xs text-gray-400">{emoji ? 'Change emoji' : 'Pick an emoji'}</span>
          </button>
          {showEmojiPicker && (
            <EmojiPicker
              onSelect={e => { setEmoji(e); setShowEmojiPicker(false); }}
              onClear={() => { setEmoji(""); setShowEmojiPicker(false); }}
            />
          )}
        </div>

        <label className="block text-xs text-gray-500 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Coding, Gym…"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 outline-none focus:border-violet-500 mb-4 transition-colors"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && save()}
        />

        <label className="block text-xs text-gray-500 mb-2">Color</label>
        <ColorPicker
          color={color}
          onChange={handleColorChange}
          takenColors={takenColors}
          duplicateError={duplicateError}
        />

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-3 py-1.5 text-xs text-white rounded-lg transition-opacity hover:opacity-80"
            style={{ background: "#7c3aed" }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

interface EditActivityModalProps {
  activity: Activity;
  onClose: () => void;
}

function EditActivityModal({ activity, onClose }: EditActivityModalProps) {
  const { updateActivity, activities } = useApp();
  const [name, setName] = useState(activity.name);
  const [color, setColor] = useState(activity.color);
  const [emoji, setEmoji] = useState(activity.emoji ?? "");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [duplicateError, setDuplicateError] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);

  const takenColors = activities
    .filter((a) => a.id !== activity.id)
    .map((a) => a.color.toLowerCase());

  useEffect(() => {
    if (!showEmojiPicker) return;
    function onOutside(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmojiPicker(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [showEmojiPicker]);

  function handleColorChange(c: string) {
    setColor(c);
    setDuplicateError(false);
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (
      color.toLowerCase() !== activity.color.toLowerCase() &&
      takenColors.includes(color.toLowerCase())
    ) {
      setDuplicateError(true);
      return;
    }
    updateActivity(activity.id, { name: trimmed, color, emoji: emoji || undefined });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className="bg-white rounded-2xl p-5 w-full max-w-[300px] shadow-2xl"
        style={{ border: "0.5px solid rgba(0,0,0,0.08)" }}
      >
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Edit Activity</h3>

        {/* Emoji picker */}
        <label className="block text-xs text-gray-500 mb-1">Emoji</label>
        <div className="relative mb-4" ref={emojiRef}>
          <button
            type="button"
            onClick={() => setShowEmojiPicker(s => !s)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border w-full text-left transition-all"
            style={{
              borderColor: emoji ? color + '60' : '#e5e7eb',
              background: emoji ? color + '0d' : '#f9fafb',
            }}
          >
            <span className="text-xl w-6 text-center leading-none">{emoji || '🙂'}</span>
            <span className="text-xs text-gray-400">{emoji ? 'Change emoji' : 'Pick an emoji'}</span>
          </button>
          {showEmojiPicker && (
            <EmojiPicker
              onSelect={e => { setEmoji(e); setShowEmojiPicker(false); }}
              onClear={() => { setEmoji(""); setShowEmojiPicker(false); }}
            />
          )}
        </div>

        <label className="block text-xs text-gray-500 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 outline-none focus:border-violet-500 mb-4 transition-colors"
          autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
        />

        <label className="block text-xs text-gray-500 mb-2">Color</label>
        <ColorPicker
          color={color}
          onChange={handleColorChange}
          takenColors={takenColors}
          duplicateError={duplicateError}
        />

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-3 py-1.5 text-xs text-white rounded-lg transition-opacity hover:opacity-80"
            style={{ background: "#7c3aed" }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dropdown ─────────────────────────────────────────────────────────────────

function ActivityDropdown() {
  const { activities, selectedActId, setSelectedActId, removingMode, activeSession, setToast } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const selected = activities.find((a) => a.id === selectedActId) ?? activities[0];
  if (!selected) return null;

  function handleTrigger() {
    if (activeSession) {
      setToast('~Active session in progress\nPlease clock out of your current task before selecting another.');
      return;
    }
    if (!removingMode) setOpen((o) => !o);
  }

  function handleSelect(id: string) {
    if (activeSession && id !== selectedActId) {
      setToast('~Active session in progress\nPlease clock out of your current task before selecting another.');
      setOpen(false);
      return;
    }
    setSelectedActId(id);
    setOpen(false);
  }

  const displayName = (a: Activity) => (a.emoji ? a.emoji + ' ' : '') + a.name;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={handleTrigger}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 hover:border-violet-400"
        style={{
          borderColor: selected.color + "60",
          background: selected.color + "15",
          color: selected.color,
          opacity: activeSession ? 0.7 : 1,
          cursor: activeSession ? 'not-allowed' : 'pointer',
        }}
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: selected.color }} />
        {displayName(selected)}
        {activeSession ? (
          <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5 opacity-60">
            <path d="M9 5V4a3 3 0 0 0-6 0v1H2v6h8V5H9zm-5-1a2 2 0 1 1 4 0v1H4V4zm2 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
          </svg>
        ) : (
          <ChevronIcon />
        )}
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1.5 rounded-xl shadow-xl py-1 z-30 min-w-[160px]"
          style={{ background: "var(--xp-card)", border: "0.5px solid var(--xp-bdr2)" }}
        >
          {activities.map((a) => (
            <button
              key={a.id}
              onClick={() => handleSelect(a.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-black/5"
              style={{ color: a.id === selectedActId ? a.color : "var(--xp-txt)", fontWeight: a.id === selectedActId ? 600 : 400 }}
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.color }} />
              {displayName(a)}
              {a.id === selectedActId && <span className="ml-auto">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ActivityBar ──────────────────────────────────────────────────────────────

export function ActivityBar() {
  const { activities, selectedActId, setSelectedActId, removeActivity, removingMode, setRemovingMode, activeSession, setToast } = useApp();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editActivity, setEditActivity] = useState<Activity | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  function handlePillClick(id: string) {
    if (removingMode) return;
    if (activeSession && id !== selectedActId) {
      setToast('~Active session in progress\nPlease clock out of your current task before selecting another.');
      return;
    }
    setSelectedActId(id);
  }

  return (
    <>
      <div
        className="flex items-center gap-2 px-4 py-2 flex-wrap"
        style={{ background: "var(--xp-bg2)", borderBottom: "0.5px solid var(--xp-bdr)" }}
      >
        {/* Label */}
        <span className="text-[10px] uppercase tracking-widest font-medium flex-shrink-0" style={{ color: "var(--xp-txt3)" }}>
          Activities
        </span>

        {/* Add */}
        <button
          onClick={() => { setRemovingMode(false); setShowAddModal(true); }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-white transition-opacity hover:opacity-80 flex-shrink-0"
          style={{ background: "#7c3aed" }}
        >
          <PlusIcon /> Add
        </button>

        {/* Remove */}
        <button
          onClick={() => setRemovingMode(!removingMode)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-150 flex-shrink-0"
          style={{
            background: removingMode ? "#fef2f2" : "#f3f4f6",
            color: removingMode ? "#ef4444" : "#6b7280",
            border: `1px solid ${removingMode ? "#fecaca" : "#e5e7eb"}`,
          }}
        >
          <MinusIcon /> Remove
        </button>

        <div className="w-px h-4 flex-shrink-0" style={{ background: "var(--xp-bdr2)" }} />

        <ActivityDropdown />

        {/* Pills — single-click selects, double-click edits */}
        {activities.map((a) => (
          <div key={a.id} className="relative flex-shrink-0">
            <div
              onClick={() => handlePillClick(a.id)}
              onDoubleClick={() => { if (!removingMode) setEditActivity(a); }}
              onMouseEnter={() => setHoveredId(a.id)}
              onMouseLeave={() => setHoveredId(null)}
              title="Double-click to edit"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer select-none"
              style={{
                color: a.color,
                background:
                  a.id === selectedActId && !removingMode
                    ? a.color + "22"
                    : hoveredId === a.id
                    ? a.color + "18"
                    : "var(--xp-bg3)",
                border: `1.5px solid ${
                  a.id === selectedActId && !removingMode
                    ? a.color
                    : hoveredId === a.id
                    ? a.color + "70"
                    : "transparent"
                }`,
                transition: "background 0.2s ease, border-color 0.2s ease",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: a.color }} />
              {a.emoji ? a.emoji + ' ' : ''}{a.name}
            </div>

            {removingMode && (
              <button
                onClick={() => removeActivity(a.id)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[11px] font-bold leading-none hover:bg-red-600 transition-colors shadow-sm z-10"
                aria-label={`Remove ${a.name}`}
              >
                −
              </button>
            )}
          </div>
        ))}
      </div>

      {showAddModal && <AddActivityModal onClose={() => setShowAddModal(false)} />}
      {editActivity && <EditActivityModal activity={editActivity} onClose={() => setEditActivity(null)} />}
    </>
  );
}
