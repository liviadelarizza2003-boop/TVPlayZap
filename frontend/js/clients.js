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
        ${dueBadge(c.due_date)}
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
        <div class="flex gap-8 mt-16">
          ${isEdit ? `<button type="button" class="btn btn-danger" onclick="ClientsView.deleteClient(${id})">🗑 Remover</button>` : ''}
          <button type="submit" class="btn btn-primary" style="flex:1">${isEdit ? 'Salvar alterações' : 'Cadastrar cliente'}</button>
        </div>
      </form>
    `);

    document.getElementById('client-form').onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
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
