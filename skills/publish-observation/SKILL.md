# Publish Observation Skill

## When to use
When the user wants to publish/record/save a species observation to the community data store — OR when they want to save it locally first (see step 6 below).

> **Note — photo-less drafts**: If the user explicitly says they want to save a draft now and attach a picture later (no photo in this turn), skip steps 1 and 3 and go straight to gathering location + name + any local knowledge, then `save_draft_observation` with the scientific name the user typed and `images` left empty. The draft cannot be published until a picture is attached — see `draft-observations`.

## Fast path — use this when the user is clearly ready

If the user's reply already contains an unambiguous publish-intent verb or a strong yes
("publica", "publícalo", "súbelo", "publish it", "yes publish", "sí publica",
"correcto, publica", "go ahead", "do it"), AND you have a location AND
identification, you may **collapse steps 3–6 into a single tool call**:

- Treat the user's reply as both ID-agreement AND publish-confirmation.
- Do NOT ask "¿te parece que sí es {species}?" again.
- Do NOT ask "¿lo publico o lo guardo como borrador?" — they already said publish.
- Call `publish_occurrence` immediately with all available fields (taxonomy, location,
  occurrenceRemarks if the user volunteered any local knowledge in the original
  message, otherwise omit it).
- Local-knowledge fields (vernacular name, story, use) are OPTIONAL on the fast path —
  only include what the user already volunteered. Do not back-fill by asking.

The fast path exists because the slow path (one-question-per-turn) caused real users
to abandon publishes during the 2026-05-18 community session. Use the fast path
whenever it's safe to do so — when in doubt, fast path wins.

## Standard flow — FOLLOW THIS EXACTLY when the fast path doesn't apply

1. **Species ID required (photo path)** — For the normal flow you must have identified the species first (via identify_species). If the user has no photo and wants to save a draft, they must type the scientific name themselves — go to the photo-less branch in `draft-observations`.

2. **Location required** — Before publishing or saving, you MUST have a location. Check if:
   - The user already shared a Telegram location (GPS coordinates available)
   - The user mentioned a place name you can geocode
   - If neither: **ASK for location**. Say something like: "📍 Where did you spot this? You can share your location or tell me the place name."
   - Use `geocode_location` to convert place names to coordinates — this also gives you `locality`, `country`, `countryCode`, `stateProvince`, `municipality` to pass along.

3. **Ask if the ID sounds right** — exactly ONCE, in a separate turn. Phrase it as a soft check, not a publish confirmation:
   > "¿Te parece que sí es {species}?"
   > ("Does {species} sound right to you?")

   When the user replies:
   - If they correct you (e.g. "es un cupuaçu!") — update the species silently, acknowledge, and **treat that correction itself as the agreement**. Do NOT re-ask "¿te parece bien?" for the corrected species. The user already gave you the right answer; asking again is annoying and triggers loops.
   - If they affirm ("sí", "yes", "correcto") — the ID is locked. Move on.
   - **Once the user has agreed (or corrected you), the species is LOCKED.** Do not re-confirm the species again at any later step. Re-asking "¿me confirmas que sí es {species}?" after this point is forbidden and is what causes the confirmation loop.

