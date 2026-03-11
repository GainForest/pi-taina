---
name: geocoding
description: Convert text location descriptions to GPS coordinates using the geocode_location tool. Use when a user provides a place name instead of sharing their Telegram GPS location.
---

# Geocoding

## When to Use
- User says "I saw it near the river in Manaus" → geocode "river, Manaus, Brazil"
- User says "Central Park" → geocode "Central Park, New York"
- User provides a locality name during the publishing flow

## How to Use
1. Call geocode_location with the place description as query
2. Optionally pass a countryCode (ISO 3166-1 alpha-2) to narrow results
3. The tool returns: latitude, longitude, formatted address, locality, country, stateProvince
4. Use the returned coordinates for publish_occurrence

## Tips
- Be specific in queries: "Manaus, Amazonas, Brazil" works better than just "Manaus"
- If the first result seems wrong, ask the user to clarify
- Always prefer Telegram GPS location sharing over geocoding for accuracy
