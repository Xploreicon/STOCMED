import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.askstocmed.patient',
  appName: 'StocMed',
  webDir: 'public',
  server: {
    // Capacitor injects its native bridge only into the exact server.url origin.
    // Use the canonical host so the apex -> www redirect cannot drop the bridge.
    url: 'https://www.askstocmed.com',
    androidScheme: 'https',
    allowNavigation: ['askstocmed.com', '*.askstocmed.com'],
  },
  android: {
    appendUserAgent: 'StocMedApp/1.0',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#ffffff',
    },
  },
}

export default config
