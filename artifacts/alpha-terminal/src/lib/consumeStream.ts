import { fetchWithAuth } from "./fetchWithAuth";

const CHUNK_DELAY_MS = 30;

export async function consumeStream(
  url: string,
  body: Record<string, unknown>,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
  onReasoning?: (text: string) => void,
): Promise<void> {
  try {
    const res = await fetchWithAuth(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      console.error("[consumeStream] HTTP error:", res.status, errText);
      onError(`Server error (${res.status}). Please refresh the page and try again.`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { onError("No readable stream."); return; }

    const decoder = new TextDecoder();
    let buf = "";

    const delay = () => new Promise<void>(r => setTimeout(r, CHUNK_DELAY_MS));

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") { onDone(); return; }
        try {
          const parsed = JSON.parse(payload) as { text?: string; reasoning?: string; error?: string };
          if (parsed.error) { onError(parsed.error); return; }
          if (parsed.reasoning) {
            onReasoning?.(parsed.reasoning);
            await delay();
          }
          if (parsed.text) {
            onChunk(parsed.text);
            await delay();
          }
        } catch {}
      }
    }
    onDone();
  } catch (err: any) {
    console.error("[consumeStream] Network error:", err);
    onError("Connection lost. Please try again.");
  }
}
