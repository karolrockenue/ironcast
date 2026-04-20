import { Tabs } from "expo-router";
import Svg, { Path, Rect, Circle, Polyline } from "react-native-svg";
import { colors } from "../../src/theme/colors";

type IconProps = { color: string; focused: boolean };

function DumbbellIcon({ color, focused }: IconProps) {
  const w = focused ? 2.4 : 1.9;
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Rect x="1.5" y="8" width="2.5" height="8" rx="0.6" stroke={color} strokeWidth={w} />
      <Rect x="5" y="6" width="2.5" height="12" rx="0.6" stroke={color} strokeWidth={w} />
      <Rect x="16.5" y="6" width="2.5" height="12" rx="0.6" stroke={color} strokeWidth={w} />
      <Rect x="20" y="8" width="2.5" height="8" rx="0.6" stroke={color} strokeWidth={w} />
      <Path d="M7.5 12 H16.5" stroke={color} strokeWidth={w} strokeLinecap="round" />
    </Svg>
  );
}

function HistoryIcon({ color, focused }: IconProps) {
  const w = focused ? 2.4 : 1.9;
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3.5 8.5 A8.5 8.5 0 1 1 3.5 13.5"
        stroke={color}
        strokeWidth={w}
        strokeLinecap="round"
      />
      <Polyline
        points="3.5,4 3.5,8.5 8,8.5"
        stroke={color}
        strokeWidth={w}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Polyline
        points="12,7 12,12 15.5,14"
        stroke={color}
        strokeWidth={w}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function ProgressIcon({ color, focused }: IconProps) {
  const w = focused ? 2.4 : 1.9;
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="13" width="3.5" height="8" rx="0.6" stroke={color} strokeWidth={w} />
      <Rect x="10.25" y="9" width="3.5" height="12" rx="0.6" stroke={color} strokeWidth={w} />
      <Rect x="17.5" y="5" width="3.5" height="16" rx="0.6" stroke={color} strokeWidth={w} />
    </Svg>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "800",
          letterSpacing: 1.5,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Workout",
          tabBarLabel: "WORKOUT",
          tabBarIcon: ({ color, focused }) => (
            <DumbbellIcon color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarLabel: "HISTORY",
          tabBarIcon: ({ color, focused }) => (
            <HistoryIcon color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: "Progress",
          tabBarLabel: "PROGRESS",
          tabBarIcon: ({ color, focused }) => (
            <ProgressIcon color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
