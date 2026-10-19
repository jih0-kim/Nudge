export const demoPage = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nudge · Demo inbox & calendar</title>
<style>
:root{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#29382e;background:#f7f8f4;font-synthesis:none;--green:#245c41;--muted:#748078;--line:#e3e8df}
*{box-sizing:border-box}body{margin:0}button{font:inherit;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #c28b36;outline-offset:4px}button:disabled{cursor:default;opacity:.5}button{color:inherit}a{color:var(--green)}.banner{background:#eaf0dc;border-bottom:1px solid #dce5cb;min-height:37px;display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 20px;font-size:11px;letter-spacing:.03em}.banner b{letter-spacing:.11em;font-size:10px}.dot{width:6px;height:6px;background:#71944b;border-radius:50%;display:inline-block}.shell{display:grid;grid-template-columns:220px 1fr;min-height:calc(100vh - 37px)}.sidebar{padding:30px 18px;border-right:1px solid var(--line);display:flex;flex-direction:column;background:#f0f3ec}.brand{font-size:25px;font-weight:750;letter-spacing:-1px;padding:0 12px;display:flex;align-items:center;gap:10px}.brand-icon{background:#dbe8b9;border-radius:12px;font-size:24px;padding:4px 8px}.workspace-label{font-size:10px;letter-spacing:.14em;color:var(--muted);margin:38px 12px 13px;font-weight:700}.nav{display:grid;gap:6px}.nav button{border:0;background:transparent;text-align:left;padding:12px 14px;border-radius:9px;font-size:13px;display:flex;gap:12px;align-items:center}.nav button.active{background:white;box-shadow:0 2px 5px #263e2b08;color:var(--green);font-weight:650}.nav-icon{font-size:18px;width:23px}.count{margin-left:auto;background:#edf1e6;border-radius:5px;font-size:10px;padding:2px 6px}.sidebar-bottom{margin-top:auto;padding:35px 10px 0}.sandbox-note{font-size:11px;line-height:1.7;color:var(--muted)}.profile{border-top:1px solid var(--line);padding-top:20px;margin-top:20px;display:flex;gap:10px;align-items:center}.avatar{width:35px;height:35px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:650;background:#e8dbc4;flex-shrink:0}.profile b{display:block;font-size:12px}.profile small{color:var(--muted);font-size:10px}.main{min-width:0}.topbar{height:79px;padding:0 40px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);background:#ffffff70;gap:12px}.breadcrumb{font-size:12px;color:var(--muted)}.breadcrumb span{color:#344c3c}.top-actions{display:flex;gap:18px;align-items:center}.clock{font-size:11px;color:var(--muted)}.reset{border:1px solid #d5decf;border-radius:7px;padding:8px 12px;font-size:11px;background:transparent}.content{max-width:1450px;margin:auto;padding:35px 40px}.eyebrow{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#7b886f;font-weight:700}h1{font-size:29px;letter-spacing:-1px;font-weight:600;margin:9px 0}h2{font-size:17px;letter-spacing:-.3px;margin:0}h3{font-size:14px;margin:0}.subheading{font-size:12px;color:var(--muted);line-height:1.7;margin:0 0 27px}.title-row{display:flex;justify-content:space-between;align-items:center;gap:16px}.pill{font-size:10px;border:1px solid #d9e2d0;background:#eef3e7;color:#526c40;border-radius:20px;padding:6px 10px;white-space:nowrap}.panel{border:1px solid var(--line);border-radius:14px;background:white;overflow:hidden}.panel-heading{padding:20px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}.muted{color:var(--muted);font-size:11px}.mail-layout{display:grid;grid-template-columns:minmax(260px,.9fr) minmax(320px,1.1fr);min-height:530px}.mail-list{border-right:1px solid var(--line)}.mail-item{display:block;width:100%;text-align:left;background:white;border:0;border-bottom:1px solid #edf0e9;padding:21px 20px}.mail-item.selected{background:#f1f5eb;box-shadow:inset 3px 0 #6c8c4d}.mail-meta{display:flex;align-items:center;gap:9px;margin-bottom:8px;font-size:11px}.mail-meta time{margin-left:auto;font-size:10px;color:var(--muted)}.unread{width:5px;height:5px;border-radius:50%;background:#6d8f54}.mail-subject{font-size:12px;line-height:1.5;font-weight:650}.mail-preview{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:6px}.mail-detail{padding:32px}.mail-detail h2{font-size:21px;line-height:1.4;margin:18px 0 24px}.sender{display:flex;gap:12px;align-items:center}.sender strong{display:block;font-size:12px}.sender small{font-size:10px;color:var(--muted)}.mail-body{white-space:pre-wrap;line-height:1.95;font-size:13px;margin:30px 0}.source-note{font-size:11px;background:#f5f7f0;border-radius:8px;padding:14px;line-height:1.7;color:#627351}.primary{background:var(--green);color:white;border:0;border-radius:8px;font-size:12px;padding:12px 18px;font-weight:550}.secondary{background:white;border:1px solid #dce3d6;border-radius:8px;padding:11px 14px;font-size:12px}.mail-detail .primary{margin-top:20px}.calendar-grid{display:grid;grid-template-columns:1fr 280px;gap:22px}.calendar{position:relative;margin:25px 24px 25px 12px;height:608px}.hour{position:absolute;left:0;right:0;border-top:1px solid #edf0e8;height:1px;margin-left:53px}.hour span{position:absolute;left:-51px;top:-7px;color:#8a948b;font-size:10px}.event{position:absolute;left:65px;right:8px;border:0;border-left:3px solid #a4b4cb;border-radius:5px;background:#eaf0f7;padding:5px 11px;text-align:left;overflow:hidden;display:flex;align-items:baseline;gap:10px}.event strong{font-size:11px;font-weight:600}.event small{font-size:10px;white-space:nowrap;color:#5d6c64}.event.research{background:#eee8f7;border-color:#a18abd}.event.focus{background:#edf0e4;border-color:#9aa96b}.event.personal{background:#f9ecda;border-color:#ccaa72}.now-line{position:absolute;left:51px;right:0;border-top:1px solid #c48060;z-index:2;pointer-events:none}.now-line:before{content:'';position:absolute;width:6px;height:6px;background:#c48060;border-radius:50%;top:-3px;left:-3px}.free-slot{position:absolute;left:65px;right:8px;border:1px dashed #93ac7a;background:#f4f8ec;border-radius:5px;padding:8px 11px;font-size:11px;color:#63804d}.aside-card{padding:22px}.aside-card p{font-size:12px;line-height:1.85;color:var(--muted)}.big-number{font-size:39px;letter-spacing:-2px;color:var(--green);margin:12px 0 0}.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:10px;color:var(--muted);margin:20px 0}.legend span:before{content:'';display:inline-block;width:7px;height:7px;border-radius:2px;background:#bdcba4;margin-right:5px}.coach-grid{display:grid;grid-template-columns:minmax(320px,1fr) 280px;gap:22px}.coach-intro{padding:23px 25px;background:#fafbf7;border-bottom:1px solid var(--line);font-size:12px;line-height:1.85}.coach-intro strong{color:#3b6241}.conversation{padding:25px;display:grid;gap:20px}.bubble{font-size:12px;line-height:1.85;max-width:96%}.bubble.user{background:#edf1e6;border-radius:12px 12px 2px 12px;padding:13px 17px;margin-left:auto}.speaker{font-size:10px;letter-spacing:.08em;color:#6c8256;margin-bottom:7px;text-transform:uppercase;font-weight:700}.quest{border:1px solid #d7e3c8;border-radius:10px;padding:20px;background:#fcfdf8}.quest-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.quest h3{font-size:17px;letter-spacing:-.4px}.quest p{font-size:12px;line-height:1.85}.quest-meta{font-size:10px;color:#79866f;margin-top:15px;line-height:1.8}.quest-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:17px}.success{font-size:12px;background:#f0f5e9;padding:12px 15px;border-radius:8px;color:#496637;line-height:1.8}.pet-card{text-align:center;background:#f4f6ec;padding:25px 20px}.pet-art{height:140px;display:flex;align-items:center;justify-content:center}.pet-svg{width:110px;height:120px;filter:drop-shadow(0 10px 8px #45652a12)}.pet-stage{font-size:20px;font-weight:600;letter-spacing:-.5px}.pet-card p{font-size:11px;color:#79846e;line-height:1.7}.progress{height:5px;background:#e0e6d4;border-radius:8px;margin:18px 0 8px;overflow:hidden}.progress-fill{height:100%;background:#87a266;transition:width .3s}.milestones{display:flex;justify-content:space-between;font-size:9px;color:#7e8c70}.grounding{padding:22px;border-top:1px solid var(--line)}.grounding ul{padding-left:16px;margin:12px 0 0;font-size:11px;line-height:2;color:var(--muted)}.footer-note{font-size:10px;color:#8a9385;line-height:1.8;margin-top:20px}.empty-state{padding:30px;font-size:13px;line-height:1.8}.error{margin:40px;padding:20px;background:#fff0e7;border:1px solid #e8ba9e;border-radius:10px}#notice{font-size:11px;color:#526c40;min-height:17px;margin-top:10px} [hidden]{display:none!important}
@media(min-width:1450px){.content{padding-top:45px}.mail-layout{min-height:600px}}
@media(max-width:1100px){.sidebar{padding:25px 10px}.shell{grid-template-columns:175px 1fr}.topbar{padding:0 25px}.content{padding:28px 25px}.coach-grid,.calendar-grid{grid-template-columns:minmax(300px,1fr) 235px}.mail-layout{grid-template-columns:1fr}.mail-list{border-right:0;max-height:250px;overflow:auto;border-bottom:1px solid var(--line)}.clock{display:none}}
@media(max-width:800px){.shell{grid-template-columns:1fr}.sidebar{padding:16px 20px;border-right:0;border-bottom:1px solid var(--line);display:block}.brand{font-size:21px;padding:0}.workspace-label,.sidebar-bottom{display:none}.nav{display:flex;margin-top:15px}.nav button{padding:9px 12px;flex:1}.topbar{height:55px;padding:0 20px}.content{padding:25px 18px}.coach-grid,.calendar-grid{grid-template-columns:1fr}.pet-art{height:100px}.pet-svg{height:95px}.banner{font-size:10px;flex-wrap:wrap;gap:5px}h1{font-size:25px}.event{gap:5px}.event small{font-size:9px}.mail-detail{padding:22px}}
</style>
</head>
<body>
<div class="banner"><span class="dot"></span><b>DEMO DATA</b><span>Fictional inbox & calendar · available to your real Nudge coach with “demo on” in Slack</span></div>
<div class="shell">
<aside class="sidebar">
  <div class="brand"><span class="brand-icon" aria-hidden="true">❧</span> nudgling<span style="color:#90a66f">.</span></div>
  <div class="workspace-label">DEMO INBOX & CALENDAR</div>
  <nav class="nav" aria-label="Demo views">
    <button data-view="inbox"><span class="nav-icon" aria-hidden="true">✉</span>Inbox <span class="count">2</span></button>
    <button data-view="calendar"><span class="nav-icon" aria-hidden="true">▦</span>Calendar</button>
    <button data-view="nudge"><span class="nav-icon" aria-hidden="true">✧</span>Use in Slack</button>
  </nav>
  <div class="sidebar-bottom"><div class="sandbox-note">A little context.<br>A smaller next step.<br>A habit that grows with you.</div><div class="profile"><span class="avatar">MC</span><div><b>Maya Chen</b><small>Fictional demo persona</small></div></div></div>
</aside>
<main class="main">
  <header class="topbar"><div class="breadcrumb"><a href="/">Nudge</a> <span>/ <span id="view-name">Inbox</span></span></div><div class="top-actions"><span class="clock">Oct 22, 2026 · 10:20 AM ET · time frozen</span><button class="reset" id="reset">↻ Reset view</button></div></header>
  <div class="content" id="content"><p>Loading the fictional inbox and calendar…</p></div>
</main>
</div>
<noscript><p class="error">Enable JavaScript to use this local demo. No external services are required.</p></noscript>
<script>
'use strict';
var scenario;
var storageKey = 'nudgling-demo-view-v2';
var state = { view: 'inbox', selected: 'interview' };
var content = document.getElementById('content');
function esc(value) { return String(value).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function load() {
  try {
    var saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && ['inbox','calendar','nudge'].includes(saved.view) && scenario.emails.some(function(e) { return e.id === saved.selected; })) {
      state = {view:saved.view, selected:saved.selected};
    }
  } catch (_) { /* The demo also works without browser storage. */ }
}
function save() { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (_) {} }
function intro(eyebrow,title,subtitle,pill) {
  return '<div class="eyebrow">'+eyebrow+'</div><div class="title-row"><h1>'+title+'</h1><span class="pill">'+pill+'</span></div><p class="subheading">'+subtitle+'</p>';
}
function render() {
  save();
  document.querySelectorAll('[data-view]').forEach(function(button) {
    var active = button.dataset.view === state.view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  document.getElementById('view-name').textContent = {inbox:'Inbox',calendar:'Calendar',nudge:'Use in Slack'}[state.view];
  document.querySelector('.count').textContent = scenario.emails.filter(function(e) {return e.unread;}).length;
  content.innerHTML = state.view === 'inbox' ? inbox() : state.view === 'calendar' ? calendar() : coach();
}
function inbox() {
  var selected = scenario.emails.find(function(e) { return e.id === state.selected; });
  var list = scenario.emails.map(function(e) {
    return '<button class="mail-item '+(e.id === state.selected ? 'selected' : '')+'" data-email="'+e.id+'" aria-pressed="'+(e.id === state.selected)+'"><div class="mail-meta">'+(e.unread?'<span class="unread" aria-label="Unread"></span>':'')+'<strong>'+esc(e.from)+'</strong><time>'+e.time+'</time></div><div class="mail-subject">'+esc(e.subject)+'</div><div class="mail-preview">'+esc(e.preview)+'</div></button>';
  }).join('');
  return intro('Context, not more noise','A busy day. A little clarity.','Fictional incoming emails appear here automatically during a live simulation.','Gmail-style mock')+
    '<div class="panel"><div class="panel-heading"><h2>Inbox <span class="muted">/ '+scenario.emails.length+' messages</span></h2><span class="muted">maya.chen@example.test</span></div><div class="mail-layout"><div class="mail-list">'+list+'</div><article class="mail-detail"><span class="pill">'+esc(selected.label)+'</span><h2>'+esc(selected.subject)+'</h2><div class="sender"><span class="avatar" style="background:'+selected.color+'">'+selected.initials+'</span><div><strong>'+esc(selected.from)+'</strong><small>'+esc(selected.address)+' · to Maya</small></div></div><div class="mail-body">'+esc(selected.body)+'</div><div class="source-note">✧ The demo story: Leah’s interview is time-sensitive. The launch review can wait. Maya wants small steps, not a busier lunch break.</div><button class="primary" data-action="calendar">Check my day →</button></article></div></div><p class="footer-note">All people, messages, and addresses are fictional. This is not Gmail and cannot send email.</p>';
}
function minutes(time) { var parts=time.split(':').map(Number); return parts[0]*60+parts[1]; }
function calendar() {
  var events = scenario.events.map(function(e) {
    var top = (minutes(e.start)-540)*1.5;
    var height = (minutes(e.end)-minutes(e.start))*1.5-2;
    return '<button class="event '+e.kind+'" style="top:'+top+'px;height:'+height+'px" data-event="'+e.id+'" aria-label="'+esc(e.title+' '+e.start+' to '+e.end)+'"><strong>'+esc(e.title)+'</strong><small>'+e.start+'–'+e.end+'</small></button>';
  }).join('');
  var hours = '';
  for(var h=9;h<=15;h++) hours += '<div class="hour" style="top:'+((h-9)*90)+'px"><span>'+String(h).padStart(2,'0')+':00</span></div>';
  return intro('Make room for what matters','There’s a gap. Not an hour.','Thursday, October 22, 2026 · Eastern time · a fixed day for a repeatable demo','Google Calendar-style mock')+
    '<div class="calendar-grid"><section class="panel"><div class="panel-heading"><h2>Thursday <span class="muted">22</span></h2><span class="muted">Day view · ET</span></div><div class="calendar">'+hours+events+'<div class="now-line" style="top:120px" aria-label="Current demo time: 10:20"></div><div class="free-slot" style="top:152px;height:42px">✧ 10:20–11:00 · room for a small step</div></div></section><aside><div class="panel aside-card"><div class="eyebrow">Before your next call</div><div class="big-number">40 <span style="font-size:15px;letter-spacing:0">minutes</span></div><p>Free time is not an instruction to fill every minute. Start with five, and keep the rest.</p><h3>One real constraint</h3><p>Your customer interview starts at 11:00. Lunch at 12:30 stays protected.</p><button class="primary" data-action="nudge">Find my small next step →</button><div class="legend"><span>Team</span><span>Research</span><span>Personal</span></div><div id="event-detail" class="source-note" role="status">Select an event to see its details.</div></div><p class="footer-note">Read-only fictional calendar. Suggested quests never create or move events.</p></aside></div>';
}
function coach() {
  return intro('Same app. Real coach.','Take this context to Nudge.','The fake inbox and calendar feed the real Slack coach. No separate bot or simulated pet.','Live Slack flow')+
    '<section class="panel"><div class="coach-intro"><strong>1. Enable demo data for your Slack user</strong><p>DM Nudge: <code>demo on</code></p>This enables read-only tools for the same fictional emails and calendar you see here. It does not connect a real Google account or change your personal memory.</div><div class="conversation"><div><h3>2. Ask the real coach</h3><p class="subheading">Send this in your Nudge DM:</p><div class="source-note">Using the demo inbox and calendar, I’m overwhelmed. What small quest should I do before the customer interview? Keep my lunch break free.</div></div><div><h3>3. Make it smaller if needed</h3><p class="subheading">Reply: “I only have 30 seconds. Make the quest smaller.” The live model responds to your constraint; this page does not script its answer.</p></div><div><h3>4. Complete the quest in Slack</h3><p class="subheading">Do the tiny action, then react ✅ on your own Quest message. The existing worker logs completion and grows your real pet. Send <code>status</code> to check it. No completion buttons or fake progress here.</p></div><div class="source-note">Send <code>inbox</code> or <code>calendar</code> for a direct data check, <code>demo status</code> to check your mode, and <code>demo off</code> when finished. Demo mode is per Slack user, not workspace-wide.</div><p><a href="https://app.slack.com" target="_blank" rel="noopener noreferrer">Open Slack ↗</a></p></div></section><p class="footer-note">The model needs the main app’s AI configuration, and Slack must already be connected. The fictional clock is fixed at 10:20 AM ET on October 22, 2026; real reminders still use real time. Turning demo mode off does not reset real quests or pet progress.</p>';
}
document.addEventListener('click',function(event) {
  var button=event.target.closest('button');
  if(!button || !scenario) return;
  if(button.dataset.view) { state.view=button.dataset.view; render(); }
  else if(button.dataset.email) { state.selected=button.dataset.email; render(); }
  else if(button.dataset.event) {
    var e=scenario.events.find(function(item){return item.id===button.dataset.event;});
    document.getElementById('event-detail').textContent=e.title+' · '+e.start+'–'+e.end+' ET. '+e.detail;
  } else if(button.id==='reset') {
    state={view:'inbox',selected:'interview'};render();
  } else if(button.dataset.action) {
    var action=button.dataset.action;
    if(action==='calendar'||action==='nudge') state.view=action;
    render();
  }
});
fetch('/demo/api/scenario').then(function(response) {
  if(!response.ok) throw new Error('Scenario unavailable');
  return response.json();
}).then(function(data) {scenario=data;load();render();}).catch(function() {
  content.innerHTML='<div class="error"><h2>Couldn’t load the demo data</h2><p>Check that Nudge is running, then reload this page.</p><button class="secondary" id="retry">Try again</button></div>';
  document.getElementById('retry').addEventListener('click',function(){location.reload();});
});
setInterval(function() {
  if (!scenario) return;
  fetch('/demo/api/scenario').then(function(response) {if(!response.ok) throw new Error();return response.json();}).then(function(data) {
    if (JSON.stringify(data.emails) !== JSON.stringify(scenario.emails)) {
      var newest = data.emails[0];
      var arrived = !scenario.emails.some(function(e) {return e.id === newest.id;});
      scenario = data;
      if (arrived && state.view === 'inbox') state.selected = newest.id;
      if (!scenario.emails.some(function(e) {return e.id === state.selected;})) state.selected = 'interview';
      render();
    }
  }).catch(function() { /* Keep the last visible fictional inbox on transient errors. */ });
}, 5000);
</script>
</body>
</html>`;
