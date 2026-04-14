# Publish Observation Skill

## When to use
When the user wants to publish/record/save a species observation to the community data store.

## Flow — FOLLOW THIS EXACTLY

1. **Species ID required** — You must have identified the species first (via identify_species). If not, ask the user to send a photo first.

2. **Location required** — Before publishing, you MUST have a location. Check if:
   - The user already shared a Telegram location (GPS coordinates available)
   - The user mentioned a place name you can geocode
   - If neither: **ASK for location**. Say something like: "📍 Where did you spot this? You can share your location or tell me the place name."
   - Use `geocode_location` to convert place names to coordinates.

3. **Ask if the ID sounds right first** — do not move toward publishing until the user has had a later turn to confirm the identification feels right.

4. **Publish only after explicit confirmation** — Do not call `publish_occurrence` in the same turn as a fresh identification. Wait until the user gives a clear publish/record/save yes in a later turn after the identification-agreement checkpoint.

5. **Publish with ALL data** — When calling `publish_occurrence`, you MUST pass:

   **Required:**
   - `scientificName` — from identification result
   
   **Taxonomy — ALWAYS pass ALL of these from the identification result:**
   - `kingdom` — e.g. "Plantae", "Animalia", "Fungi"
   - `phylum` — e.g. "Tracheophyta", "Chordata"
   - `class_` — e.g. "Magnoliopsida", "Aves" (note: underscore because class is reserved in JS)
   - `order` — e.g. "Asparagales", "Passeriformes"
   - `family` — e.g. "Asparagaceae", "Fringillidae"
   - `genus` — from identification taxonomy.genus
   - `specificEpithet` — second word of the scientific name (e.g. "trifasciata" from "Dracaena trifasciata")
   - `taxonRank` — usually "species"
   
   **Location — pass ALL available:**
   - `decimalLatitude` and `decimalLongitude` — GPS coordinates
   - `locality` — text description of the place
   - `country`, `countryCode` — country info
   - `stateProvince`, `municipality` — admin regions if known
   
   **Other:**
   - `vernacularName` — common name from identification
   - `habitat` — from identification result or user context
   - `eventDate` — date of observation (default: today)
   - `occurrenceRemarks` — any notes from the user

6. **After publishing** — The tool returns a `hyperscanUrl`. ALWAYS share it with the user:
   "Your observation has been published! 🎉 View it here: <a href="{hyperscanUrl}">Hyperscan</a>"

## CRITICAL — Taxonomy passthrough
The identify_species tool returns a `taxonomy` object with kingdom, phylum, class, order, family, genus. You MUST pass ALL of these to publish_occurrence. Do NOT skip any. Do NOT make the user provide taxonomy — you already have it from the identification.

Map the fields like this:
- taxonomy.kingdom → kingdom
- taxonomy.phylum → phylum  
- taxonomy.class → class_ (note the underscore!)
- taxonomy.order → order
- taxonomy.family → family
- taxonomy.genus → genus

## Dont
- Never publish without a location — always ask if missing
- Never treat the identification turn as confirmation — the user must confirm in a later turn
- Never skip taxonomy fields — always pass them all
- Never forget to share the Hyperscan link after publishing
- Never ask the user for taxonomy info — you have it from identification
