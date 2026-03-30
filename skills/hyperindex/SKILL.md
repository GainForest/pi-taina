---
name: hyperindex
description: Search and browse biodiversity records and hypercerts on the Hypersphere network. Use when users ask about existing observations, want to see community records, or search for species data.
---

# Hyperindex

## When to Use
- User asks 'what have we recorded?' or 'show me our observations'
- User asks about a specific species across the network
- User wants to see hypercerts/bumicerts or impact certificates
- User asks 'how many records do we have?'
- User asks 'how many have I done?' or 'show me my observations'

## How to Use
- For community records: use type='occurrences' with the community DID
- For species search: use type='search' with the species name
- For browsing: use type='occurrences' without a DID filter
- Keep limit reasonable (5-10 for display, up to 20 for counts)

### User-specific queries
When a user asks about THEIR observations ('how many have I done?', 'show me mine'):
1. Query type='occurrences' with the community DID (you already know it)
2. Look at the `recordedBy` field in each result — it contains the Telegram user's display name and ID (e.g. 'Diego Rivera (@diegorb, tg:123456)')
3. Match against the current user's display name or Telegram ID from the message context
4. Count or filter the results client-side
5. Do NOT ask the user for their DID — you already have their identity from the message
6. NEVER invent a DID for the user (e.g. did:telegram:xxx) — that's not a real thing
7. NEVER filter by DID to find a user's records — DID is the COMMUNITY identifier, not the user's

## Presentation (HTML for Telegram)
Format results using HTML tags, not Markdown. Use emoji for visual structure.

For occurrences:
```
🌺 <b>Bougainvillea spectabilis</b> <i>(Buganvilla)</i>
   📍 Nairobi · 📅 26 mar 2026
   🔗 <a href="https://hyperscan.gainforest.app/...">Ver en Hyperscan</a>

🌳 <b>Ficus thonningii</b>
   📍 Kampala · 📅 26 mar 2026
```

For summaries: 'Hemos registrado 23 especies! Aquí van las más recientes...'
For user-specific: 'Has registrado 5 observaciones! 🎉'

## Don't
- Don't dump raw JSON or URIs on the user
- Don't show DIDs — they're internal identifiers
- Don't show more than 5 records at a time unless asked
- Don't query without a purpose — always in response to a user question
- Don't ask the user for their DID — you already know who they are from the message context
- Don't use Markdown formatting (**bold**, *italic*) — use HTML (<b>, <i>, <a>)
