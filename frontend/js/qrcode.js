/* ============================================================
   qrcode.js — Tela de conexão WhatsApp via QR Code
   ============================================================ */

const QRCodeView = {
  ws: null,
  connected: false,

  render(container) {
    container.innerHTML = `
      <h1 class="page-title">📱 WhatsApp</h1>

      <div class="card" style="margin-bottom:16px">
        <div class="flex items-center justify-between mb-16">
          <div>
            <div class="fw-600">Status da conexão</div>
            <div class="text-sm text-muted mt-8" id="qr-status-text">Verificando...</div>
          </div>
          <div id="qr-status-dot" class="bot-status-badge">
            <div class="dot"></div>
            <span>Offline</span>
          </div>
        </div>

        <div id="qr-area" class="qr-container">
          <div class="qr-frame">
            <div class="qr-placeholder">
              <div class="spinner"></div>
              <span>Aguardando QR Code...</span>
            </div>
          </div>
          <div id="qr-instructions" class="text-sm text-muted" style="text-align:center;max-width:280px;line-height:1.6">
            Abra o WhatsApp no celular que vai atender<br>
            <strong>Dispositivos Vinculados → Vincular dispositivo</strong><br>
            e escaneie o QR acima.
          </div>

          <p style="text-align:center;margin-top:14px">
            <a href="#" id="toggle-pairing-code" class="text-sm">Só tenho esse celular, não consigo escanear →</a>
          </p>

          <div id="pairing-code-box" class="hidden" style="width:100%;max-width:320px;margin:8px auto 0">
            <p class="text-sm text-muted" style="text-align:center;line-height:1.6;margin-bottom:12px">
              Digite o número que vai atender. Vamos gerar um código — aí no mesmo celular, abra o WhatsApp em
              <strong>Dispositivos Vinculados → Vincular dispositivo → Vincular com número de telefone</strong>
              e digite o código.
            </p>
            <div class="form-group">
              <input id="pairing-phone" type="tel" class="form-input" placeholder="5511999999999 (DDI + DDD + número)">
            </div>
            <button id="pairing-code-btn" class="btn btn-primary btn-full">Gerar código</button>
            <p id="pairing-code-error" class="text-sm text-red mt-8 hidden" style="text-align:center"></p>
            <div id="pairing-code-result" class="hidden" style="text-align:center;margin-top:16px">
              <div class="text-sm text-muted mb-8">Código de pareamento:</div>
              <div id="pairing-code-value" style="font-size:1.8rem;font-weight:700;letter-spacing:3px;color:var(--text-primary)"></div>
              <p class="text-sm text-muted mt-8">Válido por poucos minutos — se expirar, gere outro.</p>
            </div>
          </div>
        </div>

        <div id="connected-state" class="hidden" style="text-align:center;padding:24px 0">
          <div style="font-size:3rem;margin-bottom:12px">✅</div>
          <div class="fw-600" style="color:var(--green);font-size:1.1rem">WhatsApp Conectado!</div>
          <p class="text-sm text-muted mt-8">O bot está ativo e respondendo automaticamente.</p>
          <button class="btn btn-ghost btn-full" style="margin-top:20px"
            onclick="QRCodeView.disconnect()">
            Desconectar
          </button>
        </div>
      </div>

      <div class="card">
        <div class="fw-600 mb-16">ℹ️ Como funciona</div>
        <p class="text-sm text-muted" style="line-height:1.7">
          1. O WhatsApp da Lívia precisa ficar conectado à internet.<br>
          2. O bot responde automaticamente às mensagens recebidas.<br>
          3. Lembretes de renovação são enviados todo dia às 9h.<br>
          4. Se o celular ficar sem internet, o bot reconecta automaticamente.
        </p>
      </div>
    `;

    this.connectWebSocket();
    this.setupPairingCode();
  },

  setupPairingCode() {
    const toggle = document.getElementById('toggle-pairing-code');
    const box    = document.getElementById('pairing-code-box');
    const btn    = document.getElementById('pairing-code-btn');
    const phone  = document.getElementById('pairing-phone');
    const err    = document.getElementById('pairing-code-error');
    const result = document.getElementById('pairing-code-result');
    const value  = document.getElementById('pairing-code-value');

    toggle.onclick = (e) => {
      e.preventDefault();
      box.classList.toggle('hidden');
    };

    btn.onclick = async () => {
      err.classList.add('hidden');
      result.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Gerando...';
      try {
        const res = await api.post('/api/bot/pairing-code', { phone: phone.value });
        if (res?.code) {
          const code = res.code;
          value.textContent = code.length === 8 ? `${code.slice(0,4)}-${code.slice(4)}` : code;
          result.classList.remove('hidden');
        }
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Gerar código';
      }
    };
  },

  connectWebSocket() {
    // Fecha conexão anterior se existir
    if (this.ws) { this.ws.close(); this.ws = null; }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url      = `${protocol}//${location.host}/ws/qr`;

    this.ws = new WebSocket(url);

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'qr')          this.showQr(msg.data);
        if (msg.type === 'connected')   this.showConnected();
        if (msg.type === 'disconnected')this.showDisconnected();
      } catch {}
    };

    this.ws.onerror = () => {
      // Fallback: usa polling REST
      this.pollStatus();
    };

    this.ws.onclose = () => {
      if (this.connected) return; // já mostrou estado conectado
      setTimeout(() => {
        if (document.getElementById('qr-area')) this.connectWebSocket();
      }, 5000);
    };
  },

  async pollStatus() {
    try {
      const s = await api.get('/api/bot/status');
      if (s?.connected) this.showConnected();
      else if (!s?.hasQr) this.showDisconnected();
    } catch {}
  },

  showQr(dataUrl) {
    const qrArea = document.getElementById('qr-area');
    const conn   = document.getElementById('connected-state');
    if (!qrArea) return;

    qrArea.classList.remove('hidden');
    conn.classList.add('hidden');
    this.connected = false;

    // Atualiza status badge
    this.updateStatusBadge(false, true);

    qrArea.querySelector('.qr-frame').innerHTML = `
      <img src="${dataUrl}" alt="QR Code WhatsApp" style="width:100%;height:100%">
      <div class="qr-scanning-line"></div>
    `;
  },

  showConnected() {
    const qrArea = document.getElementById('qr-area');
    const conn   = document.getElementById('connected-state');
    if (!conn) return;

    this.connected = true;
    qrArea?.classList.add('hidden');
    conn.classList.remove('hidden');
    this.updateStatusBadge(true, false);
    document.getElementById('qr-status-text').textContent = 'Conectado e ativo';
  },

  showDisconnected() {
    this.connected = false;
    this.updateStatusBadge(false, false);
    const qrArea = document.getElementById('qr-area');
    if (qrArea) {
      qrArea.classList.remove('hidden');
      qrArea.querySelector('.qr-frame').innerHTML = `
        <div class="qr-placeholder">
          <div class="spinner"></div>
          <span>Gerando QR Code...</span>
        </div>`;
    }
    document.getElementById('qr-status-text').textContent = 'Aguardando conexão...';
  },

  updateStatusBadge(connected, hasQr) {
    const badge = document.getElementById('qr-status-dot');
    if (!badge) return;
    if (connected) {
      badge.className = 'bot-status-badge connected';
      badge.innerHTML = '<div class="dot"></div><span>Conectado</span>';
    } else if (hasQr) {
      badge.className = 'bot-status-badge';
      badge.innerHTML = '<div class="dot" style="background:var(--orange)"></div><span>Aguardando scan</span>';
    } else {
      badge.className = 'bot-status-badge';
      badge.innerHTML = '<div class="dot"></div><span>Offline</span>';
    }
  },

  disconnect() {
    if (!confirm('Tem certeza que deseja desconectar o WhatsApp?\nVocê precisará escanear o QR Code novamente.')) return;
    showToast('Desconectando...', 'success');
    // O backend detecta a desconexão e limpa a sessão ao receber loggedOut
    // TODO: implementar endpoint POST /api/bot/disconnect se necessário
    showToast('Para desconectar completamente, vá no WhatsApp > Dispositivos Vinculados e remova este dispositivo.', 'success', 6000);
  },
};
