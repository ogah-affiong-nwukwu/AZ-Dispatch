import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export function usePersistentState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw) as T
    } catch {
      // Fall through to the initial value when storage is unavailable.
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      // Persistence is best-effort for the demo.
    }
  }, [key, state])

  return [state, setState]
}
