import { request } from 'node:https'

export type ConnectivityListener = (online: boolean) => void

// A real reachability probe — `navigator.onLine` (and the "am I online"
// checks people reach for by habit) just report whether a network
// interface is up, which lies on captive portals and VPN-only links. This
// round-trips to GitHub itself, since that's the endpoint that actually
// matters here (doc §5.4).
export class ConnectivityWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private lastKnown: boolean | null = null
  private readonly listeners = new Set<ConnectivityListener>()

  constructor(private readonly intervalMs: number = 15_000) {}

  onChange(listener: ConnectivityListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (this.timer) return
    void this.check()
    this.timer = setInterval(() => void this.check(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async check(): Promise<void> {
    const online = await probe()
    if (online !== this.lastKnown) {
      this.lastKnown = online
      this.listeners.forEach((listener) => listener(online))
    }
  }
}

function probe(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ method: 'HEAD', host: 'api.github.com', path: '/', timeout: 5000 }, (res) => {
      resolve((res.statusCode ?? 0) < 500)
      res.resume()
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
    req.end()
  })
}
