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

## Taxonomy Passthrough
When publishing after a species identification, ALWAYS pass the taxonomy fields from the identification result to publish_occurrence:
- kingdom, phylum, class_ (note the underscore — maps to 'class' in the record), order, family from the taxonomy object
- genus: extract from scientificName (first word of binomial)
- specificEpithet: extract from scientificName (second word of binomial)
- taxonRank: usually 'species' unless the ID was at a higher rank (genus, family)

Example: if identify_species returned:
  scientificName: 'Ara macao'
  taxonomy: { kingdom: 'Animalia', phylum: 'Chordata', class: 'Aves', order: 'Psittaciformes', family: 'Psittacidae' }

Then call publish_occurrence with:
  scientificName: 'Ara macao'
  kingdom: 'Animalia'
  phylum: 'Chordata'
  class_: 'Aves'
  order: 'Psittaciformes'
  family: 'Psittacidae'
  genus: 'Ara'
  specificEpithet: 'macao'
  taxonRank: 'species'

## Location Enrichment
When you have geocoded a location, pass ALL available fields:
- decimalLatitude, decimalLongitude (from GPS or geocode)
- locality (specific place name)
- country, countryCode
- stateProvince (from geocode result)
- municipality (from geocode locality field, if it's a municipality)

The more location detail, the more useful the record is for scientists.

## Organization Context
The bot automatically enriches records with organization info (institutionCode, rightsHolder, datasetName) if the community account has an organization registered on Hyperscan. You don't need to do anything — it happens automatically.

If the org is found at boot, mention it naturally: 'Publishing for [Org Name] 🌿'
