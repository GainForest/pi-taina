# Pi-Tainá 🌿

A self-hosted Telegram bot for community biodiversity documentation, powered by Pi agent

---

## What is Pi-Tainá?

Pi-Tainá is a community biodiversity AI assistant that lives on Telegram. It helps communities document and monitor local wildlife by:

- **Identifying species** from photos using vision AI
- **Coaching on photo quality** with organism-specific tips to get better observations
- **Publishing Darwin Core occurrence records** to a community ATProto/Bluesky account as permanent, open data
- **Forest health reports** — tree cover loss, fire alerts, and deforestation alerts for any location, powered by Global Forest Watch
- **Hypercerts** — create impact certificates for conservation projects and link observations as verifiable evidence
- **Browse the network** — search and browse community biodiversity records and hypercerts on the Hypersphere
- **Answering questions** about local ecology, conservation, and biodiversity

Each community runs their own instance with their own personality, language, and local knowledge. Built on the Pi coding agent — communities can ask Tainá to build new capabilities for them.

Pi-Tainá is part of the [GainForest](https://gainforest.earth) network.

---

## Quick Start

**Prerequisites:** Node.js 20+, npm

1. Clone the repository:
   ```bash
   git clone https://github.com/gainforest/pi-taina.git
   cd pi-taina
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the example environment file and fill in your values:
   ```bash
   cp .env.example .env
   ```

4. Start the bot:
   ```bash
   npm start        # production
   npm run dev      # with hot-reload (watch mode)
   ```

5. Run the smoke test:
   ```bash
   npm run test:smoke
   ```

---

## Configuration

Copy `.env.example` to `.env` and set the following variables:

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | From @BotFather on Telegram |
| `GEMINI_API_KEY` | Yes | Google Gemini API key (used for agent and species ID). Get from [aistudio.google.com](https://aistudio.google.com/apikey) |
| `ATPROTO_HANDLE` | For publishing | Community ATProto/Bluesky handle (e.g. `taina-amazon.bsky.social`) |
| `ATPROTO_PASSWORD` | For publishing | App password for the ATProto account (not your main password) |
| `ATPROTO_SERVICE` | No | ATProto service URL (default: `https://bsky.social`). Change if your community runs its own PDS |
| `ANTHROPIC_API_KEY` | No | Enables Claude models as an alternative provider |
| `OPENAI_API_KEY` | No | Enables GPT models as an alternative provider |
| `PI_MODEL` | No | Override the default conversational model (format: `provider/model-id`, e.g. `google/gemini-2.5-flash`) |
| `SPECIES_ID_MODEL` | No | Override the model used for species identification. Must be a Gemini model ID (e.g. `gemini-2.5-flash`) |
| `PI_CODING_AGENT_DIR` | No | Override Pi config directory (default: `~/.pi/agent`) |
| `PI_CACHE_RETENTION` | No | Set to `long` for extended prompt cache retention |
| `PI_SKIP_VERSION_CHECK` | No | Set to `1` to skip Pi version check at startup |
| `GFW_DATA_API_KEY` | No | Global Forest Watch Data API key for forest monitoring features. Get free at [data-api.globalforestwatch.org](https://data-api.globalforestwatch.org) |

---

## Setting Up a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to choose a name and username
3. Copy the bot token BotFather gives you
4. Paste it as `TELEGRAM_BOT_TOKEN` in your `.env` file
5. Optional: use `/setdescription` and `/setuserpic` in BotFather to give your bot a description and profile photo

---

## Setting Up an ATProto Account

ATProto (Bluesky) is used to publish permanent, open biodiversity occurrence records.

1. Create a Bluesky account for your community (e.g. `taina-amazon.bsky.social`)
2. Go to **Settings → App Passwords → Add App Password**
3. Give it a name (e.g. `pi-taina`) and copy the generated password
4. Set `ATPROTO_HANDLE` to your community handle and `ATPROTO_PASSWORD` to the app password in your `.env`

> **Note:** Use an app password, not your main account password. App passwords can be revoked independently.

---

## Setting Up Global Forest Watch

GFW enables forest health reports with tree cover loss charts, fire alerts, and deforestation alerts for any location.

1. Get a free API key at [data-api.globalforestwatch.org](https://data-api.globalforestwatch.org)
2. Set `GFW_DATA_API_KEY` in your `.env`

---

## Access Control

Tainá uses a local whitelist to control who can interact with the bot. No external database needed.

### Setup

1. Get your Telegram user ID (message [@userinfobot](https://t.me/userinfobot) on Telegram)
2. Add it to your `.env`:
   ```
   ADMIN_USER_ID=123456789
   ```
3. Start the bot — you're automatically the admin

### Managing Members

From Telegram, admins can use these commands:

| Command | Description |
|---------|-------------|
| `/join` | Anyone can request to join |
| `/approve <id>` | Approve a pending request or add a user directly |
| `/remove <id>` | Remove a member (can't remove admins) |
| `/pending` | View pending join requests |
| `/members` | View all community members |

### How It Works

- The whitelist is stored locally in `data/whitelist.json`
- Admin users get full access including filesystem tools for skill building
- Regular members can use all biodiversity tools but cannot access the filesystem
- Unknown users are blocked and prompted to `/join`

---

## Skills

Skills are documents that teach Tainá how to use each tool. They live in `skills/` and are referenced by the agent at runtime. Each skill is self-contained and can be edited to customize behavior.

| Skill | Description |
|---|---|
| `species-identification/` | How to identify species from photos with Gemini vision |
| `publish-observation/` | How to publish a Darwin Core occurrence record to ATProto |
| `forest-monitoring/` | How to generate forest health reports from GFW data |
| `geocoding/` | How to convert place names to GPS coordinates |
| `hyperindex/` | How to query the Hypersphere network for records and hypercerts |
| `hypercerts/` | How to create hypercerts and attach observations as evidence |

Tainá can also **build new skills on demand** — if a community member asks for something Tainá can't do yet, she can write and save a new skill in the `./skills/` directory.

---

## Hypercerts

Hypercerts are impact certificates that let communities document conservation and reforestation work as verifiable, on-chain records.

**What you can do:**
- Create a hypercert for a project or initiative (with title, description, location, dates, work scope)
- Attach community biodiversity observations as evidence to back up the claim
- Browse existing hypercerts on the Hypersphere network

Tainá handles the hypercert creation wizard proactively, asking for missing fields like contributor names and location before publishing.

---

## Customizing for Your Community

Pi-Tainá is designed to be adapted for each community:

- **Edit `AGENTS.md`** to customize Tainá's personality, language, local species knowledge, and behavior
- **Add skills** in the `./skills/` directory — each skill is a file that extends what Tainá can do
- **Ask Tainá to build skills herself** — she can write and save new capabilities when community members request them

Examples of customizations:
- Change the language Tainá responds in by default
- Add local species names and traditional ecological knowledge
- Create skills for specific workflows your community needs

---

## How It Works

```
Telegram message → Pi agent → AI response
       ↓
   Photo sent → Species identification (Gemini vision)
                → Photo quality coaching
                → Offer to publish observation
                       ↓
               User confirms → Geocode location
                             → Publish to ATProto PDS as Darwin Core record
                             → Optionally create a hypercert

Voice note → Transcribed → Treated as text message

Location shared → Forest health report (GFW)
                → Tree cover loss chart + GFW map link

"Create a hypercert" → Hypercert creation wizard
                     → Attach community observations as evidence

"Search hyperindex" → Browse community records on the Hypersphere
```

- **Telegram**: grammY library handles incoming messages, photos, voice notes, and locations
- **Agent**: Pi coding agent manages conversation context and tool use
- **Species ID**: Google Gemini vision model analyzes photos
- **Publishing**: Darwin Core occurrence records posted to ATProto PDS
- **Forest monitoring**: GFW Data API — tree cover, fire alerts, deforestation alerts
- **Hypercerts**: org.hypercerts.claim.activity records on ATProto + Hypersphere network
- **Groups**: Tainá responds when @mentioned, or when photos/locations/voice are sent
- **DMs**: Tainá always responds to all messages

---

## Running as a Service (Mac Mini Deployment)

For always-on deployment on a Mac Mini, use [pm2](https://pm2.keymetrics.io/):

1. Install pm2 globally:
   ```bash
   npm install -g pm2
   ```

2. Start Pi-Tainá with pm2:
   ```bash
   pm2 start npm --name taina -- start
   ```

3. Enable auto-restart on crash and auto-start on boot:
   ```bash
   pm2 startup
   pm2 save
   ```

4. Useful pm2 commands:
   ```bash
   pm2 status          # Check if taina is running
   pm2 logs taina      # View recent logs
   pm2 restart taina   # Restart the bot
   pm2 stop taina      # Stop the bot
   ```

---

## Project Structure

```
pi-taina/
├── src/
│   ├── index.ts              # Bot entry point, startup sequence
│   ├── agent.ts              # Pi agent session management and custom tools
│   ├── telegram.ts           # Telegram bot transport (grammY)
│   ├── atproto.ts            # ATProto community account client
│   ├── env.ts                # Environment variable loader
│   ├── hyperindex.ts         # Hyperindex GraphQL client (org context)
│   └── tools/
│       ├── identify-species.ts    # Species ID via Gemini vision
│       ├── publish-occurrence.ts  # Darwin Core → ATProto
│       ├── geocode-location.ts    # Place name → GPS coordinates
│       ├── gfw-api.ts             # GFW Data API (tree cover, fire, deforestation)
│       ├── gfw-chart.ts           # Tree cover loss chart image generator
│       ├── transcribe-voice.ts    # Voice note → text (Gemini)
│       ├── query-hyperindex.ts    # Search Hypersphere network
│       ├── create-hypercert.ts     # Create hypercert records
│       └── attach-observations.ts # Link observations to hypercerts
├── skills/                   # Agent skills (one subdirectory per skill)
│   ├── species-identification/
│   ├── publish-observation/
│   ├── forest-monitoring/
│   ├── geocoding/
│   ├── hyperindex/
│   └── hypercerts/
├── data/sessions/            # Per-user agent session state (gitignored)
├── .env.example              # Environment variable template
└── package.json
```

---

## License

MIT
