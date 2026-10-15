import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import { api, type EventDefinition, type Site } from './api'
import { ConfirmButton, CopyBox, ErrorText } from './ui/Form'
import { Panel } from './ui/Panel'

const errorOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const definedBy = (by: string) => (by.startsWith('key:') ? `key ${by.slice(4)}` : by)

/**
 * How a coding agent adds tracking to the site the right way: the lines for the project's
 * AGENTS.md, the MCP server it connects to with an agent key, and the events defined so far.
 */
export function AgentSettings({ site }: { site: Site }) {
  const queryClient = useQueryClient()
  const admin = site.role !== 'viewer'
  const setup = useQuery({ queryKey: ['agents', site.id], queryFn: () => api.agents(site.id) })
  const remove = useMutation({
    mutationFn: (name: string) => api.deleteDefinition(site.id, name),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['agents', site.id] }),
  })
  const data = setup.data
  return (
    <Panel title="Coding agents">
      <p className="m-0 text-body text-muted">
        Let Claude Code, Cursor or Codex add tracking to {site.domain}: they read the rules, take
        the gaps from the latest draft, check each event arrives and define what it means.
      </p>
      {setup.isError && <ErrorText>{errorOf(setup.error)}</ErrorText>}
      {data && (
        <>
          <CopyBox
            label="Add to the project's AGENTS.md or CLAUDE.md"
            value={data.snippet.trim()}
          />
          <CopyBox
            label="Connect the MCP server (Claude Code). Create a Coding agent key under Settings, API keys."
            value={`claude mcp add --transport http recount ${data.mcp} --header "Authorization: Bearer <agent key>"`}
          />
          <a
            href={data.rules}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-label text-ink underline-offset-2 hover:underline"
          >
            <BookOpen className="size-4" strokeWidth={1.75} aria-hidden="true" />
            Tracking rules (llms.txt)
          </a>
          <Definitions
            events={data.events}
            onDelete={admin ? (name) => remove.mutate(name) : undefined}
          />
          {remove.isError && <ErrorText>{errorOf(remove.error)}</ErrorText>}
        </>
      )}
    </Panel>
  )
}

function Definitions({
  events,
  onDelete,
}: {
  events: EventDefinition[]
  onDelete?: (name: string) => void
}) {
  if (!events.length)
    return (
      <p className="m-0 text-label text-muted">
        No events defined yet. An agent defines each event it adds once it has seen it arrive.
      </p>
    )
  return (
    <div className="grid gap-1.5 border-line border-t pt-3">
      <span className="text-label font-medium text-muted">Defined events</span>
      <ul className="m-0 grid list-none p-0">
        {events.map((e) => {
          const properties = Object.keys(e.properties)
          return (
            <li
              key={e.name}
              className="flex flex-wrap items-center justify-between gap-2 border-line border-t py-2 first:border-t-0"
            >
              <span className="min-w-0">
                <span className="block text-body font-medium">
                  {e.name}
                  {e.key && <span className="ml-2 text-label text-muted">key</span>}
                  {e.stage && <span className="ml-2 text-label text-muted">{e.stage}</span>}
                </span>
                <span className="block text-label text-muted">{e.description}</span>
                <span className="block text-label text-muted">
                  {properties.length > 0 && (
                    <>
                      <code className="font-mono">{properties.join(', ')}</code> ·{' '}
                    </>
                  )}
                  by {definedBy(e.definedBy)}
                </span>
              </span>
              {onDelete && (
                <ConfirmButton
                  label="Delete"
                  confirm="Confirm delete"
                  onConfirm={() => onDelete(e.name)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
