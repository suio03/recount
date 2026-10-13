import type { ReactNode } from 'react'

export interface PanelProps {
  title: string
  actions?: ReactNode
  children?: ReactNode
}

/** The bordered box every dashboard section sits in. */
export function Panel({ title, actions, children }: PanelProps) {
  return (
    <section className="grid min-w-0 content-start gap-3 rounded-md border border-line bg-surface p-4">
      <header className="flex min-h-7 flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-body font-semibold">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  )
}
