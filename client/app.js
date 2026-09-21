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
function setupPasswordHistory() {
  if (!state.isHost || document.getElementById('savedPasswordsPanel')) {
    return;
  }

  const panel = document.createElement('div');
  panel.id = 'savedPasswordsPanel';
  panel.style.marginTop = '18px';
  panel.style.padding = '14px';
  panel.style.border = '1px solid #39ff14';
  panel.style.borderRadius = '10px';
  panel.style.background = 'rgba(0, 0, 0, 0.55)';

  const title = document.createElement('div');
  title.textContent = 'SAVED PASSWORDS';
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '10px';

  const list = document.createElement('div');
  list.id = 'passwordHistory';
  list.textContent = 'Loading saved passwords...';

  panel.appendChild(title);
  panel.appendChild(list);
  hostPanel.appendChild(panel);

  loadPasswordHistory();
}

async function loadPasswordHistory() {
  const list = document.getElementById('passwordHistory');
  if (!list) return;

  list.textContent = 'Loading saved passwords...';

  try {
    const response = await fetch('/api/passwords');

    if (!response.ok) {
      throw new Error('Failed to load saved passwords.');
    }

    const passwords = await response.json();

    list.innerHTML = '';

    if (!passwords.length) {
      list.textContent = 'No saved passwords yet.';
      return;
    }

    passwords.forEach((item, index) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '10px';
      row.style.marginBottom = '8px';

      const text = document.createElement('div');
      text.style.flex = '1';
      text.style.wordBreak = 'break-word';

      const password = document.createElement('div');
      password.textContent = item.password;

      const date = document.createElement('small');
      date.textContent = new Date(item.created_at).toLocaleString();

      text.appendChild(password);
      text.appendChild(date);

      row.appendChild(text);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = index === 0 ? 'CURRENT' : 'DELETE';
      deleteBtn.disabled = index === 0;

      deleteBtn.addEventListener('click', async () => {
        if (!confirm('Delete this saved password?')) return;

        deleteBtn.disabled = true;

        try {
          const deleteResponse = await fetch(
            `/api/passwords/${encodeURIComponent(item.id)}`,
            { method: 'DELETE' }
          );

          if (!deleteResponse.ok) {
            throw new Error('Delete failed.');
          }

          await loadPasswordHistory();
        } catch (error) {
          console.error(error);
          deleteBtn.disabled = false;
          alert('Failed to delete the password.');
        }
      });

      row.appendChild(deleteBtn);
      list.appendChild(row);
    });
  } catch (error) {
    console.error(error);
    list.textContent = 'Unable to load saved passwords.';
  }
}
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
  setStatus('Connecting to Discord...');

  await discordSdk.ready();

  state.instanceId = discordSdk.instanceId;

  const { code } = await discordSdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });

  const tokenResponse = await fetch('/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });

  if (!tokenResponse.ok) {
    throw new Error('Failed to exchange Discord authorization code.');
  }

  const tokenData = await tokenResponse.json();

  state.auth = await discordSdk.commands.authenticate({
    access_token: tokenData.access_token,
  });

  const meResponse = await fetch('/api/me', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  if (!meResponse.ok) {
    throw new Error('Failed to load user information.');
  }

  const me = await meResponse.json();

  state.isHost = !!me.isHost;
hostPanel.hidden = !state.isHost;

if (state.isHost) {
  setupPasswordHistory();
}

  renderChallenge();
  connectSocket();
}

function connectSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl =
    `${protocol}//${window.location.host}/ws?instance=` +
    encodeURIComponent(state.instanceId);

  state.socket = new WebSocket(wsUrl);

  state.socket.addEventListener('open', () => {
    send({ type: 'sync' });
  });

  state.socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'state') {
      state.challenge = msg.challenge || '';
      renderChallenge();
    }
  });

  state.socket.addEventListener('close', () => {
    setStatus('Disconnected from the server. Please reopen the Activity.');
  });

  state.socket.addEventListener('error', () => {
    setStatus('Connection error.');
  });
}

function send(message) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(message));
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

  send({
    type: 'reset',
  });
});

copyBtn.addEventListener('click', async () => {
  if (!state.challenge) return;

  let copied = false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(state.challenge);
      copied = true;
    }
  } catch {}

  if (!copied) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = state.challenge;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);

      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);

      copied = document.execCommand('copy');
      textarea.remove();
    } catch {}
  }

  copyBtn.textContent = copied ? 'COPIED!' : 'COPY FAILED';

  setTimeout(() => {
    copyBtn.textContent = 'COPY PASSWORD';
  }, 1100);
});

setupDiscord().catch((error) => {
  console.error(error);
  setStatus('Failed to connect to Discord.');
});
