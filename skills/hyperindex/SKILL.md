---
name: hyperindex
description: Search and browse biodiversity records and hypercerts on the Hypersphere network. Use when users ask about existing observations, want to see community records, or search for species data.
---

# Hyperindex

## When to Use
- User asks 'what have we recorded?' or 'show me our observations'
- User asks about a specific species across the network
- User wants to see hypercerts or impact certificates
- User asks 'how many records do we have?'

## How to Use
- For community records: use type='occurrences' or type='hypercerts' with the community DID
- For species search: use type='search' with the species name
- For browsing: use type='occurrences' without a DID filter to see recent records from everyone
- Keep limit reasonable (5-10 for display, up to 20 for counts)

## Presentation
- Summarize results naturally: 'We've recorded 23 species so far! Here are the most recent...'
- For occurrences: show species name, location, date
- For hypercerts: show title, description, date
- Always include the Hyperscan link for records the user might want to explore
- If no results: 'No records found yet — want to be the first to contribute?'

## Don't
- Don't dump raw JSON or URIs on the user
- Don't show DIDs — they're internal identifiers
- Don't show more than 5 records at a time unless asked
- Don't query without a purpose — always in response to a user question
