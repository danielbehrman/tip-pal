import type { NextConfig } from "next"

const isNative = process.env.IS_NATIVE === "true"

const nextConfig: NextConfig = {
  ...(isNative && {
    output: "export",
    trailingSlash: true,
    images: { unoptimized: true },
  }),
}

export default nextConfig
