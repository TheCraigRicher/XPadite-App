"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import { useApp } from "./AppContext";
import { CalendarSection } from "./CalendarSection";
import type {
  AIMessage,
  AIDraftPlan,
  DraftTask,
  AIPlanState,
  Activity,
} from "./types";
import {
  buildAttachments,
  removeAttachmentById,
  ATTACHMENT_ACCEPT,
  AttachmentItem,
  ImageLightbox,
} from "./attachmentUtils";

const ACTION_LABELS = {
  editNotes: "✏️ Edit Notes",
  upload:    "📎 Upload File",
  camera:    "📷 Camera",
} as const;

// ═══════════════════════════════════════════════════════════════════
// SECTION 1 — HELPERS
// ═══════════════════════════════════════════════════════════════════

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function fmtDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}


function fmtTime(hhmm: string | null): string {
  if (!hhmm) return "";
  const [h, min] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(min).padStart(2, "0")} ${ampm}`;
}

function timeToTs(dateKey: string, timeStr: string): number {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const [h, min] = timeStr.split(":").map(Number);
  return new Date(y, mo - 1, d, h, min, 0, 0).getTime();
}

function getTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function fmtMs(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2 — PERSISTENCE
// ═══════════════════════════════════════════════════════════════════

const LS_KEY = "xp9-aic";

interface PersistedState {
  messages: AIMessage[];
  planState: AIPlanState;
  draftPlan: AIDraftPlan | null;
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { messages: [], planState: "idle", draftPlan: null };
}

function saveState(s: PersistedState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3 — useAICoach HOOK  (all logic, no visuals)
// ═══════════════════════════════════════════════════════════════════

type VoiceState = "idle" | "listening" | "processing";

interface UseAICoachReturn {
  messages: AIMessage[];
  streamingContent: string;
  isStreaming: boolean;
  planState: AIPlanState;
  draftPlan: AIDraftPlan | null;
  voiceState: VoiceState;
  errorMsg: string | null;
  sendMessage: (text: string) => Promise<void>;
  generatePlan: () => Promise<void>;
  addTasksToCalendar: () => Promise<void>;
  updateDraftTask: (clientId: string, patch: Partial<DraftTask>) => void;
  removeDraftTask: (clientId: string) => void;
  resetConversation: () => void;
  startVoice: () => void;
  stopVoice: () => Promise<string | null>;
  cancelVoice: () => void;
}

function useAICoach(): UseAICoachReturn {
  const { activities, addActivity, updateDay, setToast } = useApp();

  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [streamingContent, setStreaming] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [planState, setPlanState] = useState<AIPlanState>("idle");
  const [draftPlan, setDraftPlan] = useState<AIDraftPlan | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const saved = loadState();
    if (saved.messages.length) {
      setMessages(saved.messages);
      setPlanState(saved.planState);
      setDraftPlan(saved.draftPlan);
    }
  }, []);

  useEffect(() => {
    saveState({ messages, planState, draftPlan });
  }, [messages, planState, draftPlan]);

  const buildContext = useCallback(
    () => ({
      today: todayStr(),
      timezone: getTimezone(),
      activities: activities.map((a) => ({
        id: a.id,
        name: a.name,
        emoji: a.emoji ?? null,
      })),
    }),
    [activities],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (isStreaming || !text.trim()) return;
      setErrorMsg(null);

      const userMsg: AIMessage = {
        id: genId(),
        role: "user",
        content: text.trim(),
        timestamp: Date.now(),
      };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      if (planState === "idle") setPlanState("conversation");

      setIsStreaming(true);
      setStreaming("");
      abortRef.current = new AbortController();

      try {
        const res = await fetch("/api/ai-coach/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortRef.current.signal,
          body: JSON.stringify({
            messages: nextMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            context: buildContext(),
          }),
        });
        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: "Request failed" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let content = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          setStreaming(content);
        }
        setMessages((prev) => [
          ...prev,
          { id: genId(), role: "assistant", content, timestamp: Date.now() },
        ]);
        setStreaming("");
        const userCount = nextMessages.filter((m) => m.role === "user").length;
        if (
          userCount >= 4 &&
          planState !== "draft_ready" &&
          planState !== "generating"
        ) {
          setPlanState("ready_to_generate");
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        const msg =
          err instanceof Error ? err.message : "Failed to reach AI Coach";
        setErrorMsg(msg);
      } finally {
        setIsStreaming(false);
      }
    },
    [isStreaming, messages, planState, buildContext],
  );

  const generatePlan = useCallback(async () => {
    if (messages.length === 0) return;
    setErrorMsg(null);
    setPlanState("generating");
    try {
      const res = await fetch("/api/ai-coach/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          context: buildContext(),
        }),
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Plan generation failed" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { plan } = await res.json();
      const planId = "aip-" + genId();
      const sorted = [...plan.tasks].sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        if (a.startTime && b.startTime)
          return a.startTime < b.startTime ? -1 : 1;
        return 0;
      });
      const draftTasks: DraftTask[] = sorted.map((t) => ({
        ...t,
        reminderEnabled: t.reminderRecommended,
        aiPlanId: planId,
        done: false,
      }));
      const dates = draftTasks.map((t) => t.date).sort();
      setDraftPlan({
        id: planId,
        createdAt: Date.now(),
        goal: plan.goal,
        activitySuggestion: plan.activitySuggestion,
        phases: plan.phases,
        milestones: plan.milestones,
        tasks: draftTasks,
        dateRange: {
          start: dates[0] ?? todayStr(),
          end: dates[dates.length - 1] ?? todayStr(),
        },
        warnings: plan.warnings,
        assumptions: plan.assumptions,
      });
      setPlanState("draft_ready");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Plan generation failed";
      setErrorMsg(msg);
      setPlanState("ready_to_generate");
      setToast(`~AI Plan error\n${msg}`);
    }
  }, [messages, buildContext, setToast]);

  const addTasksToCalendar = useCallback(async () => {
    if (!draftPlan) return;
    setPlanState("saving");
    setErrorMsg(null);
    try {
      const sugg = draftPlan.activitySuggestion;
      let resolvedActId = sugg.existingActivityId ?? "";
      if (!resolvedActId) {
        const existing = activities.find(
          (a) => a.name.toLowerCase() === sugg.suggestedName.toLowerCase(),
        );
        if (existing) {
          resolvedActId = existing.id;
        } else {
          const newAct: Activity = {
            id: "act-ai-" + genId(),
            name: sugg.suggestedName,
            color: sugg.suggestedColor ?? "#7c3aed",
            emoji: sugg.emoji ?? undefined,
          };
          addActivity(newAct);
          resolvedActId = newAct.id;
        }
      }
      const grouped = draftPlan.tasks.reduce<Record<string, DraftTask[]>>(
        (acc, t) => {
          (acc[t.date] ??= []).push(t);
          return acc;
        },
        {},
      );
      for (const [dateKey, tasks] of Object.entries(grouped)) {
        updateDay(dateKey, (prev) => {
          const newTasks = tasks.map((dt) => ({
            id: "ai-" + genId(),
            text: dt.title,
            done: false,
            journal: dt.notes ?? "",
            timerStart: null,
            timerEnd: null,
            actId: resolvedActId,
            milestone: dt.priority === "high",
            sessions:
              dt.startTime && dt.endTime
                ? [
                    {
                      id: "ais-" + genId(),
                      startTs: timeToTs(dateKey, dt.startTime),
                      endTs: timeToTs(dateKey, dt.endTime),
                      note: dt.notes ?? "",
                      tags: [],
                    },
                  ]
                : [],
            aiPlanId: dt.aiPlanId,
          }));
          return { ...prev, tasks: [...prev.tasks, ...newTasks] };
        });
      }
      setPlanState("saved");
      setToast(
        `~Tasks added to calendar!\n${draftPlan.tasks.length} tasks from your AI plan`,
      );
      setTimeout(() => {
        setPlanState("idle");
        setDraftPlan(null);
        setMessages([]);
      }, 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save tasks";
      setErrorMsg(msg);
      setPlanState("draft_ready");
      setToast(`~Save error\n${msg}`);
    }
  }, [draftPlan, activities, addActivity, updateDay, setToast]);

  const updateDraftTask = useCallback(
    (clientId: string, patch: Partial<DraftTask>) => {
      setDraftPlan((prev) =>
        prev
          ? {
              ...prev,
              tasks: prev.tasks.map((t) =>
                t.clientId === clientId ? { ...t, ...patch } : t,
              ),
            }
          : prev,
      );
    },
    [],
  );

  const removeDraftTask = useCallback((clientId: string) => {
    setDraftPlan((prev) => {
      if (!prev) return prev;
      const tasks = prev.tasks.filter((t) => t.clientId !== clientId);
      return tasks.length === 0 ? prev : { ...prev, tasks };
    });
  }, []);

  const resetConversation = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setDraftPlan(null);
    setPlanState("idle");
    setStreaming("");
    setIsStreaming(false);
    setErrorMsg(null);
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
  }, []);

  const startVoice = useCallback(async () => {
    if (voiceState !== "idle") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecRef.current = rec;
      rec.start();
      setVoiceState("listening");
    } catch {
      setToast("~Microphone access denied\nPlease allow microphone access.");
    }
  }, [voiceState, setToast]);

  const stopVoice = useCallback(async (): Promise<string | null> => {
    const rec = mediaRecRef.current;
    if (!rec || voiceState !== "listening") return null;
    setVoiceState("processing");
    return new Promise((resolve) => {
      rec.onstop = async () => {
        rec.stream.getTracks().forEach((t) => t.stop());
        mediaRecRef.current = null;
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];
        try {
          const fd = new FormData();
          fd.append("audio", blob);
          const res = await fetch("/api/ai-coach/transcribe", {
            method: "POST",
            body: fd,
          });
          if (!res.ok) throw new Error("Transcription failed");
          const { text } = await res.json();
          setVoiceState("idle");
          resolve(text ?? null);
        } catch {
          setVoiceState("idle");
          setToast("~Transcription failed\nCould not convert speech.");
          resolve(null);
        }
      };
      rec.stop();
    });
  }, [voiceState, setToast]);

  const cancelVoice = useCallback(() => {
    const rec = mediaRecRef.current;
    if (rec) {
      rec.stream.getTracks().forEach((t) => t.stop());
      mediaRecRef.current = null;
    }
    audioChunksRef.current = [];
    setVoiceState("idle");
  }, []);

  return {
    messages,
    streamingContent,
    isStreaming,
    planState,
    draftPlan,
    voiceState,
    errorMsg,
    sendMessage,
    generatePlan,
    addTasksToCalendar,
    updateDraftTask,
    removeDraftTask,
    resetConversation,
    startVoice,
    stopVoice,
    cancelVoice,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 4 — VOICE WAVEFORM  (Phase 1: thin-bar gaussian animation)
// ═══════════════════════════════════════════════════════════════════

function WaveformDisplay({
  voiceState,
  isStreaming,
}: {
  voiceState: VoiceState;
  isStreaming: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  // Derive display label — Phase 2 will drive the canvas too
  const label =
    voiceState === "listening"
      ? "🎤 Listening..."
      : voiceState === "processing"
        ? "🧠 Processing..."
        : isStreaming
          ? "🤖 Responding..."
          : "🎤 Listening...";

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false);

    function draw() {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const W = canvas.offsetWidth || 320;
      const H = canvas.offsetHeight || 86;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const t = Date.now() / 1000;
      const cY = H * 0.5;

      // Background
      ctx.fillStyle = "#040112";
      ctx.fillRect(0, 0, W, H);

      // Central bloom
      const bloom = ctx.createRadialGradient(
        W * 0.5,
        cY,
        0,
        W * 0.5,
        cY,
        W * 0.46,
      );
      bloom.addColorStop(0, "rgba(100,28,220,0.32)");
      bloom.addColorStop(0.5, "rgba(68,12,180,0.14)");
      bloom.addColorStop(1, "rgba(18, 0, 70,0)");
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, W, H);

      if (reduced) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      const N = 56;
      const BAR = 2;
      const pad = 18;
      const slot = (W - pad * 2) / N;

      for (let i = 0; i < N; i++) {
        const x01 = i / (N - 1);
        const cx = pad + i * slot + (slot - BAR) * 0.5;

        // Gaussian taper: tallest at center, very short at edges
        const d = Math.abs(x01 - 0.5) * 2;
        const env = Math.exp(-d * d * 3.0);

        // Animated sine superposition — two independent frequencies per bar
        const a1 = 0.5 + 0.5 * Math.sin(t * 2.4 + i * 0.31);
        const a2 = 0.5 + 0.5 * Math.sin(t * 1.65 + i * 0.22 + 1.1);
        const anim = 0.36 + 0.64 * (0.58 * a1 + 0.42 * a2);

        const barH = Math.max(2, H * 0.8 * env * anim);
        const y = cY - barH * 0.5;

        // Hue: purple (270) at center → cyan-teal (190) at edges
        const hue = 270 - d * 80;
        const sat = 88;
        const lit = 60 + env * 12;
        const alph = 0.52 + env * 0.48;

        const grd = ctx.createLinearGradient(0, y, 0, y + barH);
        grd.addColorStop(
          0,
          `hsla(${hue + 18},${sat}%,${lit + 14}%,${alph * 0.85})`,
        );
        grd.addColorStop(
          0.38,
          `hsla(${hue},     ${sat}%,${lit}%,     ${alph})`,
        );
        grd.addColorStop(
          0.62,
          `hsla(${hue},     ${sat}%,${lit}%,     ${alph})`,
        );
        grd.addColorStop(
          1,
          `hsla(${hue + 18},${sat}%,${lit + 14}%,${alph * 0.85})`,
        );

        ctx.shadowColor = `hsla(${hue},${sat}%,${lit}%,${env * 0.62})`;
        ctx.shadowBlur = 4 + env * 7;

        ctx.fillStyle = grd;
        ctx.fillRect(cx, y, BAR, barH);
      }

      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 14px 16px" }}>
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: 150,
          borderRadius: 6,
        }}
      />
      <div
        style={{
          marginTop: 14,
          fontSize: 10.5,
          color: "rgba(196,168,255,0.65)",
          letterSpacing: "0.06em",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 5 — CONVERSATION AREA
// ═══════════════════════════════════════════════════════════════════

function ConversationArea({
  messages,
  streamingContent,
  isStreaming,
}: {
  messages: AIMessage[];
  streamingContent: string;
  isStreaming: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  if (messages.length === 0 && !isStreaming) {
    const timeStr = new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return (
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 12px 8px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "linear-gradient(135deg,#6d28d9,#9333ea)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              flexShrink: 0,
              boxShadow: "0 2px 8px rgba(109,40,217,0.4)",
            }}
          >
            🤖
          </div>
          <div
            style={{
              flex: 1,
              borderRadius: "16px 16px 16px 4px",
              background: "white",
              border: "1px solid rgba(229,224,255,0.9)",
              padding: "11px 14px 10px",
              boxShadow: "0 1px 6px rgba(124,58,237,0.08)",
            }}
          >
            <p
              style={{
                fontSize: 13.5,
                fontWeight: 700,
                color: "#1a1033",
                lineHeight: 1.3,
                marginBottom: 5,
              }}
            >
              Hi Craig! 👋
            </p>
            <p style={{ fontSize: 13, color: "#3d3456", lineHeight: 1.6 }}>
              I'm your AI Coach. Let's build a plan that actually fits your life
              and helps you reach your goal.
            </p>
            <p
              style={{
                fontSize: 12.5,
                color: "#7c3aed",
                marginTop: 7,
                fontWeight: 600,
              }}
            >
              What goal do you want to focus on?
            </p>
            <p
              style={{
                fontSize: 10.5,
                color: "#a099b8",
                marginTop: 8,
                textAlign: "right",
              }}
            >
              {timeStr}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          style={{
            display: "flex",
            justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          {msg.role === "assistant" && (
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "linear-gradient(135deg,#6d28d9,#9333ea)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              🤖
            </div>
          )}
          <div
            style={{
              maxWidth: "78%",
              padding: "9px 13px",
              borderRadius:
                msg.role === "user"
                  ? "16px 16px 4px 16px"
                  : "16px 16px 16px 4px",
              background:
                msg.role === "user"
                  ? "linear-gradient(135deg,#5b21b6,#7c3aed)"
                  : "rgba(255,255,255,0.07)",
              border:
                msg.role === "assistant"
                  ? "0.5px solid rgba(255,255,255,0.1)"
                  : "none",
              fontSize: 14,
              lineHeight: 1.55,
              color: msg.role === "user" ? "white" : "var(--xp-txt)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {msg.content}
          </div>
        </div>
      ))}
      {isStreaming && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "linear-gradient(135deg,#6d28d9,#9333ea)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            🤖
          </div>
          <div
            style={{
              maxWidth: "78%",
              padding: "9px 13px",
              borderRadius: "16px 16px 16px 4px",
              background: "rgba(255,255,255,0.07)",
              border: "0.5px solid rgba(255,255,255,0.1)",
              fontSize: 14,
              lineHeight: 1.55,
              color: "var(--xp-txt)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {streamingContent || (
              <span style={{ display: "flex", gap: 4 }}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#a78bfa",
                      display: "inline-block",
                      animation: `xp-blink 1s ${i * 200}ms ease-in-out infinite`,
                    }}
                  />
                ))}
              </span>
            )}
            {streamingContent && (
              <span
                style={{
                  display: "inline-block",
                  width: 2,
                  height: 14,
                  background: "#a78bfa",
                  marginLeft: 2,
                  animation: "xp-blink 0.8s ease-in-out infinite",
                  verticalAlign: "text-bottom",
                }}
              />
            )}
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 5b — MICROPHONE ICON  (custom SVG matching supplied asset)
// ═══════════════════════════════════════════════════════════════════

function MicIcon({
  size = 22,
  color = "white",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size * 0.72}
      height={size}
      viewBox="0 0 64 90"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* Hollow capsule body — outline only, matching reference */}
      <rect x="14" y="2" width="36" height="52" rx="18" stroke={color} strokeWidth="7" fill="none" />
      {/* Wide U-arc stand */}
      <path
        d="M4 46 Q4 78 32 78 Q60 78 60 46"
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* Stem */}
      <line
        x1="32"
        y1="78"
        x2="32"
        y2="94"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 6 — AI COACH CARD  (left panel)
// ═══════════════════════════════════════════════════════════════════

interface AICoachCardProps {
  coach: UseAICoachReturn;
  isActive: boolean;
  onActivate: () => void;
}

function AICoachCard({
  coach,
  isActive,
  onActivate,
}: AICoachCardProps) {
  const { isDark } = useApp();
  const [text, setText] = useState("");
  const [showNudge, setShowNudge] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { planState, messages, isStreaming, voiceState } = coach;
  const isGenerating = planState === "generating";
  const isSaved = planState === "saved";
  const inputDisabled =
    isStreaming || isGenerating || planState === "saving" || isSaved;

  function handleSend() {
    if (!text.trim() || inputDisabled || voiceState !== "idle") return;
    coach.sendMessage(text.trim());
    setText("");
    taRef.current?.focus();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleMic() {
    if (voiceState === "listening") {
      const t = await coach.stopVoice();
      if (t) {
        setText((prev) => (prev ? prev + " " + t : t));
        taRef.current?.focus();
      }
    } else if (voiceState === "idle") {
      await coach.startVoice();
    }
  }

  // Active vs inactive styles — background tint included so it cross-fades smoothly
  const cardStyle = isActive
    ? {
        background: isDark ? "rgba(11,5,26,0.99)" : "#fdfbff",
        border: "1.5px solid rgba(124,58,237,0.62)",
        boxShadow: isDark
          ? "0 0 0 3px rgba(124,58,237,0.11), 0 0 22px rgba(124,58,237,0.17), 0 8px 32px rgba(0,0,0,0.52)"
          : "0 0 0 3px rgba(124,58,237,0.08), 0 0 18px rgba(124,58,237,0.14), 0 6px 24px rgba(0,0,0,0.1)",
      }
    : {
        background: isDark ? "rgba(8,4,22,0.98)" : "#ffffff",
        border: isDark
          ? "0.5px solid rgba(124,58,237,0.28)"
          : "1px solid rgba(124,58,237,0.2)",
        boxShadow: isDark
          ? "0 4px 20px rgba(0,0,0,0.45)"
          : "0 2px 16px rgba(124,58,237,0.07)",
      };

  return (
    <div
      onClick={onActivate}
      onFocus={onActivate}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderRadius: 20,
        overflow: "hidden",
        cursor: "default",
        // 190ms ease-out on all three properties — no scale, no bounce
        transition:
          "background-color 190ms ease-out, border-color 190ms ease-out, box-shadow 190ms ease-out",
        ...cardStyle,
      }}
    >
      {/* ── Waveform (always dark audio panel, top of card) ── */}
      <div style={{ flexShrink: 0, background: "#04010e" }}>
        <WaveformDisplay voiceState={voiceState} isStreaming={isStreaming} />
      </div>

      {/* ── Conversation / welcome message area ── */}
      <div
        style={{
          flex: 1,
          margin: "0 12px 12px",
          border: `1px solid ${isDark ? "rgba(147,51,234,0.3)" : "rgba(229,224,255,0.9)"}`,
          borderRadius: 16,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: isDark
            ? "rgba(255,255,255,0.02)"
            : "rgba(250,248,255,0.8)",
        }}
      >
        <ConversationArea
          messages={coach.messages}
          streamingContent={coach.streamingContent}
          isStreaming={isStreaming}
        />
      </div>

      {/* ── Suggested Goals (empty state only) ── */}
      {messages.length === 0 && !isStreaming && !inputDisabled && (
        <div style={{ padding: "0 12px 14px", flexShrink: 0 }}>
          <div
            style={{
              borderRadius: 14,
              border: isDark
                ? "1px solid rgba(124,58,237,0.18)"
                : "1px solid rgba(229,224,255,0.9)",
              background: isDark ? "rgba(124,58,237,0.05)" : "white",
              padding: "10px 12px",
              boxShadow: isDark ? "none" : "0 1px 4px rgba(124,58,237,0.06)",
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: isDark ? "rgba(196,168,255,0.7)" : "#6d28d9",
                marginBottom: 8,
                letterSpacing: "0.04em",
              }}
            >
              ✨ Suggested Goals
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {[
                { emoji: "💪", label: "Build muscle" },
                { emoji: "🎓", label: "College Project" },
                { emoji: "🚀", label: "Launch a SaaS" },
              ].map((g) => (
                <button
                  key={g.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    setText(g.label);
                    taRef.current?.focus();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "5px 11px",
                    borderRadius: 20,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                    color: isDark ? "rgba(255,255,255,0.82)" : "#3d3456",
                    background: isDark
                      ? "rgba(124,58,237,0.10)"
                      : "rgba(243,240,255,0.9)",
                    border: isDark
                      ? "0.5px solid rgba(124,58,237,0.28)"
                      : "1px solid rgba(209,200,255,0.8)",
                    transition: "background 140ms ease",
                  }}
                >
                  <span>{g.emoji}</span>
                  <span>{g.label}</span>
                </button>
              ))}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  taRef.current?.focus();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 11px",
                  borderRadius: 20,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                  color: isDark ? "rgba(255,255,255,0.38)" : "#a099b8",
                  background: "transparent",
                  border: isDark
                    ? "0.5px dashed rgba(255,255,255,0.14)"
                    : "1px dashed rgba(180,170,220,0.6)",
                  transition: "background 140ms ease",
                }}
              >
                + Custom goal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Error banner ── */}
      {coach.errorMsg && (
        <div
          style={{
            margin: "0 14px 6px",
            padding: "7px 12px",
            borderRadius: 10,
            background: "rgba(239,68,68,0.1)",
            border: "0.5px solid rgba(239,68,68,0.3)",
            fontSize: 12,
            color: "#fca5a5",
          }}
        >
          {coach.errorMsg}
        </div>
      )}

      {/* ── Unified composer: input + mic + Generate Plan in one container ── */}
      <div style={{ padding: "0 12px 12px", flexShrink: 0 }}>
        <div
          style={{
            border: `1.5px solid ${isDark ? "rgba(124,58,237,0.32)" : "rgba(209,200,255,0.95)"}`,
            borderRadius: 16,
            background: isDark ? "rgba(255,255,255,0.04)" : "white",
            boxShadow: isDark
              ? "inset 0 1px 0 rgba(255,255,255,0.04)"
              : "0 2px 8px rgba(124,58,237,0.07), inset 0 1px 0 rgba(255,255,255,0.9)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Upper: text input */}
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => { setText(e.target.value); setShowNudge(false); }}
            onKeyDown={handleKey}
            disabled={inputDisabled || voiceState !== "idle"}
            placeholder={
              voiceState === "listening"
                ? "🎤 Listening…"
                : voiceState === "processing"
                  ? "Transcribing…"
                  : "What goal do you want to discuss?"
            }
            rows={2}
            style={{
              resize: "none",
              border: "none",
              background: "transparent",
              outline: "none",
              fontSize: 13.5,
              color: "var(--xp-txt)",
              lineHeight: 1.55,
              padding: "12px 14px 6px",
              maxHeight: 90,
              overflowY: "auto",
              opacity: inputDisabled ? 0.5 : 1,
            }}
          />

          {/* Nudge banner — appears when Generate Plan is clicked too early */}
          {showNudge && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 10px 7px 12px",
                background: isDark ? "rgba(109,40,217,0.12)" : "rgba(237,233,254,0.9)",
                borderTop: `0.5px solid ${isDark ? "rgba(124,58,237,0.25)" : "rgba(167,139,250,0.4)"}`,
              }}
            >
              <span style={{ flex: 1, fontSize: 11.5, lineHeight: 1.45, color: isDark ? "rgba(196,168,255,0.92)" : "#5b21b6" }}>
                Please discuss your goal with AI Coach before generating a plan.
              </span>
              <button
                onClick={() => setShowNudge(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: isDark ? "rgba(167,139,250,0.7)" : "rgba(109,40,217,0.5)", fontSize: 14, lineHeight: 1, padding: "2px 4px", flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Bottom row: mic (left) + Generate Plan (right) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px 8px",
              borderTop: isDark
                ? "0.5px solid rgba(255,255,255,0.05)"
                : "0.5px solid rgba(229,224,255,0.8)",
            }}
          >
            {/* Circular mic button */}
            <button
              onClick={handleMic}
              disabled={voiceState === "processing" || inputDisabled}
              title={
                voiceState === "listening"
                  ? "Stop recording"
                  : voiceState === "processing"
                    ? "Transcribing…"
                    : "Voice input"
              }
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                flexShrink: 0,
                background:
                  voiceState === "listening"
                    ? "rgba(239,68,68,0.14)"
                    : voiceState === "processing"
                      ? "rgba(109,40,217,0.18)"
                      : inputDisabled && voiceState === "idle"
                        ? "rgba(163,117,242,0.10)"
                        : "linear-gradient(145deg, #6d28d9 0%, #8b5cf6 100%)",
                border:
                  voiceState === "listening"
                    ? "1.5px solid rgba(239,68,68,0.50)"
                    : inputDisabled && voiceState === "idle"
                      ? "1px solid rgba(163,117,242,0.18)"
                      : "none",
                cursor:
                  voiceState === "processing" || inputDisabled
                    ? "not-allowed"
                    : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 200ms, box-shadow 200ms",
                boxShadow:
                  voiceState === "listening"
                    ? "0 0 0 4px rgba(239,68,68,0.10), 0 0 0 7px rgba(239,68,68,0.05)"
                    : voiceState === "idle" && !inputDisabled
                      ? "0 2px 10px rgba(124,58,237,0.42), 0 0 0 2px rgba(124,58,237,0.10)"
                      : "none",
                opacity: voiceState === "processing" ? 0.65 : 1,
              }}
            >
              {voiceState === "processing" ? (
                <span
                  style={{
                    fontSize: 10,
                    color: "rgba(167,139,250,0.85)",
                    letterSpacing: "0.18em",
                  }}
                >
                  ···
                </span>
              ) : (
                <MicIcon size={19} />
              )}
            </button>

            {/* Generate Plan / status */}
            {!isSaved ? (
              <button
                onClick={() => {
                  if (isGenerating || isStreaming) return;
                  const userMsgCount = messages.filter((m) => m.role === "user").length;
                  if (userMsgCount < 3) {
                    setShowNudge(true);
                  } else {
                    setShowNudge(false);
                    coach.generatePlan();
                  }
                }}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  borderRadius: 11,
                  fontSize: 13.5,
                  fontWeight: 700,
                  background: isGenerating
                    ? "rgba(124,58,237,0.55)"
                    : "linear-gradient(135deg, #5b21b6, #7c3aed)",
                  color: "white",
                  border: "0.5px solid rgba(167,139,250,0.35)",
                  cursor: "pointer",
                  boxShadow: isGenerating ? "none" : "0 3px 12px rgba(124,58,237,0.28)",
                  transition: "all 200ms ease",
                }}
              >
                {isGenerating ? "⏳ Generating your plan…" : "✨ Generate Plan"}
              </button>
            ) : (
              <div
                style={{
                  flex: 1,
                  padding: "9px 0",
                  borderRadius: 11,
                  textAlign: "center",
                  background: "rgba(22,163,74,0.10)",
                  border: "0.5px solid rgba(22,163,74,0.28)",
                  fontSize: 13.5,
                  color: "#86efac",
                  fontWeight: 700,
                }}
              >
                ✅ Tasks saved to calendar!
              </div>
            )}
          </div>
        </div>

        {/* Reset link */}
        {messages.length > 0 && (
          <button
            onClick={coach.resetConversation}
            style={{
              display: "block",
              width: "100%",
              marginTop: 7,
              textAlign: "center",
              fontSize: 11,
              color: isDark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.28)",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            Start new conversation ↺
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 7 — TASK MANAGER CARD  (right panel)
// ═══════════════════════════════════════════════════════════════════

// Non-persistent placeholder rows — visual only, never saved, never counted
const N_PLACEHOLDERS = 5;

function PlaceholderTaskRow({ idx }: { idx: number }) {
  const { isDark } = useApp();
  const alpha = 1 - idx * 0.1;
  return (
    <div
      aria-hidden="true"
      style={{
        borderRadius: 10,
        border: isDark
          ? "0.5px solid rgba(255,255,255,0.06)"
          : "1px solid rgba(229,224,255,0.85)",
        background: isDark ? "rgba(255,255,255,0.025)" : "white",
        opacity: alpha * 0.72,
        pointerEvents: "none",
        userSelect: "none",
        boxShadow: isDark ? "none" : "0 1px 3px rgba(124,58,237,0.05)",
      }}
    >
      {/* Top row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "8px 10px 4px",
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.15)",
            flexShrink: 0,
            cursor: "grab",
          }}
        >
          ⠿
        </span>
        <span
          style={{
            fontSize: 11,
            color: isDark ? "rgba(255,255,255,0.22)" : "#7c6fa0",
            fontWeight: 600,
            minWidth: 36,
            flexShrink: 0,
          }}
        >
          Task {idx + 1}
        </span>
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            flexShrink: 0,
            border: `1.5px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(180,170,220,0.6)"}`,
          }}
        />
        {/* Placeholder title — gray rounded pill matching ITR 4 */}
        <div
          style={{
            flex: 1,
            height: 22,
            borderRadius: 6,
            background: isDark
              ? "rgba(255,255,255,0.06)"
              : "rgba(220,215,240,0.45)",
            display: "flex",
            alignItems: "center",
            paddingLeft: 8,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              fontSize: 11.5,
              color: isDark ? "rgba(255,255,255,0.22)" : "#b0a8c8",
              fontStyle: "italic",
            }}
          >
            Tasks by AI Coach
          </span>
        </div>
        {/* Activity pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            borderRadius: 8,
            border: isDark
              ? "0.5px solid rgba(255,255,255,0.08)"
              : "1px solid rgba(209,200,255,0.7)",
            background: isDark
              ? "rgba(124,58,237,0.06)"
              : "rgba(243,240,255,0.7)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: isDark
                ? "rgba(167,139,250,0.3)"
                : "rgba(124,58,237,0.3)",
            }}
          />
          <span
            style={{
              fontSize: 10,
              color: isDark ? "rgba(167,139,250,0.35)" : "#a99dc8",
              fontWeight: 500,
            }}
          >
            Activity
          </span>
        </div>
        <span
          style={{
            fontSize: 13,
            color: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.12)",
          }}
        >
          ···
        </span>
      </div>
      {/* Bottom row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "3px 10px 8px",
          borderTop: isDark
            ? "0.5px solid rgba(255,255,255,0.04)"
            : "0.5px solid rgba(229,224,255,0.6)",
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: isDark ? "rgba(255,255,255,0.16)" : "#c4bedd",
            minWidth: 38,
          }}
        >
          0h 0m
        </span>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: "rgba(22,163,74,0.07)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(22,163,74,0.28)",
            fontSize: 9,
          }}
        >
          ▶
        </div>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: "rgba(239,68,68,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(239,68,68,0.28)",
            fontSize: 9,
          }}
        >
          ■
        </div>
        <span
          style={{
            fontSize: 11.5,
            color: isDark ? "rgba(167,139,250,0.22)" : "#c4bedd",
            fontWeight: 500,
          }}
        >
          00:00 AM – 00:00 PM
        </span>
        <div
          style={{
            marginLeft: "auto",
            width: 20,
            height: 20,
            borderRadius: 5,
            background: isDark
              ? "rgba(124,58,237,0.08)"
              : "rgba(243,240,255,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            color: isDark ? "rgba(167,139,250,0.25)" : "rgba(124,58,237,0.3)",
          }}
        >
          ▶
        </div>
      </div>
    </div>
  );
}

// ── TaskCard ──────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  idx,
  color,
  onUpdate,
  onRemove,
}: {
  task: DraftTask;
  idx: number;
  color: string;
  onUpdate: (p: Partial<DraftTask>) => void;
  onRemove: () => void;
}) {
  const { isDark } = useApp();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notesFocused, setNotesFocused] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const attachments = useMemo(() => task.attachments ?? [], [task.attachments]);

  async function handleFiles(files: FileList | null, source: "upload" | "camera") {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const next = await buildAttachments(files, source);
      onUpdate({ attachments: [...attachments, ...next] });
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(id: string) {
    onUpdate({ attachments: removeAttachmentById(attachments, id) });
  }

  const totalMs = useMemo(() => {
    if (!task.startTime || !task.endTime) return task.estimatedMinutes * 60_000;
    const [sh, sm] = task.startTime.split(":").map(Number);
    const [eh, em] = task.endTime.split(":").map(Number);
    return (eh * 60 + em - (sh * 60 + sm)) * 60_000;
  }, [task]);

  return (
    <>
    <div
      style={{
        borderRadius: 12,
        border: isDark
          ? "0.5px solid rgba(255,255,255,0.08)"
          : "0.5px solid rgba(0,0,0,0.09)",
        background: task.done
          ? isDark
            ? "rgba(22,163,74,0.05)"
            : "rgba(22,163,74,0.04)"
          : isDark
            ? "rgba(255,255,255,0.04)"
            : "rgba(248,248,252,0.9)",
        overflow: "hidden",
      }}
    >
      {/* Top row: number + checkbox + title + activity + menu */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 12px 6px",
        }}
      >
        {/* Drag handle */}
        <span
          style={{
            color: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
            fontSize: 11,
            flexShrink: 0,
            cursor: "grab",
          }}
        >
          ≡
        </span>
        {/* Task number */}
        <span
          style={{
            fontSize: 11,
            color: isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)",
            fontWeight: 600,
            minWidth: 18,
            flexShrink: 0,
          }}
        >
          {idx + 1}
        </span>
        {/* Checkbox */}
        <button
          onClick={() => onUpdate({ done: !task.done })}
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            flexShrink: 0,
            cursor: "pointer",
            background: task.done ? "#16a34a" : "transparent",
            border: `1.5px solid ${task.done ? "#16a34a" : color}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {task.done && (
            <span style={{ fontSize: 9, color: "white", fontWeight: 900 }}>
              ✓
            </span>
          )}
        </button>

        {/* Title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input
              autoFocus
              value={task.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
              style={{
                width: "100%",
                background: "rgba(124,58,237,0.08)",
                border: "0.5px solid rgba(124,58,237,0.4)",
                borderRadius: 6,
                padding: "3px 8px",
                fontSize: 13,
                color: "var(--xp-txt)",
                outline: "none",
              }}
            />
          ) : (
            <span
              onClick={() => setEditing(true)}
              style={{
                fontSize: 13,
                fontWeight: 500,
                cursor: "text",
                display: "block",
                color: task.done ? "var(--xp-txt3)" : "var(--xp-txt)",
                textDecoration: task.done ? "line-through" : "none",
                opacity: task.done ? 0.65 : 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {task.title || "Untitled task"}
            </span>
          )}
        </div>

        {/* Activity pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            borderRadius: 8,
            border: `0.5px solid ${color}55`,
            background: isDark ? `${color}18` : `${color}12`,
            flexShrink: 0,
            maxWidth: 110,
          }}
        >
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: color,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 11,
              color: isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.65)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 500,
            }}
          >
            {task.activityName}
          </span>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) setTimeout(() => notesRef.current?.focus(), 80);
          }}
          title={expanded ? "Collapse" : "Notes & Attachments"}
          style={{
            width: 22,
            height: 22,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            background: expanded
              ? isDark ? "rgba(124,58,237,0.18)" : "rgba(124,58,237,0.1)"
              : "none",
            borderRadius: 5,
            cursor: "pointer",
            color: expanded
              ? isDark ? "rgba(167,139,250,0.9)" : "#7c3aed"
              : isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)",
            fontSize: 11,
            transition: "background 150ms, color 150ms",
          }}
        >
          {expanded ? "⌃" : "⌄"}
        </button>

        {/* Remove */}
        <button
          onClick={onRemove}
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            background: "none",
            cursor: "pointer",
            color: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.3)",
            fontSize: 14,
          }}
        >
          ···
        </button>
      </div>

      {/* Bottom row: duration + times */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 12px 9px",
          borderTop: isDark
            ? "0.5px solid rgba(255,255,255,0.05)"
            : "0.5px solid rgba(0,0,0,0.06)",
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)",
            minWidth: 42,
          }}
        >
          {fmtMs(totalMs)}
        </span>
        {/* Start/stop buttons */}
        <button
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: "rgba(22,163,74,0.12)",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#16a34a",
            fontSize: 10,
          }}
        >
          ▶
        </button>
        <button
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: "rgba(239,68,68,0.1)",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
          }}
        >
          🟥
        </button>
        {/* Time range */}
        {task.startTime && task.endTime ? (
          <span
            style={{
              fontSize: 12,
              color: isDark ? "rgba(167,139,250,0.8)" : "#7c3aed",
              fontWeight: 500,
            }}
          >
            {fmtTime(task.startTime)} – {fmtTime(task.endTime)}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: "var(--xp-txt3)" }}>
            {fmtDate(task.date)}
          </span>
        )}
        {task.priority === "high" && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "#f59e0b",
              letterSpacing: "0.06em",
              background: "rgba(245,158,11,0.12)",
              padding: "1px 5px",
              borderRadius: 3,
              marginLeft: "auto",
            }}
          >
            HIGH
          </span>
        )}
        {task.reminderEnabled && (
          <span style={{ fontSize: 11, marginLeft: "auto" }}>🔔</span>
        )}
        <div
          style={{
            marginLeft: "auto",
            width: 20,
            height: 20,
            borderRadius: 5,
            background: "rgba(124,58,237,0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            color: "#9333ea",
          }}
        >
          ▶
        </div>
      </div>

      {/* ── Expanded: Notes + Attachments ── */}
      {expanded && (
        <div
          style={{
            borderTop: isDark
              ? "0.5px solid rgba(124,58,237,0.18)"
              : "0.5px solid rgba(124,58,237,0.14)",
            padding: "10px 12px 12px",
          }}
        >
          {/* Action bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {(["editNotes", "upload", "camera"] as const).map((action) => (
              <button
                key={action}
                onClick={() => {
                  if (action === "editNotes") notesRef.current?.focus();
                  else if (action === "upload") uploadRef.current?.click();
                  else cameraRef.current?.click();
                }}
                disabled={uploading && action !== "editNotes"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 10px",
                  borderRadius: 7,
                  background: isDark ? "rgba(124,58,237,0.10)" : "rgba(124,58,237,0.06)",
                  border: isDark
                    ? "0.5px solid rgba(124,58,237,0.28)"
                    : "0.5px solid rgba(124,58,237,0.2)",
                  cursor: "pointer",
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: isDark ? "rgba(196,168,255,0.88)" : "#5b21b6",
                  transition: "background 130ms",
                  opacity: uploading && action !== "editNotes" ? 0.5 : 1,
                }}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
            {uploading && (
              <span style={{ fontSize: 11, color: isDark ? "rgba(167,139,250,0.7)" : "#7c3aed", display: "flex", alignItems: "center", gap: 4 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    border: "1.5px solid currentColor",
                    borderTopColor: "transparent",
                    animation: "xp-spin 0.7s linear infinite",
                  }}
                />
                Uploading…
              </span>
            )}
          </div>

          {/* Hidden file inputs */}
          <input
            ref={uploadRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            style={{ display: "none" }}
            onChange={(e) => { handleFiles(e.target.files, "upload"); e.currentTarget.value = ""; }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            {...{ capture: "environment" }}
            style={{ display: "none" }}
            onChange={(e) => { handleFiles(e.target.files, "camera"); e.currentTarget.value = ""; }}
          />

          {/* Notes textarea */}
          <textarea
            ref={notesRef}
            value={task.notes ?? ""}
            onChange={(e) => onUpdate({ notes: e.target.value || null })}
            placeholder="Add notes, links, ideas…"
            rows={2}
            style={{
              width: "100%",
              resize: "vertical",
              border: isDark
                ? `0.5px solid ${notesFocused ? "rgba(124,58,237,0.55)" : "rgba(124,58,237,0.25)"}`
                : `0.5px solid ${notesFocused ? "rgba(124,58,237,0.5)" : "rgba(124,58,237,0.2)"}`,
              borderRadius: 8,
              background: isDark ? "rgba(255,255,255,0.03)" : "rgba(248,246,255,0.9)",
              color: "var(--xp-txt)",
              fontSize: 12.5,
              lineHeight: 1.55,
              padding: "8px 10px",
              outline: "none",
              boxSizing: "border-box",
              minHeight: 56,
              maxHeight: 140,
              fontFamily: "inherit",
            }}
            onFocus={() => setNotesFocused(true)}
            onBlur={() => setNotesFocused(false)}
          />

          {/* Attachments list */}
          {attachments.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
              {attachments.map((att) => (
                <AttachmentItem
                  key={att.id}
                  attachment={att}
                  isDark={isDark}
                  onRemove={() => removeAttachment(att.id)}
                  onPreview={() => {
                    if (att.mimeType.startsWith("image/")) setLightbox(att.url);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>

    {/* Image lightbox */}
    {lightbox && (
      <ImageLightbox src={lightbox} alt="Attachment preview" onClose={() => setLightbox(null)} />
    )}
  </>
  );
}

interface TaskManagerCardProps {
  coach: UseAICoachReturn;
  onCollapse?: () => void;
  isActive?: boolean;
  onActivate?: () => void;
}

function TaskManagerCard({
  coach,
  onCollapse: _onCollapse,
  isActive = false,
  onActivate,
}: TaskManagerCardProps) {
  const { isDark } = useApp();
  const { draftPlan, planState } = coach;
  const actColor = draftPlan?.activitySuggestion.suggestedColor ?? "#7c3aed";
  const isSaving = planState === "saving";
  const isSaved = planState === "saved";

  const tasksByDate = useMemo(() => {
    if (!draftPlan) return [];
    const groups: Record<string, DraftTask[]> = {};
    for (const t of draftPlan.tasks) {
      (groups[t.date] ??= []).push(t);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [draftPlan]);

  const totalFocusMs = useMemo(() => {
    if (!draftPlan) return 0;
    return draftPlan.tasks.reduce((acc, t) => {
      if (!t.startTime || !t.endTime) return acc + t.estimatedMinutes * 60_000;
      const [sh, sm] = t.startTime.split(":").map(Number);
      const [eh, em] = t.endTime.split(":").map(Number);
      return acc + (eh * 60 + em - (sh * 60 + sm)) * 60_000;
    }, 0);
  }, [draftPlan]);

  const tmCardStyle = isActive
    ? {
        background: isDark ? "rgba(11,5,26,0.99)" : "#fdfbff",
        border: "1.5px solid rgba(124,58,237,0.62)",
        boxShadow: isDark
          ? "0 0 0 3px rgba(124,58,237,0.11), 0 0 22px rgba(124,58,237,0.17), 0 8px 32px rgba(0,0,0,0.52)"
          : "0 0 0 3px rgba(124,58,237,0.08), 0 0 18px rgba(124,58,237,0.14), 0 6px 24px rgba(0,0,0,0.1)",
      }
    : {
        background: isDark ? "rgba(8,4,22,0.98)" : "#ffffff",
        border: isDark
          ? "0.5px solid rgba(124,58,237,0.22)"
          : "1px solid rgba(0,0,0,0.08)",
        boxShadow: isDark
          ? "0 4px 20px rgba(0,0,0,0.45)"
          : "0 2px 16px rgba(0,0,0,0.06)",
      };

  return (
    <div
      onClick={onActivate}
      onFocus={onActivate}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderRadius: 20,
        overflow: "hidden",
        cursor: "default",
        transition:
          "background-color 190ms ease-out, border-color 190ms ease-out, box-shadow 190ms ease-out",
        ...tmCardStyle,
      }}
    >
      {/* ── Sub-header: date range + Reminder + Add Task ── */}
      <div
        style={{
          padding: "10px 12px 8px",
          borderBottom: isDark
            ? "0.5px solid rgba(255,255,255,0.06)"
            : "0.5px solid rgba(229,224,255,0.9)",
          flexShrink: 0,
        }}
      >
        {/* Row 1: date-range pill + action buttons */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              border: isDark
                ? "1px solid rgba(124,58,237,0.38)"
                : "1.5px solid #7c3aed",
              borderRadius: 10,
              padding: "5px 12px",
              fontSize: 13,
              color: isDark ? "rgba(255,255,255,0.9)" : "#3d3456",
              fontWeight: 600,
              background: isDark ? "rgba(124,58,237,0.08)" : "white",
              flex: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {draftPlan
              ? `From ${fmtDate(draftPlan.dateRange.start)} to ${fmtDate(draftPlan.dateRange.end)}`
              : `From ${fmtDate(todayStr())} to ${fmtDate(new Date(Date.now() + 6 * 86_400_000).toISOString().split("T")[0])}`}
          </div>
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 11px",
              borderRadius: 8,
              background: "#7c3aed",
              color: "white",
              fontSize: 12,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            🔔 Reminder
          </button>
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 11px",
              borderRadius: 8,
              background: "#16a34a",
              color: "white",
              fontSize: 12,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            + Add Task
          </button>
        </div>
        {/* Row 2: stats */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              fontSize: 12,
              color: isDark ? "rgba(255,255,255,0.55)" : "#6b6080",
            }}
          >
            Total tasks:{" "}
            <strong style={{ color: isDark ? "white" : "#1a1033" }}>
              {draftPlan ? `${draftPlan.tasks.length}/5` : "0/5"}
            </strong>
            <span style={{ marginLeft: 3, fontSize: 10, opacity: 0.5 }}>∨</span>
          </span>
          <span
            style={{
              fontSize: 12,
              color: isDark ? "rgba(255,255,255,0.55)" : "#6b6080",
              marginLeft: 10,
            }}
          >
            Total Focus Time Today:{" "}
            <strong style={{ color: isDark ? "white" : "#1a1033" }}>
              {totalFocusMs > 0 ? fmtMs(totalFocusMs) : "0h 0m"}
            </strong>
          </span>
        </div>
      </div>

      {/* ── Task list (scrollable) ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        {!draftPlan ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {Array.from({ length: N_PLACEHOLDERS }, (_, i) => (
              <PlaceholderTaskRow key={i} idx={i} />
            ))}
          </div>
        ) : (
          <>
            {draftPlan.warnings.length > 0 && (
              <div
                style={{
                  marginBottom: 10,
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: "rgba(245,158,11,0.08)",
                  border: "0.5px solid rgba(245,158,11,0.25)",
                }}
              >
                {draftPlan.warnings.map((w, i) => (
                  <p
                    key={i}
                    style={{ fontSize: 12, color: "#d97706", lineHeight: 1.5 }}
                  >
                    ⚠ {w}
                  </p>
                ))}
              </div>
            )}
            {tasksByDate.map(([date, tasks]) => (
              <div key={date} style={{ marginBottom: 12 }}>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--xp-txt3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 6,
                    paddingLeft: 2,
                  }}
                >
                  {fmtDate(date)}
                </p>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 5 }}
                >
                  {tasks.map((t, i) => (
                    <TaskCard
                      key={t.clientId}
                      task={t}
                      idx={i}
                      color={actColor}
                      onUpdate={(p) => coach.updateDraftTask(t.clientId, p)}
                      onRemove={() => coach.removeDraftTask(t.clientId)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Add to Calendar button ── */}
      <div
        style={{
          padding: "10px 12px 12px",
          borderTop: isDark
            ? "0.5px solid rgba(255,255,255,0.06)"
            : "0.5px solid rgba(229,224,255,0.9)",
          flexShrink: 0,
        }}
      >
        {isSaved ? (
          <div
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 700,
              textAlign: "center",
              background: "rgba(22,163,74,0.12)",
              border: "0.5px solid rgba(22,163,74,0.4)",
              color: "#86efac",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            ✓ Tasks Added to Calendar
          </div>
        ) : isSaving ? (
          <button
            disabled
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 700,
              background: "linear-gradient(135deg,#5b21b6,#7c3aed)",
              color: "rgba(255,255,255,0.75)",
              border: "none",
              cursor: "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: 0.85,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: "white",
                animation: "xp-spin 0.7s linear infinite",
              }}
            />
            Adding Tasks…
          </button>
        ) : (
          <button
            onClick={draftPlan ? coach.addTasksToCalendar : undefined}
            style={{
              width: "100%",
              padding: "13px 0",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 700,
              background:
                "linear-gradient(135deg, #5b21b6 0%, #7c3aed 55%, #8b5cf6 100%)",
              color: "white",
              border: "none",
              cursor: "pointer",
              boxShadow:
                "0 4px 16px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              letterSpacing: "0.01em",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="white" strokeWidth="1.5" />
              <path
                d="M4.5 8l2.5 2.5 4.5-5"
                stroke="white"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Add Tasks to Calendar
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 8 — WORKSPACE NAV BAR  (mobile / focus mode)
// ═══════════════════════════════════════════════════════════════════

type WorkspaceTab = "coach" | "tasks" | "calendar";

function WorkspaceNavBar({
  active,
  onChange,
}: {
  active: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
}) {
  const tabs: Array<{ id: WorkspaceTab; icon: string; label: string }> = [
    { id: "coach", icon: "🤖", label: "AI Coach" },
    { id: "tasks", icon: "✓", label: "Task Manager" },
    { id: "calendar", icon: "📅", label: "Calendar" },
  ];
  return (
    <div
      style={{
        display: "flex",
        borderTop: "0.5px solid rgba(255,255,255,0.1)",
        background: "var(--xp-hdr)",
        flexShrink: 0,
      }}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              padding: "10px 0",
              cursor: "pointer",
              color: isActive ? "#a78bfa" : "rgba(255,255,255,0.48)",
              borderTop: isActive
                ? "2px solid #a78bfa"
                : "2px solid transparent",
              background: "transparent",
              borderRight: "none",
              borderBottom: "none",
              borderLeft: "none",
              transition: "color 150ms, border-color 150ms",
            }}
          >
            <span style={{ fontSize: 18 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 500 }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 9 — AICoachPage  (main export, orchestrator)
// ═══════════════════════════════════════════════════════════════════

interface AICoachPageProps {
  onClose: () => void;
  onMotivate: () => void;
}

export function AICoachPage({ onClose, onMotivate }: AICoachPageProps) {
  const { isDark } = useApp();
  const coach = useAICoach();

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("coach");

  // ESC: close
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  // Auto-switch to tasks tab when plan arrives
  useEffect(() => {
    if (coach.planState === "draft_ready") setActiveTab("tasks");
  }, [coach.planState]);

  const S0 = isDark
    ? "linear-gradient(160deg, #0a0420 0%, #0d0628 60%, #060218 100%)"
    : "#f9f8ff";

  // Single-panel view renderer
  function renderSinglePanel() {
    if (activeTab === "tasks") {
      return <TaskManagerCard coach={coach} isActive onActivate={() => {}} />;
    }
    if (activeTab === "calendar") {
      return (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderRadius: 14,
            border: "1.5px solid rgba(124,58,237,0.55)",
            boxShadow: "0 0 0 3px rgba(124,58,237,0.1)",
            background: isDark ? "rgba(8,4,22,0.95)" : "white",
            transition: "box-shadow 220ms ease",
          }}
        >
          <div style={{ flex: 1, overflowY: "auto" }}>
            <CalendarSection
              onDayDoubleClick={() => {}}
              onMonthZoom={() => {}}
              activeMonth={null}
            />
          </div>
        </div>
      );
    }
    // Default: AI Coach panel
    return (
      <AICoachCard
        coach={coach}
        isActive
        onActivate={() => {}}
      />
    );
  }

  // ── Header ────────────────────────────────────────────────────────────────
  // Layout: [← Back] | [two-zone center: AI Coach pill | Date] | [Focus Mode]
  // Back + Focus Mode are at the edges; the center aligns with the two panels.
  const hdrBtnStyle: CSSProperties = {
    background: "rgba(255,255,255,0.12)",
    border: "0.5px solid rgba(255,255,255,0.20)",
    borderRadius: 8,
    padding: "5px 13px",
    color: "white",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
    transition: "background 150ms ease",
    whiteSpace: "nowrap",
  };

  const Header = (
    <div
      className="xp-aic-hdr"
      style={{
        display: "flex",
        alignItems: "center",
        height: 60,
        flexShrink: 0,
        borderBottom: "0.5px solid rgba(255,255,255,0.06)",
        padding: "0 12px",
        gap: 10,
        position: "relative",
      }}
    >
      {/* Far-left: ← Back */}
      <button onClick={onClose} style={hdrBtnStyle}>
        ← Back
      </button>

      {/* Absolutely centered 🤖 AI Coach pill — independent of button widths */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          top: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          pointerEvents: "none",
          zIndex: 1,
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.96)",
            borderRadius: 28,
            padding: "6px 20px",
            display: "flex",
            alignItems: "center",
            gap: 7,
            color: "#4c1d95",
            fontWeight: 700,
            fontSize: 14,
            boxShadow: "0 2px 14px rgba(0,0,0,0.22)",
            letterSpacing: "0.01em",
            userSelect: "none",
          }}
        >
          🤖 AI Coach
        </div>
      </div>

      {/* Far-right: Motivate Me */}
      <button
        onClick={onMotivate}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white transition-all duration-150 hover:opacity-85 hover:scale-105 flex-shrink-0"
        style={{ background: '#7c3aed', border: '0.5px solid rgba(167,139,250,0.35)', marginLeft: "auto" }}
      >
        Motivate Me 🔥
      </button>
    </div>
  );

  // ── Dedicated AI Coach body ────────────────────────────────────────────────
  const SinglePanelBody = (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          padding: "8px 8px 0",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 760,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {renderSinglePanel()}
        </div>
      </div>
      <WorkspaceNavBar
        active={activeTab}
        onChange={setActiveTab}
      />
    </div>
  );

  // ── NORMAL MODE — centered modal, height-bounded so bottom is never cut off ─
  return (
    <>
      <style>{`
        @keyframes xpAicHdrFlow {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .xp-aic-hdr {
          background: linear-gradient(135deg, #5b21b6 0%, #6d28d9 22%, #7c3aed 46%, #8b5cf6 65%, #7c3aed 82%, #6d28d9 100%);
          background-size: 320% 320%;
          animation: xpAicHdrFlow 14s ease infinite;
        }
        @keyframes xp-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-3 sm:p-4 pt-3 ${isDark ? "xp-dark" : "xp-light"}`}
      style={{
        background: isDark ? "rgba(0,0,0,0.88)" : "rgba(0,0,0,0.64)",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        backdropFilter: "blur(9px) saturate(0.85)",
        WebkitBackdropFilter: "blur(9px) saturate(0.85)",
      }}
      onClick={onClose}
    >
      {/* Ambient glows */}
      {isDark && (
        <div
          className="fixed inset-0 pointer-events-none overflow-hidden"
          style={{ zIndex: -1 }}
        >
          <div
            style={{
              position: "absolute",
              top: "-8%",
              right: "-4%",
              width: 600,
              height: 600,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(124,58,237,0.07) 0%, transparent 65%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: "-6%",
              width: 500,
              height: 500,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(8,145,178,0.04) 0%, transparent 65%)",
            }}
          />
        </div>
      )}

      {/* Modal shell */}
      <div
        className="w-full rounded-2xl overflow-hidden max-w-[640px]"
        style={{
          background: S0,
          border: isDark
            ? "0.5px solid rgba(124,58,237,0.32)"
            : "0.5px solid rgba(124,58,237,0.22)",
          boxShadow: isDark
            ? "0 40px 90px rgba(0,0,0,0.85), 0 0 0 0.5px rgba(124,58,237,0.28), 0 0 72px rgba(124,58,237,0.16), inset 0 1px 0 rgba(255,255,255,0.05)"
            : "0 28px 64px rgba(0,0,0,0.18), 0 0 44px rgba(124,58,237,0.12)",
          marginBottom: 4,
          minHeight: "calc(100vh - 32px)",
          maxHeight: "calc(100vh - 32px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {Header}
        {SinglePanelBody}
      </div>
    </div>
    </>
  );
}
