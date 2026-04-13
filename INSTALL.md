# Pi-Tainá Install Guide

Quick path for a first setup.

## Prerequisites

- Node.js 20+
- npm
- Python 3
- On Raspberry Pi: 64-bit Raspberry Pi OS (`aarch64`)

## 1) Clone and install

```bash
git clone https://github.com/gainforest/pi-taina.git
cd pi-taina
./setup.sh
```

The setup script installs dependencies, checks your environment, and creates `.env` from `.env.example` if needed.

## 2) Set your environment

Open `.env` and set the required values. If you need to create it manually:

```bash
cp .env.example .env
```

Required values:

- `TELEGRAM_BOT_TOKEN`
- `GEMINI_API_KEY`
- `ADMIN_USER_ID`

For observation publishing, also set:

- `ATPROTO_HANDLE`
- `ATPROTO_PASSWORD`

Optional features:

- `GFW_DATA_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`

## 3) Verify the install

```bash
npm run test:install
```

## 4) Start the bot

```bash
npm start
```

For development with reload:

```bash
npm run dev
```

Smoke test:

```bash
npm run test:smoke
```

## Need the deeper guide?

- ATProto publishing: [README.md#setting-up-an-atproto-account](README.md#setting-up-an-atproto-account)
- Global Forest Watch: [README.md#setting-up-global-forest-watch](README.md#setting-up-global-forest-watch)
- Raspberry Pi swap and service setup: [README.md#raspberry-pi-deployment](README.md#raspberry-pi-deployment)
- Running as a service: [README.md#running-as-a-service](README.md#running-as-a-service)
