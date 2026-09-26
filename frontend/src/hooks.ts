import { useCallback, useEffect, useState } from "react";
// Schedule after completion so slow requests never overlap or arrive out of order.
export function usePoll<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [receivedAt, setReceivedAt] = useState(Date.now());
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await load();
        if (active) {
          setData(value);
          setError("");
          setReceivedAt(Date.now());
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Connection failed");
      }
      if (active) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load, revision]);
  return { data, error, receivedAt, refresh };
}
export function useTick() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
