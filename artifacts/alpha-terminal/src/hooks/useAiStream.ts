import { useState, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface UseAiStreamOptions<T> {
  url: string;
  onThinking?: (text: string) => void;
  onResult?: (data: T) => void;
  onError?: (msg: string) => void;
}

interface UseAiStreamReturn<T> {
  thinking: string[];
  result: T | null;
  isStreaming: boolean;
  error: string | null;
  startStream: (payload: Record<string, unknown>) => Promise<void>;
  abort: () => void;
}

export function useAiStream<T = unknown>({
  url,
  onThinking,
  onResult,
  onError,
}: UseAiStreamOptions<T>): UseAiStreamReturn<T> {
  const [thinking, setThinking] = useState<string[]>([]);
  const [result, setResult] = useState<T | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const startStream = useCallback(
    async (payload: Record<string, unknown>) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsStreaming(true);
      setThinking([]);
      setResult(null);
      setError(null);

      try {
        const response = await fetchWithAuth(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "Request failed");
          const msg = `Generation failed: ${errText}`;
          setError(msg);
          setIsStreaming(false);
          onError?.(msg);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setError("No readable stream.");
          setIsStreaming(false);
          return;
        }

        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) continue;

            if (line.startsWith("data: ")) {
              const payload = line.slice(6).trim();
              if (!payload || payload === "[DONE]") continue;

              try {
                const parsed = JSON.parse(payload);

                if (parsed.type === "thinking" && parsed.text) {
                  setThinking((prev) => [...prev, parsed.text]);
                  onThinking?.(parsed.text);
                } else if (parsed.type === "complete" && parsed.pulse) {
                  setResult(parsed.pulse as T);
                  setIsStreaming(false);
                  onResult?.(parsed.pulse as T);
                } else if (parsed.type === "error" || parsed.error) {
                  const msg = parsed.message || parsed.error || "Generation failed";
                  setError(msg);
                  setIsStreaming(false);
                  onError?.(msg);
                }
              } catch {}
            }
          }
        }

        setIsStreaming(false);
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setIsStreaming(false);
        onError?.(msg);
      }
    },
    [url, onThinking, onResult, onError]
  );

  return { thinking, result, isStreaming, error, startStream, abort };
}
