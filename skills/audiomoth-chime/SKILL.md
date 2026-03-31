---
name: audiomoth-chime
description: Generate AudioMoth configuration chimes. Use when the user mentions AudioMoth, wants to set up a bioacoustic recorder, deploy a sound monitor, or asks for a configuration chime. The chime encodes timestamp, GPS location, and deployment ID at 18kHz carrier frequency.
---

# AudioMoth Chime

## What It Does
Generates a short audio file that configures an AudioMoth bioacoustic recorder via its microphone. Playing the chime syncs the device clock, sets its GPS location, and assigns a deployment ID — all in one step.

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

3. **Generate the chime**
   - Call `generate_audiomoth_chime` with the coordinates
   - The tool returns a WAV file and a deployment ID

4. **Send the WAV file with a friendly message**
   - Share the deployment ID so the user can track this recorder later
   - Include brief instructions on how to use the chime (see below)

Example response after generating:
"Here's your configuration chime! 🔊 Your deployment ID is <b>ABC-1234</b> — keep that for your records.

To configure your AudioMoth:
🔈 Play this audio near the microphone (within ~1 meter)
💡 The LED will flash to confirm it worked

Want to log this deployment as an observation too?"

## How to Use the Chime
Tell the user:
- Play the audio file near the AudioMoth microphone, within about 1 meter
- The device LED will flash to confirm the configuration was received
- Works with AudioMoth firmware that supports the AudioMothChime protocol
- Generate a fresh chime each time — it encodes the current time

## Important Notes
- **Location is required** — always get coordinates before calling the tool
- **Deployment ID** — auto-generated if not specified; always share it with the user so they can reference their deployment later
- **Time-sensitive** — the chime encodes the current UTC timestamp, so generate a new one each time rather than reusing an old file
