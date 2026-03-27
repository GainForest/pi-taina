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
1. Gather the basics: what was the project? (title + short description)
2. Ask about timeframe: when did it start? Is it ongoing or finished?
3. Ask about location: where did this happen? (use geocode_location if needed)
4. If the user sent a photo, it will be attached automatically
5. Suggest work scope tags based on what they described
6. Call create_hypercert with all gathered info
7. Share the Hyperscan link so they can view their impact certificate

## Presentation
- Celebrate the creation: 'Your impact is now on the record! 🏆'
- Share the Hyperscan URL so they can view and share it
- Explain briefly: 'A hypercert is like a certificate for your conservation work — it's permanent and verifiable'
- Don't overwhelm with technical details about ATProto or DIDs

## Don't
- Don't create a hypercert for every species observation — those are occurrences
- Don't require all fields — title and short description are enough
- Don't ask more than 2 questions before creating — gather what you can and fill in defaults
