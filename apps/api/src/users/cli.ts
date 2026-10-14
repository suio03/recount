import { randomBytes } from 'node:crypto'
import { eq, sql as q } from 'drizzle-orm'
import { db, sql } from '../db/postgres'
import { userSessions, users } from '../db/schema'
import { hashPassword } from '../passwords'

/**
 * For whoever runs the server, since there is no email to reset a password with yet.
 *   pnpm user list
 *   pnpm user password <email>
 *       Sets a new random password, prints it and signs the account out everywhere.
 */

async function main() {
  const [command, email] = process.argv.slice(2)
  if (command === 'list') {
    for (const u of await db.select().from(users).orderBy(users.createdAt))
      console.log(`${u.email}\t${u.name}`)
  } else if (command === 'password' && email) {
    const password = randomBytes(12).toString('base64url')
    const [user] = await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(q`lower(${users.email})`, email.trim().toLowerCase()))
      .returning()
    if (!user) throw new Error(`no account ${email}`)
    await db.delete(userSessions).where(eq(userSessions.userId, user.id))
    console.log(`new password for ${user.email}: ${password}`)
  } else {
    throw new Error('usage: list | password <email>')
  }
}

try {
  await main()
} finally {
  await sql.end()
}
