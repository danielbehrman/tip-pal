import { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "dev.behrman.tippal",
  appName: "TIP Pal",
  webDir: "out",
  server: {
    androidScheme: "https",
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: "DARK",
    },
  },
}

export default config
