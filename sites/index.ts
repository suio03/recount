import type { SiteSemantics } from '@recount/semantic'
import ordalin from './ordalin'

/** Every site with a semantic catalog. Add new sites here. */
const catalog: SiteSemantics[] = [ordalin]

export const semanticsFor = (domain: string) => catalog.find((s) => s.domain === domain)
