'use client'

import { useState, useEffect } from 'react'
import { XpaditeLogo } from './XpaditeLogo'

interface Particle {
  id: number
  left: number
  delay: number
}

interface Props {
  celebrate?: boolean
}

function FloatingIcon({
  children,
  className,
  style,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div className={`absolute select-none cursor-default z-10 ${className ?? ''}`} style={style}>
      <div className="relative">
        {/* Soft glow halo behind icon */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            inset: '-8px',
            background: 'radial-gradient(circle, rgba(139,92,246,0.28) 0%, transparent 70%)',
            filter: 'blur(6px)',
          }}
        />
        <span
          className="relative z-10 leading-none"
          style={{ filter: 'drop-shadow(0 4px 14px rgba(0,0,0,0.55)) drop-shadow(0 0 8px rgba(139,92,246,0.3))' }}
        >
          {children}
        </span>
      </div>
    </div>
  )
}

export function MarketingPanel({ celebrate = false }: Props) {
  const [isCelebrating, setIsCelebrating] = useState(false)
  const [particles, setParticles] = useState<Particle[]>([])

  useEffect(() => {
    if (!celebrate) return
    const ps: Particle[] = Array.from({ length: 5 }, (_, i) => ({
      id: i,
      left: 18 + Math.random() * 64,
      delay: i * 200,
    }))
    setParticles(ps)
    setIsCelebrating(true)
    const t = setTimeout(() => {
      setIsCelebrating(false)
      setParticles([])
    }, 2400)
    return () => clearTimeout(t)
  }, [celebrate])

  return (
    <div className="hidden lg:flex flex-col flex-1 relative overflow-hidden px-10 xl:px-14 py-10 xl:py-12">

      {/* ── Background orbs (animated) ──────────────────── */}
      <div
        className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl pointer-events-none"
        style={{
          background: 'rgba(139,92,246,0.32)',
          transform: 'translate(30%,-30%)',
          animation: 'orb-glow 9s ease-in-out infinite',
        }}
      />
      <div
        className="absolute bottom-0 left-0 w-80 h-80 rounded-full blur-3xl pointer-events-none"
        style={{
          background: 'rgba(124,58,237,0.22)',
          transform: 'translate(-25%,25%)',
          animation: 'orb-glow-alt 12s ease-in-out infinite',
          animationDelay: '3s',
        }}
      />
      <div
        className="absolute top-1/2 left-1/3 w-64 h-64 rounded-full blur-3xl pointer-events-none"
        style={{
          background: 'rgba(167,139,250,0.14)',
          transform: 'translateY(-50%)',
          animation: 'orb-glow 15s ease-in-out infinite',
          animationDelay: '6s',
        }}
      />
      <div
        className="absolute top-1/4 left-2/3 w-48 h-48 rounded-full blur-2xl pointer-events-none"
        style={{
          background: 'rgba(192,132,252,0.16)',
          animation: 'orb-glow-alt 11s ease-in-out infinite',
          animationDelay: '1.5s',
        }}
      />

      {/* ── Dot pattern overlay ──────────────────────────── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(192,132,252,0.18) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          animation: 'dot-fade 9s ease-in-out infinite',
        }}
      />

      {/* ── Sparkle dots ──────────────────────────────────── */}
      {[
        'top-[13%] left-[40%] w-1 h-1',
        'top-[27%] right-[26%] w-[5px] h-[5px]',
        'top-[50%] left-[10%] w-1 h-1',
        'top-[8%] left-[58%] w-[3px] h-[3px]',
        'bottom-[30%] right-[9%] w-1 h-1',
        'bottom-[47%] left-[46%] w-[5px] h-[5px]',
        'top-[68%] right-[34%] w-[3px] h-[3px]',
        'top-[38%] left-[62%] w-1 h-1',
        'bottom-[18%] left-[28%] w-[3px] h-[3px]',
      ].map((cls, i) => (
        <div key={i} className={`absolute rounded-full bg-white/50 pointer-events-none ${cls}`} />
      ))}

      {/* ── Floating icons ────────────────────────────────── */}

      {/* 📈 analytics — upper right */}
      <FloatingIcon
        className="top-[6%] right-[8%]"
        style={{ animation: 'float-slow 11s ease-in-out infinite', fontSize: '3.25rem' }}
      >
        📈
      </FloatingIcon>

      {/* ✅ checkmark — middle right */}
      <FloatingIcon
        className="top-[52%] right-[6%]"
        style={{
          animation: 'float-medium 13s ease-in-out infinite',
          animationDelay: '2.5s',
          fontSize: '2.75rem',
        }}
      >
        ✅
      </FloatingIcon>

      {/* ── Logo ──────────────────────────────────────────── */}
      <div className="relative z-10">
        <XpaditeLogo variant="light" size={36} />
      </div>

      {/* ── Early access badge ────────────────────────────── */}
      <div className="relative z-10 mt-7">
        <span
          className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full border border-white/15 text-white/65 text-xs font-medium tracking-wide"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0"
            style={{ boxShadow: '0 0 6px rgba(192,132,252,0.9)' }}
          />
          Now accepting early access signups
        </span>
      </div>

      {/* ── Headline + pill + body ────────────────────────── */}
      <div className="relative z-10 mt-10 flex-1 flex flex-col justify-center max-w-lg">

        {/* Gradient headline */}
        <h1 className="text-4xl xl:text-[2.75rem] font-black leading-[1.15] tracking-tight">
          <span className="text-white block">Expedite your</span>
          <span className="block bg-gradient-to-r from-violet-300 via-purple-300 to-fuchsia-400 bg-clip-text text-transparent">
            productivity &amp;
          </span>
          <span className="block bg-gradient-to-r from-violet-300 via-purple-300 to-fuchsia-400 bg-clip-text text-transparent">
            progress
          </span>
        </h1>

        {/* ── Milestone pill ────────────────────────────────── */}
        <div className="mt-7 relative inline-block">

          {/* Celebration badge */}
          {isCelebrating && (
            <div
              className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold text-white z-20 pointer-events-none"
              style={{
                background: 'linear-gradient(135deg,#7c3aed,#a855f7)',
                boxShadow: '0 4px 18px rgba(124,58,237,0.65)',
                animation: 'badge-appear 2.4s ease-in-out forwards',
              }}
            >
              ✨ Today&apos;s Progress Added!
            </div>
          )}

          {/* Floating particles */}
          {particles.map(p => (
            <span
              key={p.id}
              className="absolute text-base pointer-events-none z-20"
              style={{
                left: `${p.left}%`,
                bottom: '100%',
                animation: 'particle-up 1.4s ease-out forwards',
                animationDelay: `${p.delay}ms`,
              }}
            >
              ✨
            </span>
          ))}

          {/* Pill */}
          <div
            className="group/pill inline-flex items-center gap-3 px-5 py-3.5 rounded-full cursor-default border border-purple-400/30 transition-all duration-300 hover:scale-[1.018] hover:border-purple-400/55"
            style={{
              background: 'rgba(255,255,255,0.07)',
              animation: isCelebrating ? 'none' : 'pill-idle 10s ease-in-out infinite',
              boxShadow: isCelebrating
                ? '0 0 60px rgba(168,85,247,0.75)'
                : '0 0 30px rgba(168,85,247,0.24), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <p className="text-sm font-semibold bg-gradient-to-r from-pink-300 via-fuchsia-300 to-pink-200 bg-clip-text text-transparent leading-snug">
              Document your journey. Celebrate every milestone.
            </p>
            <span className="flex items-center gap-0.5">
              <span
                className="inline-block text-lg transition-transform duration-300 ease-out group-hover/pill:rotate-[4deg] group-hover/pill:scale-[1.1]"
                style={{
                  animation: isCelebrating
                    ? 'trophy-idle 0.8s cubic-bezier(0.4,0,0.2,1) 1'
                    : 'trophy-idle 10s cubic-bezier(0.4,0,0.2,1) infinite',
                }}
              >
                🏆
              </span>
              <span
                className="inline-block text-lg transition-transform duration-300 ease-out group-hover/pill:-translate-y-[3px]"
                style={{
                  animation: isCelebrating
                    ? 'rocket-idle 0.8s cubic-bezier(0.4,0,0.2,1) 1'
                    : 'rocket-idle 10s cubic-bezier(0.4,0,0.2,1) infinite',
                }}
              >
                🚀
              </span>
            </span>
          </div>
        </div>

        {/* Body copy */}
        <p className="mt-5 text-sm xl:text-[0.9375rem] text-white/55 leading-relaxed max-w-sm xl:max-w-md">
          The all-in-one productivity calendar that marks your best days, tracks every activity with timers, and uses AI to plan your week.
        </p>
      </div>

      {/* ── Bottom: 🎯 target + quote card ───────────────── */}
      <div className="relative z-10 flex items-end gap-4 mt-auto pt-10">
        <FloatingIcon
          style={{
            position: 'relative',
            fontSize: '3rem',
            flexShrink: 0,
            animation: 'float-fast 9s ease-in-out infinite',
            animationDelay: '1.2s',
          }}
        >
          🎯
        </FloatingIcon>

        <div
          className="flex-1 rounded-2xl p-4 xl:p-5 backdrop-blur-sm border border-white/10"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          <p className="text-white/75 text-xs xl:text-sm leading-relaxed">
            <span className="text-purple-300/80 text-xl leading-none font-serif mr-1">"</span>
            Discipline is choosing between what you want now and what you want most.
          </p>
          <p className="text-white/35 text-xs mt-2 font-medium">– Abraham Lincoln</p>
        </div>
      </div>
    </div>
  )
}
