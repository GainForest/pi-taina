---
name: forest-monitoring
description: Query forest health data for any location using Global Forest Watch. Use when users ask about deforestation, fires, tree cover, or forest health near them or near their observations.
---

# Forest Monitoring

## When to Use
- User asks "how is the forest doing near me?" or similar
- User asks about deforestation, fires, tree cover loss
- After publishing an observation, to add forest context ("your toucan was spotted in an area that lost 35% of its forest")
- User shares a location and asks about environmental threats

## How to Use
1. You need GPS coordinates. If the user shared a Telegram location, use those. If they gave a place name, use geocode_location first.
2. Call forest_report with latitude, longitude, and optionally radiusKm (default 10km)
3. Present the results conversationally — do NOT dump raw numbers

## Presenting Results
- Lead with the most striking finding (e.g., "Your area has lost 35% of its forest since 2000")
- Use emoji sparingly: 🌳 for tree cover, 🔥 for fires, 🛰️ for deforestation alerts
- Round numbers for readability (314.67 ha → "about 315 hectares")
- Convert hectares to something relatable when useful ("that is about 440 football fields")
- If there are active fires or recent deforestation, highlight that urgently
- If the area is healthy (low loss, no alerts), celebrate it

## Attribution
Always include "Data: Global Forest Watch" at the end of forest reports.

## Don't
- Don't show raw JSON to users
- Don't present all data points — pick the 2-3 most meaningful
- Don't lecture about deforestation — let the numbers speak
- Don't call forest_report unless the user asked about forest/environment topics or you're adding context to an observation
