# Publish Observation Skill

## When to use
When the user wants to publish/record/save a species observation to the community data store — OR when they want to save it locally first (see step 6 below).

## Flow — FOLLOW THIS EXACTLY

1. **Species ID required** — You must have identified the species first (via identify_species). If not, ask the user to send a photo first.

2. **Location required** — Before publishing or saving, you MUST have a location. Check if:
   - The user already shared a Telegram location (GPS coordinates available)
   - The user mentioned a place name you can geocode
   - If neither: **ASK for location**. Say something like: "📍 Where did you spot this? You can share your location or tell me the place name."
   - Use `geocode_location` to convert place names to coordinates — this also gives you `locality`, `country`, `countryCode`, `stateProvince`, `municipality` to pass along.

3. **Ask if the ID sounds right** — do not move toward publishing until the user has had a later turn to confirm the identification feels right.

4. **Ask for a local/traditional name** — Once the ID is agreed, ask in one short line (in the user's language):
   > "¿Tiene un nombre local o tradicional esta especie? 🌿"
   > ("Is there a local or traditional name for this species?")
   If they give one, remember it for step 7. If they say no or skip, that's fine — move on without pressing.

5. **Ask for stories, uses, or cultural knowledge** — One more short, warm ask (in the user's language):
   > "¿Algún uso, historia o conocimiento local que quieras guardar junto con este registro?"
   > ("Any use, story, or local knowledge you want to save with this record?")
   If they share something, append it to the local name from step 4. Voice notes are great here. If they skip, that's fine.

6. **Ask: publish now, or save for later?** — After local knowledge has been offered, ask in ONE short line (in the user's language):
   > "¿Lo publico ahora, o lo guardo para después? 📝"
   > ("Publish this now, or save for later?")
   - If they say **publish / upload / yes / send**: continue to step 7 with `publish_occurrence`.
   - If they say **save / later / offline / not yet**: continue to step 7 with `save_draft_observation` instead — the draft carries exactly the same fields and will publish as-captured when flushed later. Also follow the `draft-observations` skill for the save reply.
   Do not call either tool in the same turn as a fresh identification — wait for this explicit choice.

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

8. **After publishing** (publish_occurrence path only) — The tool returns a `hyperscanUrl`. ALWAYS share it:
   > "Your observation has been published! 🎉 View it here: <a href="{hyperscanUrl}">Hyperscan</a>"

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

## Dont
- Never publish or save without a location — always ask if missing
- Never treat the identification turn as confirmation — the user must confirm in a later turn
- Never skip the local-knowledge asks (steps 4 and 5) — they run regardless of whether the user publishes now or saves for later
- Never skip taxonomy fields — always pass them all
- Never call `publish_occurrence` when the user chose to save for later — call `save_draft_observation` with the same fields instead
- Never forget to share the Hyperscan link after a successful publish
- Never ask the user for taxonomy info — you have it from identification
