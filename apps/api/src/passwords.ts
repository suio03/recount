import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * One of OWASP's equivalent scrypt settings: N = 2^15, r = 8, p = 3. It needs 32 MiB per hash
 * rather than the 128 MiB of N = 2^17, so a few sign-ins at once fit on a small host.
 */
const N = 2 ** 15
const R = 8
const P = 3
const LENGTH = 32

function derive(password: string, salt: Buffer, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  )
}

const memory = (n: number, r: number) => 256 * n * r

/** `scrypt$N$r$p$salt$hash`, so the cost can rise later without breaking stored hashes. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = await derive(password, salt, { N, r: R, p: P, maxmem: memory(N, R) })
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, n, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const key = await derive(password, Buffer.from(salt, 'base64url'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: memory(Number(n), Number(r)),
  })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Checked against when no account has the email, so a miss takes as long as a wrong password. */
export const decoy = await hashPassword(randomBytes(16).toString('hex'))
