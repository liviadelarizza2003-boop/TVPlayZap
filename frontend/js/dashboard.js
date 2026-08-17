/* ============================================================
   dashboard.js — Tela inicial com stats e vencimentos
   ============================================================ */

const DashboardView = {
  async render(container) {
    container.innerHTML = `
      <h1 class="page-title">Olá, Lívia! 👋</h1>
      <div class="stats-grid" id="stats-grid">
        ${[1,2,3,4].map(() => `
          <div class="stat-card">
            <div class="stat-value" style="color:var(--text-muted)">—</div>
            <div class="stat-label" style="color:var(--text-muted)">Carregando...</div>
          </div>`).join('')}
      </div>
      <div class="section-header">
        <span class="section-title">📅 Vencimentos Próximos</span>
        <button class="btn btn-ghost" style="font-size:0.8rem;padding:6px 12px"
          onclick="App.navigate('clients')">Ver todos</button>
      </div>
      <div id="expiring-list"><div class="spinner" style="margin:24px auto"></div></div>
    `;

    // Carrega stats e vencimentos em paralelo
    const [stats, expiring] = await Promise.all([
      api.get('/api/config/stats'),
      api.get('/api/clients/expiring?days=7'),
    ]);

    if (stats) this.renderStats(stats);
    if (expiring) this.renderExpiring(expiring);
  },

  renderStats(s) {
    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card accent">
        <div class="stat-icon">👥</div>
        <div class="stat-value">${s.totalClients}</div>
        <div class="stat-label">Clientes ativos</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-icon">⏰</div>
        <div class="stat-value">${s.expiring3days}</div>
        <div class="stat-label">Vencem em 3 dias</div>
      </div>
      <div class="stat-card green">
        <div class="stat-icon">🤖</div>
        <div class="stat-value">${s.autoAnswered}</div>
        <div class="stat-label">Auto-respondidas hoje</div>
      </div>
      <div class="stat-card pink">
        <div class="stat-icon">🎓</div>
        <div class="stat-value">${s.pendingTraining}</div>
        <div class="stat-label">Para revisar</div>
      </div>
    `;
  },

  renderExpiring(clients) {
    const list = document.getElementById('expiring-list');
    if (!clients.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎉</div>
          <p>Nenhum cliente vencendo nos próximos 7 dias!</p>
        </div>`;
      return;
    }

    list.innerHTML = clients.map(c => `
      <div class="list-item" onclick="DashboardView.openClient(${c.id})">
        <div class="list-item-avatar">${initials(c.name)}</div>
        <div class="list-item-info">
          <div class="list-item-name">${c.name}</div>
          <div class="list-item-sub">${c.plan || 'Sem plano definido'}</div>
        </div>
        ${dueBadge(c.due_date)}
      </div>`).join('');
  },

  /** Vai pra tela de Clientes e já abre o formulário do cliente clicado */
  async openClient(id) {
    App.navigate('clients');
    await ClientsView.loadClients();
    ClientsView.openForm(id);
  },
};
