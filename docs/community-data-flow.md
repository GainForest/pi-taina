# Community Data Flow

A short explainer of how a community's biodiversity data moves through Pi-Tainá — from the moment it lands in chat to the moment it becomes public.

---

## 1. Data goes in (Telegram → bot)

Every observation starts as a Telegram message from a community member:

- 📸 **Photo** → species identification (Gemini vision + iNaturalist enrichment)
- 🎤 **Voice note** → transcribed to text
- 📍 **Location pin** → GPS coordinates
- 💬 **Text** → notes, local names, traditional knowledge

The bot checks the user against `data/whitelist.json` first. Unknown users are blocked. Members and admins are passed to the Pi agent, which assembles the pieces (species, taxonomy, coordinates, images, notes) into a **Darwin Core occurrence record**.

At this point the record is just an in-memory object on the device. Nothing has left the Pi.

---

## 2. Local-first (saved on the device)

After identifying a species, Tainá always asks:

> "Publish this now, or save it for later? 📝"

If the user picks **save**, the full record is written to:

- `data/drafts.db` — SQLite row with the assembled payload
- `data/drafts/<draft-id>/` — the original image bytes

This is local-only. Useful for offline fieldwork, spotty connectivity, or when the user wants to review before publishing. Drafts are scoped per Telegram user — only you can publish or discard your own.

Other things that live locally and never leave the device:

- `data/whitelist.json` — community member list
- `data/sessions/` — per-user agent conversation state
- `.env` — credentials (bot token, ATProto password, API keys)

Each community runs its own bot on its own hardware (Mac Mini, Raspberry Pi). There is no shared cloud, no central database.

---

## 3. Going public (device → ATProto)

When the user picks **publish** (or runs `/publish <id>` on a saved draft), the record is pushed to ATProto:

1. Images are uploaded as blobs to the community/org PDS
2. A Darwin Core occurrence record is written to the account's repo
3. The post becomes a permanent, addressable URI (e.g. `at://did:plc:.../app.bsky.feed.post/...`)

If the community has set up an **org account** (via the organization-setup flow), publishes go through that org handle on `gainforest.id`. Otherwise they go through the community account configured by `ATPROTO_HANDLE` / `ATPROTO_PASSWORD`.

Once published, the record is:

- **Open** — anyone can read it without an API key
- **Permanent** — lives in the account's signed repo
- **Queryable across communities** via the Hypersphere / Hyperindex network

Hypercerts (Bumicerts) follow the same path: built locally, published to ATProto, and observations can be attached as evidence.

---

## 4. What is ATProto? (the short version)

**ATProto** (the AT Protocol) is the open network that Bluesky runs on. Think of it as "email for social data" — but for any kind of record, not just posts.

Three pieces matter for Pi-Tainá:

- **DID** — a permanent identifier for the community account (e.g. `did:plc:abc123...`). It doesn't change even if the handle does.
- **Handle** — the human-readable name (e.g. `taina-amazon.bsky.social`). Like a domain name pointing at the DID.
- **PDS (Personal Data Server)** — where the account's records live. Anyone can run one. Communities can use `bsky.social`, `gainforest.id`, or self-host.

Each community **owns** its account and its data. Records are signed by the account, so even if you copy them elsewhere, the signature proves where they came from. Other apps and indexers can read those records without asking permission — that is what makes the data genuinely open.

For Pi-Tainá this means: a community publishes once, and every other Tainá instance, GainForest tool, or third-party app can find and verify those observations.

---

## TL;DR

```
Telegram message
      │
      ▼
  Pi agent  ──►  Local draft  (data/drafts.db)         ← stays on device
      │              │
      │              ▼
      └──────►  ATProto publish  ──►  Hypersphere      ← public, permanent
                  (community / org account)
```

Local until the user says publish. Public the moment they do.
