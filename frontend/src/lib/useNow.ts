import { useEffect, useState } from 'react'

/** The current time in ms, refreshed every `everyMs`. Keeps render free of impure clock reads. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}
