/** Static UI: provider data and errors are rendered with textContent, never HTML. */
export function setupPage(nonce: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect your coach · Nudge</title>
<style nonce="${nonce}">
:root{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#193f38;background:#f5f8f2;font-synthesis:none}*{box-sizing:border-box}body{margin:0;padding:40px 20px}main{max-width:760px;margin:auto}.brand{display:flex;align-items:center;gap:10px;font-weight:750;letter-spacing:-.5px}.mark{display:grid;place-items:center;background:#d9eccb;border-radius:16px;width:42px;height:42px;font-size:24px}header{padding:48px 0 30px}.eyebrow{text-transform:uppercase;letter-spacing:2px;font-size:11px;font-weight:750;color:#58816a}h1{font-size:clamp(35px,7vw,56px);line-height:1.08;letter-spacing:-2px;margin:16px 0}p{line-height:1.65;color:#64756a}.intro{max-width:540px;font-size:17px}.card{background:#fff;border:1px solid #dfe7db;border-radius:22px;padding:30px;box-shadow:0 8px 35px #1b493506;margin:0 0 20px}h2{font-size:22px;margin:0 0 10px;letter-spacing:-.5px}.steps{display:grid;gap:0;margin:22px 0}.step{display:flex;align-items:center;gap:14px;padding:15px 0;border-bottom:1px solid #edf0e9}.step:last-child{border:0}.dot{display:grid;place-items:center;background:#f0f4ec;color:#6b7e68;width:30px;height:30px;border-radius:50%;font-size:13px;font-weight:700;flex-shrink:0}.step small{display:block;color:#7b897b;margin-top:4px}.done .dot{background:#e0efcf;color:#2c652c}button,.button{background:#234f42;color:white;border:0;border-radius:11px;padding:14px 20px;font-size:15px;font-weight:650;cursor:pointer;text-decoration:none;display:inline-block}button:hover,.button:hover{background:#306752}button:disabled{opacity:.5;cursor:wait}.secondary{background:#edf2e7;color:#35513a}.secondary:hover{background:#e1e9da}label{font-size:13px;font-weight:650;display:block;margin:22px 0 8px}input[type=text],input[type=password],input[type=url]{width:100%;padding:13px;border:1px solid #ced8c8;border-radius:10px;font:inherit;background:#fbfcf9}input:focus{outline:2px solid #9bbd8c;outline-offset:2px}.check{display:flex;align-items:flex-start;gap:8px;line-height:1.6;font-weight:400;margin:18px 0}.check input{margin-top:4px}.hint{font-size:12px;color:#7b897b;margin:8px 0 20px}.notice{padding:14px 17px;border-radius:11px;background:#fff0e6;color:#8c4526;font-size:14px;line-height:1.6;margin:0 0 20px}.success{background:#e8f3dd;color:#3b6234}.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.footer{font-size:12px;color:#8a9788;margin-top:24px;display:flex;justify-content:space-between;gap:20px}.quiet{border:0;background:none;color:#74856d;font-size:12px;padding:0}.quiet:hover{background:none;color:#234f42}[hidden]{display:none!important}@media(max-width:500px){body{padding:24px 16px}.card{padding:22px}header{padding:36px 0 24px}.footer{display:block}}
</style></head><body><main>
<div class="brand"><span class="mark" aria-hidden="true">🌱</span> nudge</div>
<header><div class="eyebrow">Your personal habit coach</div><h1>Small habits.<br>A little help.</h1><p class="intro">A thoughtful nudge, right where you already chat. Connect Slack once—then everyone can simply message the coach.</p></header>
<div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
<section id="loading" class="card"><p>Checking your setup…</p></section>
<section id="unlock" class="card" hidden><h2>A private space to get started</h2><p>This page is for the person installing Nudge. Open your private setup link, or enter the setup key from the server startup message.</p><form id="unlock-form"><label for="setup-key">Setup key</label><input id="setup-key" type="password" autocomplete="off" required maxlength="256"><p class="hint">Slack users never need this key, an account, or a separate signup.</p><button type="submit">Continue to setup</button></form></section>
<section id="dashboard" class="card" hidden><h2 id="heading">Make room for better habits</h2><p id="description">One Slack approval. We’ll take care of the connection and message delivery.</p>
<div class="steps"><div class="step" id="step-server"><span class="dot">1</span><div>App connection<small id="server-caption">Checking Composio configuration</small></div></div><div class="step" id="step-slack"><span class="dot">2</span><div>Slack workspace<small id="slack-caption">Waiting for your approval</small></div></div><div class="step" id="step-delivery"><span class="dot">3</span><div>Reminders & replies<small id="delivery-caption">Configured automatically after approval</small></div></div></div>
<div id="ready-note" class="notice success" hidden>You’re connected. Open Slack, find the installed bot under Apps, and send “hi”. Each person gets their own private memory.</div>
<form id="connect-form"><label for="public-url">Public app address</label><input id="public-url" type="url" placeholder="https://your-app.example.com" required><p class="hint">The HTTPS address of this Nudge server. We use it to receive Slack messages. If you opened this page through your public address, it’s already filled in.</p><label class="check"><input id="consent" type="checkbox" required><span>Allow Nudge to configure Slack message delivery for this Composio project. Existing webhooks for other apps won’t be overwritten.</span></label><div class="actions"><button id="connect-button" type="submit">Connect Slack →</button><button id="complete-button" type="button" class="secondary" hidden>I’ve approved Slack—finish setup</button><a id="open-slack" class="button secondary" href="https://app.slack.com" target="_blank" rel="noopener noreferrer" hidden>Open Slack ↗</a></div></form>
<p class="hint">Only the installer approves access. Everyone else just sends a DM. Reminder schedules are currently one-time.</p></section>
<div class="footer"><span>Memory stored in SQLite · Connections handled by Composio</span><button id="logout" class="quiet" hidden>Lock setup page</button></div>
</main><script nonce="${nonce}">
const byId = id => document.getElementById(id);
let current;
function notice(text, success = false) { const box = byId('notice'); box.textContent = text; box.className = success ? 'notice success' : 'notice'; box.hidden = !text; }
async function api(path, body) {
  const response = await fetch('/setup/' + path, body === undefined ? {credentials:'same-origin'} : {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Something went wrong. Please try again.'); error.status = response.status; throw error; }
  return data;
}
function step(id, ready, caption) { byId('step-' + id).classList.toggle('done', ready); byId(id + '-caption').textContent = caption; }
async function load() {
  try {
    current = await api('api/status');
    byId('unlock').hidden = true; byId('dashboard').hidden = false; byId('logout').hidden = false;
    step('server', current.composioConfigured, current.composioConfigured ? 'Composio configured on the server' : 'The operator needs to add a Composio project key');
    step('slack', current.connected, current.connected ? 'Workspace connection saved' : current.pending ? 'Approval started—finish it in Slack' : 'Waiting for your approval');
    step('delivery', current.ready, current.ready ? 'DM events and message delivery enabled' : 'Configured automatically after approval');
    byId('heading').textContent = current.ready ? 'Your coach is ready.' : 'Make room for better habits';
    byId('ready-note').hidden = !current.ready; byId('open-slack').hidden = !current.ready;
    byId('connect-button').textContent = current.reconnectRequired ? 'Reconnect Slack →' : current.connected ? 'Update connection' : 'Connect Slack →';
    byId('connect-button').disabled = !current.composioConfigured || current.busy;
    byId('complete-button').hidden = !current.pending || current.ready || current.reconnectRequired;
    if (!byId('public-url').value) byId('public-url').value = current.publicUrl || (location.protocol === 'https:' ? location.origin : '');
    if (current.error) notice(current.error);
    else if (!current.aiConfigured) notice('Slack commands will work, but natural-language coaching needs an OpenAI key configured by the app operator.');
    else notice('');
  } catch (error) {
    if (error.status === 401) { byId('unlock').hidden = false; byId('dashboard').hidden = true; byId('logout').hidden = true; }
    else notice(error.message);
  } finally { byId('loading').hidden = true; }
}
byId('unlock-form').addEventListener('submit', async event => { event.preventDefault(); try { await api('session', {token:byId('setup-key').value}); byId('setup-key').value = ''; notice(''); await load(); } catch (error) { notice(error.message); } });
byId('connect-form').addEventListener('submit', async event => {
  event.preventDefault(); byId('connect-button').disabled = true; notice('Preparing your Slack connection…', true);
  try {
    const result = await api(current.reconnectRequired ? 'reconnect' : current.connected ? 'refresh' : 'connect', {publicUrl:byId('public-url').value, consent:byId('consent').checked});
    if (result.redirectUrl) location.assign(result.redirectUrl); else await load();
  } catch (error) { notice(error.message); byId('connect-button').disabled = false; }
});
byId('complete-button').addEventListener('click', async () => { byId('complete-button').disabled = true; notice('Finishing setup…', true); try { await api('complete', {}); await load(); } catch (error) { notice(error.message); } finally { byId('complete-button').disabled = false; } });
byId('logout').addEventListener('click', async () => { try { await api('logout', {}); await load(); } catch (error) { notice(error.message); } });
(async () => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  if (token) { history.replaceState(null, '', '/setup'); try { await api('session', {token}); } catch (error) { notice(error.message); } }
  await load();
})();
</script></body></html>`;
}
