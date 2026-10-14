import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from './env'

/**
 * Third-party secrets kept in the database, such as payment provider keys, are sealed with
 * AES-256-GCM under a key derived from ENCRYPTION_KEY, so a copy of the database alone does not
 * give them away. Sealed: 12-byte nonce, 16-byte tag, ciphertext.
 */

const key = () =>
  env.ENCRYPTION_KEY ? createHash('sha256').update(env.ENCRYPTION_KEY).digest() : undefined

export const canSeal = () => key() !== undefined

export function seal(plain: string): Buffer {
  const k = key()
  if (!k) throw new Error('ENCRYPTION_KEY is not set')
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', k, nonce)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), body])
}

export function unseal(sealed: Buffer): string {
  const k = key()
  if (!k) throw new Error('ENCRYPTION_KEY is not set')
  const decipher = createDecipheriv('aes-256-gcm', k, sealed.subarray(0, 12))
  decipher.setAuthTag(sealed.subarray(12, 28))
  try {
    return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('cannot decrypt the stored key: ENCRYPTION_KEY has changed')
  }
}
