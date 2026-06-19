import { Suspense, lazy } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { isSupabaseConfigured } from './lib/supabase'
import { NavGuardProvider, useNavGuard } from './lib/navGuard'
import { Banner, Spinner } from './components/ui'

// Lazy-load pages so the heavy chart/xlsx code only loads when its screen is opened.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Receipt = lazy(() => import('./pages/Receipt'))
const Jobs = lazy(() => import('./pages/Jobs'))
const JobDetail = lazy(() => import('./pages/JobDetail'))
const Records = lazy(() => import('./pages/Records'))
const Config = lazy(() => import('./pages/Config'))

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
            ? 'bg-gradient-to-r from-brand to-brand-dark text-white shadow-soft'
            : 'text-slate-600 hover:bg-slate-100'
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
        `flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold transition ${
          isActive ? 'text-brand-700' : 'text-slate-400'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`flex h-7 w-12 items-center justify-center rounded-full text-lg leading-none transition ${
              isActive ? 'bg-brand-50' : 'opacity-70'
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

export default function App() {
  return (
    <NavGuardProvider>
      <AppShell />
    </NavGuardProvider>
  )
}

function AppShell() {
  return (
    <div className="min-h-screen">
      {/* Mobile top app bar */}
      <header className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-light to-brand text-white shadow-soft">📦</div>
        <div className="text-sm font-bold text-slate-900">Repacking</div>
        <div className="ml-auto text-[11px] font-medium text-slate-400">Landed-cost</div>
      </header>

      <div className="md:flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white/80 backdrop-blur md:flex">
          <div className="flex items-center gap-2.5 px-4 py-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-light to-brand text-lg text-white shadow-soft">📦</div>
            <div>
              <div className="text-sm font-bold leading-tight text-slate-900">Repacking</div>
              <div className="text-xs text-slate-400">Landed-cost prototype</div>
            </div>
          </div>
          <nav className="flex flex-col gap-1 px-3 pb-4">
            {NAV.map((n) => (
              <SideItem key={n.to} {...n} />
            ))}
          </nav>
        </aside>

        {/* Page content. Extra bottom padding on mobile clears the tab bar. */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-10 md:pt-6">
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
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {NAV.map((n) => (
          <TabItem key={n.to} {...n} />
        ))}
      </nav>
    </div>
  )
}
