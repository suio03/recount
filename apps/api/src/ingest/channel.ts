/**
 * Classifies where a visit came from. Returns a human-readable channel name used in the
 * dashboard and by the AI layer.
 */

export type Channel =
  | 'Direct'
  | 'Organic Search'
  | 'Paid Search'
  | 'AI Assistant'
  | 'Organic Social'
  | 'Paid Social'
  | 'Email'
  | 'Referral'

const SEARCH =
  /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|naver|seznam|brave|startpage|qwant)\./
const AI =
  /(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|chat\.deepseek\.com|you\.com|phind\.com|kagi\.com)$/
const SOCIAL =
  /(^|\.)(x\.com|twitter\.com|t\.co|facebook\.com|instagram\.com|linkedin\.com|lnkd\.in|reddit\.com|youtube\.com|tiktok\.com|pinterest\.com|threads\.net|bsky\.app|news\.ycombinator\.com|producthunt\.com|weibo\.com|xiaohongshu\.com|zhihu\.com|bilibili\.com)$/
const EMAIL = /(^|\.)(mail\.google\.com|outlook\.live\.com|mail\.yahoo\.com)$/

export function classifyChannel(input: {
  source: string
  utmMedium: string
  clickIdType: string
}): Channel {
  const medium = input.utmMedium.toLowerCase()
  const source = input.source.toLowerCase()
  const paid =
    /^(cpc|ppc|paid|paidsearch|paid_search|cpm|display)$/.test(medium) || input.clickIdType !== ''

  if (AI.test(source) || medium === 'ai') return 'AI Assistant'
  if (SEARCH.test(source)) return paid ? 'Paid Search' : 'Organic Search'
  if (SOCIAL.test(source) || medium === 'social') return paid ? 'Paid Social' : 'Organic Social'
  if (medium === 'email' || EMAIL.test(source)) return 'Email'
  if (paid) return 'Paid Search'
  if (source === '') return 'Direct'
  return 'Referral'
}
