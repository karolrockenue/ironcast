// Simple in-memory store for active workout state that needs to be shared across screens.
// This avoids the params-across-screens problem with expo-router modals.

type Listener = () => void;

let selectedExercise: { id: number; name: string } | null = null;
let pickerContext: "workout" | "template" = "workout";
const listeners = new Set<Listener>();

export const workoutStore = {
  getExercise() {
    return selectedExercise;
  },
  setExercise(ex: { id: number; name: string } | null) {
    selectedExercise = ex;
    listeners.forEach((fn) => fn());
  },
  getContext() {
    return pickerContext;
  },
  setContext(ctx: "workout" | "template") {
    pickerContext = ctx;
  },
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
