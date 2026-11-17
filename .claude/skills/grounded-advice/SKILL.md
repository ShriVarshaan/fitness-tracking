---
name: grounded-advice
description: Use when working on the advice engine, template insights, scheduled insights (morning, post-workout, evening, weekly), chat tools, prompts, the optional Gemini LLM wording or advice evaluation. Ensures every piece of advice is traceable to numbers, admits missing data and stays non-medical.
---

# Grounded advice

Design: `docs/PLAN.md` §7. Rules decide the facts; templates (or optionally an LLM) only word them.

## Flow

findings (deterministic, `derived-metrics` skill) → **evidence packet** (`packages/advice/packet.ts`, compact JSON incl. a data-availability map) → **template insight** (always) → *optional* Gemini wording via the Vercel AI SDK with Zod structured output `{headline, body, actions[], evidence_ids[], confidence, missing_data[]}` → **validators** → store `insights` → deliver (in-app + Web Push).

## Non-negotiables

1. **AI is opt-out (on by default, owner's decision).** No LLM call if the user switched AI off in Settings or `GOOGLE_GENERATIVE_AI_API_KEY` isn't set. Otherwise the template insight is shown.
2. **Template path always works** with no LLM at all — test it.
3. **Numeric grounding:** every number in LLM text must match a packet value (after rounding/unit formatting). Fail → retry once → template.
4. Every action cites ≥ 1 evidence id; UI renders "Based on…" chips and a confidence badge.
5. Low confidence or missing metrics → `missing_data` non-empty and shown ("Not available: HRV — no overnight data").
6. **Red flags never come from the LLM.** Fixed template wording signposting GP / NHS 111 / 999. Chat messages mentioning chest pain, fainting, breathlessness at rest or palpitations get the fixed message and the LLM does not continue the topic.
7. Safety filter blocks diagnosis, medication/supplement dosing and extreme diets. Footer: wellness information, not medical advice.

## Chat tools (Phase 3)

- Read-only typed tools only (`get_daily_metrics`, `get_trend`, `compare_periods`, `list_activities`, `get_activity`, `get_sleep`, `get_findings`, `get_data_availability`, `explain_metric`). **No text-to-SQL.**
- Queries run under the logged-in session; nothing user-identifying comes from tool arguments.
- Cap results (~366 points, downsample); log every call.

## LLM

- Google Gemini free tier (ADR 0002); model IDs from config (`GEMINI_MODEL`, `GEMINI_CHAT_MODEL`), not hard-coded. Quota exhausted (429) → template. Record the model used on each insight.

## Evaluation

- Scenario suite in `packages/advice/eval/` (poor sleep + low HRV, load spike, illness-like RHR rise, missing HRV, < 14 days of data, travel, red flags).
- Hard checks must be 100%: grounding, citations, missing-data acknowledgement, red-flag template, safety filter. Run on every prompt or model change.
