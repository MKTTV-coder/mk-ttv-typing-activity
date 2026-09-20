import express from 'express';
import http from 'http';
import crypto from 'crypto';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  InteractionType,
  InteractionResponseType,
  verifyKeyMiddleware,
} from 'discord-interactions';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = Number(process.env.PORT || 8787);
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const HOST_USER_ID = process.env.HOST_DISCORD_USER_ID || '';
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || '';
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const sessions = new Map(); // session -> user
const instances = new Map(); // Discord activity instance -> state + sockets
async function registerPasswordCommand() {
  if (!CLIENT_ID || !DISCORD_GUILD_ID || !DISCORD_BOT_TOKEN) {
    console.warn(
      'Discord command registration skipped: missing environment variables.'
    );
    return;
  }

  const baseUrl =
    `https://discord.com/api/v10/applications/${CLIENT_ID}` +
    `/guilds/${DISCORD_GUILD_ID}/commands`;

  const headers = {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const listResponse = await fetch(baseUrl, {
    method: 'GET',
    headers,
  });

  if (!listResponse.ok) {
    const errorText = await listResponse.text();
    console.error(
      `Failed to check Discord commands (${listResponse.status}):`,
      errorText
    );
    return;
  }

  const commands = await listResponse.json();

  const existingCommand = commands.find(
    (command) => command.name === 'password' && command.type === 1
  );

  const commandData = {
    name: 'password',
    type: 1,
    description: 'Open the password Activity',
  };

  let response;

  if (existingCommand) {
    response = await fetch(`${baseUrl}/${existingCommand.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(commandData),
    });
  } else {
    response = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(commandData),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `Failed to register /password (${response.status}):`,
      errorText
    );
    return;
  }

  const command = await response.json();

  console.log(`Discord /password command ready: ${command.id}`);
}

  const url =
    `https://discord.com/api/v10/applications/${CLIENT_ID}` +
    `/guilds/${DISCORD_GUILD_ID}/commands`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'password',
      type: 1,
      description: 'Open the password Activity',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `Failed to register /password (${response.status}):`,
      errorText
    );
    return;
  }

  const command = await response.json();
  console.log(`Registered /password command: ${command.id}`);
}
app.post(
  '/api/discord/interactions',
  verifyKeyMiddleware(DISCORD_PUBLIC_KEY),
  (req, res) => {
    const interaction = req.body;

    if (
      interaction.type === InteractionType.APPLICATION_COMMAND &&
      interaction.data?.name === 'password'
    ) {
      return res.json({
        type: InteractionResponseType.LAUNCH_ACTIVITY,
      });
    }

    return res.status(400).json({
      error: 'Unknown interaction',
    });
  }
);
app.use(express.json({ limit: '16kb' }));

function cookieValue(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function signSession(token) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, user);
  return `${token}.${signSession(token)}`;
}

function getUserFromRequest(req) {
  const raw = cookieValue(req.headers.cookie, 'mk_session');
  if (!raw) return null;
  const [token, sig] = raw.split('.');
  if (!token || !sig) return null;
  const expected = signSession(token);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return sessions.get(token) || null;
}

function authRequired(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

app.post('/api/token', async (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).json({ error: 'Discord credentials are not configured on the server.' });
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Missing OAuth code.' });

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: 'https://127.0.0.1/callback'
  });

  // The Embedded App SDK starter flow exchanges the authorization code on the server.
  // Discord's Activity URL mapping normally proxies /api to this service; the redirect URI
  // is not used by the Activity browser itself after the SDK hands us the code.
  const tokenResp = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const token = await tokenResp.json();
  if (!tokenResp.ok) return res.status(400).json({ error: token.error_description || 'Discord token exchange failed.' });

  const userResp = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  const user = await userResp.json();
  if (!userResp.ok) return res.status(400).json({ error: 'Could not read Discord user.' });

  const sessionCookie = createSession({
    id: user.id,
    username: user.username,
    global_name: user.global_name || user.username,
  });
  res.setHeader('Set-Cookie', `mk_session=${encodeURIComponent(sessionCookie)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=86400`);
  res.json({ access_token: token.access_token });
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({
    user: req.user,
    isHost: req.user.id === HOST_USER_ID,
  });
});

function getState(instanceId) {
  if (!instances.has(instanceId)) {
    instances.set(instanceId, { challenge: '', running: false, startedAt: null, clients: new Set() });
  }
  return instances.get(instanceId);
}

function broadcast(instanceId, payload) {
  const state = getState(instanceId);
  const data = JSON.stringify(payload);
  for (const ws of state.clients) if (ws.readyState === 1) ws.send(data);
}

function publicState(state) {
  return { type: 'state', challenge: state.challenge, running: state.running, startedAt: state.startedAt };
}

wss.on('connection', (ws, req) => {
  const user = getUserFromRequest(req);
  const url = new URL(req.url, 'http://localhost');
  const instanceId = url.searchParams.get('instance');
  if (!user || !instanceId) return ws.close(1008, 'Unauthorized');

  const state = getState(instanceId);
  ws.user = user;
  ws.instanceId = instanceId;
  state.clients.add(ws);
  ws.send(JSON.stringify(publicState(state)));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const current = getState(instanceId);

    if (msg.type === 'sync') {
      ws.send(JSON.stringify(publicState(current)));
      return;
    }

    const isHost = user.id === HOST_USER_ID;
    if (msg.type === 'setChallenge') {
      if (!isHost) return;
      const challenge = String(msg.challenge || '').trim().slice(0, 5000);
      if (!challenge) return;
      current.challenge = challenge;
      current.running = false;
      current.startedAt = null;
      broadcast(instanceId, publicState(current));
      return;
    }

    if (msg.type === 'start') {
      if (!isHost || !current.challenge) return;
      current.running = true;
      current.startedAt = Date.now();
      broadcast(instanceId, publicState(current));
      return;
    }

    if (msg.type === 'reset') {
      if (!isHost) return;
      current.challenge = '';
      current.running = false;
      current.startedAt = null;
      broadcast(instanceId, publicState(current));
      return;
    }

    if (msg.type === 'result') {
      // Results are accepted only from authenticated participants. They are sent to the host,
      // not treated as a command that can change the shared challenge.
      const result = msg.result || {};
      const clean = {
        username: user.global_name || user.username,
        wpm: Number(result.wpm) || 0,
        accuracy: Number(result.accuracy) || 0,
        errors: Number(result.errors) || 0,
      };
      for (const client of current.clients) {
        if (client.readyState === 1 && client.user?.id === HOST_USER_ID) {
          client.send(JSON.stringify({ type: 'result', result: clean }));
        }
      }
    }
  });

  ws.on('close', () => state.clients.delete(ws));
});

// In production, serve the Vite build from ../dist.
const dist = path.resolve(__dirname, '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

server.listen(PORT, () => {
  console.log(`MK TTV Discord Activity server listening on ${PORT}`);

  if (!HOST_USER_ID) {
    console.warn(
      'WARNING: HOST_DISCORD_USER_ID is not set; nobody can use host controls.'
    );
  }

  registerPasswordCommand().catch((error) => {
    console.error('Discord command registration failed:', error);
  });
});
