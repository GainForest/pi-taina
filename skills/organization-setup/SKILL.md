---
name: organization-setup
description: Create a new organization on the gainforest.id network. Use when users want to set up their community, NGO, or conservation project as an organization. Tainá guides them through a natural conversation, extracting info from voice notes and messages.
---

# Organization Setup

> An organization is a community, NGO, or conservation project with its own handle on gainforest.id. When users say "register our group", "create an account for our project", or "I want our own handle", this is the skill to use.

## When to Use
- User says "set up our organization", "create an org", "register our community", "I want to create an account for our project"
- User asks how to publish data under their own name or organization
- User mentions they want their own gainforest.id handle
- User wants to represent a group, NGO, or community project on the network

## When NOT to Use
- User wants to identify a species → use identify_species instead
- User wants to create a bumicert → use create_hypercert instead
- User wants to publish an observation → use publish_occurrence instead

## Core Principles

### 1. Extract, Don't Interrogate
If a user sends a voice note or a long message, extract every field you can — name, type, location, founded date, description, objectives, ecosystem. Then only ask about what is still missing. Never re-ask for information already provided, even if it was mentioned in passing or in a voice note.

### 2. Voice Notes Are First-Class
Open with: "Tell me about your organization — you can type or send me a voice note 🎤"

A single voice note can fill 5+ fields. Use transcribe_voice, then parse the transcription for org name, type, country, year, description, and objectives. Treat voice input exactly like typed input — extract everything from it.

### 3. Infer and Confirm
- If they mention "Costa Rica" → set country to `CR` (ISO 3166-1 alpha-2) without asking
- If they say "nonprofit" in passing → set type
- If they describe conservation work → infer `objectives: ["Conservation"]`
- Never ask for what you already know

### 4. Images Are Natural
Invite images naturally: "Send me a photo that represents your org — your logo, your team, your land 📸"

- If they send a square or small image → treat as avatar/logo
- If they send a wide or landscape image → treat as banner
- Invite images, don't demand them. If they skip, that's fine.

### 5. One Question at a Time
Never dump multiple questions at once. Ask one thing, wait for the answer, then ask the next. This is a conversation, not a form.

### 6. Skip Is Always OK
If they say "skip" or "that's all", stop asking and move forward with what you already have. Six fields are truly required: `displayName`, `handle`, `organizationType`, `description`, `country` (ISO alpha-2), and at least one `objective`. Everything else is optional.

### 7. Invite Code Is Required by gainforest.id
The PDS rejects account creation without an invite code. Two paths:
- If `GAINFOREST_INVITE_CODE` is set in the bot's `.env`, `create_organization` uses that automatically — you do not need to ask the user.
- Otherwise, ask the user for their invite code as part of the setup flow: "Do you have a GainForest invite code? You'll need one to create the org on gainforest.id." Pass it as `inviteCode`.

If `create_organization` returns an "Invite code is required" or "Invite code rejected" error, stop and ask the user for a (different) code — do not retry with the same one.

### 8. Polygon Mapping Is Optional
If the user wants to define a territory, land, site boundary, or area, offer a Telegram Web App button first so they can draw the boundary right in Telegram. Ask for just one thing: tap the button and draw the area. Do not frame copy-paste as the main flow when the automatic handoff works.

When Telegram sends the drawn boundary back automatically, continue the conversation naturally and fold it into the organization setup.

If the automatic handoff does not arrive and the user pastes the fallback boundary data from the Web App into chat, accept it, confirm that the boundary was recovered, and keep going without asking them to redraw unless the data is invalid.

Point-only organization creation still remains supported.

## Conversational Flow

1. **User triggers org creation intent** — they say something like "I want to register our community" or "set up our org"

2. **Tainá opens warmly:**
   "Let's do it! Tell me about your organization — what's it called and what do you do? You can type or send me a voice note 🎤"

3. **Parse the response** — extract everything possible: name, type, country, year, description, objectives, ecosystem. A voice note can fill all of these at once.

4. **Celebrate what they do** — be genuine:
   "That's amazing work!" / "Love it!" / "What a beautiful project 🌿"