4. **Ask for a local/traditional name** — Once the ID is agreed, ask in one short line (in the user's language):
   > "¿Tiene un nombre local o tradicional esta especie? 🌿"
   > ("Is there a local or traditional name for this species?")
   If they give one, remember it for step 7. If they say no or skip, that's fine — move on without pressing.

5. **Ask for stories, uses, or cultural knowledge** — One more short, warm ask (in the user's language):
   > "¿Algún uso, historia o conocimiento local que quieras guardar junto con este registro?"
   > ("Any use, story, or local knowledge you want to save with this record?")
   If they share something, append it to the local name from step 4. Voice notes are great here. If they skip, that's fine.

6. **Ask: publish now, or save for later?** — This step is MANDATORY and must ALWAYS offer BOTH options in the same question. Even if the user already shared their location and seems ready, you MUST ask them to pick between publishing and drafting. Phrase it in ONE short line (in the user's language):
   > "¿Lo publico ahora, o lo guardo como borrador para después? 📝"
   > ("Publish this now, or save it as a draft for later?")

   **This is the ONLY confirmation turn between agreement and the tool call.** Do not insert any other confirmation step here. After the user answers this one question, call the tool — do NOT ask "¿confirmas?" or "¿estás seguro?" or "¿de verdad?". One question, one answer, one tool call.

   **Interpreting the user's reply:**
   - **Publish path** — "publica", "publish", "súbelo", "upload", "ahora", "ya", "go ahead", "do it", or a bare "sí"/"yes" (since this question is now the active prompt, a plain affirmation defaults to publish). Call `publish_occurrence`.
   - **Draft path** — "save", "later", "draft", "borrador", "offline", "más tarde", "todavía no", "not yet". Call `save_draft_observation`. Also follow the `draft-observations` skill for the save reply.

   Do not call either tool in the same turn as a fresh identification — wait for this explicit choice.

   **FORBIDDEN phrasings — these have caused real confirmation loops; do NOT use any variant**:
   - ❌ "Would you like to publish this?" — one-sided yes/no
   - ❌ "Shall I publish it to the community records?" — one-sided yes/no
   - ❌ "¿Lo publico?" — one-sided yes/no
   - ❌ "¿Me confirmas que lo registramos como {species}?" — re-asks about ID, not about publish/draft
   - ❌ "¿Me confirmas por última vez si la identificación es correcta para publicarlo?" — chains a redundant ID confirm in front of publish
   - ❌ "Sólo dime que sí y lo subo de inmediato." — collapses publish-or-draft into a yes/no
   - ❌ Any phrasing that asks the user to re-affirm the species name after they already agreed (or corrected you) in step 3
   Always give the user BOTH choices in the same turn, and never re-litigate the ID.

7. **Call the tool with ALL data** — Whether you're calling `publish_occurrence` or `save_draft_observation`, you MUST pass every available field. A draft must carry the same richness as a live publish:

   **Required:**
   - `scientificName` — from identification result

   **Taxonomy — ALWAYS pass ALL of these from the identification result:**
   - `kingdom` — e.g. "Plantae", "Animalia", "Fungi"
   - `phylum` — e.g. "Tracheophyta", "Chordata"
   - `class_` — e.g. "Magnoliopsida", "Aves" (note: underscore because class is reserved in JS)
   - `order` — e.g. "Asparagales", "Passeriformes"
   - `family` — e.g. "Asparagaceae", "Fringillidae"
   - `genus` — from identification taxonomy.genus
   - `specificEpithet` — second word of the scientific name (e.g. "glabra" from "Bougainvillea glabra")
   - `taxonRank` — usually "species"

   **Location — pass ALL available:**
   - `decimalLatitude` and `decimalLongitude` — GPS coordinates
   - `locality` — text description of the place
   - `country`, `countryCode` — country info
   - `stateProvince`, `municipality` — admin regions if known

   **Other:**
   - `vernacularName` — common name from identification (e.g. "Bougainvillea")
   - `habitat` — from identification result or user context
   - `eventDate` — date of observation (default: today)
   - `occurrenceRemarks` — **required if steps 4 or 5 produced anything** — combine the local/traditional name and any story/use/cultural note the user shared, in their language. Example: "Nombre local: Santa Rita. Usos: las abuelas la ponen en altares durante Día de Muertos."

8. **After publishing** (publish_occurrence path only) — The tool returns a `hyperscanUrl` AND a `linkInstruction` field. ALWAYS share the link in your VERY NEXT reply. Do not split into two replies, do not save the link for a follow-up — it must be visible in the same turn that confirms the publish:
   > Spanish: "¡Listo, Diego! 🎉 Aquí está tu observación: <a href="{hyperscanUrl}">Ver en Hyperscan</a>"
   > English: "Published! 🎉 View it here: <a href="{hyperscanUrl}">Hyperscan</a>"
   > Portuguese: "Pronto! 🎉 Veja sua observação: <a href="{hyperscanUrl}">Hyperscan</a>"

   The link is non-negotiable. If you confirm a publish without the link, the user
   has to ask for it manually — that is a UX failure.

   **After saving a draft** (save_draft_observation path only) — confirm warmly and remind the user how to flush later. The `draft-observations` skill has the exact reply pattern.

## CRITICAL — Taxonomy passthrough
The identify_species tool returns a `taxonomy` object with kingdom, phylum, class, order, family, genus. You MUST pass ALL of these to whichever tool you call. Do NOT skip any. Do NOT make the user provide taxonomy — you already have it from the identification.

Map the fields like this:
- taxonomy.kingdom → kingdom
- taxonomy.phylum → phylum
- taxonomy.class → class_ (note the underscore!)
- taxonomy.order → order
- taxonomy.family → family
- taxonomy.genus → genus

## Failure handling — DO NOT retry

If `publish_occurrence` returns `success: false`, **stop**. Do not call it again
in the same turn or in immediate follow-up turns. The model has been observed
hitting the same failing tool 5+ times in a row when the registry was down,
which spams the user and confuses the conversation.

Specifically:

1. Look at the result's `userMessageInstruction` field — it tells you exactly
   what to say. Follow it.
2. Offer `save_draft_observation` as a fallback — drafts work even when the
   registry is unreachable, and the user can flush them later with `/publish`.
3. Only call `publish_occurrence` again if the user explicitly asks ("try again",
   "retry", "intentalo de nuevo"). A user saying "sí" or "ok" after a failure
   does NOT mean retry — it means they read your apology.
4. If the failure mentions ATProto / registry / agent error, that's a config
   problem on the bot itself. Tell the user a calm one-liner like "El
   registro está temporalmente fuera de servicio — guardo tu observación como
   borrador para más tarde" and call `save_draft_observation` immediately.

## Confirmation loop — how to avoid it

The bot has previously gotten stuck asking the user "¿me confirmas?" two or three times in a row. This is a serious UX failure. Rules to prevent it:

1. **At most ONE confirmation turn between ID agreement and the tool call**, and that turn MUST be the step-6 dual-option question ("publish now or save as draft?"). No other confirmation may sit in this gap.
2. **The species is locked after step 3.** Once the user agreed or corrected you, never ask "¿es {species}?" again. Re-asking the ID after agreement is the #1 cause of the loop.
3. **If you've already asked step 6 once and got any affirmation back** (sí, yes, ok, dale, claro, "publícalo"), call `publish_occurrence` immediately. Do NOT rephrase the question or ask again.
4. **If a tool returns `publish_confirmation_required` or `identification_agreement_required`**, do not parrot the error back at the user with another "¿confirmas?". The runtime gate is satisfied by the user's NEXT message after a normal step-6 ask — just ask step 6 cleanly and proceed on their reply.
5. **If a tool returns a system error you don't recognize**, do not apologize and re-ask the same question. Tell the user there was a technical issue, what they can do (try again, send `/publish <draftId>`, etc.), and move on.

## Dont
- Never publish or save without a location — always ask if missing
- Never treat the identification turn as confirmation — the user must confirm in a later turn
- Never re-ask the user to confirm the species ID after step 3 — once they agreed or corrected you, the ID is final
- Never skip step 6 — you MUST always ask "publish now, or save as a draft for later?" and offer BOTH options. Never ask only "shall I publish?" as a yes/no.
- Never insert a second confirmation step between step 6 and the tool call. Step 6 is the LAST question before publishing.
- Never reply with another "¿me confirmas?" after the user has already said "sí" — instead, call the tool.
- Never skip the local-knowledge asks (steps 4 and 5) — they run regardless of whether the user publishes now or saves for later
- Never skip taxonomy fields — always pass them all
- Never call `publish_occurrence` when the user chose to save for later — call `save_draft_observation` with the same fields instead
- Never forget to share the Hyperscan link after a successful publish — it goes in the SAME reply that confirms the publish, not a later turn
- Never ask "do you want the link?" — always include it unprompted
- Never ask the user for taxonomy info — you have it from identification
