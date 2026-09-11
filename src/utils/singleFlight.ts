/**
 * Coalesces concurrent calls to one asynchronous operation. A later call can
 * start a new operation only after the previous promise has settled.
 */
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null

  return () => {
    if (inFlight) return inFlight

    const current = Promise.resolve().then(task)
    inFlight = current
    current.then(
      () => {
        if (inFlight === current) inFlight = null
      },
      () => {
        if (inFlight === current) inFlight = null
      },
    )
    return current
  }
}
