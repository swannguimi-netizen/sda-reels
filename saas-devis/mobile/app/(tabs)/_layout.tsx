import { Tabs } from 'expo-router'
import { C, Icon } from '@/components/ui'

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: C.brand, headerTitleStyle: { color: C.text }, sceneStyle: { backgroundColor: C.bg } }}>
      <Tabs.Screen name="index" options={{ title: 'Accueil', tabBarIcon: ({ color }) => <Icon ios="house" android="home" color={color} size={24} /> }} />
      <Tabs.Screen name="devis" options={{ title: 'Devis', tabBarIcon: ({ color }) => <Icon ios="doc.text" android="description" color={color} size={24} /> }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: ({ color }) => <Icon ios="bubble.left.and.bubble.right" android="forum" color={color} size={24} /> }} />
      <Tabs.Screen name="compte" options={{ title: 'Compte', tabBarIcon: ({ color }) => <Icon ios="person.crop.circle" android="account_circle" color={color} size={24} /> }} />
    </Tabs>
  )
}
