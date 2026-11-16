import { addDays } from "@ft/core";
import type { RuleContext } from "./types";

/** The last `n` dates ending at ctx.date, oldest first. */
export const lastDates = (ctx: RuleContext, n: number) => Array.from({ length: n }, (_, i) => addDays(ctx.date, i - (n - 1)));

