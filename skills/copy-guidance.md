# Crank — product copy guidance

Internal Motive guidance for Glean copy iterations. Keep tone professional and concise.

## Principles

1. Prefer short, scannable labels over marketing fluff.
2. Use active voice for CTAs (`Save changes`, not `Changes can be saved`).
3. Match surrounding UI vocabulary; do not invent parallel terms for the same concept.
4. Preserve meaning when shortening — never drop required legal/safety caveats.
5. Prefer sentence case for body and buttons unless the surface already uses title case.
6. Avoid banned fluff: seamless, robust, leverage, utilize, delve, elevate.

## Variant intents Glean should cover

When asked for 3–4 options, aim for distinct intents such as:

1. **Concise** — shorten without losing meaning
2. **Clearer** — reduce ambiguity for first-time users
3. **Actionable** — strengthen verbs / CTAs
4. **On-brand / product tone** — align with Motive product register

## Output shape

For each variant, return updated text for every selected text node (`path` + `text`), not a single blob. The bookmarklet applies node-by-node.
