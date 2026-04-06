// =============================================
// ESTADO GLOBAL
// =============================================
const STATE = {
  running: false,
  startTime: null,
  pausedElapsed: 0,
  timerInterval: null,
  rcpInterval: null,
  rcpStartTime: null,
  rcpCycles: 0,
  rcpRunning: false,
  events: [],
  meds: [],
  choques: 0,
  doseEpi: 0,
  ritmoAtual: null,
  lastEpiTime: null,
};

const RCP_DURATION = 120; // 2 minutos em segundos

// =============================================
// RELÓGIO
// =============================================
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toLocaleTimeString('pt-BR', { hour12: false });
  document.getElementById('date-display').textContent =
    now.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
}
updateClock();
setInterval(updateClock, 1000);

// =============================================
// TIMER PCR
// =============================================
function iniciarPCR() {
  if (STATE.running) return;
  if (!STATE.startTime) {
    STATE.startTime = Date.now() - STATE.pausedElapsed;
    addEvent({ type:'inicio', text:'PCR Iniciado', detail:'Evento iniciado — cronômetro ativado' });
    toast('Evento PCR iniciado', 'success');
    document.getElementById('status-badge').className = 'status-badge active';
    document.getElementById('status-badge').textContent = 'EM ANDAMENTO';
    checkAlerts();
  } else {
    STATE.startTime = Date.now() - STATE.pausedElapsed;
    toast('Cronômetro retomado', 'info');
  }
  STATE.running = true;
  STATE.timerInterval = setInterval(updateTimer, 500);
}

function pausarPCR() {
  if (!STATE.running) return;
  STATE.running = false;
  STATE.pausedElapsed = Date.now() - STATE.startTime;
  clearInterval(STATE.timerInterval);
  toast('Cronômetro pausado', 'warn');
}

function resetarPCR() {
  if (!confirm('Deseja resetar toda a sessão?')) return;
  clearInterval(STATE.timerInterval);
  clearInterval(STATE.rcpInterval);
  Object.assign(STATE, {
    running:false, startTime:null, pausedElapsed:0,
    timerInterval:null, rcpInterval:null, rcpStartTime:null,
    rcpCycles:0, rcpRunning:false, events:[], meds:[],
    choques:0, doseEpi:0, ritmoAtual:null, lastEpiTime:null
  });
  document.getElementById('elapsed-time').textContent = '00:00:00';
  document.getElementById('elapsed-time').className = '';
  document.getElementById('rcp-timer').textContent = '02:00';
  document.getElementById('rcp-bar').style.width = '0%';
  document.getElementById('rcp-cycle-count').textContent = 'Ciclo #0';
  document.getElementById('status-badge').className = 'status-badge standby';
  document.getElementById('status-badge').textContent = 'STANDBY';
  document.getElementById('ritmo-display').textContent = '—';
  document.querySelectorAll('.rhythm-btn').forEach(b => b.classList.remove('active'));
  renderTimeline();
  renderMedList();
  updateStats();
  clearAlerts();
  toast('Sessão resetada', 'warn');
}

