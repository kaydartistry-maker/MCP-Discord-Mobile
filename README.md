# Discord MCP for Mobile Claude

A lightweight MCP (Model Context Protocol) server for Discord that runs on Cloudflare Workers. Gives Claude access to Discord from anywhere — mobile, browser, any client that supports HTTP MCP endpoints.

## Why This Exists

The standard Discord MCP requires a local Node.js process running on your machine. This version runs entirely on Cloudflare Workers, so:

- Works from **mobile Claude** (iOS/Android app)
- Works from **any browser** with Claude
- No local process to keep running
- Free tier is plenty for personal use

## Features

- **Read messages** from any channel (with image vision — see attachments, embeds, and custom emotes)
- **Send messages** (with optional reply)
- **Search messages** across a server
- **Add reactions** to messages (supports custom server emojis)
- **Edit messages** previously sent by the bot
- **Delete messages** from channels
- **Typing indicator** — show "bot is typing..." in a channel
- **Send images** via URL embed with optional caption
- **List custom emojis** in a server (with usage format)
- **List and send stickers** from a server
- **Voice notes** — ElevenLabs TTS with native Discord voice message UI and waveform
- **List servers** the bot is in
- **Get server info** (channels, member count, etc.)

## Setup

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section, create a bot
4. Copy the bot token (you'll need this)
5. Enable these intents under "Privileged Gateway Intents":
   - Message Content Intent
6. Go to OAuth2 > URL Generator
   - Select `bot` scope
   - Select permissions: `Read Messages/View Channels`, `Send Messages`, `Manage Messages`, `Add Reactions`, `Read Message History`, `Attach Files`, `Use External Emojis`
7. Use the generated URL to invite the bot to your server

### 2. Deploy to Cloudflare Workers

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/MCP-Discord-Mobile.git
cd MCP-Discord-Mobile

# Install dependencies
npm install

# Login to Cloudflare (if not already)
npx wrangler login

# Set your secrets
npx wrangler secret put DISCORD_TOKEN
# (paste your bot token when prompted)

npx wrangler secret put MCP_SECRET
# (create a random string for auth - use something like a UUID)

# Optional: for voice notes
npx wrangler secret put ELEVENLABS_API_KEY
# (paste your ElevenLabs API key - needs text_to_speech permission)

# Deploy
npm run deploy
```

### 3. Add to Claude

In Claude's settings, add a new MCP connector:

```
https://YOUR_WORKER.workers.dev/mcp/YOUR_SECRET
```

Replace:
- `YOUR_WORKER` with your Cloudflare Worker subdomain
- `YOUR_SECRET` with the MCP_SECRET you set

## Available Tools

| Tool | Description |
|------|-------------|
| `discord_read_messages` | Read messages from a channel (resolves images, embeds, and custom emotes) |
| `discord_send` | Send a message (optionally as reply) |
| `discord_search_messages` | Search messages in a server |
| `discord_add_reaction` | React to a message (supports custom server emojis) |
| `discord_edit_message` | Edit a previously sent message |
| `discord_delete_message` | Delete a message from a channel |
| `discord_typing` | Show a typing indicator (~10 seconds) |
| `discord_send_image` | Send an image via URL embed with optional caption |
| `discord_list_emojis` | List all custom emojis in a server |
| `discord_list_stickers` | List all stickers in a server |
| `discord_send_sticker` | Send a sticker to a channel |
| `discord_send_voice` | Generate TTS voice note via ElevenLabs and send as native Discord voice message |
| `discord_list_servers` | List all servers the bot is in |
| `discord_get_server_info` | Get server details and channels |

## Security

- Authentication via URL path (secret in URL)
- CORS enabled for browser access
- Bot token stored as Cloudflare secret (not in code)
- Only you control who has the MCP URL

## Local Development

```bash
# Run locally
npm run dev

# View logs from deployed worker
npm run tail
```

## Voice Notes

The `discord_send_voice` tool uses ElevenLabs TTS to generate native Discord voice messages with waveform UI. Requires an ElevenLabs API key with `text_to_speech` permission.

The tool accepts a `voice` parameter to select between configured voices. Voice IDs are mapped in the `VOICE_MAP` constant in `src/index.ts`.

ElevenLabs returns OGG/Opus audio natively, which Discord accepts as voice messages — no transcoding or ffmpeg required.

## Technical Details

- Pure REST API — no discord.js dependency
- JSON-RPC 2.0 protocol (MCP standard)
- Cloudflare Workers runtime (V8 isolates)
- TypeScript
- Image vision via base64 MCP image blocks
- Native Discord voice messages via 3-step upload pipeline

## License

MIT
