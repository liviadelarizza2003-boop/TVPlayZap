/* ============================================================
   clients.js — Gestão de clientes e vencimentos
   ============================================================ */

const ClientsView = {
  clients: [],
  searchTerm: '',

  async render(container) {
    container.innerHTML = `
      <div class="flex items-center justify-between mb-16">
        <h1 class="page-title" style="margin:0">Clientes</h1>
      </div>
      <div class="form-group">
        <input id="client-search" type="search" class="form-input"
          placeholder="🔍  Buscar por nome, telefone ou plano..."
          value="${this.searchTerm}">
      </div>
      <div id="clients-list"><div class="spinner" style="margin:24px auto"></div></div>
    `;

    // FAB para adicionar
    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.title = 'Novo cliente';
    fab.innerHTML = '+';
    fab.onclick = () => this.openForm();
    document.body.appendChild(fab);

    document.getElementById('client-search').addEventListener('input', e => {
      this.searchTerm = e.target.value;
      this.renderList();
    });

    await this.loadClients();
  },

  async loadClients() {
    try {
      this.clients = await api.get('/api/clients?active=true') || [];
      this.renderList();
    } catch (e) {
      showToast('Erro ao carregar clientes', 'error');
    }
  },

  renderList() {
    const list = document.getElementById('clients-list');
    if (!list) return;

    const term = this.searchTerm.toLowerCase();
    const filtered = this.clients.filter(c =>
      !term ||
      c.name?.toLowerCase().includes(term) ||
      c.phone?.includes(term) ||
      c.plan?.toLowerCase().includes(term)
    );

    // Ordena por vencimento mais próximo primeiro
    filtered.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });

    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state">
        <div class="empty-icon">👥</div>
        <p>${this.searchTerm ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.<br>Toque no + para adicionar!'}</p>
      </div>`;
      return;
    }

    list.innerHTML = filtered.map(c => `
      <div class="list-item" onclick="ClientsView.openForm(${c.id})">
        <div class="list-item-avatar">${initials(c.name)}</div>
        <div class="list-item-info">
          <div class="list-item-name">${c.name}</div>
          <div class="list-item-sub">📱 ${c.phone}${c.plan ? ` · ${c.plan}` : ''}</div>
        </div>
        ${c.is_trial ? '<span class="list-item-badge badge-soon">Em trial</span>' : dueBadge(c.due_date)}
      </div>`).join('');
  },

  openForm(id) {
    const client = id ? this.clients.find(c => c.id === id) : null;
    const isEdit = !!client;

    const closeDrawer = openDrawer(`
      <h2 class="drawer-title">${isEdit ? '✏️ Editar Cliente' : '➕ Novo Cliente'}</h2>
      <form id="client-form">
        <div class="form-group">
          <label class="form-label">Nome completo *</label>
          <input class="form-input" name="name" required value="${client?.name || ''}" placeholder="Ex: Maria Silva">
        </div>
        <div class="form-group">
          <label class="form-label">WhatsApp (com DDD e código do país) *</label>
          <input class="form-input" name="phone" required type="tel"
            value="${client?.phone || ''}" placeholder="5511999999999">
        </div>
        <div class="form-group">
          <label class="form-label">Plano / Serviço</label>
          <input class="form-input" name="plan" value="${client?.plan || ''}" placeholder="Ex: Plano Mensal">
        </div>
        <div class="form-group">
          <label class="form-label">Data de vencimento</label>
          <input class="form-input" name="due_date" type="date" value="${client?.due_date || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Observações</label>
          <textarea class="form-textarea" name="notes" placeholder="Notas internas...">${client?.notes || ''}</textarea>
        </div>
        ${!isEdit ? `
        <div class="form-group" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" name="is_trial" id="cf-trial" value="1" style="width:18px;height:18px">
          <label class="form-label" for="cf-trial" style="margin:0;text-transform:none;letter-spacing:normal">
            Iniciar trial de 24h (envia mensagem perguntando se quer assinar depois de 24h)
          </label>
        </div>` : ''}
        ${isEdit && client?.is_trial ? `
        <div class="card" style="margin:0 0 18px;background:var(--bg-card-hover)">
          <p class="text-sm" style="margin-bottom:10px">👤 Este cliente está em período de teste.</p>
          <button type="button" class="btn btn-success btn-full" onclick="ClientsView.renewClient(${id})">
            🔄 Assinou! Registrar renovação agora
          </button>
        </div>` : ''}
        ${isEdit && !client?.is_trial ? `
        <button type="button" class="btn btn-ghost btn-full" style="margin-bottom:12px" onclick="ClientsView.renewClient(${id})">
          🔄 Renovar agora (define vencimento a partir de hoje)
        </button>` : ''}
        ${isEdit ? `
        <button type="button" class="btn btn-ghost btn-full" style="margin-bottom:18px" onclick="ClientsView.sendReminderNow(${id})">
          📨 Enviar lembrete agora
        </button>
        <p class="form-hint" style="margin-top:-10px;margin-bottom:18px">
          Útil se esqueceu de cadastrar o cliente a tempo do lembrete automático — manda a mensagem de lembrete pra ele agora mesmo.
        </p>` : ''}
        <div class="flex gap-8 mt-16">
          ${isEdit ? `<button type="button" class="btn btn-danger" onclick="ClientsView.deleteClient(${id})">🗑 Remover</button>` : ''}
          <button type="submit" class="btn btn-primary" style="flex:1">${isEdit ? 'Salvar alterações' : 'Cadastrar cliente'}</button>
        </div>
      </form>
    `);

    document.getElementById('client-form').onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      data.is_trial = !!data.is_trial;
      try {
        if (isEdit) {
          await api.patch(`/api/clients/${id}`, data);
          showToast('Cliente atualizado!');
        } else {
          await api.post('/api/clients', data);
          showToast('Cliente cadastrado!');
        }
        closeDrawer();
        await this.loadClients();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  },

  async sendReminderNow(id) {
    try {
      await api.post(`/api/clients/${id}/send-reminder`, {});
      showToast('Lembrete enviado! 📨');
    } catch (e) {
      showToast(e.message, 'error');
    }
  },

  async renewClient(id) {
    try {
      await api.post(`/api/clients/${id}/renew`, {});
      showToast('Renovação registrada! Vencimento atualizado. 🎉');
      document.getElementById('overlay').click(); // fecha drawer
      await this.loadClients();
    } catch (e) {
      showToast(e.message, 'error');
    }
  },

  async deleteClient(id) {
    if (!confirm('Remover este cliente?')) return;
    try {
      await api.del(`/api/clients/${id}`);
      showToast('Cliente removido.');
      document.getElementById('overlay').click(); // fecha drawer
      await this.loadClients();
    } catch (e) {
      showToast(e.message, 'error');
    }
  },
};
