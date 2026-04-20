// Rest timer uses wall-clock timestamps so the countdown keeps running when the
// screen is backgrounded. A local notification is scheduled at the end time so
// the phone can alert the user even with the app closed.

import { useCallback, useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import * as Haptics from "expo-haptics";

// Configure how the OS presents rest-end notifications while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: false,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let permissionsRequested = false;
async function ensurePermissions() {
  if (permissionsRequested) return;
  permissionsRequested = true;
  const current = await Notifications.getPermissionsAsync();
  if (current.status === "granted") return;
  await Notifications.requestPermissionsAsync();
}

export type RestState = {
  totalSeconds: number; // prescribed duration for the current rest
  endAt: number; // wall-clock ms when rest should end
  remaining: number; // seconds left
  running: boolean;
  label?: string; // e.g. "Next: Lat Pulldown · Set 2 of 2"
};

type StartArgs = { seconds: number; label?: string };

export function useRestTimer() {
  const [state, setState] = useState<RestState>({
    totalSeconds: 0,
    endAt: 0,
    remaining: 0,
    running: false,
  });
  const notifIdRef = useRef<string | null>(null);
  const endedOnceRef = useRef<boolean>(false);

  // 500ms tick → compute remaining from wall clock.
  useEffect(() => {
    if (!state.running) return;
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((state.endAt - Date.now()) / 1000)
      );
      setState((prev) =>
        prev.endAt === state.endAt && prev.remaining !== remaining
          ? { ...prev, remaining }
          : prev
      );
      if (remaining <= 0 && !endedOnceRef.current) {
        endedOnceRef.current = true;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setState((prev) => ({ ...prev, running: false }));
      }
    };
    tick();
    const i = setInterval(tick, 500);
    return () => clearInterval(i);
  }, [state.running, state.endAt]);

  const cancelScheduledNotif = useCallback(async () => {
    const id = notifIdRef.current;
    if (id) {
      notifIdRef.current = null;
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch {}
    }
  }, []);

  const start = useCallback(
    async ({ seconds, label }: StartArgs) => {
      if (seconds <= 0) return;
      await ensurePermissions();
      await cancelScheduledNotif();

      const endAt = Date.now() + seconds * 1000;
      endedOnceRef.current = false;
      setState({
        totalSeconds: seconds,
        endAt,
        remaining: seconds,
        running: true,
        label,
      });

      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: "Rest complete",
            body: label ? `Next: ${label}` : "Time for your next set",
            sound: "default",
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(endAt),
          },
        });
        notifIdRef.current = id;
      } catch {
        // notifications might be denied; timer still works in-app
      }
    },
    [cancelScheduledNotif]
  );

  const adjust = useCallback(
    (deltaSeconds: number) => {
      setState((prev) => {
        if (!prev.running && prev.remaining <= 0) return prev;
        const newEnd = Math.max(Date.now(), prev.endAt + deltaSeconds * 1000);
        const newTotal = Math.max(1, prev.totalSeconds + deltaSeconds);
        // re-schedule notification with new end time
        cancelScheduledNotif().then(() => {
          Notifications.scheduleNotificationAsync({
            content: {
              title: "Rest complete",
              body: prev.label ? `Next: ${prev.label}` : "Time for your next set",
              sound: "default",
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: new Date(newEnd),
            },
          })
            .then((id) => {
              notifIdRef.current = id;
            })
            .catch(() => {});
        });
        endedOnceRef.current = false;
        return {
          ...prev,
          endAt: newEnd,
          totalSeconds: newTotal,
          remaining: Math.max(0, Math.ceil((newEnd - Date.now()) / 1000)),
          running: true,
        };
      });
    },
    [cancelScheduledNotif]
  );

  const skip = useCallback(async () => {
    await cancelScheduledNotif();
    endedOnceRef.current = true;
    setState({
      totalSeconds: 0,
      endAt: 0,
      remaining: 0,
      running: false,
    });
  }, [cancelScheduledNotif]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelScheduledNotif();
    };
  }, [cancelScheduledNotif]);

  return { state, start, adjust, skip };
}
