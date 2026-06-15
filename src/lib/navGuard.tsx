import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface Guard {
  active: boolean
  message: string
}
interface GuardCtx {
  guard: Guard
  setGuard: (g: Guard) => void
}

const NavGuardContext = createContext<GuardCtx | null>(null)

/** Provides a global "block navigation" flag consulted by the sidebar nav. */
export function NavGuardProvider({ children }: { children: ReactNode }) {
  const [guard, setGuard] = useState<Guard>({ active: false, message: '' })
  return <NavGuardContext.Provider value={{ guard, setGuard }}>{children}</NavGuardContext.Provider>
}

export function useNavGuard(): GuardCtx {
  const ctx = useContext(NavGuardContext)
  if (!ctx) throw new Error('useNavGuard must be used within NavGuardProvider')
  return ctx
}

/**
 * Activate a navigation block while `active` is true. Blocks sidebar links
 * (via the shared guard) and warns on browser refresh/close (beforeunload).
 */
export function useBlockNavigation(active: boolean, message: string) {
  const { setGuard } = useNavGuard()

  useEffect(() => {
    setGuard({ active, message })
    return () => setGuard({ active: false, message: '' })
  }, [active, message, setGuard])

  useEffect(() => {
    if (!active) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [active])
}
