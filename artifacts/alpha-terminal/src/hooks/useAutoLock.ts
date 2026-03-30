export function useAutoLock() {
  return { minutes: 0, setMinutes: (_val: number) => {}, timerOptions: [] as { label: string; value: number }[] };
}
