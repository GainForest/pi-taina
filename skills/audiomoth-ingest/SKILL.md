---
name: audiomoth-ingest
description: Detect AudioMoth SD cards connected to the machine and upload their bioacoustic recordings to the community ATProto PDS. Use when the user asks about SD cards, AudioMoth recordings, uploading audio data, or checking if recording devices are ready to sync.
---

# AudioMoth SD Card Ingestion

## When to Use

- User asks "are there SD cards ready?", "any cards to upload?", "¿hay tarjetas listas?", or similar
- User asks to upload/sync AudioMoth recordings
- User mentions an AudioMoth device or acoustic recorder
- User asks to check recording devices

## Why location matters

The AudioMoth has **no GPS** — the WAV files only carry a deployment ID + timestamp, not coordinates. Every deployment record needs lat/lon stored separately so the recordings can be georeferenced on the community map.

**The happy path**: when the user generated the configuration chime (`generate_audiomoth_chime`) in the field with GPS, the deployment record was already created on ATProto with location. The SD upload then auto-matches by `deviceSerialNumber === meta.deploymentId` and links the audio without asking anything.

**The fallback path**: if the deployment record doesn't exist yet (chime wasn't used, or ATProto creation failed back then, or the AudioMoth was set up without Tainá), the tool can't proceed without coordinates and will return `location_required`. Ask the user, then retry. No location → no upload. Hard rule.

## Flow — FOLLOW THIS EXACTLY

### Step 1 — Detect SD cards
Call `detect_audiomoth_sd`. It scans mounted volumes for AudioMoth WAV files.

- **No cards found**: Tell the user no AudioMoth SD cards are connected. Suggest inserting the card.
- **Cards found**: Report each card (label, path, WAV count) and ask the user if they want to upload. If multiple cards, process one at a time.

### Step 2 — Confirm and call upload
Once the user confirms ("sí", "súbelas", "go ahead"), call `upload_audiomoth_sd` with the `folder` path. On the first call you typically don't have a deployment URI or location yet — that's fine. The tool will route through one of the four paths below.

### Step 3 — Handle the tool's response

The tool can return any of these:

**a) `success: true`** — done. Report uploaded/skipped counts and the deployment name. Done.

**b) `code: "deployment_choice_needed"`** — multiple deployments exist. The `deployments` array contains rich entries `{uri, name, deployedAt, locality, decimalLatitude, decimalLongitude}`. Show the user a numbered list using the *name* + *locality* + *deployedAt* (e.g., "**AudioMoth at Manaus** — desplegado 4 dic 2025"). Ask which one this SD belongs to. Call `upload_audiomoth_sd` again with `folder` + the chosen `deploymentUri`.

**c) `code: "location_required"`** — the tool needs coordinates. Read `reason`:
  - `"no_deployment"` → no AudioMoth has been registered yet. Ask the user where the AudioMoth is placed.
  - `"deployment_missing_location"` → an existing deployment matches but has no lat/lon. Tell the user warmly: "Encontré tu AudioMoth registrado como *{deploymentName}*, pero le falta ubicación. ¿Dónde está colocado?" Pass back the same `deploymentUri` to patch it.

  How to gather location (mirrors the publish_occurrence flow):
  - If the user shared a Telegram location in the conversation recently → use those coordinates.
  - If they mention a place name → call `geocode_location` to convert.
  - Otherwise: ask. One ask. Phrase: "📍 ¿Dónde está colocado este AudioMoth? Comparte tu ubicación, dime el nombre del lugar, o pega coordenadas."

  Then call `upload_audiomoth_sd` again with `folder`, the `decimalLatitude` and `decimalLongitude` you gathered, and the `deploymentUri` (if you were patching an existing one).

**d) `code: "error"`** — surface the error to the user in their language. Don't loop on errors.

### Step 4 — Confirm success
After a `success: true`, share:
- How many files were uploaded vs. skipped (already on PDS).
- The deployment name and (optionally) coordinates.
- Example: "✅ Subí 247 grabaciones de **{deploymentName}**. (5 ya estaban subidas antes y las salté.) Quedaron georreferenciadas en (-3.0254, -60.0080)."

## Don't

- **Don't** call `upload_audiomoth_sd` without user confirmation that they want to upload.
- **Don't** invent coordinates. If you don't have a Telegram location, a geocoded place name, or explicit coordinates from the user, ask. If the user refuses or can't provide one, tell them upload is blocked until they do — be warm but firm.
- **Don't** invent deployment URIs — use only what `deployment_choice_needed` returned or what a previous call gave back.
- **Don't** worry about duplicate uploads — the tool deduplicates via SHA-1.
- **Don't** ask for `habitat`, `mountingHeight`, or other deployment metadata — those can be added later via Hyperscan if the user wants. The required fields are only `decimalLatitude` + `decimalLongitude`.
- **Don't** loop on `location_required`. Ask the user ONE TIME. If they refuse, surface a clear "no puedo subir sin ubicación" and stop.