function updateTimer() {
  if (!STATE.startTime) return;
  const elapsed = Date.now() - STATE.startTime;
  const h = Math.floor(elapsed / 3600000);
  const m = Math.floor((elapsed % 3600000) / 60000);
  const s = Math.floor((elapsed % 60000) / 1000);
  const txt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  document.getElementById('elapsed-time').textContent = txt;
  document.getElementById('stat-tempo').textContent = `${String(m+h*60).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

  // critical > 10 minutos
  if (elapsed > 600000) {
    document.getElementById('elapsed-time').classList.add('critical');
    if (elapsed > 600000 && elapsed < 602000) showAlert('danger', '⚠ PCR >10 min — avaliar prognóstico');
  }
  // Epinefrina lembrete 3-5 min
  if (STATE.lastEpiTime) {
    const diff = (Date.now() - STATE.lastEpiTime) / 60000;
    if (diff >= 3 && diff < 3.05) showAlert('warn', '💊 3 min desde última Epinefrina — considerar nova dose');
  }
}

// =============================================
// RCP CICLO
// =============================================
function iniciarCicloRCP() {
  if (!STATE.running) { toast('Inicie o PCR primeiro', 'error'); return; }
  if (STATE.rcpRunning) { clearInterval(STATE.rcpInterval); STATE.rcpRunning = false; }
  STATE.rcpRunning = true;
  STATE.rcpStartTime = Date.now();
  STATE.rcpCycles++;
  document.getElementById('rcp-cycle-count').textContent = `Ciclo #${STATE.rcpCycles}`;
  addEvent({ type:'rcp', text:`RCP Ciclo #${STATE.rcpCycles} Iniciado`, detail:'Compressões torácicas — 100-120/min' });
  toast(`Ciclo RCP #${STATE.rcpCycles} iniciado`, 'success');

  clearInterval(STATE.rcpInterval);
  STATE.rcpInterval = setInterval(() => {
    const elapsed = (Date.now() - STATE.rcpStartTime) / 1000;
    const remaining = Math.max(0, RCP_DURATION - elapsed);
    const m = Math.floor(remaining / 60);
    const s = Math.floor(remaining % 60);
    document.getElementById('rcp-timer').textContent =
      `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    document.getElementById('rcp-bar').style.width = `${(elapsed / RCP_DURATION) * 100}%`;

    if (remaining <= 0) {
      clearInterval(STATE.rcpInterval);
      STATE.rcpRunning = false;
      document.getElementById('rcp-timer').textContent = '00:00';
      document.getElementById('rcp-bar').style.width = '100%';
      showAlert('warn', `🔄 Ciclo RCP #${STATE.rcpCycles} concluído — verificar ritmo / pulso`);
      toast(`Ciclo #${STATE.rcpCycles} finalizado!`, 'warn');
      beepAlert();
    }
  }, 500);
  updateStats();
}

function logPausaRCP() {
  if (!STATE.running) return;
  if (STATE.rcpRunning) { clearInterval(STATE.rcpInterval); STATE.rcpRunning = false; }
  addEvent({ type:'pausa', text:'Pausa RCP', detail:'Verificação de ritmo / pulso' });
  toast('Pausa RCP registrada', 'info');
}

// =============================================
// DESFIBRILAÇÃO
// =============================================
function registrarDesfibrilacao() {
  if (!STATE.running) { toast('Inicie o PCR primeiro', 'error'); return; }
  const energia = parseInt(document.getElementById('energia-input').value) || 200;
  STATE.choques++;
  addEvent({
    type:'desfibrilacao',
    text:`Choque #${STATE.choques} — ${energia}J`,
    detail:`Desfibrilação aplicada • ${energia} joules • Via: DEA/Cardioversor`
  });
  updateStats();
  toast(`⚡ Choque #${STATE.choques} registrado — ${energia}J`, 'warn');

  const btn = document.getElementById('btn-desfib');
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 1000);

  showAlert('info', `⚡ Choque #${STATE.choques} aplicado — iniciar RCP imediatamente`);
  beepAlert();
}

// =============================================
// MEDICAÇÕES
// =============================================
document.getElementById('med-nome').addEventListener('change', function() {
  document.getElementById('custom-med-group').style.display =
    this.value === '_custom' ? 'flex' : 'none';
});

function registrarMedicacao() {
  if (!STATE.running) { toast('Inicie o PCR primeiro', 'error'); return; }
  let nome = document.getElementById('med-nome').value;
  if (!nome) { toast('Selecione um medicamento', 'error'); return; }
  if (nome === '_custom') nome = document.getElementById('med-custom').value.trim() || 'Medicação';
  const via = document.getElementById('med-via').value;
  const obs = document.getElementById('med-obs').value.trim();

  STATE.meds.push({ nome, via, time: getClockTime(), elap: getElapsed() });
  addEvent({
    type:'medicacao',
    text: `${nome} — ${via}`,
    detail: obs || `Administrado por via ${via}`
  });

  if (nome.toLowerCase().includes('epinefrina')) {
    STATE.doseEpi++;
    STATE.lastEpiTime = Date.now();
  }

  document.getElementById('med-obs').value = '';
  document.getElementById('med-nome').value = '';
  document.getElementById('med-custom').value = '';
  document.getElementById('custom-med-group').style.display = 'none';

  renderMedList();
  updateStats();
  toast(`Medicação registrada: ${nome}`, 'success');
}

// =============================================
// RITMO
// =============================================
function setRitmo(ritmo) {
  if (!STATE.running) { toast('Inicie o PCR primeiro', 'error'); return; }
  STATE.ritmoAtual = ritmo;
  document.getElementById('ritmo-display').textContent = ritmo;
  document.querySelectorAll('.rhythm-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === ritmo || b.textContent.trim() === ritmoAbrev(ritmo));
  });
  addEvent({ type:'ritmo', text:`Ritmo: ${ritmo}`, detail:'Ritmo identificado no monitor' });
  toast(`Ritmo registrado: ${ritmo}`, 'info');

  if (ritmo === 'FV' || ritmo === 'TV sem pulso') {
    showAlert('danger', `⚡ ${ritmo} detectado — chocável! Preparar desfibrilação.`);
  }
}

