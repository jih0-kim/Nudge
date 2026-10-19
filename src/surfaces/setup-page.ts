import type { SlackSetup } from '../services/slack-setup.js';

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

interface SetupPage {
  nonce: string;
  status?: ReturnType<SlackSetup['status']>;
  formToken?: string;
  publicUrl: string;
  error?: string;
}

/** Start a new navigation so CSP form-action does not block provider redirects. */
export function authorizationPage(nonce: string, redirectUrl: string) {
  const url = escapeHtml(redirectUrl);
  const scriptUrl = JSON.stringify(redirectUrl).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Continue to Slack · Nudge</title>
<style nonce="${nonce}">${setupStyles}</style></head><body><main>
<div class="brand"><span class="mark" aria-hidden="true">🌱</span> nudge</div>
<header><div class="eyebrow">Your personal habit coach</div><h1>One small step.<br>You’re almost there.</h1><p class="intro">We’re opening Composio so you can approve your Nudge Slack connection.</p></header>
<section class="card" aria-labelledby="continue-heading"><h2 id="continue-heading">Continue to Slack</h2><p role="status">Opening your secure connection…</p><p><a class="button" href="${url}" rel="noreferrer">Continue to Slack authorization →</a></p><p class="hint">If nothing opens automatically, use the link above. After approval, you’ll return to Nudge.</p><a class="button secondary" href="/setup">Back to setup</a></section>
<div class="footer">Memory stored in SQLite · Connections handled by Composio</div></main>
<script nonce="${nonce}">window.location.replace(${scriptUrl});</script></body></html>`;
}

/** Render useful HTML on the first request; no fetch, hydration or status polling. */
export function setupPage({ nonce, status, formToken, publicUrl, error }: SetupPage) {
  const notice = error || status?.error || (status?.appChanged ? 'Your Nudge Slack app is selected, but the saved connection belongs to the previous app. Connect Nudge below to finish switching.' : '') || (status && !status.aiConfigured
    ? 'Slack commands will work, but natural-language coaching needs an OpenAI key configured by the app operator.' : '');
  const csrf = `<input type="hidden" name="csrf" value="${escapeHtml(formToken || '')}">`;
  const action = status?.reconnectRequired ? 'reconnect' : status?.connected ? 'refresh' : 'connect';
  const button = status?.reconnectRequired ? 'Connect Nudge to Slack →' : status?.connected ? 'Update connection' : 'Connect Slack →';
  const deliveryForm = status?.canConfigureDelivery ? `<details id="slack-delivery"${!status.deliveryConfigured || notice ? ' open' : ''}><summary>${status.deliveryConfigured ? 'Update Slack credentials' : 'Connect message delivery'}</summary><p>Paste these two values once. No new OAuth approval is needed. Credentials stay private and are never sent to the AI.</p><form id="delivery-form" method="post" action="/setup/slack-delivery">${csrf}<label for="signing-secret">1. Signing Secret</label><p id="secret-help" class="hint">Slack app → Basic Information → App Credentials → Signing Secret. Click Show, then copy the value—not the Client Secret or a token.</p><input id="signing-secret" name="signingSecret" type="password" autocomplete="off" spellcheck="false" required maxlength="128" aria-describedby="secret-help"><label for="bot-token">2. Bot User OAuth Token</label><p id="bot-help" class="hint">Slack app → OAuth &amp; Permissions → Bot User OAuth Token. Paste the complete value. Slack will verify that it belongs to your bot.</p><input id="bot-token" name="botToken" type="password" autocomplete="off" spellcheck="false" required maxlength="4096" aria-describedby="bot-help"><div id="delivery-feedback" class="notice${notice ? '' : ' success'}" role="status" aria-live="polite" tabindex="-1"${notice ? '' : ' hidden'}>${escapeHtml(notice)}</div><p><button id="delivery-submit" type="submit">Save Slack connection</button></p></form></details>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect your coach · Nudge</title>
<style nonce="${nonce}">
${setupStyles}
</style></head><body><main>
<div class="brand"><span class="mark" aria-hidden="true">🌱</span> nudge</div>
<header><div class="eyebrow">Your personal habit coach</div><h1>${status?.ready ? 'See you in Slack.' : 'One workspace.\nEveryone welcome.'}</h1><p class="intro">Install once. Everyone can DM Nudge—with their own private memory and reminders.</p></header>
${notice ? `<div id="notice" class="notice" role="alert">${escapeHtml(notice)}</div>` : ''}
${!status ? `<section id="unlock" class="card"><h2>Install Nudge in Slack</h2><p>Open the private Slack setup link shared by your server operator. It signs you in automatically and shows the Connect Slack button.</p><p>This is an admin-only page. If you just want to chat, open Nudge in Slack—no key or signup needed.</p>
<details><summary>Operator: enter an admin key manually</summary><form id="unlock-form" method="post" action="/setup/session"><label for="setup-key">Admin key from the server startup link</label><input id="setup-key" name="token" type="password" autocomplete="off" required maxlength="256"><p class="hint">This protects workspace installation settings. It is not a Slack token or a personal-app connection key.</p><button type="submit">Continue to setup</button></form></details>
<noscript><p class="hint">You can enter the key from your private link manually—the characters after #token=.</p></noscript></section>` : `
<section id="dashboard" class="card"><h2>${status.ready ? 'Your bot is connected.' : status.connected ? 'Finish connecting Nudge' : 'Connect your workspace'}</h2>
<p>${status.ready ? 'Bot access verified. Send a fresh DM to confirm event delivery.' : status.pending ? 'Finish approval in Slack, then return here.' : 'Only the installer approves access. Everyone else just sends a DM.'}</p>
${deliveryForm}
<details${!status.ready ? ' open' : ''}><summary>Slack app event settings</summary><p>Keep Socket Mode off. In Event Subscriptions, enable events, set this Request URL, and subscribe to the bot event <strong>message.im</strong>:</p><p><code>${escapeHtml(publicUrl)}/webhooks/slack</code></p><p class="hint">Remove the old message.im subscription under user events, if present. Save Changes. Allow messages under App Home. This is a one-time app setting, not a step for each person. Bot permissions: chat:write and im:history.</p><p class="hint">Connection readiness verifies bot access only. A new DM confirms event delivery.</p></details>
${status.ready ? '<div id="ready-note" class="notice success">You’re connected. Open Slack, find the installed bot under Apps, and send “hi”. Each person gets their own private memory.</div><p><a class="button" href="https://app.slack.com" target="_blank" rel="noopener noreferrer">Open Slack ↗</a></p>' : ''}
${status.ready ? '<details><summary>Connection settings</summary>' : ''}<form id="connect-form" method="post" action="/setup/${action}">${csrf}<input type="hidden" name="publicUrl" value="${escapeHtml(publicUrl)}"><input type="hidden" name="consent" value="yes"><p class="hint">Composio manages workspace authorization and connected apps. Chat messages go directly between Slack and Nudge.</p><div class="actions"><button type="submit"${!status.composioConfigured || status.busy ? ' disabled' : ''}>${button}</button>${status.connected && action !== 'reconnect' ? `<button type="submit" class="secondary" formaction="/setup/reconnect"${!status.composioConfigured || status.busy ? ' disabled' : ''}>Reconnect Slack →</button>` : ''}</div></form>${status.ready ? '</details>' : ''}
${status.pending && !status.ready && !status.reconnectRequired ? `<form method="post" action="/setup/complete">${csrf}<p><button type="submit" class="secondary">I’ve approved Slack—finish setup</button></p></form>` : ''}
<p class="hint">Private memory is separated by workspace and Slack user. Reminder schedules are currently one-time.</p></section>`}
<div class="footer"><span>Memory stored in SQLite · Connections handled by Composio</span>${status ? `<form method="post" action="/setup/logout">${csrf}<button type="submit" class="quiet">Lock setup page</button></form>` : ''}</div>
</main>
${status?.canConfigureDelivery ? `<script nonce="${nonce}">
const deliveryForm = document.getElementById('delivery-form');
const secretInput = document.getElementById('signing-secret');
const botInput = document.getElementById('bot-token');
const feedback = document.getElementById('delivery-feedback');
const saveButton = document.getElementById('delivery-submit');
function showDeliveryFeedback(message, failed) {
  feedback.textContent = message;
  feedback.className = failed ? 'notice' : 'notice success';
  feedback.hidden = false;
  feedback.focus();
}
deliveryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const signingSecret = secretInput.value.trim();
  const botToken = botInput.value.trim();
  if (!/^[a-f0-9]{32,64}$/i.test(signingSecret)) {
    showDeliveryFeedback('Signing Secret: use Basic Information → App Credentials → Signing Secret. This is not a token or Client Secret.', true);
    secretInput.focus(); return;
  }
  if (!botToken || /\\s/.test(botToken)) {
    showDeliveryFeedback('Paste the complete Bot User OAuth Token from OAuth & Permissions, without spaces.', true);
    botInput.focus(); return;
  }
  if (saveButton.disabled) return;
  saveButton.disabled = true;
  saveButton.textContent = 'Checking Slack connection…';
  showDeliveryFeedback('Checking bot access and saving your connection…', false);
  try {
    const response = await fetch(deliveryForm.action, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ signingSecret, botToken, csrf: deliveryForm.elements.namedItem('csrf').value }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) {
      showDeliveryFeedback(result.error || 'Could not save. Your entries are still here; please retry.', true);
      return;
    }
    secretInput.value = ''; botInput.value = '';
    showDeliveryFeedback('Saved! Now click Retry beside the Request URL in Slack, wait for Verified, and Save Changes. Then send Nudge a new DM.', false);
    saveButton.textContent = 'Saved';
  } catch {
    showDeliveryFeedback('The connection check was interrupted. Your entries are still here. Click Save Slack connection to retry.', true);
  } finally {
    saveButton.disabled = false;
    if (saveButton.textContent !== 'Saved') saveButton.textContent = 'Save Slack connection';
  }
});
</script>` : ''}
${!status ? `<script nonce="${nonce}">
// Only exchange the private URL fragment. All page state and actions are server-rendered.
const token = new URLSearchParams(location.hash.slice(1)).get('token');
if (token) {
  history.replaceState(null, '', '/setup');
  document.getElementById('setup-key').value = token;
  document.getElementById('unlock-form').requestSubmit();
}
</script>` : ''}</body></html>`;
}

const setupStyles = `
:root{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#193f38;background:#f5f8f2;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;padding:40px 20px}main{max-width:760px;margin:auto}
.brand{display:flex;align-items:center;gap:10px;font-weight:750;letter-spacing:-.5px}
.mark{display:grid;place-items:center;background:#d9eccb;border-radius:16px;width:42px;height:42px;font-size:24px}
header{padding:48px 0 30px}.eyebrow{text-transform:uppercase;letter-spacing:2px;font-size:11px;font-weight:750;color:#58816a}
h1{font-size:clamp(35px,7vw,56px);line-height:1.08;letter-spacing:-2px;margin:16px 0}p{line-height:1.65;color:#64756a}.intro{max-width:540px;font-size:17px}
.card{background:#fff;border:1px solid #dfe7db;border-radius:22px;padding:30px;box-shadow:0 8px 35px #1b493506;margin:0 0 20px}h2{font-size:22px;margin:0 0 10px;letter-spacing:-.5px}
.steps{display:grid;gap:0;margin:22px 0}.step{display:flex;align-items:center;gap:14px;padding:15px 0;border-bottom:1px solid #edf0e9}.step:last-child{border:0}
.dot{display:grid;place-items:center;background:#f0f4ec;color:#6b7e68;width:30px;height:30px;border-radius:50%;font-size:13px;font-weight:700;flex-shrink:0}.step small{display:block;color:#7b897b;margin-top:4px}.done .dot{background:#e0efcf;color:#2c652c}
button,.button{background:#234f42;color:white;border:0;border-radius:11px;padding:14px 20px;font-size:15px;font-weight:650;cursor:pointer;text-decoration:none;display:inline-block}button:hover,.button:hover{background:#306752}button:disabled{opacity:.5;cursor:wait}.secondary{background:#edf2e7;color:#35513a}.secondary:hover{background:#e1e9da}
label{font-size:13px;font-weight:650;display:block;margin:22px 0 8px}input[type=text],input[type=password],input[type=url]{width:100%;padding:13px;border:1px solid #ced8c8;border-radius:10px;font:inherit;background:#fbfcf9}input:focus{outline:2px solid #9bbd8c;outline-offset:2px}.check{display:flex;align-items:flex-start;gap:8px;line-height:1.6;font-weight:400;margin:18px 0}.check input{margin-top:4px}
.hint{font-size:12px;color:#7b897b;margin:8px 0 20px}.notice{padding:14px 17px;border-radius:11px;background:#fff0e6;color:#8c4526;font-size:14px;line-height:1.6;margin:0 0 20px}.success{background:#e8f3dd;color:#3b6234}.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.footer{font-size:12px;color:#8a9788;margin-top:24px;display:flex;justify-content:space-between;gap:20px}.quiet{border:0;background:none;color:#74856d;font-size:12px;padding:0}.quiet:hover{background:none;color:#234f42}[hidden]{display:none!important}
@media(max-width:500px){body{padding:24px 16px}.card{padding:22px}header{padding:36px 0 24px}.footer{display:block}}
`;
