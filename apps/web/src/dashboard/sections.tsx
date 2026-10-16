import { createContext, useContext } from 'react'
import type { Tab } from './search'

/** The tab each linked section lives on. */
const TAB_OF: Record<string, Tab> = {
  traffic: 'overview',
  tried: 'journeys',
  paths: 'journeys',
  quiet: 'journeys',
}

export const tabOf = (section: string): Tab | undefined => TAB_OF[section]

export const scrollToSection = (section: string) =>
  document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' })

/**
 * Opens a section by its id: switches to the tab holding it, then scrolls to it. Outside a
 * dashboard with tabs it only scrolls.
 */
export const OpenSection = createContext<(section: string) => void>(scrollToSection)

export const useOpenSection = () => useContext(OpenSection)