function ritmoAbrev(r) {
  const map = { 'TV sem pulso':'TVSP', 'Assistolia':'Assis.' };
  return map[r] || r;
}

// =============================================
// RETORNO ESPONTÂNEO
// =============================================
function registrarRetorno() {
  if (!STATE.running) { toast('Inicie o PCR primeiro', 'error'); return; }
  STATE.running = false;
  clearInterval(STATE.timerInterval);
  clearInterval(STATE.rcpInterval);
  addEvent({
    type:'retorno',
    text:'✓ RETORNO ESPONTÂNEO DA CIRCULAÇÃO',
    detail:`REC confirmado em ${getElapsed()} de PCR`
  });
  document.getElementById('status-badge').className = 'status-badge';
  document.getElementById('status-badge').style.borderColor = 'var(--green)';
  document.getElementById('status-badge').style.color = 'var(--green)';
  document.getElementById('status-badge').textContent = 'REC ✓';
  clearAlerts();
  showAlert('info', '✓ REC confirmado — monitorar sinais vitais e transferir para UTI');
  toast('🎉 Retorno espontâneo registrado!', 'success');
}

// =============================================
// OBSERVAÇÃO
// =============================================
function registrarObs() {
  const txt = document.getElementById('obs-text').value.trim();
  if (!txt) { toast('Digite uma observação', 'error'); return; }
  addEvent({ type:'obs', text:'Observação', detail: txt });
  document.getElementById('obs-text').value = '';
  toast('Observação registrada', 'info');
}

// =============================================
// EVENTOS / TIMELINE
// =============================================
function addEvent(evt) {
  evt.id = Date.now();
  evt.clockTime = getClockTime();
  evt.elapsed = getElapsed();
  STATE.events.unshift(evt); // mais recente primeiro
  renderTimeline();
  document.getElementById('event-count').textContent = STATE.events.length;
}

function renderTimeline() {
  const container = document.getElementById('timeline');
  const emptyMsg = document.getElementById('empty-msg');
  if (STATE.events.length === 0) {
    container.innerHTML = '<div class="timeline-empty" id="empty-msg">⊘ Nenhum evento registrado.<br>Inicie a sessão para começar.</div>';
    return;
  }
  container.innerHTML = STATE.events.map((evt, i) => `
    <div class="event-item">
      <div class="event-time">
        <div>${evt.clockTime}</div>
        <div style="font-size:9px;margin-top:2px;color:var(--muted);">${evt.elapsed}</div>
      </div>
      <div class="event-line">
        <div class="event-dot type-${evt.type}"></div>
        ${i < STATE.events.length - 1 ? '<div class="event-connector"></div>' : ''}
      </div>
      <div class="event-card type-${evt.type}">
        <div class="event-type-tag">${typeLabel(evt.type)}</div>
        <div class="event-main-text">${evt.text}</div>
        ${evt.detail ? `<div class="event-detail">${evt.detail}</div>` : ''}
      </div>
    </div>
  `).join('');
}

function typeLabel(t) {
  const map = {
    inicio:'PCR', medicacao:'MEDICAÇÃO', desfibrilacao:'DESFIBRILAÇÃO',
    rcp:'RCP', ritmo:'RITMO', retorno:'RETORNO', pausa:'PAUSA RCP',
    obs:'OBSERVAÇÃO'
  };
  return map[t] || t.toUpperCase();
}

// =============================================
// MED LIST
// =============================================
function renderMedList() {
  const el = document.getElementById('med-list');
  if (STATE.meds.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);font-size:11px;text-align:center;padding:16px;">Nenhuma medicação</div>';
    return;
  }
  el.innerHTML = [...STATE.meds].reverse().map(m => `
    <div class="med-list-item">
      <div>
        <div class="med-name">${m.nome}</div>
        <div class="med-dose">${m.via} · ${m.elap}</div>
      </div>
      <div class="med-time">${m.time}</div>
    </div>
  `).join('');
}

// =============================================
// STATS
// =============================================
function updateStats() {
  document.getElementById('stat-epinefrina').textContent = STATE.doseEpi;
  document.getElementById('stat-choques').textContent = STATE.choques;
  document.getElementById('stat-ciclos').textContent = STATE.rcpCycles;
  document.getElementById('stat-total-med').textContent = STATE.meds.length;
}

