/**
 * Properties that look like personal data. Events describe what visitors do, never who they are,
 * so a property named like a contact detail or holding an address, a phone or card number is
 * refused: server-side events and event definitions are rejected with the reason, and browser
 * events drop the property, since the tracker never retries.
 */

/** Property names that hold who someone is, split into words first ("userEmail" → user email). */
const PERSONAL_WORDS = new Set([
  'email',
  'mail',
  'phone',
  'tel',
  'telephone',
  'mobile',
  'firstname',
  'lastname',
  'fullname',
  'surname',
  'username',
  'address',
  'street',
  'zip',
  'zipcode',
  'postcode',
  'postal',
  'ssn',
  'passport',
  'password',
  'passwd',
  'birthday',
  'birthdate',
  'dob',
  'iban',
  'ip',
  'card',
  'cardnumber',
  'cvv',
  'cvc',
])

/** Pairs of words that are personal only together ("first name", "credit card"). */
const PERSONAL_PAIRS = new Set([
  'first name',
  'last name',
  'full name',
  'user name',
  'display name',
  'credit card',
  'card number',
  'date of',
  'social security',
  'ip address',
  'postal code',
  'zip code',
])

function words(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** Why a property name looks personal, or undefined when it does not. */
export function personalName(name: string): string | undefined {
  const w = words(name)
  if (w.some((x) => PERSONAL_WORDS.has(x)) || PERSONAL_WORDS.has(w.join('')))
    return `"${name}" names personal data`
  for (let i = 0; i + 1 < w.length; i++)
    if (PERSONAL_PAIRS.has(`${w[i]} ${w[i + 1]}`)) return `"${name}" names personal data`
  return undefined
}

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/
/** A phone number written as one: a leading + or three groups or more, 8 to 15 digits. */
const PHONE = /^\+?[\d\s().-]+$/
const DATE = /^\d{4}-\d{2}-\d{2}/
/** An international number inside longer text ("call +1 415 555 0100"). */
const PHONE_IN_TEXT = /(?:^|[^\w+])\+\d[\d\s().-]{6,18}\d/

function luhn(digits: string) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** Why a property value looks personal, or undefined when it does not. */
export function personalValue(value: string): string | undefined {
  const v = value.trim()
  if (EMAIL.test(v)) return 'holds an email address'
  if (IPV4.test(v) && v.split('.').every((p) => Number(p) <= 255)) return 'holds an IP address'
  const digits = v.replace(/\D/g, '')
  // Dates and decimal amounts are digits with separators too.
  const groups = v.split(/[\s().-]+/).filter(Boolean).length
  if (PHONE.test(v) && !DATE.test(v) && (v.startsWith('+') || groups >= 3)) {
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return 'holds a card number'
    if (digits.length >= 8 && digits.length <= 15) return 'holds a phone number'
  }
  if (/^\d{13,19}$/.test(v) && luhn(v)) return 'holds a card number'
  const embedded = v.match(PHONE_IN_TEXT)?.[0].replace(/\D/g, '') ?? ''
  if (embedded.length >= 8 && embedded.length <= 15) return 'holds a phone number'
  return undefined
}

/** Each property that looks personal, with why. */
export function personalProperties(props: Record<string, string>) {
  const found: Array<{ key: string; reason: string }> = []
  for (const [key, value] of Object.entries(props)) {
    const reason = personalName(key) ?? personalValue(value)
    if (reason) found.push({ key, reason: reason.startsWith('"') ? reason : `"${key}" ${reason}` })
  }
  return found
}

/** The properties that do not look personal. */
export function withoutPersonal(props: Record<string, string>) {
  const drop = new Set(personalProperties(props).map((p) => p.key))
  return drop.size ? Object.fromEntries(Object.entries(props).filter(([k]) => !drop.has(k))) : props
}
