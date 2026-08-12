/* ============================================================
   app.js — Roteador SPA + utilitários globais
   ============================================================ */

'use strict';

// ── API helper ───────────────────────────────────────────────
const AUTH_EXEMPT_PATHS = ['/api/auth/login', '/api/auth/reset-password'];

const api = {
  async get(path) {
    const r = await fetch(path, { credentials: 'include' });
    if (r.status === 401 && !AUTH_EXEMPT_PATHS.includes(path)) { App.showLogin(); return null; }
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 401 && !AUTH_EXEMPT_PATHS.includes(path)) { App.showLogin(); return null; }
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
  },
  async patch(path, body) {
    const r = await fetch(path, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 401 && path !== '/api/auth/login') { App.showLogin(); return null; }
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE', credentials: 'include' });
    if (r.status === 401 && path !== '/api/auth/login') { App.showLogin(); return null; }
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
  },
};

// ── Toast ────────────────────────────────────────────────────
function showToast(msg, type = 'success', durationMs = 3000) {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = (type === 'success' ? '✅ ' : '❌ ') + msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}

// ── Drawer ───────────────────────────────────────────────────
function openDrawer(html, onOpen) {
  const overlay = document.getElementById('overlay');
  const drawer  = document.getElementById('drawer');
  const content = document.getElementById('drawer-content');
  content.innerHTML = html;
  overlay.classList.add('open');
  drawer.classList.add('open');
  if (onOpen) onOpen(drawer);

  const close = () => {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
  };
  overlay.onclick = close;
  return close;
}

// ── App Core ─────────────────────────────────────────────────
const App = {
  currentRoute: 'dashboard',

  async init() {
    // PWA Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Verifica autenticação
    try {
      const stats = await api.get('/api/config/stats');
      if (stats) this.showApp();
      else this.showLogin();
    } catch {
      this.showLogin();
    }
  },

  showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');

    const btn = document.getElementById('login-btn');
    const inp = document.getElementById('login-password');
    const err = document.getElementById('login-error');

    const doLogin = async () => {
      err.classList.add('hidden');
      btn.textContent = 'Entrando...';
      btn.disabled = true;
      try {
        await api.post('/api/auth/login', { password: inp.value });
        this.showApp();
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
      } finally {
        btn.textContent = 'Entrar no painel';
        btn.disabled = false;
      }
    };

    btn.onclick = doLogin;
    inp.onkeydown = e => { if (e.key === 'Enter') doLogin(); };
    inp.focus();

    // ── Esqueci minha senha ──────────────────────────────────
    const forgotLink  = document.getElementById('forgot-password-link');
    const cancelLink  = document.getElementById('cancel-reset-link');
    const loginBox    = document.querySelector('#login-screen .login-box');
    const resetBox    = document.getElementById('reset-box');
    const resetBtn    = document.getElementById('reset-btn');
    const resetKey    = document.getElementById('reset-key');
    const resetPass   = document.getElementById('reset-new-password');
    const resetErr    = document.getElementById('reset-error');
    const resetOk     = document.getElementById('reset-success');

    forgotLink.onclick = (e) => {
      e.preventDefault();
      loginBox.classList.add('hidden');
      resetBox.classList.remove('hidden');
      resetErr.classList.add('hidden');
      resetOk.classList.add('hidden');
      resetKey.focus();
    };

    cancelLink.onclick = (e) => {
      e.preventDefault();
      resetBox.classList.add('hidden');
      loginBox.classList.remove('hidden');
    };

    const doReset = async () => {
      resetErr.classList.add('hidden');
      resetOk.classList.add('hidden');
      resetBtn.textContent = 'Redefinindo...';
      resetBtn.disabled = true;
      try {
        await api.post('/api/auth/reset-password', {
          recoveryKey: resetKey.value,
          newPassword: resetPass.value,
        });
        resetOk.classList.remove('hidden');
        resetKey.value = '';
        resetPass.value = '';
      } catch (e) {
        resetErr.textContent = e.message;
        resetErr.classList.remove('hidden');
      } finally {
        resetBtn.textContent = 'Redefinir senha';
        resetBtn.disabled = false;
      }
    };

    resetBtn.onclick = doReset;
  },

  showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    // Navegação
    document.querySelectorAll('.nav-item[data-route]').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.route));
    });

    this.navigate('dashboard');
    this.startBotStatusPoll();
    this.refreshTrainingBadge();

    // Carrega nome do negócio no header
    api.get('/api/config').then(cfg => {
      if (cfg?.business_name) {
        document.getElementById('business-name-header').textContent = cfg.business_name;
      }
    });
  },

  logout() {
    api.post('/api/auth/logout', {}).catch(() => {});
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
  },

  navigate(route) {
    this.currentRoute = route;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const navBtn = document.getElementById(`nav-${route}`);
    if (navBtn) navBtn.classList.add('active');

    // Remove FAB antigo
    document.querySelectorAll('.fab').forEach(f => f.remove());

    const view = document.getElementById('view');
    const renders = {
      dashboard: () => DashboardView.render(view),
      clients:   () => ClientsView.render(view),
      training:  () => TrainingView.render(view),
      qrcode:    () => QRCodeView.render(view),
      settings:  () => SettingsView.render(view),
    };
    (renders[route] || renders.dashboard)();
  },

  async refreshTrainingBadge() {
    try {
      const [faqData, clientsData] = await Promise.all([
        api.get('/api/faq/candidates/count'),
        api.get('/api/clients/candidates/count'),
      ]);
      const total = (faqData?.count || 0) + (clientsData?.count || 0);
      const badge = document.getElementById('training-badge');
      if (total > 0) {
        badge.textContent = total;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    } catch {}
  },

  startBotStatusPoll() {
    const badge  = document.getElementById('bot-status-badge');
    const dot    = badge.querySelector('.dot');
    const text   = document.getElementById('bot-status-text');

    const refresh = async () => {
      try {
        const s = await api.get('/api/bot/status');
        if (s?.connected) {
          badge.classList.add('connected');
          text.textContent = 'Conectado';
        } else if (s?.hasQr) {
          badge.classList.remove('connected');
          text.textContent = 'QR Aguardando';
        } else {
          badge.classList.remove('connected');
          text.textContent = 'Offline';
        }
      } catch {}
    };

    refresh();
    setInterval(refresh, 15000); // atualiza a cada 15s
  },
};

// ── Utils ─────────────────────────────────────────────────────
function formatDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

function dueBadge(dateStr) {
  const d = daysUntil(dateStr);
  if (d === null) return '';
  if (d < 0)  return '<span class="list-item-badge badge-today">Vencido</span>';
  if (d === 0)return '<span class="list-item-badge badge-today">Vence hoje</span>';
  if (d <= 3) return `<span class="list-item-badge badge-soon">Vence em ${d}d</span>`;
  if (d <= 7) return `<span class="list-item-badge badge-ok">Vence em ${d}d</span>`;
  return `<span class="list-item-badge badge-ok">${formatDate(dateStr)}</span>`;
}

function initials(name) {
  return (name || '?').split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
}

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
