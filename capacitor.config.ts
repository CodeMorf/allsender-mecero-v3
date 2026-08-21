import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'tech.allsender.mesero',
  appName: 'RestaPP Mesero',
  webDir: 'dist',
  android: {
    scheme: 'https',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_mesero',
      iconColor: '#d97706',
      sound: 'service_bell.mp3',
    },
  },
}

export default config
