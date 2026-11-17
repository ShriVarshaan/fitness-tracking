# ADR 0002: AI provider — Google Gemini instead of Groq

- **Status:** accepted
- **Date:** 2026-11-17
- **Replaces:** Groq free tier (`docs/PLAN.md` §2, §7)

## Context

Insight wording and chat used Groq's free tier (`openai/gpt-oss-20b` for wording, `openai/gpt-oss-120b` for chat). The owner wanted higher limits and chose to move to Google's Gemini API through Google AI Studio.

## Decision

- Use Google Gemini through the Vercel AI SDK (`@ai-sdk/google`) for both insight wording and chat. Groq is removed.
- Default models: `gemini-3.5-flash-lite` for both wording (`GEMINI_MODEL`) and chat (`GEMINI_CHAT_MODEL`). If a model is busy or out of quota, wording and chat try the next distinct model, ending with `gemini-3.1-flash-lite` (`GEMINI_FALLBACK_MODEL`, which has its own free-tier quota). All were listed as stable on 17 Nov 2026. The key is `GOOGLE_GENERATIVE_AI_API_KEY` (server-only).
- Chat first used `gemini-3.8-flash`. On the live site on 17 Nov 2026 it answered "This model is currently experiencing high demand" on both tries, and flash-lite answered correctly through the fallback. So flash-lite became the chat default.
- Thinking level `low` for both, to save tokens.
- The rest is unchanged: templates are the source of truth, the same validators and fallbacks apply, and red flags are never sent.

## Known issues, accepted by the owner

- **Terms.** Gemini API terms (Use Restrictions): "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom." The app has open sign-up and the owner is in the UK, so the terms call for a billing-enabled project. The owner chose the free tier anyway ("it'll be just me and a recruiter maybe") and accepted the risk. Do not re-litigate; revisit only if usage grows or Google enforces it.
- **Data use.** For users in the UK, EEA or Switzerland, Google applies its paid-service data terms to free usage too. Prompts aren't used to improve Google's products, and they are logged for a limited time to detect misuse. The privacy notice says this.
- **Limits.** Google no longer publishes free-tier limits per model; they vary by model and project and reset at midnight Pacific time. Check the AI Studio console for the real numbers. A busy or exhausted model moves to the next one; if all are unavailable, wording uses the template (retried on the next sync) and chat shows a "try again in a few minutes" message.
- **Verified live on 17 Nov 2026** with `pnpm test:live`: 13/13 cases passed (11 requests, 0 quota errors). The first run found invented actions and an over-broad safety filter, both fixed. Re-run it after any prompt or model change.

## Sources

- Gemini API terms: https://aistudio.google.com/docs/terms
- Models: https://aistudio.google.com/docs/models
- Rate limits: https://aistudio.google.com/docs/rate-limits
