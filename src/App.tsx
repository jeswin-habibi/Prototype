import { Component, Suspense, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { isSupabaseConfigured } from './lib/supabase'
import { NavGuardProvider, useNavGuard } from './lib/navGuard'
import { Banner, Spinner } from './components/ui'

// Lazy-load pages so the heavy chart/xlsx code only loads when its screen is opened.
// If a chunk fails to load — usually because a new deploy replaced the hashed file while
// an old tab was still open — reload once instead of showing a blank screen.
function lazyWithRetry<T extends ComponentType>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    const KEY = 'chunk-reloaded'
    try {
      const mod = await factory()
      sessionStorage.removeItem(KEY)
      return mod
    } catch (err) {
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, '1')
        window.location.reload()
        return new Promise<{ default: T }>(() => {}) // never resolves; the page is reloading
      }
      throw err
    }
  })
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(err: unknown) { console.error('App error boundary caught:', err) }
  render() {
    if (this.state.hasError) {
      return (
        <div className="px-4 py-16 text-center">
          <p className="mb-1 text-sm font-semibold text-slate-700">This screen didn’t load.</p>
          <p className="mb-4 text-xs text-slate-400">A new version may be available.</p>
          <button className="btn-primary mx-auto" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}

const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'))
const Receipt = lazyWithRetry(() => import('./pages/Receipt'))
const Jobs = lazyWithRetry(() => import('./pages/Jobs'))
const JobDetail = lazyWithRetry(() => import('./pages/JobDetail'))
const Records = lazyWithRetry(() => import('./pages/Records'))
const Config = lazyWithRetry(() => import('./pages/Config'))

const NAV = [
  { to: '/dashboard', label: 'Dashboard', short: 'Home', icon: '📊' },
  { to: '/receipt', label: 'Parent Receipt', short: 'Receipt', icon: '📥' },
  { to: '/jobs', label: 'Repacking Jobs', short: 'Jobs', icon: '⚙️' },
  { to: '/records', label: 'Records', short: 'Records', icon: '🧾' },
  { to: '/config', label: 'Config', short: 'Config', icon: '🛠️' },
]

function useGuardedNav() {
  const { guard } = useNavGuard()
  return (e: React.MouseEvent) => {
    if (guard.active) {
      e.preventDefault()
      window.alert(guard.message)
    }
  }
}

/** Desktop sidebar item (icon + full label). */
function SideItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  const onClick = useGuardedNav()
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
          isActive
            ? 'bg-brand text-white shadow-soft'
            : 'text-slate-300 hover:bg-white/5 hover:text-white'
        }`
      }
    >
      <span className="text-lg" aria-hidden>
        {icon}
      </span>
      <span>{label}</span>
    </NavLink>
  )
}

/** Mobile bottom-tab item (icon stacked over short label). */
function TabItem({ to, short, icon }: { to: string; short: string; icon: string }) {
  const onClick = useGuardedNav()
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold transition ${
          isActive ? 'text-brand-light' : 'text-slate-400'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`flex h-7 w-12 items-center justify-center rounded-full text-lg leading-none transition ${
              isActive ? 'bg-brand/20' : 'opacity-70'
            }`}
            aria-hidden
          >
            {icon}
          </span>
          <span>{short}</span>
        </>
      )}
    </NavLink>
  )
}

// True while the on-screen keyboard is up (visual viewport noticeably shorter than the layout).
function useKeyboardOpen() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => setOpen(window.innerHeight - vv.height > 150)
    vv.addEventListener('resize', onResize)
    onResize()
    return () => vv.removeEventListener('resize', onResize)
  }, [])
  return open
}

// Light/dark theme, persisted. (Full dark styling lands with the dark-mode reference.)
function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return (localStorage.getItem('theme') as 'light' | 'dark') || 'light' } catch { return 'light' }
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try { localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))] as const
}

function Logo({ className }: { className?: string }) {
  return <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="Re-Pack IQ" className={className} />
}

export default function App() {
  return (
    <NavGuardProvider>
      <AppShell />
    </NavGuardProvider>
  )
}

function AppShell() {
  const keyboardOpen = useKeyboardOpen()
  const [theme, toggleTheme] = useTheme()
  return (
    <div className="min-h-screen">
      {/* Mobile top app bar — dark chrome */}
      <header className="sticky top-0 z-20 flex items-center gap-2.5 bg-ink-900 px-4 py-3 text-white md:hidden">
        <Logo className="h-8 w-8 rounded-lg" />
        <div className="text-base font-bold">Re-Pack IQ</div>
        <button
          onClick={toggleTheme}
          aria-label="Toggle dark mode"
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-base hover:bg-white/10"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      <div className="md:flex">
        {/* Desktop sidebar — dark chrome */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-ink-900 text-white md:flex">
          <div className="flex items-center gap-2.5 px-4 py-5">
            <Logo className="h-9 w-9 rounded-lg" />
            <div>
              <div className="text-sm font-bold leading-tight">Re-Pack IQ</div>
              <div className="text-xs text-slate-400">Smart repacking</div>
            </div>
          </div>
          <nav className="flex flex-col gap-1 px-3 pb-4">
            {NAV.map((n) => (
              <SideItem key={n.to} {...n} />
            ))}
          </nav>
          <div className="mt-auto px-3 pb-5">
            <button
              onClick={toggleTheme}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5"
            >
              {theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}
            </button>
          </div>
        </aside>

        {/* Page content. Extra bottom padding on mobile clears the floating tab bar. */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 md:px-6 md:pb-10 md:pt-6">
          {!isSupabaseConfigured && (
            <Banner tone="error">
              <strong>Supabase not configured.</strong> Create a project at supabase.com, run{' '}
              <code className="rounded bg-rose-100 px-1">supabase/schema.sql</code>, then set{' '}
              <code className="rounded bg-rose-100 px-1">VITE_SUPABASE_URL</code> and{' '}
              <code className="rounded bg-rose-100 px-1">VITE_SUPABASE_ANON_KEY</code> in a{' '}
              <code className="rounded bg-rose-100 px-1">.env</code> file (see{' '}
              <code className="rounded bg-rose-100 px-1">.env.example</code>).
            </Banner>
          )}
          <ErrorBoundary>
            <Suspense fallback={<Spinner />}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/receipt" element={<Receipt />} />
                <Route path="/jobs" element={<Jobs />} />
                <Route path="/jobs/:id" element={<JobDetail />} />
                <Route path="/records" element={<Records />} />
                <Route path="/config" element={<Config />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Mobile bottom nav — floating dark bar; hidden while typing so the keyboard doesn't push it over content */}
      {!keyboardOpen && (
        <nav
          className="fixed inset-x-3 z-20 grid grid-cols-5 rounded-2xl bg-ink-900 shadow-lift md:hidden"
          style={{ bottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
        >
          {NAV.map((n) => (
            <TabItem key={n.to} {...n} />
          ))}
        </nav>
      )}
    </div>
  )
}
