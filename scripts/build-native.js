#!/usr/bin/env node
// Permanent native build script for Capacitor static export.
//
// WHY THE RENAME: Next.js requires export const dynamic to be a static string
// literal — expressions and process.env checks are rejected by Turbopack at
// compile time. There is no Next.js App Router config to exclude specific routes
// from output: 'export'. The only reliable approach is to remove API routes from
// the directory before the build and unconditionally restore them after, whether
// the build succeeds or fails.
//
// API routes stay on Vercel. The native app calls them via NEXT_PUBLIC_API_BASE_URL.
//
// Usage: npm run build:native

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..")
const apiDir = path.join(root, "app", "api")
const apiDirTemp = path.join(root, "app", "_api")

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const vars = {}
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx < 1) continue
    vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
  }
  return vars
}

// If a previous run was interrupted, restore before starting
if (!fs.existsSync(apiDir) && fs.existsSync(apiDirTemp)) {
  fs.renameSync(apiDirTemp, apiDir)
}

const envLocal = loadEnvFile(path.join(root, ".env.local"))

fs.renameSync(apiDir, apiDirTemp)

try {
  execSync("next build", {
    stdio: "inherit",
    cwd: root,
    env: {
      ...process.env,
      ...envLocal,
      IS_NATIVE: "true",
      NEXT_PUBLIC_API_BASE_URL: "https://tippal.behrman.dev",
    },
  })
} finally {
  fs.renameSync(apiDirTemp, apiDir)
}

execSync("npx cap sync ios", {
  stdio: "inherit",
  cwd: root,
})