5. **Suggest a handle** based on the name (lowercase, hyphens, max 20 chars):
   "How about `cabarete-sostenible.gainforest.id`? Or would you prefer something different?"

6. **Ask about missing REQUIRED fields only** — if type wasn't mentioned, ask: "Are you a nonprofit, a community group, or something else?" If description is too short, ask for a bit more. If country wasn't mentioned, ask "Which country are you based in?" and translate it to the ISO alpha-2 code yourself. If objectives weren't mentioned and you can't infer them, ask: "What's the focus — Conservation, Research, Education, Community, or something else?"

7. **Offer polygon capture when needed** — if they mention territory, land, site boundary, or area, show a Telegram Web App button so they can draw it in Telegram. Ask for one action only: tap the button and draw the area.

   When Telegram returns the drawn boundary, keep going with the organization setup.

   If the user pastes the fallback boundary data instead, accept it, tell them the boundary was recovered, and continue naturally. Do not ask them to debug Telegram or redraw unless the data fails validation.

8. **Naturally weave in optional fields** — one at a time, only if not already provided:
    - "Do you have a website or social media?"
    - "Send me your logo 📸"
    - "What year were you founded?"
    - "Any goals or focus areas you'd like to highlight?"

9. **Ask for email:**
   "What email should we use for account recovery? This lets you reset the password if it's ever lost."
   It's optional — if they skip, that's fine, but encourage it since there's no other recovery path.

10. **Show the confirmation summary** before creating anything:

    📛 Name
    🔗 handle.gainforest.id
    🏷️ Type(s)
    📝 Description (truncated if long)
    🌍 Country (ISO alpha-2)
    🎯 Objectives
    📧 Email (if provided)
    📍 Location (if provided)
    🗺️ Mapped area (if provided)
    🌐 Website (if provided)
    📱 Social links (if provided)
    📅 Founded (if provided)
    🖼️ Logo / banner (if provided)

    "Ready to create? 🌿"

11. **On confirmation → call `create_organization`** with all collected fields.

12. **Read the result carefully.** The tool returns:
    ```
    {
      success: true,
      did: "did:plc:...",          ← the org's decentralized identifier
      handle: "name.gainforest.id", ← full handle
      password: "...",              ← the org's ATProto account password (32 chars, random)
      profileUri: "at://...",
      orgUri: "at://...",
      locationUri: "at://..."       ← only if a polygon/location was provided
    }
    ```

13. **Present the result to the user** using ONLY the fields the tool returned:

    Example message:
    "🎉 ¡Tu organización está activa!
    🔗 handle.gainforest.id
    🔑 Contraseña: <code>PASSWORD_HERE</code>
    🌐 Ver perfil: https://www.hyperscan.dev/data?did=DID_HERE"

    - Show the handle and password clearly — the password is the credential to log into the org's ATProto account
    - Link to hyperscan so they can see the live profile
    - Do NOT offer to save anything to `.env` — credentials are saved to `orgs.json` automatically
    - Tell the user: from now on, all observations and records Tainá publishes will be under the org account. No restart needed.

14. **Offer the next step:**
    "Want to create a bumicert for your project? Or start recording observations? 🌿"

## Required vs Optional Fields

**Required (must have before creating):**
- `displayName` — the full name of the organization (min 8 characters)
- `handle` — the gainforest.id handle (suggest one, let them confirm)
- `organizationType` — nonprofit, community group, research institution, etc.
- `description` — what the org does (a sentence or two is enough)
- `country` — ISO 3166-1 alpha-2 code (e.g. `DO`, `BR`, `CR`). Translate the country name yourself; don't ask the user for the code.
- `objectives` — at least one of: **Conservation**, **Research**, **Education**, **Community**, **Other**. Capitalize exactly. Infer from the description when possible.
- `inviteCode` — gainforest.id requires an invite code. If `GAINFOREST_INVITE_CODE` is set in `.env`, omit it and the tool falls back automatically. Otherwise, ask the user for one.

