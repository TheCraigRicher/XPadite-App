'use client'

import { useState } from 'react'

interface Props {
  variant?: 'light' | 'dark'
  size?: number
  className?: string
}

function XpaditeIconFallback({ size }: { size: number }) {
  const r = size * 0.22
  return (
    <div
      className="flex-shrink-0 relative"
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: 'radial-gradient(circle at 38% 28%, #f05252 0%, #dc2020 40%, #991b1b 100%)',
        boxShadow: '0 2px 10px rgba(220,32,32,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
      }}
    >
      <svg
        viewBox="0 0 56 56"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
      >
        <defs>
          <linearGradient id="xMetal" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="35%" stopColor="#e2e8f0" />
            <stop offset="75%" stopColor="#94a3b8" />
            <stop offset="100%" stopColor="#64748b" />
          </linearGradient>
          <filter id="xShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0.5" dy="1.5" stdDeviation="1.5" floodColor="rgba(0,0,0,0.6)" />
          </filter>
        </defs>
        {/* X shape — two crossing thick strokes with metallic fill */}
        <path
          d="M12 13 L26 28 L12 43 L18 43 L28 33 L38 43 L44 43 L30 28 L44 13 L38 13 L28 23 L18 13 Z"
          fill="url(#xMetal)"
          filter="url(#xShadow)"
        />
        {/* Highlight edge on upper strokes */}
        <path
          d="M12 13 L18 13 L28 23 L38 13 L44 13"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="1"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  )
}

export function XpaditeLogo({ variant = 'dark', size = 36, className = '' }: Props) {
  const [imgError, setImgError] = useState(false)

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {imgError ? (
        <XpaditeIconFallback size={size} />
      ) : (
        <img
          src="/logo-icon.png"
          alt="Xpadite"
          width={size}
          height={size}
          onError={() => setImgError(true)}
          className="flex-shrink-0"
          style={{ objectFit: 'contain', borderRadius: size * 0.18 }}
          draggable={false}
        />
      )}
      <span
        className={`font-bold text-xl tracking-tight select-none ${
          variant === 'light' ? 'text-white' : 'text-gray-900'
        }`}
      >
        Xpadite
      </span>
    </div>
  )
}
