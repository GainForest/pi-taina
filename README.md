# Pi-Tainá 🌿

A self-hosted Telegram bot for community biodiversity documentation, powered by Pi agent

---

## What is Pi-Tainá?

Pi-Tainá is a community biodiversity AI assistant that lives on Telegram. It helps communities document and monitor local wildlife by:

- **Identifying species** from photos using vision AI
- **Coaching on photo quality** with organism-specific tips to get better observations
- **Publishing Darwin Core occurrence records** to a community ATProto/Bluesky account as permanent, open data
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
   npm start
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
```

- **Telegram**: grammY library handles incoming messages and media
- **Agent**: Pi coding agent manages conversation context and tool use
- **Species ID**: Google Gemini vision model analyzes photos
- **Publishing**: Darwin Core occurrence records posted to ATProto PDS
- **Groups**: Tainá responds when @mentioned or when photos are sent
- **DMs**: Tainá always responds

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

## License

MIT
