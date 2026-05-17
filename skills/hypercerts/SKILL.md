---
name: hypercerts
description: Create hypercerts (impact certificates) to document conservation projects, community initiatives, and environmental work. Use when users want to record project-level impact — not individual species observations.
---

# Hypercerts

> The community calls these "bumicerts" — treat "bumicert" and "hypercert" as synonyms. When talking to users, prefer "bumicert".

## When to Use
- User talks about a project, initiative, or campaign (not a single species sighting)
- User mentions reforestation, cleanup, monitoring program, community garden, etc.
- User explicitly asks to create a hypercert, bumicert, or impact certificate
- User wants to document ongoing or completed conservation work

## When NOT to Use
- User sends a photo of a species → use `identify_species` + `publish_occurrence` instead
- User asks about forest health → use `forest_report` instead
- User just wants to search existing records → use `query_hyperindex` instead

## Required gates (MUST satisfy ALL before calling create_hypercert)

The runtime tool `create_hypercert` ENFORCES gate 1 and will return `code: "photo_required"` if violated. Gates 2 and 3 are your responsibility — the model is the only thing that can enforce them.

1. **Photo in state** — at least one photo must be in the conversation state. If the user hasn't sent one, ask:
   > "📸 Mándame una foto del proyecto — del área, el equipo, o el trabajo en progreso. Va a ser la cara del bumicert."
   Wait for the photo. Do NOT proceed without it. If you call the tool anyway, it returns `photo_required` and you'll have to ask anyway.

2. **Title and shortDescription must come from the USER** — these are the two human-facing fields that define what the bumicert is *about*. **Never invent them silently.** Specifically:
   - If the user said something like "publica esto como bumicert" without details, you do NOT have enough info. Ask:
     > "¿Qué título le ponemos? ¿Y cómo describirías en una o dos frases el trabajo que estás documentando?"
   - It's fine to *suggest* a title/description based on context (e.g. for an AudioMoth deployment: "podríamos llamarlo 'Monitoreo bioacústico en {locality}' — ¿te parece o prefieres otro?") — but the user must confirm or override. Don't just write your suggestion into the tool call.
   - Don't ask both fields in two separate turns. Combine: "¿Título y un par de frases describiendo el trabajo?"

3. **One follow-up max for the remaining fields** — after photo + title + description are set, ask at most ONE follow-up to fill the most-missing field:
   - No dates? → "¿Cuándo empezó esto?" (default ongoing if unsaid)
   - No location? → "¿Dónde está el proyecto?" then `geocode_location`
   - No work scope? → Don't ask. Infer from the description (reforestation → "reforestation, habitat-restoration").

## Auto-filled fields — DON'T ask the user
- `contributors`: the submitting user + their org (if registered)
- `createdAt`: now
- `workScope`: inferred from the user-provided description
- `image`: the most recent photo in state (the one you just asked for)

## After creating
1. Share the Hyperscan link warmly: "🏆 Tu bumicert ya está en la red comunitaria: <link>"
2. **Offer to link observations as evidence** — this is the highest-value follow-up:
   > "¿Quieres que adjunte tus observaciones biodiversas como evidencia del trabajo?"
   - If yes → `attach_observations` with the hypercert URI + CID from the create result.
   - Optionally ask date range: "¿Todas las observaciones, o solo de un período?"
3. After attaching, celebrate the link: "🌳 Tu bumicert ahora respaldado por X registros verificables."

## Don't
- **Don't** call `create_hypercert` without a photo. The runtime gate will block you — but you should have asked first anyway.
- **Don't** invent the title or `shortDescription` from context. Suggest, get confirmation, then submit. The user's project is theirs to name.
- **Don't** ask more than 2 questions before calling the tool: (photo + title/description) is the first turn, ONE follow-up is the second. Then create.
- **Don't** mix this flow with a species observation — if the user just sent a photo of a frog, they want `publish_occurrence`, not a bumicert.
- **Don't** add technical details about ATProto, DIDs, or CIDs to the user-facing reply. Keep it warm and human.

## Common foot-guns from past sessions
- **AudioMoth context**: when the user has just uploaded AudioMoth recordings and asks "puedes crear un bumicert con estas grabaciones?", that does NOT give you a photo or a confirmed title. Ask for both. The recordings are great EVIDENCE (link them via `attach_observations` after creating), but they aren't a substitute for the bumicert photo + description.
- **"Just do it" pressure**: when the user is enthusiastic ("¡dale!"), don't skip the photo gate. The bumicert without a photo is a worse artifact than the one-extra-turn wait.
