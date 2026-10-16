import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Site } from '../api'
import { Switch } from '../ui/Switch'

/** Per site, since a wiki or reference site rarely needs the model reading it. */
export function AiSwitch({ site }: { site: Pick<Site, 'id' | 'ai'> }) {
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: (ai: boolean) => api.setAi(site.id, ai),
    onSuccess: (updated) => {
      queryClient.setQueryData<Site[]>(['sites'], (all) =>
        all?.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
      )
      for (const key of ['brief', 'replays', 'replayDigest'])
        queryClient.invalidateQueries({ queryKey: [key] })
    },
  })
  return (
    <span title="The brief, replay summaries and the patterns across them. Off means no model calls for this site.">
      <Switch
        label="AI analysis"
        checked={change.isPending ? (change.variables ?? site.ai) : site.ai}
        disabled={change.isPending}
        onChange={(ai) => change.mutate(ai)}
      />
    </span>
  )
}
