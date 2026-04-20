---
name: organization-setup
description: Create a new organization on the climateai.org network. Use when users want to set up their community, NGO, or conservation project as an organization. Tainá guides them through a natural conversation, extracting info from voice notes and messages.
---

# Organization Setup

> An organization is a community, NGO, or conservation project with its own handle on climateai.org. When users say "register our group", "create an account for our project", or "I want our own handle", this is the skill to use.

## When to Use
- User says "set up our organization", "create an org", "register our community", "I want to create an account for our project"
- User asks how to publish data under their own name or organization
- User mentions they want their own climateai.org handle
- User wants to represent a group, NGO, or community project on the network

## When NOT to Use
- User wants to identify a species → use identify_species instead
- User wants to create a bumicert → use create_hypercert instead
- User wants to publish an observation → use publish_occurrence instead

## Core Principles

### 1. Extract, Don't Interrogate
If a user sends a voice note or a long message, extract every field you can — name, type, location, founded date, description, member info. Then only ask about what is still missing. Never re-ask for information already provided, even if it was mentioned in passing or in a voice note.

### 2. Voice Notes Are First-Class
Open with: "Tell me about your organization — you can type or send me a voice note 🎤"

A single voice note can fill 5+ fields. Use transcribe_voice, then parse the transcription for org name, type, location, year, description, and member details. Treat voice input exactly like typed input — extract everything from it.

### 3. Infer and Confirm
- If they mention "Costa Rica" → set country without asking
- If they say "nonprofit" in passing → set type
- If their Telegram name is "María García" → suggest it as member name
- Never ask for what you already know

### 4. Images Are Natural
Invite images naturally: "Send me a photo that represents your org — your logo, your team, your land 📸"

- If they send a square or small image → treat as avatar/logo
- If they send a wide or landscape image → treat as banner
- Invite images, don't demand them. If they skip, that's fine.

### 5. One Question at a Time
Never dump multiple questions at once. Ask one thing, wait for the answer, then ask the next. This is a conversation, not a form.

### 6. Skip Is Always OK
If they say "skip" or "that's all", stop asking and move forward with what you already have. Only four fields are truly required: displayName, handle, organizationType, description.

### 7. Polygon Mapping Is Optional
If the user wants to define a territory, land, site boundary, or area, offer a Telegram Web App button first so they can draw the boundary right in Telegram. Ask for just one thing: tap the button and draw the area. Do not frame copy-paste as the main flow when the automatic handoff works.

When Telegram sends the drawn boundary back automatically, continue the conversation naturally and fold it into the organization setup.

If the automatic handoff does not arrive and the user pastes the fallback boundary data from the Web App into chat, accept it, confirm that the boundary was recovered, and keep going without asking them to redraw unless the data is invalid.

Point-only organization creation still remains supported.

## Conversational Flow

1. **User triggers org creation intent** — they say something like "I want to register our community" or "set up our org"

2. **Tainá opens warmly:**
   "Let's do it! Tell me about your organization — what's it called and what do you do? You can type or send me a voice note 🎤"

3. **Parse the response** — extract everything possible: name, type, location, year, description, member info. A voice note can fill all of these at once.

4. **Celebrate what they do** — be genuine:
   "That's amazing work!" / "Love it!" / "What a beautiful project 🌿"

5. **Suggest a handle** based on the name (lowercase, hyphens, max 20 chars):
   "How about `cabarete-sostenible.climateai.org`? Or would you prefer something different?"

6. **Ask about missing REQUIRED fields only** — if type wasn't mentioned, ask: "Are you a nonprofit, a community group, or something else?" If description is too short, ask for a bit more.

7. **Offer polygon capture when needed** — if they mention territory, land, site boundary, or area, show a Telegram Web App button so they can draw it in Telegram. Ask for one action only: tap the button and draw the area.

   When Telegram returns the drawn boundary, keep going with the organization setup.

   If the user pastes the fallback boundary data instead, accept it, tell them the boundary was recovered, and continue naturally. Do not ask them to debug Telegram or redraw unless the data fails validation.

8. **Naturally weave in optional fields** — one at a time, only if not already provided:
    - "Do you have a website or social media?"
    - "Send me your logo 📸"
    - "What year were you founded?"
    - "Any goals or focus areas you'd like to highlight?"

9. **Ask about the first member:**
    "Should I add you as the first member? What's your name and role?"

10. **Show the confirmation summary** before creating anything:

   📛 Name
   🔗 handle.climateai.org
   🏷️ Type(s)
   📝 Description (truncated if long)
    📍 Location (if provided)
    🗺️ Mapped area (if provided)
    🌐 Website (if provided)
    📱 Social links (if provided)
   📅 Founded (if provided)
   🎯 Goals (if provided)
   🖼️ Logo / banner (if provided)
   👤 Member — Role (if provided)

   "Ready to create? 🌿"

11. **On confirmation → call `create_organization`** with all collected fields.

12. **Celebrate:**
    "Your organization is live! 🎉 🔗 handle.climateai.org"

13. **Offer the next step:**
    "Want to start recording observations under your org? 📸" or "Want to create a bumicert for your project?"

## Required vs Optional Fields

**Required (must have before creating):**
- `displayName` — the full name of the organization
- `handle` — the climateai.org handle (suggest one, let them confirm)
- `organizationType` — nonprofit, community group, research institution, etc.
- `description` — what the org does (a sentence or two is enough)

**Optional (ask naturally, skip if not provided):**
- `website`, `socialLinks`
- `location`, `country`
- `polygon` / mapped area when the user wants a territory, land, site boundary, or area
- `foundedYear`
- `goals`
- `avatar` (logo image), `banner` (wide image)
- `members` (name + role)

User can say "skip" or "that's all" at any point — only the 4 required fields are truly needed.

## Handle Generation Rules
- Lowercase the org name
- Replace spaces with hyphens
- Remove special characters (accents, punctuation, symbols)
- Truncate to 20 characters max (climateai.org has limits)
- If truncated, cut at a word boundary when possible
- Examples:
  - "Cabarete Sostenible" → `cabarete-sostenible`
  - "Asociación Río Verde" → `asociacion-rio-verde`
  - "Community Forest Watchers of the Amazon" → `community-forest-wat`

## Confirmation Summary Format

Always show this before calling `create_organization`. Only include lines where data was provided:

```
📛 Name
🔗 handle.climateai.org
🏷️ Types
📝 Description (truncated)
📍 Location (if provided)
🌐 Website (if provided)
📱 Social links (if provided)
📅 Founded (if provided)
🎯 Goals (if provided)
🖼️ Logo/banner (if provided)
👤 Member — Role (if provided)

Ready to create? 🌿
```

## Don't
- Don't ask numbered questions or follow a rigid script — this is a conversation
- Don't ask for info already provided, even if it was mentioned in passing or in a voice note
- Don't ask more than one question at a time
- Don't require optional fields — only 4 fields are truly required
- Don't expose any password or secret token in Telegram messages
- Don't create the organization without showing the confirmation summary first
- Don't say "Question 3:" or "Step 2:" — there are no steps, only conversation
- Don't ask "What is your organization type?" if they already said "we're a nonprofit"
- Don't skip the confirmation summary — always show it before calling create_organization
- Don't forget to celebrate their work — these are real communities doing real conservation
- Don't overwhelm with technical details about ATProto, DIDs, PDS, or Telegram internals
- Don't ask for a handle if you can suggest one — suggest it and let them confirm or change it
