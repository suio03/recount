import '@rrweb/replay/dist/style.css'
import { Replayer } from '@rrweb/replay'
import { useQuery } from '@tanstack/react-query'
import { Pause, Play, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, type ReplaySession } from '../api'
import { cx } from '../ui/cx'
import { SegmentedControl } from '../ui/SegmentedControl'
import { clock, LEAD_IN_MS, MOMENT_TONES } from './moments'

const SPEEDS = [
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
  { value: '4', label: '4×' },
] as const
type Speed = (typeof SPEEDS)[number]['value']

/**
 * Plays one recorded session, starting at `start` ms, beside the moments the AI picked so each
 * claim can be checked against what happened. Typed text and body copy were masked when
 * recording, so they show as asterisks here too.
 */
export function ReplayPlayer({
  siteId,
  session,
  start,
  onClose,
}: {
  siteId: string
  session: ReplaySession
  start: number
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const recording = useQuery({
    queryKey: ['replay', siteId, session.id],
    queryFn: () => api.recording(siteId, session.id),
    staleTime: Number.POSITIVE_INFINITY,
  })

  // Escape closes the dialog natively; listen for that directly so the player unmounts too.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const d = dialog.current
    if (!d) return
    const closed = () => close.current()
    d.addEventListener('close', closed)
    d.showModal()
    return () => {
      d.removeEventListener('close', closed)
      d.close()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      aria-label="Session replay"
      className="m-auto h-[min(860px,92vh)] w-[min(1280px,94vw)] max-w-none overflow-hidden rounded-md border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-ink/40"
    >
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="m-0 min-w-0 truncate text-body font-semibold">Session replay</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close replay"
            className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>
        <div className="grid min-h-0 md:grid-cols-[minmax(0,1fr)_320px]">
          {recording.isError ? (
            <p className="m-auto text-muted">
              Could not load the recording: {String(recording.error)}
            </p>
          ) : !recording.data ? (
            <div className="m-4 animate-pulse rounded-sm bg-sunken" />
          ) : (
            <Player events={recording.data.events} session={session} start={start} />
          )}
        </div>
      </div>
    </dialog>
  )
}

function Player({
  events,
  session,
  start,
}: {
  events: unknown[]
  session: ReplaySession
  start: number
}) {
  const stage = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const [replayer, setReplayer] = useState<Replayer>()
  const [size, setSize] = useState({ width: 1280, height: 800 })
  const [scale, setScale] = useState(1)
  const [total, setTotal] = useState(0)
  const [time, setTime] = useState(start)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>('1')

  // One replayer per recording; `start` is only where it begins, so it is not a dependency.
  useEffect(() => {
    const root = host.current
    if (!root) return
    const r = new Replayer(events as ConstructorParameters<typeof Replayer>[0], {
      root,
      skipInactive: true,
      showWarning: false,
      mouseTail: false,
    })
    r.on('resize', (d) => {
      const { width, height } = d as { width: number; height: number }
      if (width && height) setSize({ width, height })
    })
    r.on('finish', () => setPlaying(false))
    setTotal(r.getMetaData().totalTime)
    setReplayer(r)
    r.play(start)
    setPlaying(true)
    return () => {
      r.destroy()
      root.replaceChildren()
    }
  }, [events])

  // Fit the recorded viewport inside the stage.
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const fit = () =>
      setScale(Math.min(el.clientWidth / size.width, el.clientHeight / size.height, 1))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [size])

  // Follow the playhead while playing.
  useEffect(() => {
    if (!replayer || !playing) return
    let frame = 0
    const tick = () => {
      setTime(replayer.getCurrentTime())
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [replayer, playing])

  useEffect(() => replayer?.setConfig({ speed: Number(speed) }), [replayer, speed])

  function seek(t: number, play = playing) {
    if (!replayer) return
    const at = Math.min(Math.max(0, t), total)
    if (play) replayer.play(at)
    else replayer.pause(at)
    setTime(at)
    setPlaying(play)
  }

  function toggle() {
    if (playing) seek(replayer?.getCurrentTime() ?? time, false)
    else seek(time >= total ? 0 : time, true)
  }

  const moments = session.summary.moments
  const current = moments.reduce<number>((found, m, i) => (m.t <= time + 250 ? i : found), -1)

  return (
    <>
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] border-line md:border-r">
        <div ref={stage} className="relative min-h-[240px] overflow-hidden bg-sunken">
          <div
            ref={host}
            className="absolute top-1/2 left-1/2 origin-center bg-surface"
            style={{
              width: size.width,
              height: size.height,
              transform: `translate(-50%, -50%) scale(${scale})`,
            }}
          />
        </div>
        <div className="grid gap-2 border-t border-line px-4 py-3">
          <div className="relative h-4">
            <input
              type="range"
              aria-label="Position in recording"
              min={0}
              max={total}
              step={100}
              value={Math.min(time, total)}
              onChange={(e) => seek(Number(e.target.value))}
              className="absolute inset-0 w-full cursor-pointer accent-[var(--visitors)]"
            />
            {total > 0 &&
              moments.map((m) => (
                <span
                  key={`${m.t}-${m.kind}`}
                  className={cx(
                    'pointer-events-none absolute -top-1 h-1.5 w-0.5 rounded-full',
                    MOMENT_TONES[m.kind],
                  )}
                  style={{ left: `${(m.t / total) * 100}%` }}
                />
              ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggle}
                disabled={!replayer}
                aria-label={playing ? 'Pause' : 'Play'}
                className="grid size-8 cursor-pointer place-items-center rounded-sm bg-ink text-on-ink disabled:opacity-50"
              >
                {playing ? (
                  <Pause className="size-4" strokeWidth={2} />
                ) : (
                  <Play className="size-4" strokeWidth={2} />
                )}
              </button>
              <span className="font-mono text-label text-muted tabular-nums">
                {clock(time)} / {clock(total)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-label text-muted">Idle stretches are skipped</span>
              <SegmentedControl
                label="Playback speed"
                options={SPEEDS}
                value={speed}
                onChange={setSpeed}
              />
            </div>
          </div>
        </div>
      </div>

      <aside className="grid content-start gap-3 overflow-y-auto border-t border-line p-4 md:border-t-0">
        <p className="m-0 font-serif text-note font-semibold">{session.summary.headline}</p>
        <p className="m-0 font-serif text-note text-muted">{session.summary.intent}</p>
        <ol className="m-0 grid list-none gap-1 p-0">
          {moments.map((m, i) => (
            <li key={`${m.t}-${m.kind}`}>
              <button
                type="button"
                onClick={() => seek(Math.max(0, m.t - LEAD_IN_MS), true)}
                aria-current={i === current ? 'step' : undefined}
                title="Play from just before this moment"
                className="grid w-full cursor-pointer grid-cols-[3.25rem_minmax(0,1fr)] items-baseline gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-sunken aria-[current=step]:bg-sunken"
              >
                <span className="flex items-center gap-1.5 font-mono text-label text-muted tabular-nums">
                  <span className={cx('size-1.5 shrink-0 rounded-full', MOMENT_TONES[m.kind])} />
                  {clock(m.t)}
                </span>
                <span className="font-serif text-note">{m.text}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="m-0 text-label text-muted">
          Text the visitor typed and the page's body copy were masked while recording.
        </p>
      </aside>
    </>
  )
}
