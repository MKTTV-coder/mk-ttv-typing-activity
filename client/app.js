import { DiscordSDK } from '@discord/embedded-app-sdk';

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
const discordSdk = new DiscordSDK(clientId);

const state = {
  auth: null,
  instanceId: null,
  challenge: '',
  isHost: false,
  socket: null,
};

const $ = (id) => document.getElementById(id);

const statusText = $('statusText');
const hostPanel = $('hostPanel');
const hostText = $('hostText');
const postBtn = $('postBtn');
const resetBtn = $('resetBtn');
const challengeText = $('challengeText');
const copyBtn = $('copyBtn');

function setStatus(message) {
  statusText.textContent = message;
}

function renderChallenge() {
  challengeText.textContent =
    state.challenge || 'Waiting for the host to post a password...';

  if (state.challenge) {
    setStatus('PASSWORD POSTED — click COPY PASSWORD to copy it.');
  } else if (state.isHost) {
    setStatus('HOST MODE — enter a password and click POST PASSWORD.');
  } else {
    setStatus('Waiting for the host to post a password.');
  }
}

async function setupDiscord() {
  await discordSdk.ready();

  state.instanceId = discordSdk.instanceId;

  const { code } = await discordSdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });

  const response = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    throw new Error('Discord login failed');
  }

  const { access_token } = await response.json();

  state.auth = await discordSdk.commands.authenticate({
    access_token,
  });

  if (!state.auth?.user?.id) {
    throw new Error('Discord authentication failed');
  }

  const me = await fetch('/api/me').then((r) => r.json());

  state.isHost = !!me.isHost;
  hostPanel.hidden = !state.isHost;

  renderChallenge();
  connectSocket();
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url =
    `${protocol}//${location.host}/ws?instance=` +
    encodeURIComponent(state.instanceId);

  state.socket = new WebSocket(url);

  state.socket.addEventListener('open', () => {
    state.socket.send(JSON.stringify({ type: 'sync' }));
  });

  state.socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'state') {
      state.challenge = msg.challenge || '';
      renderChallenge();
    }
  });

  state.socket.addEventListener('close', () => {
    setStatus('Connection lost — reconnecting...');
  });

  state.socket.addEventListener('error', () => {
    setStatus('Connection error.');
  });
}

function send(msg) {
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(msg));
  }
}

postBtn.addEventListener('click', () => {
  if (!state.isHost) return;

  const text = hostText.value.trim();

  if (!text) return;

  send({
    type: 'setChallenge',
    challenge: text,
  });
});

resetBtn.addEventListener('click', () => {
  if (!state.isHost) return;

  send({ type: 'reset' });
});

copyBtn.addEventListener('click', async () => {
  if (!state.challenge) return;

  try {
    await navigator.clipboard.writeText(state.challenge);
  } catch {}

  copyBtn.textContent = 'COPIED!';

  setTimeout(() => {
    copyBtn.textContent = 'COPY PASSWORD';
  }, 1100);
});

setupDiscord().catch((err) => {
  console.error(err);
  setStatus(`Activity setup failed: ${err.message}`);
});
