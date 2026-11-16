import { describe, expect, it } from "vitest";
import { isRedFlagMessage, numbersIn, SAFETY_REPLY, stripMarkdown, ungroundedChatNumbers } from "./chat-guard";

describe("stripMarkdown", () => {
  it("removes emphasis and headings, keeps bullets readable", () => {
    expect(stripMarkdown("Your average was **7h 30m**.\n## Note\n- one\n- two")).toBe("Your average was 7h 30m.\nNote\n• one\n• two");
  });
});

describe("isRedFlagMessage", () => {
  it.each([
    "I've had chest pain since my run",
    "I fainted after the session",
    "I'm breathless at rest",
    "my heart is racing even sitting down",
    "I keep getting palpitations",
  ])("catches %s", (msg) => {
    expect(isRedFlagMessage(msg)).toBe(true);
  });

  it.each(["How was my sleep last week?", "Compare my HRV in October and November", "What's my resting heart rate trend?"])(
    "lets ordinary questions through: %s",
    (msg) => {
      expect(isRedFlagMessage(msg)).toBe(false);
    },
  );

  it("signposts 999, NHS 111 and the GP", () => {
    expect(SAFETY_REPLY).toMatch(/999/);
    expect(SAFETY_REPLY).toMatch(/NHS 111/);
    expect(SAFETY_REPLY).toMatch(/GP/);
  });
});

describe("numbersIn", () => {
  it("collects numbers from nested results and formatted strings", () => {
    const n = numbersIn([{ hrv: 61.8, date: "2026-11-14", sleep: "7h 30m", steps: "8,123" }]);
    expect([...n]).toEqual(expect.arrayContaining([61.8, 2026, 11, 14, 7, 30, 8123]));
  });
});

describe("ungroundedChatNumbers", () => {
  const tools = [{ mean_ms: 61.8, from: "2026-11-01", to: "2026-11-14", nights: 14 }, { sleep: "7h 28m", avg: 7.46 }];

  it("accepts numbers that round from tool results", () => {
    expect(ungroundedChatNumbers("Your HRV averaged 62 ms over 14 nights (1–14 Nov), with sleep around 7.5 hours (7h 28m).", tools)).toEqual([]);
  });

  it("flags invented numbers", () => {
    expect(ungroundedChatNumbers("Your HRV averaged 75 ms.", tools)).toEqual(["75"]);
  });

  it("accepts numbers repeated from the question", () => {
    expect(ungroundedChatNumbers("Over the last 14 days you averaged 62 ms.", tools, "HRV over the last 14 days?")).toEqual([]);
    expect(ungroundedChatNumbers("Over the last 14 days you averaged 62 ms.", tools.slice(1))).toEqual(["14", "62"]);
  });

  it("accepts the size of a signed change", () => {
    expect(ungroundedChatNumbers("HRV rose by 1.4 ms.", [{ change_b_minus_a: -1.4 }])).toEqual([]);
  });

  it("ignores small counting numbers", () => {
    expect(ungroundedChatNumbers("You trained 3 times in 2 weeks.", tools)).toEqual([]);
  });
});
