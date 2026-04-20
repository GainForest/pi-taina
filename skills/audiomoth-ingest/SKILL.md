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

## Flow

### Step 1 — Detect SD cards
Call `detect_audiomoth_sd`. It scans mounted volumes for AudioMoth WAV files.

**If no cards found:** Tell the user no AudioMoth SD cards are connected. Suggest they insert the SD card and try again.

**If cards found:** Report each card: label, path, number of WAV files. Ask the user if they want to upload.

### Step 2 — Confirm and upload
Only call `upload_audiomoth_sd` after the user explicitly confirms they want to upload.

Pass the `folder` path from the detection result. If there are multiple cards, process one at a time and report results for each.

### Step 3 — Report results
Report: how many files were uploaded vs. skipped (already on PDS). Include the PDS URIs if available.

## Deployment handling (automatic)

The upload tool handles AudioMoth deployment records automatically:
- If one deployment exists on the PDS → uses it
- If none exist → creates one automatically from WAV metadata
- If multiple exist → returns a list; ask the user which deployment this SD card belongs to, then call `upload_audiomoth_sd` again with the chosen `deploymentUri`

## Don't

- Don't call `upload_audiomoth_sd` without user confirmation
- Don't invent deployment URIs — use only what the tool returns
- Don't worry about duplicate uploads — the tool deduplicates via SHA-1
