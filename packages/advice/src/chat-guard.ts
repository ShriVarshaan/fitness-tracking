/**
 * Safety and grounding for chat (docs/PLAN.md §7). Pure functions, no model calls.
 */

/** Fixed reply for possible emergencies. The model is never asked to continue the topic. */
export const SAFETY_REPLY =
  "I can't help with that here. If you have chest pain, are fainting, are very short of breath at rest or have a racing or irregular heartbeat, call 999 now. If it's less urgent but you're worried, call NHS 111 or contact your GP. This app gives general wellness information, not medical advice.";

const RED_FLAG_PATTERNS = [
  /chest\s*(pain|tightness|pressure)/i,
  /pain\s+in\s+(my\s+)?chest/i,
  /faint(ed|ing)?\b|passed\s+out|black(ed)?\s+out|collapse/i,
  /(short(ness)?\s+of\s+breath|breathless|can'?t\s+breathe|struggling\s+to\s+breathe)/i,
  /palpitation|heart\s+(is\s+)?(racing|pounding|fluttering|skipping)|irregular\s+heart\s*beat/i,
  /suicid|self[-\s]?harm|kill\s+myself/i,
];

export function isRedFlagMessage(text: string): boolean {
  return RED_FLAG_PATTERNS.some((re) => re.test(text));
}

const NUMBER = /\d+(?:\.\d+)?/g;

/** Every number appearing anywhere in the tool results (keys excluded), as strings and values. */
export function numbersIn(value: unknown, out: Set<number> = new Set()): Set<number> {
  // Magnitudes too: a tool's "change: -1.4" is correctly described as "fell by 1.4".
  if (typeof value === "number" && Number.isFinite(value)) out.add(value).add(Math.abs(value));
  else if (typeof value === "string") for (const m of value.replace(/,(?=\d{3})/g, "").match(NUMBER) ?? []) out.add(Number(m));
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

/**
 * Numbers in the answer that can't be traced to any tool result. A number counts
 * as traced if some tool number rounds to it at the same precision (so "62" is
 * grounded by 61.8, "7.5" by 7.46). Small counting numbers (0–10) are allowed.
 */
export function ungroundedChatNumbers(answer: string, toolResults: unknown[], question = ""): string[] {
  // Numbers the user typed (e.g. "the last 14 days") may be repeated back.
  const known = [...numbersIn(toolResults), ...numbersIn(question)];
  const words = answer.replace(/,(?=\d{3})/g, "").match(NUMBER) ?? [];
  return words.filter((w) => {
    const n = Number(w);
    if (Number.isInteger(n) && n <= 10) return false;
    const dp = w.includes(".") ? w.split(".")[1]!.length : 0;
    const f = 10 ** dp;
    return !known.some((k) => Math.round(k * f) / f === n);
  });
}

/** Models sometimes add markdown emphasis or headings; the chat shows plain text. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}
