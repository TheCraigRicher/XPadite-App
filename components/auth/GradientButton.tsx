interface Props {
  children: React.ReactNode
  type?: 'button' | 'submit'
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
}

export function GradientButton({ children, type = 'button', disabled, loading, onClick }: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className="
        group w-full h-12 rounded-xl font-semibold text-sm text-white
        transition-all duration-250
        disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none
        active:scale-[0.98]
        flex items-center justify-center gap-2.5
      "
      style={{
        background: 'linear-gradient(to top, #5b21b6, #7c3aed)',
        boxShadow: '0 4px 14px rgba(91,33,182,0.45)',
      }}
      onMouseEnter={e => {
        if (disabled || loading) return
        const el = e.currentTarget
        el.style.transform = 'translateY(-2px)'
        el.style.boxShadow = '0 8px 24px rgba(91,33,182,0.55), 0 0 0 1px rgba(167,139,250,0.15)'
        el.style.background = 'linear-gradient(to top, #6d28d9, #8b5cf6)'
      }}
      onMouseLeave={e => {
        if (disabled || loading) return
        const el = e.currentTarget
        el.style.transform = ''
        el.style.boxShadow = '0 4px 14px rgba(91,33,182,0.45)'
        el.style.background = 'linear-gradient(to top, #5b21b6, #7c3aed)'
      }}
    >
      {loading ? (
        <>
          <svg
            className="w-4 h-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Please wait…</span>
        </>
      ) : children}
    </button>
  )
}
