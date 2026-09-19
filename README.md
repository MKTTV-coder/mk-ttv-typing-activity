# MK TTV Neon Green Discord Typing Activity

This turns the uploaded neon-green typing page into a Discord Activity using Discord's Embedded App SDK.

## What it does

- Opens inside Discord as an Activity.
- Uses the original neon/gothic artwork and visual styling.
- Authenticates users through Discord.
- Creates one shared typing session per Discord Activity instance.
- Only the Discord user ID in `HOST_DISCORD_USER_ID` can post/change the password and start/reset a test.
- Everyone else gets a read-only password prompt and a separate typing box.
- The host receives participant WPM/accuracy/error results.

## Important security detail

Do NOT put your Discord client secret in the browser. It belongs only in the server environment variables.

## Setup

1. Create a Discord application in the Discord Developer Portal.
2. Enable Activities for the application and configure the Activity URL Mapping to your deployed HTTPS site. Discord requires a URL Mapping before Activities can be enabled.
3. Install dependencies:

   npm install

4. Copy `.env.example` to `.env` and fill in:
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `HOST_DISCORD_USER_ID`
   - `SESSION_SECRET`
5. Build the client:

   npm run build

6. Start the server:

   npm start

For local Activity testing, use Discord's Activity test mode and a suitable HTTPS/local tunnel setup. The final Activity URL must be HTTPS and configured in Discord's Developer Portal.

## Finding your Discord User ID

In Discord, enable Developer Mode in User Settings > Advanced. Then right-click your own profile and choose Copy User ID. Put that ID into `HOST_DISCORD_USER_ID`.

## Deploying

The project expects a Node 20+ server with WebSocket support. Your host needs to provide HTTPS and WebSocket forwarding. Set the environment variables in the host's dashboard rather than committing `.env` to Git.
