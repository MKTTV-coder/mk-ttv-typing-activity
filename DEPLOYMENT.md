# Deployment checklist

Discord Activities are web apps embedded in Discord through the Embedded App SDK. Discord's documentation says an app must have a URL Mapping before Activity functionality can be enabled.

## Discord Developer Portal

- Create an application.
- Copy its Application ID into `VITE_DISCORD_CLIENT_ID` and `DISCORD_CLIENT_ID`.
- Copy its client secret into `DISCORD_CLIENT_SECRET` (server only).
- Enable Activities.
- Add a URL Mapping pointing `/` to the public HTTPS origin of this app.
- For testing, use Discord's private Activity/test mode.

## Host identity

Set `HOST_DISCORD_USER_ID` to your own Discord user ID. The server checks the authenticated Discord account before accepting host commands.

## Production

Use HTTPS and WebSockets. Put the Node server behind a reverse proxy if necessary. Never commit `.env` or expose `DISCORD_CLIENT_SECRET` to the client.
