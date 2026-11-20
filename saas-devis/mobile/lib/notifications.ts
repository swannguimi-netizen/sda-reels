import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { supabase } from './supabase'

// Notification reçue application ouverte : bannière + son
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
})

export type PushStatus = 'granted' | 'denied' | 'unavailable'

/** Demande l'autorisation et enregistre le jeton Expo de l'appareil pour l'utilisateur. */
export async function registerForPush(userId: string): Promise<PushStatus> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unavailable'
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Devis et messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    })
  }
  let { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
  if (status !== 'granted') return 'denied'

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    await supabase.from('push_tokens').upsert({ token, user_id: userId, platform: Platform.OS === 'ios' ? 'ios' : 'android' })
    return 'granted'
  } catch (e) {
    console.warn('Jeton de notification indisponible', e)
    return 'unavailable'
  }
}

/** Retire le jeton de l'appareil (déconnexion). */
export async function unregisterPush() {
  if (Platform.OS === 'web' || !Device.isDevice) return
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    await supabase.from('push_tokens').delete().eq('token', token)
  } catch { /* hors ligne : le serveur nettoiera le jeton plus tard */ }
}

/** Les adresses des notifications (« /devis/<id> », « /messages/<id> »…) ouvrent l'écran correspondant. */
export function routeFor(url: string | null | undefined) {
  if (!url) return '/'
  if (/^\/(devis|messages)\/[0-9a-f-]{36}$/.test(url)) return url
  return '/'
}

export function useNotificationNavigation(enabled: boolean) {
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return
    // Application lancée par un appui sur une notification
    const last = Notifications.getLastNotificationResponse()
    if (last) router.push(routeFor(last.notification.request.content.data?.url as string) as never)
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      router.push(routeFor(r.notification.request.content.data?.url as string) as never)
    })
    return () => sub.remove()
  }, [enabled])
}
