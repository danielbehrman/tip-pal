export function isNative(): boolean {
  if (typeof window === "undefined") return false
  return !!(window as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor?.isNativePlatform?.()
}
