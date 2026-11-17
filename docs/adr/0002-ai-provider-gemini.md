# ADR 0002: AI provider — Google Gemini instead of Groq

- **Status:** accepted
- **Date:** 2026-11-17
- **Replaces:** Groq free tier (`docs/PLAN.md` §2, §7)

## Context

Insight wording and chat used Groq's free tier (`openai/gpt-oss-20b` for wording, `openai/gpt-oss-120b` for chat). The owner wanted higher limits and chose to move to Google's Gemini API through Google AI Studio.

## Decision

- Use Google Gemini through the Vercel AI SDK (`@ai-sdk/google`) for both insight wording and chat. Groq is removed.
- Default models: `gemini-3.5-flash-lite` for wording (`GEMINI_MODEL`) and `gemini-3.8-flash` for chat, which calls tools (`GEMINI_CHAT_MODEL`). Both were listed as stable on 17 Nov 2026. The key is `GOOGLE_GENERATIVE_AI_API_KEY` (server-only).
- Thinking level `low` for both, to save tokens.
- The rest is unchanged: templates are the source of truth, the same validators and fallbacks apply, and red flags are never sent.

## Known issues, accepted by the owner

- **Terms.** Gemini API terms (Use Restrictions): "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom." The app has open sign-up and the owner is in the UK, so the terms call for a billing-enabled project. The owner chose the free tier anyway ("it'll be just me and a recruiter maybe") and accepted the risk. Do not re-litigate; revisit only if usage grows or Google enforces it.
- **Data use.** For users in the UK, EEA or Switzerland, Google applies its paid-service data terms to free usage too. Prompts aren't used to improve Google's products, and they are logged for a limited time to detect misuse. The privacy notice says this.
- **Limits.** Google no longer publishes free-tier limits per model; they vary by model and project and reset at midnight Pacific time. Check the AI Studio console for the real numbers. Running out of quota falls back to templates (wording) or a "try later" error (chat), as before.
- **Not yet verified with a live key:** structured output for the reword schema and tool calling for chat on these models. Run the eval suite and a few chat questions after setting the key.

## Sources

- Gemini API terms: https://aistudio.google.com/docs/terms
- Models: https://aistudio.google.com/docs/models
- Rate limits: https://aistudio.google.com/docs/rate-limits
