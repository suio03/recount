import { type ReactNode, useEffect, useRef } from 'react'

export interface PanelProps {
  title: string
  /** An anchor to link to the panel with. */
  id?: string
  actions?: ReactNode
  children?: ReactNode
}

/** The bordered box every dashboard section sits in. */
export function Panel({ title, id, actions, children }: PanelProps) {
  const ref = useRef<HTMLElement>(null)
  // Panels that wait for data mount after the router looked for the hash, so scroll to them
  // here, and once more after the panels above have loaded and moved them.
  useEffect(() => {
    if (!id || window.location.hash !== `#${id}`) return
    const scroll = () => ref.current?.scrollIntoView({ block: 'start' })
    scroll()
    const later = setTimeout(scroll, 400)
    return () => clearTimeout(later)
  }, [id])
  return (
    <section
      ref={ref}
      id={id}
      className="grid min-w-0 scroll-mt-20 content-start gap-3 rounded-md border border-line bg-surface p-4"
    >
      <header className="flex min-h-7 flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-body font-semibold">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  )
}
