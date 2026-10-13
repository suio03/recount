import { defineSite } from '@recount/semantic'

// Migrated from the Plausible fork's docs/events/ordalin.md (2026-10-06).
export default defineSite({
  domain: 'ordalin.com',
  about:
    'Ordalin is a directory of AI tools. Visitors search and compare tools; success means a visitor ' +
    'leaves to a tool site (outbound click) or a maker submits their tool.',
  events: [
    {
      name: 'Outbound Click',
      description: 'Visitor left to a listed tool. Primary conversion.',
      stage: 'conversion',
      key: true,
      properties: {
        tool: { type: 'string', description: 'Tool slug' },
        placement: {
          type: 'string',
          description:
            'Where the link was: profile, row, task, compare, editorial or a page section',
        },
      },
    },
    {
      name: 'Tool Open',
      description: 'Visitor opened a tool profile.',
      stage: 'activation',
      properties: {
        from: { type: 'string', description: 'Page section the visitor came from' },
        search: { type: 'string', description: '"yes" when the open followed a search' },
      },
    },
    {
      name: 'Search',
      description: 'Visitor searched the directory. results=0 means nothing was found.',
      stage: 'activation',
      properties: {
        query: { type: 'string', description: 'Lower-cased query, max 100 characters' },
        results: { type: 'number', description: 'Number of results' },
      },
    },
    {
      name: 'Submission Started',
      description: 'Maker opened the submission form.',
      stage: 'conversion',
    },
    {
      name: 'Submission Sent',
      description: 'Maker submitted a tool.',
      stage: 'conversion',
      key: true,
    },
  ],
  metrics: [
    {
      name: 'Outbound rate',
      description: 'Share of visitors who leave to at least one tool.',
      numerator: { event: 'Outbound Click', unique: true },
      denominator: { event: 'pageview', unique: true },
      higherIsBetter: true,
    },
    {
      name: 'Submission completion',
      description: 'Share of started submissions that are sent.',
      numerator: { event: 'Submission Sent', unique: true },
      denominator: { event: 'Submission Started', unique: true },
      windowDays: 1,
      higherIsBetter: true,
    },
  ],
})
