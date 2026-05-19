# Publish Observation Skill

## Core principle: ship it fast

Real users in Parque das Tribos abandoned publishes because the bot asked 5–7
confirmations before saving. The default flow is now **minimum-friction**: when
you have a photo identification and a location, publish immediately and share
the link. Ask follow-up questions only if the user volunteers something or if
information is genuinely missing.

## Happy path (use this 95% of the time)

For the typical case — user sends a photo and wants it recorded:

1. **Identify immediately.** Don't ask "what do you already know?" first. Call
   `identify_species` as soon as the photo arrives. If the user added context
   (a name, location hint, or note), use it; if not, identify anyway.

2. **Confirm location in one message together with the ID.** When you reply with
   the identification, include the location ask in the same message if location
   is missing:
   > "Identifiquei como X. 📍 Onde você viu? Pode compartilhar sua localização
   > ou só me dizer o nome do lugar."

3. **Publish on the next user turn.** As soon as you have ID + location, call
   `publish_occurrence` with everything you know. Do NOT ask:
   - ❌ "¿Te parece que sí es X?" (Don't re-confirm the ID — trust the model.)
   - ❌ "¿Tiene un nombre local?" (Skip unless the user already mentioned one.)
   - ❌ "¿Algún uso o historia?" (Skip unless the user already shared one.)
   - ❌ "¿Lo publico o lo guardo como borrador?" (Default: publish.)

4. **Share the link immediately.** The tool result includes `hyperscanUrl` and
   `linkInstruction`. Surface the link in the SAME reply that confirms the
   publish. Per-language phrasing:
   - Portuguese: "Pronto! 🎉 Veja sua observação: <a href=\"{url}\">Hyperscan</a>"
   - Spanish: "¡Listo! 🎉 Aquí está tu observación: <a href=\"{url}\">Hyperscan</a>"
   - English: "Published! 🎉 View it here: <a href=\"{url}\">Hyperscan</a>"

That's the whole happy path. Usually 2 turns from photo to published link.

## When to slow down (the 5% case)

Only ask extra questions when:

- **User corrects the ID** — e.g. "es un cupuaçu, no melón amargo!". Update
  the scientific name silently and re-publish with the correction. Don't
  re-ask for agreement.
- **User volunteers local knowledge** — if the user types or says a local name,
  story, or cultural use, include it in `occurrenceRemarks`. Example: user says
  "lo llamamos pé-de-galinha" → include `Nome local: pé-de-galinha`.
- **User explicitly asks to save as draft** — words like "borrador", "draft",
  "guardar para luego", "later", "not yet". Then call `save_draft_observation`
  instead of `publish_occurrence`. Otherwise, default to publish.
- **Low-confidence ID** — only if `identify_species` itself flags uncertainty.
  Then it's reasonable to ask once: "Parece ser X, mas não tenho 100% certeza.
  Te parece bem?"
- **Location truly missing and ungeocodable** — if the user neither shared
  location nor mentioned a place name, ask once for it. After they reply,
  publish.

## Photo-less drafts

If the user wants to save a draft NOW and attach a photo later (no photo in
this turn), skip identification and call `save_draft_observation` with the
scientific name the user typed and `images: []`. See `draft-observations`.

## What to pass to publish_occurrence / save_draft_observation

Both tools accept the same field set. Pass everything you have:

- **Required:** `scientificName`, `submittedBy` (filled automatically), and at
  least one of: GPS coordinates OR a text location.
- **Taxonomy** (from identify_species result — pass ALL): `kingdom`, `phylum`,
  `class_` (underscore: reserved word), `order`, `family`, `genus`,
  `specificEpithet`, `taxonRank` (usually "species").
- **Location:** `decimalLatitude`, `decimalLongitude`, `locality`, `country`,
  `countryCode`, `stateProvince`, `municipality` — pass whatever you have. Use
  `geocode_location` if you only have a place name.
- **Description:** `vernacularName`, `habitat`, `eventDate` (default: today),
  `occurrenceRemarks` (include local name / story if user volunteered any).

Never make the user provide taxonomy — it comes from identification.

## After a successful publish

The tool result includes a `linkInstruction` field with explicit phrasing.
Follow it. The link must appear in the SAME reply that confirms the publish,
not in a follow-up turn. Never ask "do you want the link?" — always include
it unprompted.

After sharing the link, you may optionally offer `publish_measurement` if the
organism has obvious quantitative fields (tree height, body size). Skip this
for casual observations.

## Failure handling — DO NOT retry

If `publish_occurrence` returns `success: false`:

1. Read the `userMessageInstruction` field — it tells you exactly what to say.
2. Offer `save_draft_observation` as a fallback. Drafts work even when the
   registry is unreachable; the user can flush with `/publish <draft-id>`.
3. Do NOT call `publish_occurrence` again unless the user explicitly says
   "try again" / "retry" / "intentalo de nuevo". A user "sí" after a failure
   means "I read your message", not "retry".
4. If the error mentions ATProto / registry / agent, it's a bot config issue.
   Say "El registro está temporalmente fuera de servicio — guardo como
   borrador" and call `save_draft_observation` immediately.

## Anti-patterns (these caused real abandonment in past sessions)

- ❌ Asking "what do you know about this organism?" before running identify_species
- ❌ Asking "¿concuerdas que es X?" after identification
- ❌ Asking "¿hay nombre local?" as a mandatory step
- ❌ Asking "¿lo publico o lo guardo como borrador?" as a mandatory step
- ❌ Re-asking the ID after the user already said yes once
- ❌ Calling `publish_occurrence` 2+ times when it returns an error
- ❌ Confirming the publish without sharing the Hyperscan link
- ❌ Calling `bash` / `read` / `edit` / `write` (these tools are disabled in chat)

## Anti-pattern recovery

If you find yourself about to ask a confirmation question, check: do you already
have ID + location? If yes, just publish. The user can correct you afterward,
and the worst case is one extra round-trip — which is still better than the
4–5 confirmations the old flow used.
