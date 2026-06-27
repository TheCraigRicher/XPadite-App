'use client'

import { useState } from 'react'

interface Props {
  id: string
  label: string
  type: 'text' | 'email' | 'password'
  value: string
  onChange: (v: string) => void
  placeholder?: string
  icon: React.ReactNode
  autoComplete?: string
  required?: boolean
  minLength?: number
}

export function AuthInput({
  id, label, type, value, onChange, placeholder, icon, autoComplete, required, minLength,
}: Props) {
  const [showPass, setShowPass] = useState(false)
  const [focused, setFocused] = useState(false)
  const inputType = type === 'password' ? (showPass ? 'text' : 'password') : type

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>

      <div
        className="relative rounded-xl transition-all duration-200"
        style={{
          boxShadow: focused
            ? '0 0 0 3px rgba(124,58,237,0.15), 0 0 0 1px rgba(124,58,237,0.4)'
            : '0 0 0 1px rgba(196,181,253,0.5)',
        }}
      >
        {/* Leading icon */}
        <span
          className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors duration-200"
          style={{ color: focused ? '#7c3aed' : '#a78bfa' }}
        >
          {icon}
        </span>

        <input
          id={id}
          type={inputType}
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          className="
            w-full h-12 pl-11 pr-11 rounded-xl
            bg-[#f3effe] border-none outline-none
            text-gray-800 text-sm placeholder:text-gray-400/80
            transition-all duration-200
          "
        />

        {/* Password toggle */}
        {type === 'password' && (
          <button
            type="button"
            onClick={() => setShowPass(s => !s)}
            aria-label={showPass ? 'Hide password' : 'Show password'}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-violet-600 transition-colors duration-150"
          >
            {showPass ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="w-5 h-5">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="w-5 h-5">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
