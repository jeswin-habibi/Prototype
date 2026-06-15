import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { isSupabaseConfigured } from './lib/supabase'
import { NavGuardProvider, useNavGuard } from './lib/navGuard'
import { Banner } from './components/ui'
import Dashboard from './pages/Dashboard'
import Receipt from './pages/Receipt'
import Jobs from './pages/Jobs'
import JobDetail from './pages/JobDetail'
import Records from './pages/Records'
import Config from './pages/Config'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/receipt', label: 'Parent Receipt', icon: '📥' },
  { to: '/jobs', label: 'Repacking Jobs', icon: '⚙️' },
  { to: '/records', label: 'Records', icon: '🧾' },
  { to: '/config', label: 'Config', icon: '🛠️' },
]

function NavItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  const { guard } = useNavGuard()
  return (
    <NavLink
      to={to}
      onClick={(e) => {
        if (guard.active) {
          e.preventDefault()
          window.alert(guard.message)
        }
      }}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
          isActive ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'
        }`
      }
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
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
    <div className="min-h-screen md:flex">
      {/* Sidebar (desktop) / top bar (mobile) */}
      <aside className="border-b border-slate-200 bg-white md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-lg text-white">📦</div>
          <div>
            <div className="text-sm font-bold leading-tight text-slate-900">Repacking</div>
            <div className="text-xs text-slate-400">Landed-cost prototype</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:gap-1 md:px-3 md:pb-4">
          {NAV.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
        </nav>
      </aside>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
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
      </main>
    </div>
  )
}
