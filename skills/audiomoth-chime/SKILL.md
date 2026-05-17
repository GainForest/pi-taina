---
name: audiomoth-chime
description: Generate AudioMoth configuration chimes. Use when the user mentions AudioMoth, wants to set up a bioacoustic recorder, deploy a sound monitor, or asks for a configuration chime. The chime encodes timestamp, GPS location, and deployment ID at 18kHz carrier frequency.
---

# AudioMoth Chime

## What It Does
Generates a short audio file that configures an AudioMoth bioacoustic recorder via its microphone, **AND simultaneously creates the deployment record on ATProto with the user's location**. Playing the chime syncs the device clock, sets its GPS location, and assigns a deployment ID. The ATProto deployment record is registered immediately so future SD card uploads auto-link by deployment ID without asking the user for location again — critical because the user often returns with the SD card weeks or months later.

## When to Trigger
Use this skill when the user:
- Mentions they have an AudioMoth or want to deploy one
- Asks about acoustic monitoring, sound recorder setup, or bioacoustic deployment
- Asks for a "configuration chime" or wants to set up a wildlife sound monitor

## Conversation Flow

1. **User mentions AudioMoth or acoustic deployment**
   - Acknowledge it warmly: "Great, let's get your AudioMoth configured! 🎙️"

2. **Get the deployment location**
   - If the user already shared a location in this conversation, use it
   - If they give a place name, call `geocode_location` to get coordinates
   - If no location yet, ask: "📍 Where are you deploying it? Share your location or tell me the place name."
   - Do NOT generate the chime without coordinates

3. **Generate the chime + register the deployment**
   - Call `generate_audiomoth_chime` with the coordinates.
   - The tool returns: WAV file, deployment ID, **and** (on success) a `deploymentUri` + `deploymentName` confirming the deployment is now live on ATProto.

4. **Send the WAV file with a friendly message**
   - Share the deployment ID so the user can track this recorder later.
   - **Confirm the deployment is registered** so the user knows future uploads will be effortless.
   - Include brief instructions on how to use the chime.
   - If the response has `deploymentRegistrationWarning`, the ATProto record was NOT created — warn the user they'll need to remember the location for the SD upload.

Example response after a clean run:
"¡Listo! 🔊 Tu deployment quedó registrado como <b>{deploymentName}</b> (código <code>{deploymentId}</code>).

Para configurar tu AudioMoth:
🔈 Reproduce este audio cerca del micrófono (a ~1 metro)
💡 El LED parpadeará para confirmar

Cuando regreses con la tarjeta SD, las grabaciones se vincularán automáticamente — no te voy a tener que volver a preguntar la ubicación. ✨"

Example response if `deploymentRegistrationWarning` is present:
"Aquí tienes tu chime (código <code>{deploymentId}</code>). El audio sí se generó, pero tuve problemas registrando el deployment en ATProto en este momento. **Importante**: anota tu ubicación — cuando traigas la tarjeta SD te la voy a pedir."

## How to Use the Chime
Tell the user:
- Play the audio file near the AudioMoth microphone, within about 1 meter
- The device LED will flash to confirm the configuration was received
- Works with AudioMoth firmware that supports the AudioMothChime protocol
- Generate a fresh chime each time — it encodes the current time

## Important Notes
- **Location is required** — always get coordinates before calling the tool.
- **Deployment ID** — auto-generated if not specified; always share it with the user so they can reference their deployment later.
- **Time-sensitive** — the chime encodes the current UTC timestamp, so generate a new one each time rather than reusing an old file.
- **Deployment record auto-creation** — on success, the tool registers the deployment on ATProto with name + lat/lon + deviceSerialNumber=deploymentId. If the user asks "¿puedo ver el deployment en ATProto ahora?" → **YES**, the record exists from this moment on, the audio recordings just haven't been linked yet (those come with the SD upload).
