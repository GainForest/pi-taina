---
name: hypercerts
description: Create hypercerts (impact certificates) to document conservation projects, community initiatives, and environmental work. Use when users want to record project-level impact — not individual species observations.
---

# Hypercerts

## When to Use
- User talks about a project, initiative, or campaign (not a single species sighting)
- User mentions reforestation, cleanup, monitoring program, community garden, etc.
- User explicitly asks to create a hypercert or impact certificate
- User wants to document ongoing or completed conservation work

## When NOT to Use
- User sends a photo of a species → use identify_species + publish_occurrence instead
- User asks about forest health → use forest_report instead
- User just wants to search existing records → use query_hyperindex instead

## How to Use
1. When the user describes a project, immediately extract what you can: title, description, dates, location
2. If the user hasn't sent a photo yet, ALWAYS ask for one before creating:
   - 'Send me a photo of the project! 📸 It could be the area, the team, or the work in progress — it'll be the face of your certificate.'
   - Wait for the photo before proceeding
3. Ask ONE more follow-up at most — prioritize what's missing:
   - No dates? Ask: 'When did this start?' (don't ask for end date separately — assume ongoing if not mentioned)
   - No location? Ask: 'Where did this happen?' then use geocode_location
   - No work scope? Don't ask — infer from the description (e.g. reforestation → 'reforestation, habitat-restoration')
4. Auto-fill as much as possible:
   - startDate: extract from conversation or default to today
   - workScope: infer tags from the description (biodiversity, reforestation, monitoring, community, etc.)
   - contributors: auto-filled (the user + org if registered)
   - location: use geocode_location if user mentions a place name
5. Call create_hypercert with everything gathered — the photo is attached automatically from the accumulated photos
6. Share the Hyperscan link
7. Offer to attach observations as evidence

## Photo
A photo is the visual identity of the hypercert — it shows up on Hyperscan as the certificate image.
- ALWAYS ask for a photo if the user hasn't sent one
- Good photos: the project area, the team working, before/after shots, the community
- The most recent photo in the conversation is used as the hypercert image
- If the user really doesn't want to send a photo, proceed without one — but always ask first

## Auto-filled Fields
These are filled automatically — you don't need to ask the user:
- contributors: the submitting user is always added, plus the org if registered
- createdAt: current timestamp
- workScope: infer from description if not explicitly provided
- image: the most recent photo sent in the conversation

Focus your questions on what ONLY the user can provide: title, dates, location, photo.

## Linking Observations
After creating a hypercert, ALWAYS offer to link the community's observations as evidence:
- 'Want me to attach your community's biodiversity records as evidence? 📋'
- If yes, call attach_observations with the hypercert URI and CID from the create_hypercert result
- Optionally ask about a date range: 'Should I include all observations, or just from a specific period?'
- After attaching, celebrate: '🏆 Your hypercert is now backed by X verified observations!'
- Share both the hypercert and attachment Hyperscan links

This is the most powerful flow — a hypercert backed by real, verifiable biodiversity data.

## Presentation
- Celebrate the creation: 'Your impact is now on the record! 🏆'
- Share the Hyperscan URL so they can view and share it
- Explain briefly: 'A hypercert is like a certificate for your conservation work — it's permanent and verifiable'
- Don't overwhelm with technical details about ATProto or DIDs

## Don't
- Don't create a hypercert for every species observation — those are occurrences
- Don't create a hypercert without asking for a photo first
- Don't ask more than 2 questions before creating — photo + one follow-up max
- Don't require all fields — title, short description, and a photo are the essentials
