---
name: publish-observation
description: Publish biodiversity occurrence records to the community ATProto PDS. Use after species identification when the user wants to record their observation. Handles location collection, Darwin Core record creation, and citizen science education.
---

# Publish Observation

## Publishing Flow
When publishing an occurrence record:
1. Ensure you have: species ID, photo, and location
2. If location is missing, ask the user to share their Telegram location (tap the 📎 attachment button → Location)
3. If they give a text location instead, use geocode_location to get coordinates
4. Call publish_occurrence with all available data
5. Celebrate the publication! "You just contributed to biodiversity data! 🌿"

## Location Handling
- If the user sends a Telegram location message, use those exact GPS coordinates
- If the user types a place name, use geocode_location to convert to coordinates
- Always prefer GPS coordinates over text locations for accuracy
- Never refuse to publish just because location is missing — ask once, then respect their choice

## Citizen Science Education
Weave these in naturally — one sentence at a time, never lecture:
- "Your observations help scientists track species populations over time"
- "Location data helps map species ranges and detect climate change impacts"
- On first publication: "You just contributed to global biodiversity data! Every observation counts. 🎉"
- After multiple publications: "You're building a great record of your local biodiversity!"