// =============================================
// ALERTS
// =============================================
let activeAlerts = [];
function showAlert(type, msg) {
  const banner = document.getElementById('alerts-banner');
  const id = Date.now();
  activeAlerts.push(id);
  const div = document.createElement('div');
  div.className = `alert-item ${type}`;
  div.id = `alert-${id}`;
  div.innerHTML = `<span style="flex:1">${msg}</span><button onclick="removeAlert(${id})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;">✕</button>`;
  banner.appendChild(div);
  banner.classList.add('visible');
  setTimeout(() => removeAlert(id), 15000);
}
function removeAlert(id) {
  const el = document.getElementById(`alert-${id}`);
  if (el) el.remove();
  activeAlerts = activeAlerts.filter(a => a !== id);
  if (activeAlerts.length === 0) {
    document.getElementById('alerts-banner').classList.remove('visible');
  }
}
function clearAlerts() {
  document.getElementById('alerts-banner').innerHTML = '';
  document.getElementById('alerts-banner').classList.remove('visible');
  activeAlerts = [];
}
function checkAlerts() {
  setTimeout(() => {
    if (STATE.running) showAlert('warn', '💊 Lembrete: Epinefrina 1mg IV a cada 3–5 min');
  }, 3000);
}

// =============================================
// HELPERS
// =============================================
function getClockTime() {
  return new Date().toLocaleTimeString('pt-BR', { hour12: false });
}
function getElapsed() {
  if (!STATE.startTime) return '00:00';
  const e = Date.now() - STATE.startTime;
  const m = Math.floor(e / 60000);
  const s = Math.floor((e % 60000) / 1000);
  return `+${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// TOAST
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `type-${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

// BEEP
function beepAlert() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [440, 550, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.12);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.12);
    });
  } catch(e) {}
}

// =============================================
// ECG CANVAS ANIMADO
// =============================================
const canvas = document.getElementById('ecg-canvas');
const ctx2d = canvas.getContext('2d');
let ecgX = 0;
const ecgData = [];
let ecgPhase = 0;

function resizeCanvas() {
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function ecgWave(phase) {
  // Simplified ECG waveform
  const p = phase % 1;
  if (p < 0.1) return Math.sin(p * Math.PI / 0.1) * 8;
  if (p >= 0.3 && p < 0.32) return -15;
  if (p >= 0.32 && p < 0.35) return 40;
  if (p >= 0.35 && p < 0.38) return -8;
  if (p >= 0.5 && p < 0.65) return Math.sin((p - 0.5) * Math.PI / 0.15) * 10;
  return 0;
}

function drawECG() {
  const W = canvas.width;
  const H = canvas.height;
  const mid = H / 2;

  // Shift canvas left
  const imageData = ctx2d.getImageData(1, 0, W - 1, H);
  ctx2d.putImageData(imageData, 0, 0);
  ctx2d.clearRect(W - 1, 0, 1, H);

  // Grid lines
  ctx2d.strokeStyle = 'rgba(26,45,69,0.6)';
  ctx2d.lineWidth = 0.5;

  // Draw new point
  const speed = STATE.running ? 0.008 : 0.002;
  ecgPhase += speed;
  const y = mid - (STATE.running ? ecgWave(ecgPhase) : Math.sin(ecgPhase * 4) * 3);

  if (ecgData.length === 0) {
    ctx2d.beginPath();
    ctx2d.moveTo(W - 1, y);
    ctx2d.strokeStyle = STATE.running ? '#ff2d47' : '#1a3a5c';
    ctx2d.lineWidth = 1.5;
    ctx2d.stroke();
  } else {
    ctx2d.beginPath();
    ctx2d.moveTo(W - 2, ecgData[ecgData.length - 1] || mid);
    ctx2d.lineTo(W - 1, y);
    ctx2d.strokeStyle = STATE.running ? '#ff2d47' : '#1a3a5c';
    ctx2d.lineWidth = STATE.running ? 1.8 : 1;
    ctx2d.shadowColor = STATE.running ? 'rgba(255,45,71,0.6)' : 'transparent';
    ctx2d.shadowBlur = STATE.running ? 6 : 0;
    ctx2d.stroke();
  }

  ecgData.push(y);
  if (ecgData.length > W) ecgData.shift();

  requestAnimationFrame(drawECG);
}
drawECG();