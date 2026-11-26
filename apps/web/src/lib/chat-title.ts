/** A chat is named after its first question, cut at a word near 60 characters. Used by the route and the UI. */
export function chatTitle(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat;
  const cut = flat.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
}
