import path from "node:path"
import fs from "node:fs"

export function authDirFor(sessionId: string) {
  const dir = path.join(process.cwd(), "data", "auth", sessionId)
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  return dir
}
