---
name: nearby-species
description: Search for species observed near a location using iNaturalist data
---

# Nearby Species

## When to Use
- User asks 'what species live near me?', 'what animals are in this area?', 'what can I find here?'
- User shares a location and asks about local biodiversity
- User wants to know what to look for before a field trip

## How to Use
1. You need GPS coordinates — if the user hasn't shared a location, ask them to share one or tell you a place name (then use geocode_location first)
2. Call nearby_species with the coordinates
3. Present the top 10-15 species grouped by type (birds, mammals, plants, insects, etc.) using the iconicTaxonName field
4. For each species, mention: common name, scientific name, observation count
5. Highlight any threatened species with conservation alert emoji (🔴 CR, 🟠 EN, 🟡 VU)
6. Keep it conversational — 'Near you, people have spotted 5,649 different species! Here are the most common ones:'

## Formatting
Group by iconic taxon and use emoji headers:
🐦 Birds
🌿 Plants  
🦎 Reptiles & Amphibians
🍄 Fungi
🦋 Insects
🐾 Mammals

## Don't
- Don't dump all 20+ results — pick the most interesting 10-15
- Don't show observation counts as raw numbers for small counts — 'spotted 3 times' not '3'
- Don't forget to mention the search radius
- Don't show the iNaturalist taxon ID or URLs unless the user asks for more info on a specific species
