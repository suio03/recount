/** Dot colors for the kinds of moment the AI picks out of a session. */
export const MOMENT_TONES = { friction: 'bg-down', progress: 'bg-up', intent: 'bg-line-strong' }

/** "01:07": a time in the recording. */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
