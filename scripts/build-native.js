#!/usr/bin/env node
// Native build script: temporarily removes API routes (which can't be statically
// exported) then restores them after the build, whether it succeeds or fails.

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const apiDir = path.join(__dirname, "..", "app", "api")
const apiDirTemp = path.join(__dirname, "..", "app", "_api_native_tmp")

fs.renameSync(apiDir, apiDirTemp)

try {
  execSync("next build", {
    stdio: "inherit",
    env: {
      ...process.env,
      IS_NATIVE: "true",
      NEXT_PUBLIC_API_BASE_URL: "https://tippal.behrman.dev",
    },
  })
} finally {
  fs.renameSync(apiDirTemp, apiDir)
}
