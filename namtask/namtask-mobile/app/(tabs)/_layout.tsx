import React from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { Colors, FontSize, FontWeight } from '../../src/constants/theme';

function TabIcon({
  name, focused, badge,
}: {
  name: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  badge?: number;
}) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons
        name={focused ? name : `${name}-outline` as any}
        size={23}
        color={focused ? Colors.teal : Colors.gray400}
      />
      {!!badge && badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </View>
  );
}

export default function TabsLayout() {
  const { user } = useAuthStore();
  const isTasker = user?.role === 'tasker';

  return (
    <Tabs
      screenOptions={{
        headerShown:             false,
        tabBarActiveTintColor:   Colors.teal,
        tabBarInactiveTintColor: Colors.gray400,
        tabBarStyle:             styles.tabBar,
        tabBarLabelStyle:        styles.tabLabel,
        tabBarHideOnKeyboard:    true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: isTasker ? 'Find Tasks' : 'Home',
          tabBarIcon: ({ focused }) => (
            <TabIcon name={isTasker ? 'search' : 'home'} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'My Tasks',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="clipboard" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="wallet" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="notifications" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="person" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor:  Colors.white,
    borderTopWidth:   1,
    borderTopColor:   Colors.border,
    height:           62,
    paddingBottom:    8,
    paddingTop:       6,
  },
  tabLabel: {
    fontSize:   FontSize.xs,
    fontWeight: FontWeight.semibold,
    marginTop:  2,
  },
  badge: {
    position:        'absolute',
    top:             -5,
    right:           -8,
    backgroundColor: Colors.error,
    borderRadius:    9,
    minWidth:        16,
    height:          16,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color:      Colors.white,
    fontSize:   9,
    fontWeight: FontWeight.black,
  },
});
