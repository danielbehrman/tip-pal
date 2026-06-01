import { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "dev.behrman.tippal",
  appName: "TIP Pal",
  webDir: "out",
  server: {
    androidScheme: "https",
  },
}

export default config
