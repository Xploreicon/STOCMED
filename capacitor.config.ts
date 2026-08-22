import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.askstocmed.patient',
  appName: 'StocMed',
  webDir: 'public',
  server: {
    url: 'https://askstocmed.com',
    androidScheme: 'https',
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
