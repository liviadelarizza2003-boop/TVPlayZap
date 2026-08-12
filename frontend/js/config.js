/* ============================================================
   config.js — Tela de Configurações (SettingsView)
   Seções:
     1. Configurações do Negócio (nome, telefone dono, horário)
     2. Mensagens Automáticas (fallback, fora do horário, lembrete)
     3. FAQ — Gerenciar Respostas Ativas
     4. Ferramentas (testar lembrete, trocar senha)
   ============================================================ */

'use strict';

const SettingsView = {

  async render(container) {
    container.innerHTML = `
      <h1 class="page-title">⚙️ Configurações</h1>

      <!-- ── Tabs ───────────────────────────────────────── -->
      <div class="tabs" id="cfg-tabs">
        <button class="tab active" data-tab="business">Negócio</button>
        <button class="tab" data-tab="messages">Mensagens</button>
        <button class="tab" data-tab="faq">FAQ</button>
        <button class="tab" data-tab="tools">Ferramentas</button>
      </div>

      <div id="cfg-panel" class="tab-panel"></div>
    `;

    // Inicializa navegação por tabs
    document.querySelectorAll('#cfg-tabs .tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#cfg-tabs .tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderTab(btn.dataset.tab);
      });
    });

    // Carrega configurações e abre primeira aba
    try {
      this._cfg = await api.get('/api/config') || {};
    } catch {
      this._cfg = {};
    }
    this.renderTab('business');
  },

  /* ── Roteador de tabs ──────────────────────────────── */
  renderTab(tab) {
    const panel = document.getElementById('cfg-panel');
    if (!panel) return;
    const map = {
      business: () => this.renderBusiness(panel),
      messages:  () => this.renderMessages(panel),
      faq:       () => this.renderFaq(panel),
      tools:     () => this.renderTools(panel),
    };
    (map[tab] || map.business)();
  },

  /* ══════════════════════════════════════════════════════
     1. NEGÓCIO
  ══════════════════════════════════════════════════════ */
  renderBusiness(panel) {
    const c = this._cfg;
    panel.innerHTML = `
      <div class="card" style="margin-top:0">
        <p class="card-label">Nome do negócio</p>
        <input id="cfg-business-name" class="form-input" type="text"
               value="${_esc(c.business_name || '')}" placeholder="Ex: Pet Shop da Livia">

        <p class="card-label" style="margin-top:16px">Seu telefone (dono)</p>
        <p class="form-hint">Formato: 5511999999999 (com código do país, sem espaços)</p>
        <input id="cfg-owner-phone" class="form-input" type="tel"
               value="${_esc(c.owner_phone || '')}" placeholder="5511999999999">

        <p class="card-label" style="margin-top:16px">Horário de atendimento</p>
        <div style="display:flex;gap:12px;align-items:center">
          <div style="flex:1">
            <label class="form-label">Início (h)</label>
            <input id="cfg-hours-start" class="form-input" type="number" min="0" max="23"
                   value="${_esc(c.working_hours_start || '9')}">
          </div>
          <span style="color:var(--text-muted);padding-top:20px">até</span>
          <div style="flex:1">
            <label class="form-label">Fim (h)</label>
            <input id="cfg-hours-end" class="form-input" type="number" min="0" max="23"
                   value="${_esc(c.working_hours_end || '18')}">
          </div>
        </div>

        <button id="cfg-save-business" class="btn btn-primary" style="margin-top:20px;width:100%">
          💾 Salvar configurações
        </button>
      </div>
    `;

    document.getElementById('cfg-save-business').onclick = async () => {
      const btn = document.getElementById('cfg-save-business');
      btn.disabled = true;
      btn.textContent = 'Salvando...';
      try {
        await api.patch('/api/config', {
          business_name:       document.getElementById('cfg-business-name').value.trim(),
          owner_phone:         document.getElementById('cfg-owner-phone').value.replace(/\D/g,''),
          working_hours_start: document.getElementById('cfg-hours-start').value,
          working_hours_end:   document.getElementById('cfg-hours-end').value,
        });
        // Atualiza nome no header
        const name = document.getElementById('cfg-business-name').value.trim();
        if (name) document.getElementById('business-name-header').textContent = name;
        // Atualiza cache local
        this._cfg = await api.get('/api/config') || this._cfg;
        showToast('Configurações salvas!');
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Salvar configurações';
      }
    };
  },

  /* ══════════════════════════════════════════════════════
     2. MENSAGENS AUTOMÁTICAS
  ══════════════════════════════════════════════════════ */
  renderMessages(panel) {
    const c = this._cfg;
    panel.innerHTML = `
      <div class="card" style="margin-top:0">
        <p class="card-label">Mensagem quando não entende a pergunta</p>
        <p class="form-hint">Enviada quando nenhuma resposta do FAQ foi encontrada.</p>
        <textarea id="cfg-fallback" class="form-input" rows="3"
          placeholder="Olá! Vou chamar a Lívia para você 😊">${_esc(c.fallback_message || '')}</textarea>

        <p class="card-label" style="margin-top:20px">Mensagem fora do horário</p>
        <p class="form-hint">Use <code>{start}</code> e <code>{end}</code> para inserir os horários.</p>
        <textarea id="cfg-offhours" class="form-input" rows="3"
          placeholder="Olá! Nosso horário é das {start}h às {end}h...">${_esc(c.off_hours_message || '')}</textarea>

        <p class="card-label" style="margin-top:20px">Mensagem de lembrete de vencimento</p>
        <p class="form-hint">Use <code>{name}</code>, <code>{plan}</code> e <code>{due_date}</code>.</p>
        <textarea id="cfg-reminder" class="form-input" rows="3"
          placeholder="Olá, {name}! Seu plano {plan} vence dia {due_date}...">${_esc(c.reminder_message || '')}</textarea>

        <button id="cfg-save-messages" class="btn btn-primary" style="margin-top:20px;width:100%">
          💾 Salvar mensagens
        </button>
      </div>
    `;

    document.getElementById('cfg-save-messages').onclick = async () => {
      const btn = document.getElementById('cfg-save-messages');
      btn.disabled = true;
      btn.textContent = 'Salvando...';
      try {
        await api.patch('/api/config', {
          fallback_message:  document.getElementById('cfg-fallback').value.trim(),
          off_hours_message: document.getElementById('cfg-offhours').value.trim(),
          reminder_message:  document.getElementById('cfg-reminder').value.trim(),
        });
        this._cfg = await api.get('/api/config') || this._cfg;
        showToast('Mensagens salvas!');
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Salvar mensagens';
      }
    };
  },

  /* ══════════════════════════════════════════════════════
     3. FAQ — GERENCIAR RESPOSTAS ATIVAS
  ══════════════════════════════════════════════════════ */
  async renderFaq(panel) {
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-weight:600;color:var(--text)">Respostas automáticas ativas</span>
        <button id="faq-add-btn" class="btn btn-primary" style="font-size:0.8rem;padding:8px 14px">
          + Nova resposta
        </button>
      </div>
      <div id="faq-list"><div class="spinner" style="margin:24px auto"></div></div>
    `;

    document.getElementById('faq-add-btn').onclick = () => this.openFaqDrawer(null);
    await this.loadFaqList();
  },

  async loadFaqList() {
    const list = document.getElementById('faq-list');
    if (!list) return;
    try {
      const items = await api.get('/api/faq') || [];
      if (!items.length) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🤖</div>
            <p>Nenhuma resposta no FAQ ainda.<br>Clique em <strong>+ Nova resposta</strong> para começar!</p>
          </div>`;
        return;
      }
      list.innerHTML = items.map(item => `
        <div class="list-item faq-row" data-id="${item.id}">
          <div class="list-item-info" style="overflow:hidden">
            <div class="list-item-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${_esc(item.question)}
            </div>
            <div class="list-item-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${_esc(item.answer)}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px">
            ${item.is_active
              ? `<span class="list-item-badge badge-ok" style="cursor:pointer" data-toggle="${item.id}">Ativa</span>`
              : `<span class="list-item-badge badge-today" style="cursor:pointer" data-toggle="${item.id}">Inativa</span>`}
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:0.75rem" data-edit="${item.id}">✏️</button>
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:0.75rem;color:var(--red)" data-del="${item.id}">🗑</button>
          </div>
        </div>
      `).join('');

      // Edit
      list.querySelectorAll('[data-edit]').forEach(btn => {
        const id = Number(btn.dataset.edit);
        btn.onclick = () => this.openFaqDrawer(items.find(i => i.id === id));
      });

      // Toggle active
      list.querySelectorAll('[data-toggle]').forEach(badge => {
        const id = Number(badge.dataset.toggle);
        badge.onclick = async () => {
          const item = items.find(i => i.id === id);
          try {
            await api.patch(`/api/faq/${id}`, { is_active: !item.is_active });
            showToast(item.is_active ? 'Resposta desativada' : 'Resposta ativada');
            await this.loadFaqList();
          } catch (e) {
            showToast(e.message, 'error');
          }
        };
      });

      // Delete
      list.querySelectorAll('[data-del]').forEach(btn => {
        const id = Number(btn.dataset.del);
        btn.onclick = () => this.confirmDeleteFaq(id);
      });
    } catch (e) {
      list.innerHTML = `<p style="color:var(--red);padding:16px">${e.message}</p>`;
    }
  },

  openFaqDrawer(item) {
    const isNew = !item;
    const html = `
      <div class="drawer-title">${isNew ? '➕ Nova Resposta' : '✏️ Editar Resposta'}</div>
      <div class="form-group">
        <label class="form-label">Pergunta / Gatilho</label>
        <input id="df-question" class="form-input" type="text"
               placeholder="Ex: Qual o horário de funcionamento?"
               value="${_esc(item?.question || '')}">
        <p class="form-hint">Frase que o cliente vai enviar para acionar esta resposta.</p>
      </div>
      <div class="form-group">
        <label class="form-label">Resposta automática</label>
        <textarea id="df-answer" class="form-input" rows="4"
          placeholder="Ex: Funcionamos de segunda a sábado, das 8h às 18h! 😊">${_esc(item?.answer || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Palavras-chave extras <span style="color:var(--text-muted)">(opcional)</span></label>
        <input id="df-keywords" class="form-input" type="text"
               placeholder="Ex: horario, abre, fecha, funcionamento"
               value="${_esc(item?.keywords || '')}">
        <p class="form-hint">Separadas por vírgula. Ajudam o bot a reconhecer variações.</p>
      </div>
      <button id="df-save" class="btn btn-primary" style="width:100%;margin-top:8px">
        ${isNew ? '➕ Adicionar ao FAQ' : '💾 Salvar alterações'}
      </button>
      ${!isNew ? `<button id="df-delete" class="btn btn-ghost" style="width:100%;margin-top:8px;color:var(--red)">🗑 Excluir esta resposta</button>` : ''}
    `;

    const closeDrawer = openDrawer(html);

    document.getElementById('df-save').onclick = async () => {
      const question = document.getElementById('df-question').value.trim();
      const answer   = document.getElementById('df-answer').value.trim();
      const keywords = document.getElementById('df-keywords').value.trim();

      if (!question || !answer) {
        showToast('Preencha a pergunta e a resposta!', 'error');
        return;
      }

      const btn = document.getElementById('df-save');
      btn.disabled = true;
      btn.textContent = 'Salvando...';

      try {
        if (isNew) {
          await api.post('/api/faq', { question, answer, keywords });
          showToast('Resposta adicionada ao FAQ!');
        } else {
          await api.patch(`/api/faq/${item.id}`, { question, answer, keywords });
          showToast('Resposta atualizada!');
        }
        closeDrawer();
        await this.loadFaqList();
      } catch (e) {
        showToast(e.message, 'error');
        btn.disabled = false;
        btn.textContent = isNew ? '➕ Adicionar ao FAQ' : '💾 Salvar alterações';
      }
    };

    if (!isNew) {
      document.getElementById('df-delete').onclick = () => {
        closeDrawer();
        this.confirmDeleteFaq(item.id);
      };
    }
  },

  confirmDeleteFaq(id) {
    const html = `
      <div class="drawer-title">🗑 Excluir resposta?</div>
      <p style="color:var(--text-muted);margin-bottom:20px;line-height:1.5">
        Esta resposta será removida permanentemente do FAQ.<br>O bot não vai mais usá-la.
      </p>
      <button id="df-confirm-del" class="btn btn-primary" style="width:100%;background:var(--red);border-color:var(--red)">
        Sim, excluir
      </button>
      <button id="df-cancel-del" class="btn btn-ghost" style="width:100%;margin-top:8px">
        Cancelar
      </button>
    `;
    const close = openDrawer(html);
    document.getElementById('df-cancel-del').onclick = close;
    document.getElementById('df-confirm-del').onclick = async () => {
      try {
        await api.del(`/api/faq/${id}`);
        showToast('Resposta excluída.');
        close();
        await this.loadFaqList();
      } catch (e) {
        showToast(e.message, 'error');
      }
    };
  },

  /* ══════════════════════════════════════════════════════
     4. FERRAMENTAS
  ══════════════════════════════════════════════════════ */
  renderTools(panel) {
    panel.innerHTML = `
      <!-- Testar lembretes -->
      <div class="card" style="margin-top:0">
        <p class="card-label">📨 Testar lembretes de vencimento</p>
        <p class="form-hint" style="margin-bottom:12px">
          Dispara agora o envio de lembretes para clientes que vencem em 3 dias.
          Útil para verificar se a mensagem chegou corretamente.
        </p>
        <button id="tool-test-reminder" class="btn btn-primary" style="width:100%">
          ▶️ Disparar lembretes agora
        </button>
        <div id="tool-reminder-result" style="display:none;margin-top:12px"></div>
      </div>

      <!-- Trocar senha -->
      <div class="card">
        <p class="card-label">🔑 Trocar senha do painel</p>
        <div class="form-group">
          <label class="form-label">Nova senha <span style="color:var(--text-muted)">(mín. 6 caracteres)</span></label>
          <input id="tool-new-pass" class="form-input" type="password"
                 placeholder="Digite a nova senha" autocomplete="new-password">
        </div>
        <div class="form-group">
          <label class="form-label">Confirmar nova senha</label>
          <input id="tool-confirm-pass" class="form-input" type="password"
                 placeholder="Repita a nova senha" autocomplete="new-password">
        </div>
        <button id="tool-change-pass" class="btn btn-primary" style="width:100%">
          🔑 Alterar senha
        </button>
      </div>

      <!-- Logout -->
      <div class="card">
        <p class="card-label">👋 Sair do painel</p>
        <p class="form-hint" style="margin-bottom:12px">
          Encerra sua sessão neste dispositivo.
        </p>
        <button id="tool-logout" class="btn btn-ghost" style="width:100%;color:var(--red)">
          Sair
        </button>
      </div>
    `;

    // Testar lembrete
    document.getElementById('tool-test-reminder').onclick = async () => {
      const btn    = document.getElementById('tool-test-reminder');
      const result = document.getElementById('tool-reminder-result');
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      result.style.display = 'none';
      try {
        const r = await api.post('/api/config/test-reminder', {});
        result.style.display = 'block';
        if (r?.sent > 0 || r?.errors?.length > 0) {
          const errHtml = r.errors?.length
            ? `<p style="color:var(--red);margin-top:6px">⚠️ ${r.errors.length} erro(s): ${r.errors.map(e => e.client).join(', ')}</p>`
            : '';
          result.innerHTML = `
            <div class="stat-card green" style="padding:12px 16px;margin:0">
              <span>✅ ${r.sent} lembrete(s) enviado(s)${errHtml ? '' : '!'}</span>
              ${errHtml}
            </div>`;
          showToast(`${r.sent} lembrete(s) enviado(s).`);
        } else {
          result.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:8px">
            Nenhum cliente vencendo em exatamente 3 dias, ou lembretes já foram enviados.
          </p>`;
        }
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '▶️ Disparar lembretes agora';
      }
    };

    // Trocar senha
    document.getElementById('tool-change-pass').onclick = async () => {
      const pass    = document.getElementById('tool-new-pass').value;
      const confirm = document.getElementById('tool-confirm-pass').value;

      if (!pass || pass.length < 6) {
        showToast('A senha deve ter ao menos 6 caracteres.', 'error'); return;
      }
      if (pass !== confirm) {
        showToast('As senhas não coincidem.', 'error'); return;
      }

      const btn = document.getElementById('tool-change-pass');
      btn.disabled = true;
      btn.textContent = 'Alterando...';
      try {
        await api.post('/api/auth/change-password', { newPassword: pass });
        showToast('Senha alterada com sucesso! 🎉');
        document.getElementById('tool-new-pass').value    = '';
        document.getElementById('tool-confirm-pass').value = '';
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '🔑 Alterar senha';
      }
    };

    // Logout
    document.getElementById('tool-logout').onclick = () => App.logout();
  },
};

/* ── helpers ───────────────────────────────────────────────── */

/** Escapa HTML para evitar XSS em atributos e textos */
function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
