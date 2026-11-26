/**
 * Server-sent events from POST /api/chat. Shared by the route (writer) and the
 * chat UI (reader). The stream is read with fetch, since EventSource can't POST.
 *
 * - status: what the model is doing before text arrives (e.g. a data lookup)
 * - delta:  a chunk of answer text, appended to the in-progress message
 * - reset:  throw away the text streamed so far (a preamble before a lookup, or
 *           an answer that failed the number check and is being redone)
 * - done:   the final, checked answer; it replaces whatever was streamed
 * - error:  the answer failed; `retry` says whether trying again may help
 */
export type ChatEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "done"; answer: string; grounded: boolean | null; toolsUsed: string[]; model: string | null }
  | { type: "error"; message: string; retry: boolean };

export function encodeEvent(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Parse an SSE body into events as they arrive. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.pipeThrough(new TextDecoderStream() as TransformStream<Uint8Array, string>).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (data) yield JSON.parse(data) as ChatEvent;
    }
  }
}
