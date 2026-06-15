import { useCallback, useEffect, useState } from 'react'

/** Generic async loader with loading/error state and a manual refresh. */
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoLoader = useCallback(loader, deps)

  const load = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) setLoading(true)
      setError(null)
      try {
        setData(await memoLoader())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [memoLoader],
  )

  // Silent refresh (used after mutations) — keeps existing content on screen
  // instead of blanking to the spinner on every keystroke/blur.
  const refresh = useCallback(() => load(false), [load])

  // Show the spinner only on first load / when the resource (deps) changes.
  useEffect(() => {
    void load(true)
  }, [load])

  return { data, loading, error, refresh, setData }
}
