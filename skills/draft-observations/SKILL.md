# Draft Observations Skill

## When to use
When the user wants to save an observation for later instead of publishing it now, or when they want to manage/publish/discard a previously-saved draft.

## Why drafts exist
- The community may be offline in the field and want to collect observations without internet.
- A user may want to defer the publish decision (e.g. confirm the ID later).
- Drafts live only on this device — they are NOT yet on ATProto / Hypersphere until published.

## Tools available
- `save_draft_observation` — same parameters as `publish_occurrence`; stores the observation locally instead of uploading. May be called with **zero photos** (photo-less draft) when the user wants to attach a picture later.
- `list_drafts` — returns the current user's saved drafts `{ id, scientificName, vernacularName, createdAt, imageCount }`.
- `attach_image_to_draft` — `{ draftId }`; takes whichever photo(s) the user just sent and attaches them to the named draft. Drafts cap at 5 images total.
- `publish_draft` — `{ draftId }`; uploads the draft to ATProto and deletes it from the local queue on success. **Refuses if the draft has no images** — direct the user to send a photo and attach it first.
- `discard_draft` — `{ draftId }`; deletes the draft without publishing.

## Saving a draft during an observation flow

The full conversation — ID → location → agreement → local name → stories → save-or-publish — lives in the `publish-observation` skill. Follow that flow as the single source of truth. When the user picks "save for later", come back here for the save-specific steps:

1. **You should already have captured**: scientific name, full taxonomy, location (GPS + locality/country if derivable), vernacular name, habitat, and — critically — `occurrenceRemarks` with the local/traditional name and any story, use, or cultural knowledge the user shared. A draft must carry the same richness as a live publish, because it flushes as-captured later.

2. **Call `save_draft_observation`** with every field you would have passed to `publish_occurrence`. Do NOT drop fields just because the user is saving instead of publishing.

3. **Confirm the save warmly** in the user's language. Tell them:
   - It is saved locally and NOT yet on the community records.
   - How to publish it later — either `/publish <draftId>` or by asking you to upload it.
   Example (Spanish):
   > "¡Listo! 🌺 Guardé tu observación de Bougainvillea como borrador, con el nombre local y todo. Cuando quieras subirla a la red, dime 'publica la bugambilia' o usa <code>/publish 97fded9f…</code>."

## Photo-less drafts — "save now, picture later"

A user may want to save an observation before they have a usable picture (no signal, bad lighting, the animal moved). The bot supports this:

1. **Trigger phrases**: "save without a picture", "I'll send the photo later", "draft this for now, photo coming", "guárdalo sin foto por ahora", etc.
2. **The user must give you the scientific name themselves** — there is no photo to run `identify_species` on. If they only know a common name, ask for the scientific name (or the closest they have). Don't guess.
3. Still gather location, vernacular name, any local-knowledge story (steps 2/4/5 of `publish-observation`) — a draft must be as rich as a live publish.
4. Call `save_draft_observation` with `scientificName` and any taxonomy/location/notes the user supplied. No photo in state is fine — the identification gate is skipped automatically when `photos` is empty.
5. **Confirm in the user's language** and explicitly remind them a picture is mandatory before publishing. Example (Spanish):
   > "✏️ Guardé tu borrador de *Panthera onca* (Coca, en el río Aguarico). Pero ojo: para publicarlo necesitamos una foto. Cuando la tengas, mándamela y dime 'añádela al borrador del jaguar' (o usa <code>/attach {draftId-corto}</code>)."
6. Save tip in your reply: when they later send the picture, you'll call `attach_image_to_draft` (see next section).

## Attaching a picture to an existing draft

When the user sends a photo in a follow-up turn and wants it bound to a saved draft:

- **Trigger phrases**: "attach this to my Bougainvillea draft", "add this picture to draft 97fded9f", "esta foto es para el borrador del jaguar", "ya tengo la foto del helecho".
- If they describe the draft instead of giving the ID, call `list_drafts` first and pick the match by species/vernacular name.
- Call `attach_image_to_draft({ draftId })`. The tool picks up whatever photo(s) are in the current turn — you don't pass image data.
- Drafts cap at 5 images. If the user is at the cap, tell them; extra photos are dropped.
- After attaching, confirm and offer to publish:
  > "📸 Foto añadida al borrador (ahora tiene 1/5 imágenes). ¿La publico ya, o quieres revisar primero?"

If the user asks to publish a draft that still has no picture, do NOT try `publish_draft` — explain a photo is needed and ask them to send one.

## Managing drafts conversationally

- **"What drafts do I have?" / "muéstrame mis borradores"** — call `list_drafts`, then reply with a short list (species, date, image count). Use the short form of the ID (first 8 chars) in the chat so it's readable, but pass the FULL ID to `publish_draft` / `discard_draft`.

- **"Upload the jaguar one" / "publica la bugambilia"** — call `list_drafts` first, pick the ID that matches the description, then call `publish_draft`. After success, share the Hyperscan link.

- **"Publish them all" / "súbelas todas"** — call `list_drafts`, then call `publish_draft` for each ID. Report which ones succeeded and which failed.

- **"Discard the last one" / "borra el borrador X"** — call `list_drafts` to find the ID, then call `discard_draft`. Confirm in one short sentence.

## Don't
- Never call `save_draft_observation` without the identification + agreement gates cleared **when a photo is in state** — same rules as `publish_occurrence`. The gates are only skipped when the user is explicitly saving without a photo.
- Never invent a scientific name for the photo-less branch — if the user doesn't supply one, ask. Better to leave the draft unsaved than to seed bad data.
- Never skip the local-knowledge asks when saving — the draft must carry a `occurrenceRemarks` field with any traditional name / story / use shared by the user. Missing it now means it's missing when the draft publishes.
- Never skip taxonomy when saving (if you have it from an identification) — the draft must carry everything the real publish would have sent.
- Never call `publish_draft` for a draft that has zero images — the tool will refuse. Send the user back to attach a photo first.
- Never tell the user their draft is "on ATProto" or "published" — it is local until they publish it.
- Never publish a draft on behalf of a user without their explicit request.
- Never expose or act on another user's draft IDs — drafts are scoped per Telegram user.
