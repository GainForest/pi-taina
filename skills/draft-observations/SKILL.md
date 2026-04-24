# Draft Observations Skill

## When to use
When the user wants to save an observation for later instead of publishing it now, or when they want to manage/publish/discard a previously-saved draft.

## Why drafts exist
- The community may be offline in the field and want to collect observations without internet.
- A user may want to defer the publish decision (e.g. confirm the ID later).
- Drafts live only on this device — they are NOT yet on ATProto / Hypersphere until published.

## Tools available
- `save_draft_observation` — same parameters as `publish_occurrence`; stores the observation locally instead of uploading.
- `list_drafts` — returns the current user's saved drafts `{ id, scientificName, vernacularName, createdAt, imageCount }`.
- `publish_draft` — `{ draftId }`; uploads the draft to ATProto and deletes it from the local queue on success.
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

## Managing drafts conversationally

- **"What drafts do I have?" / "muéstrame mis borradores"** — call `list_drafts`, then reply with a short list (species, date, image count). Use the short form of the ID (first 8 chars) in the chat so it's readable, but pass the FULL ID to `publish_draft` / `discard_draft`.

- **"Upload the jaguar one" / "publica la bugambilia"** — call `list_drafts` first, pick the ID that matches the description, then call `publish_draft`. After success, share the Hyperscan link.

- **"Publish them all" / "súbelas todas"** — call `list_drafts`, then call `publish_draft` for each ID. Report which ones succeeded and which failed.

- **"Discard the last one" / "borra el borrador X"** — call `list_drafts` to find the ID, then call `discard_draft`. Confirm in one short sentence.

## Don't
- Never call `save_draft_observation` without the identification + agreement gates cleared — same rules as `publish_occurrence`.
- Never skip the local-knowledge asks when saving — the draft must carry a `occurrenceRemarks` field with any traditional name / story / use shared by the user. Missing it now means it's missing when the draft publishes.
- Never skip taxonomy or images when saving — the draft must carry everything the real publish would have sent.
- Never tell the user their draft is "on ATProto" or "published" — it is local until they publish it.
- Never publish a draft on behalf of a user without their explicit request.
- Never expose or act on another user's draft IDs — drafts are scoped per Telegram user.