**Optional (ask naturally, skip if not provided):**
- `email` — for account recovery; encourage it but don't block on it
- `website`, `socialLinks` (twitter, instagram, facebook, linkedin, youtube, tiktok, github, discord, telegram, other)
- `location` (point or polygon) — when the user wants a territory, land, site, or area
- `foundedYear`
- `ecosystemTypes` — valid values: tropical-rainforest, mangrove, coral-reef, wetland, savanna, grassland, boreal-forest, temperate-forest, alpine, marine, freshwater, urban, agroforestry, other
- `focusSpeciesGroups` — valid values: birds, mammals, reptiles, amphibians, fish, insects, trees, shrubs, fungi, coral, other
- `avatar` (logo image), `banner` (wide image)

**How to ask about ecosystems and species naturally:**
- "What kinds of ecosystems do you work in — mangroves, rainforest, coral reefs?"
- "Do you focus on any particular group of species — birds, mammals, trees, insects?"
- These can often be inferred from the description without asking — if they say "we protect the mangroves", set ecosystemTypes=["mangrove"] automatically.

User can say "skip" or "that's all" at any point — only the 6 required fields above (plus the invite code, which may come from `.env`) are truly needed.

## Handle Generation Rules
- Lowercase the org name
- Replace spaces with hyphens
- Remove special characters (accents, punctuation, symbols)
- Truncate to 20 characters max (gainforest.id has limits)
- If truncated, cut at a word boundary when possible
- Examples:
  - "Cabarete Sostenible" → `cabarete-sostenible`
  - "Asociación Río Verde" → `asociacion-rio-verde`
  - "Community Forest Watchers of the Amazon" → `community-forest-wat`

## Confirmation Summary Format

Always show this before calling `create_organization`. Only include lines where data was provided (Name, handle, Types, Description, Country, and Objectives are always shown — they're required):

```
📛 Name
🔗 handle.gainforest.id
🏷️ Types
📝 Description (truncated)
🌍 Country (ISO alpha-2)
🎯 Objectives
📍 Location (if provided)
🌐 Website (if provided)
📱 Social links (if provided)
📅 Founded (if provided)
🖼️ Logo/banner (if provided)

Ready to create? 🌿
```

## What the Organization Actually Is

The `create_organization` tool creates a **real ATProto account** on `gainforest.id`. This means:

- The org gets its own DID (decentralized identifier) — a permanent, verifiable identity
- Up to five records are published: `app.certified.actor.profile`, `app.certified.actor.organization`, `app.gainforest.organization.info`, and — if a polygon or point was provided — `app.certified.location` plus `app.gainforest.organization.defaultSite` pointing at it
- The org has its own **password** — this is a real credential, not a display value. Share it with the user
- The org's profile is live and visible at `https://www.hyperscan.dev/data?did=<DID>`
- Credentials are **automatically saved** to `orgs.json` — no manual `.env` editing needed

**From the moment the org is created, Tainá publishes all observations, bumicerts, and records under the org account.** No restart required. If no org exists, Tainá falls back to the community account.

## Don't

- Don't ask numbered questions or follow a rigid script — this is a conversation
- Don't ask for info already provided, even if it was mentioned in passing or in a voice note
- Don't ask more than one question at a time
- Don't require optional fields — only the 6 required fields (displayName, handle, organizationType, description, country, objectives) are truly required
- Don't ask the user to provide an ISO country code — translate the country name yourself (e.g. "Dominican Republic" → `DO`)
- Don't ask about members or contributors — that's no longer part of org creation
- Don't invent an email address — always ask the user for it. If they don't provide one, leave it blank
- Don't create the organization without showing the confirmation summary first
- Don't say "Question 3:" or "Step 2:" — there are no steps, only conversation
- Don't ask "What is your organization type?" if they already said "we're a nonprofit"
- Don't skip the confirmation summary — always show it before calling create_organization
- Don't forget to celebrate their work — these are real communities doing real conservation
- Don't overwhelm with technical details about ATProto, DIDs, PDS, or Telegram internals
- Don't ask for a handle if you can suggest one — suggest it and let them confirm or change it
- Don't tell the user publishing is still under the community account — it switches to the org automatically after creation
- Don't offer to save credentials to `.env` — `orgs.json` handles it automatically, no action needed
- Don't hide the password — it IS the org's login credential. Show it clearly in a code block so the user can copy it
