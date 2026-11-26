import { safetyViolations, stripMarkdown, ungroundedChatNumbers } from "@ft/advice";
import { describe, expect, it } from "vitest";
import { OPENER_EXAMPLES, systemPrompt } from "./chat-prompt";

describe("chat system prompt", () => {
  it("offers opener examples that pass the chat's own checks", () => {
    // The model often copies an example; one the route would reject would cost every answer.
    for (const opener of OPENER_EXAMPLES) {
      expect(safetyViolations(opener)).toEqual([]);
      expect(ungroundedChatNumbers(opener, [])).toEqual([]);
      expect(stripMarkdown(opener)).toBe(opener);
    }
  });

  it("shows two different example openers, varying between requests", () => {
    const shown = (seed: number) => {
      let x = seed;
      const random = () => (x = (x * 9301 + 49297) % 233280) / 233280;
      const prompt = systemPrompt("2026-11-26", "2026-11-25", random);
      return OPENER_EXAMPLES.filter((o) => prompt.includes(`"${o}"`));
    };
    for (let seed = 1; seed <= 20; seed++) expect(shown(seed)).toHaveLength(2);
    const pairs = new Set(Array.from({ length: 20 }, (_, i) => shown(i + 1).join("|")));
    expect(pairs.size).toBeGreaterThan(3);
  });

  it("states the dates it was given", () => {
    const prompt = systemPrompt("2026-11-26", null);
    expect(prompt).toContain("Today is 2026-11-26");
    expect(prompt).toContain("an unknown date");
  });
});
