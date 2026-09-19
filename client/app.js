import { DiscordSDK } from '@discord/embedded-app-sdk';

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
const discordSdk = new DiscordSDK(clientId);

const state = {
  auth: null,
  instanceId: null,
  challenge: '',
  running: false,
  startedAt: null,
  isHost: false,
  socket: null,
};

const $ = (id) => document.getElementById(id);
const statusText = $('statusText');
const hostPanel = $('hostPanel');
const hostText = $('hostText');
const postBtn = $('postBtn');
const startBtn = $('startBtn');
const resetBtn = $('resetBtn');
const challengeText = $('challengeText');
const typingBox = $('typingBox');
const clearBtn = $('clearBtn');
const copyBtn = $('copyBtn');
const counter = $('counter');
const results = $('results');

function setStatus(text) { statusText.textContent = text; }
function updateCounter() {
  const n = typingBox.value.length;
  counter.textContent = `${n} ${n === 1 ? 'character' : 'characters'}`;
}

function showResult(result) {
  results.hidden = false;
  results.textContent = `Finished — ${result.wpm} WPM • ${result.accuracy}% accuracy • ${result.errors} errors`;
}

function renderChallenge() {
  challengeText.textContent = state.challenge || 'Waiting for the host to post a password…';
  if (state.running && state.challenge) {
    typingBox.disabled = false;
    typingBox.placeholder = 'Type the password exactly as shown above…';
    typingBox.focus();
    setStatus('TEST LIVE — type the password as fast and accurately as you can.');
  } else {
    typingBox.disabled = true;
    typingBox.placeholder = state.challenge ? 'Waiting for the host to start…' : 'The host has not posted a password yet…';
  }
  startBtn.disabled = !state.challenge;
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
  if (!response.ok) throw new Error('Discord login failed');
  const { access_token } = await response.json();

  state.auth = await discordSdk.commands.authenticate({ access_token });
  if (!state.auth?.user?.id) throw new Error('Discord authentication failed');

  const me = await fetch('/api/me').then(r => r.json());
  state.isHost = !!me.isHost;
  hostPanel.hidden = !state.isHost;

  setStatus(state.isHost ? 'HOST MODE — only you can post/change the password.' : `Connected as ${state.auth.user.global_name || state.auth.user.username}.`);
  connectSocket();
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws?instance=${encodeURIComponent(state.instanceId)}`;
  state.socket = new WebSocket(url);

  state.socket.addEventListener('open', () => {
    state.socket.send(JSON.stringify({ type: 'sync' }));
  });
  state.socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'state') {
      state.challenge = msg.challenge || '';
      state.running = !!msg.running;
      state.startedAt = msg.startedAt || null;
      if (!state.isHost) hostText.value = '';
      renderChallenge();
    }
    if (msg.type === 'result' && state.isHost) {
      // Host receives participant result notifications.
      const r = msg.result;
      const row = document.createElement('div');
      row.textContent = `${r.username}: ${r.wpm} WPM • ${r.accuracy}% • ${r.errors} errors`;
      results.hidden = false;
      results.appendChild(row);
    }
  });
  state.socket.addEventListener('close', () => setStatus('Connection lost — reconnecting…'));
  state.socket.addEventListener('error', () => setStatus('Connection error.'));
}

function send(msg) {
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(msg));
}

postBtn.addEventListener('click', () => {
  if (!state.isHost) return;
  const text = hostText.value.trim();
  if (!text) return;
  send({ type: 'setChallenge', challenge: text });
});

startBtn.addEventListener('click', () => {
  if (!state.isHost || !state.challenge) return;
  send({ type: 'start' });
});

resetBtn.addEventListener('click', () => {
  if (!state.isHost) return;
  send({ type: 'reset' });
});

clearBtn.addEventListener('click', () => {
  typingBox.value = '';
  results.hidden = true;
  updateCounter();
  if (!typingBox.disabled) typingBox.focus();
});

copyBtn.addEventListener('click', async () => {
  if (!state.challenge) return;
  try { await navigator.clipboard.writeText(state.challenge); } catch {}
  copyBtn.textContent = 'COPIED!';
  setTimeout(() => copyBtn.textContent = 'COPY PASSWORD', 1100);
});

typingBox.addEventListener('input', updateCounter);
typingBox.addEventListener('input', () => {
  if (!state.running || !state.challenge) return;
  if (typingBox.value.length >= state.challenge.length) finishTest();
});

function finishTest() {
  const elapsed = Math.max((Date.now() - state.startedAt) / 1000, 0.01);
  const typed = typingBox.value;
  let errors = Math.abs(typed.length - state.challenge.length);
  const min = Math.min(typed.length, state.challenge.length);
  for (let i = 0; i < min; i++) if (typed[i] !== state.challenge[i]) errors++;
  const correctChars = Math.max(state.challenge.length - errors, 0);
  const wpm = Math.max(0, Math.round((correctChars / 5) / (elapsed / 60)));
  const accuracy = Math.max(0, Math.round((correctChars / Math.max(state.challenge.length, 1)) * 100));
  showResult({ wpm, accuracy, errors });
  send({ type: 'result', result: { wpm, accuracy, errors } });
  typingBox.disabled = true;
}

updateCounter();
setupDiscord().catch(err => {
  console.error(err);
  setStatus(`Activity setup failed: ${err.message}`);
});
