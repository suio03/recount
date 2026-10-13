/**
 * Placeholder for the AI reading (roadmap step 5). It keeps the layout the design calls for so
 * the dashboard does not shift when findings arrive.
 */
export function ReadingPanel() {
  return (
    <aside className="grid min-w-0 content-start gap-2 rounded-md border border-line bg-surface p-4">
      <h2 className="m-0 text-body font-semibold">The reading</h2>
      <p className="m-0 text-muted">
        No reading yet. Once the AI layer is on, this column explains what changed and why, with
        links to the numbers and replays behind each claim.
      </p>
    </aside>
  )
}
