/* ============================================================
   training.js — "Treinar a Livia" (curadoria do FAQ)
   ============================================================ */

const TrainingView = {
  candidates: [],
  faqItems:   [],
  tab:        'candidates', // 'candidates' | 'faq'

  async render(container) {
    container.innerHTML = `
      <h1 class="page-title">🎓 Treinar a Livia</h1>

      <!-- Tabs -->
      <div class="flex gap-8 mb-16" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:4px">
        <button id="tab-candidates" class="btn btn-primary" style="flex:1;justify-content:center;padding:8px 12px;font-size:0.82rem"
          onclick="TrainingView.switchTab('candidates')">
          ✨ Sugestões da IA
        </button>
        <button id="tab-faq" class="btn btn-ghost" style="flex:1;justify-content:center;padding:8px 12px;font-size:0.82rem"
          onclick="TrainingView.switchTab('faq')">
          📚 FAQ Ativo
        </button>
      </div>

      <!-- Onboarding Banner (visível se não tem candidatas nem FAQ) -->
      <div id="onboarding-banner" class="card hidden" style="margin-bottom:16px;text-align:center">
        <div style="font-size:2rem;margin-bottom:10px">🚀</div>
        <div style="font-weight:600;margin-bottom:6px">Gerar FAQ do histórico</div>
        <p class="text-sm text-muted" style="margin-bottom:16px;line-height:1.5">
          Conecte o WhatsApp e clique abaixo para analisar suas conversas anteriores e gerar respostas automáticas sugeridas.
        </p>
        <button class="btn btn-primary btn-full" onclick="TrainingView.startAnalysis()">
          ✨ Analisar histórico de conversas
        </button>
        <div id="analysis-progress" class="hidden" style="margin-top:14px">
          <div class="text-sm text-muted mb-8" id="analysis-status-text">Iniciando análise...</div>
          <div class="progress-wrap">
            <div class="progress-bar" id="analysis-bar" style="width:0%"></div>
          </div>
        </div>
      </div>

      <div id="tab-content"></div>
    `;

    // FAB para adicionar resposta manualmente
    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.title = 'Nova resposta';
    fab.innerHTML = '+';
    fab.onclick = () => this.openFaqForm();
    document.body.appendChild(fab);

    await this.loadAll();
  },

  async loadAll() {
    const [candidates, faq] = await Promise.all([
      api.get('/api/faq/candidates'),
      api.get('/api/faq'),
    ]);
    this.candidates = candidates || [];
    this.faqItems   = faq || [];

    // Mostra banner de onboarding se não tem nada
    const banner = document.getElementById('onboarding-banner');
    if (banner && this.candidates.length === 0 && this.faqItems.length === 0) {
      banner.classList.remove('hidden');
    }

    this.renderTab();
    App.refreshTrainingBadge();
  },

  switchTab(tab) {
    this.tab = tab;
    document.getElementById('tab-candidates').className =
      tab === 'candidates' ? 'btn btn-primary' : 'btn btn-ghost';
    document.getElementById('tab-faq').className =
      tab === 'faq' ? 'btn btn-primary' : 'btn btn-ghost';

    // Ajusta estilo dos botões de tab manualmente
    ['candidates','faq'].forEach(t => {
      const btn = document.getElementById(`tab-${t}`);
      btn.style.flex = '1';
      btn.style.justifyContent = 'center';
      btn.style.padding = '8px 12px';
      btn.style.fontSize = '0.82rem';
    });

    this.renderTab();
  },

  renderTab() {
    const content = document.getElementById('tab-content');
    if (!content) return;

    if (this.tab === 'candidates') {
      this.renderCandidates(content);
    } else {
      this.renderFaq(content);
    }
  },

  renderCandidates(container) {
    if (!this.candidates.length) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-icon">✨</div>
        <p>Nenhuma sugestão pendente.<br>Use o botão acima para analisar o histórico ou adicione respostas manualmente com o +</p>
      </div>`;
      return;
    }

    container.innerHTML = this.candidates.map(c => `
      <div class="training-card" id="card-${c.id}">
        <div class="ai-label">✨ Sugestão da IA</div>

        <div class="question-text" id="q-text-${c.id}">${escapeHtml(c.question)}</div>

        <div class="answer-text" id="a-text-${c.id}" contenteditable="true"
          style="outline:none;cursor:text" spellcheck="true"
          title="Clique para editar a resposta">
          ${escapeHtml(c.answer)}
        </div>

        ${c.source_messages?.length ? `
          <div class="source-msgs">
            <strong style="color:var(--text-secondary)">Baseado em:</strong><br>
            ${c.source_messages.slice(0,3).map(m =>
              `<span>"${escapeHtml(m.slice(0,60))}${m.length > 60 ? '…' : ''}"</span>`
            ).join('')}
          </div>` : ''}

        <div class="training-actions">
          <button class="btn btn-success" onclick="TrainingView.approve(${c.id})">✅ Aprovar</button>
          <button class="btn btn-ghost"   onclick="TrainingView.editInline(${c.id})">✏️ Editar</button>
          <button class="btn btn-danger"  onclick="TrainingView.reject(${c.id})">✖ Descartar</button>
        </div>
      </div>`).join('');
  },

  renderFaq(container) {
    if (!this.faqItems.length) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-icon">📚</div>
        <p>Nenhuma resposta cadastrada ainda.<br>Aprove sugestões ou toque no + para adicionar manualmente.</p>
      </div>`;
      return;
    }

    container.innerHTML = this.faqItems.map(f => `
      <div class="list-item" onclick="TrainingView.openFaqForm(${f.id})">
        <div class="list-item-info">
          <div class="list-item-name" style="font-size:0.88rem">${escapeHtml(f.question)}</div>
          <div class="list-item-sub" style="margin-top:4px;line-height:1.4">
            ${escapeHtml(f.answer.slice(0,80))}${f.answer.length > 80 ? '…' : ''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <span class="list-item-badge badge-faq">usado ${f.usage_count}x</span>
        </div>
      </div>`).join('');
  },

  async approve(id) {
    const card = document.getElementById(`card-${id}`);
    const answerEl = document.getElementById(`a-text-${id}`);
    const questionEl = document.getElementById(`q-text-${id}`);

    try {
      await api.post(`/api/faq/candidates/${id}/approve`, {
        question: questionEl.textContent.trim(),
        answer:   answerEl.textContent.trim(),
      });
      showToast('✅ Resposta aprovada e adicionada ao FAQ!');
      card.style.opacity = '0';
      card.style.transition = 'opacity 0.3s';
      setTimeout(() => { this.candidates = this.candidates.filter(c => c.id !== id); this.renderTab(); }, 300);
      App.refreshTrainingBadge();
    } catch (e) {
      showToast(e.message, 'error');
    }
  },

  editInline(id) {
    const card     = document.getElementById(`card-${id}`);
    const answerEl = document.getElementById(`a-text-${id}`);
    card.classList.add('reviewing');
    answerEl.focus();
    // Posiciona cursor no fim
    const range = document.createRange();
    range.selectNodeContents(answerEl);
    range.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    showToast('✏️ Edite a resposta e clique em Aprovar', 'success', 4000);
  },

  async reject(id) {
    try {
      await api.post(`/api/faq/candidates/${id}/reject`, {});
      showToast('Sugestão descartada.');
      this.candidates = this.candidates.filter(c => c.id !== id);
      this.renderTab();
      App.refreshTrainingBadge();
    } catch (e) {
      showToast(e.message, 'error');
    }
  },

  openFaqForm(id) {
    const item   = id ? this.faqItems.find(f => f.id === id) : null;
    const isEdit = !!item;

    const closeDrawer = openDrawer(`
      <h2 class="drawer-title">${isEdit ? '✏️ Editar Resposta' : '➕ Nova Resposta'}</h2>
      <form id="faq-form">
        <div class="form-group">
          <label class="form-label">Como o cliente pergunta? *</label>
          <input class="form-input" name="question" required
            value="${escapeHtml(item?.question || '')}"
            placeholder="Ex: Qual o horário de atendimento?">
        </div>
        <div class="form-group">
          <label class="form-label">Resposta automática *</label>
          <textarea class="form-textarea" name="answer" required
            placeholder="Ex: Atendemos de segunda a sexta, das 9h às 18h! 😊">${escapeHtml(item?.answer || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Palavras-chave extras (separadas por vírgula)</label>
          <input class="form-input" name="keywords"
            value="${escapeHtml(item?.keywords || '')}"
            placeholder="Ex: horário, abre, funciona, expediente">
        </div>
        <div class="flex gap-8 mt-16">
          ${isEdit ? `
            <button type="button" class="btn btn-danger"
              onclick="TrainingView.deleteFaq(${id})">🗑</button>
          ` : ''}
          <button type="submit" class="btn btn-primary" style="flex:1">
            ${isEdit ? 'Salvar' : 'Adicionar ao FAQ'}
          </button>
        </div>
      </form>
    `);

    document.getElementById('faq-form').onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      try {
        if (isEdit) {
          await api.patch(`/api/faq/${id}`, data);
          showToast('Resposta atualizada!');
        } else {
          await api.post('/api/faq', data);
          showToast('Resposta adicionada ao FAQ!');
        }
        closeDrawer();
        await this.loadAll();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  },

  async deleteFaq(id) {
    if (!confirm('Remover esta resposta do FAQ?')) return;
    try {
      await api.del(`/api/faq/${id}`);
      showToast('Resposta removida.');
      document.getElementById('overlay').click();
      await this.loadAll();
    } catch (e) {
      showToast(e.message, 'error');
    }
  },

  async startAnalysis() {
    const btn = document.querySelector('#onboarding-banner .btn');
    const progress = document.getElementById('analysis-progress');
    const statusText = document.getElementById('analysis-status-text');
    const bar = document.getElementById('analysis-bar');

    btn.disabled = true;
    btn.textContent = '⏳ Iniciando...';
    progress.classList.remove('hidden');

    try {
      await api.post('/api/onboarding/analyze', {});
      showToast('Análise iniciada! Aguarde os resultados...', 'success', 5000);

      // Poll de progresso
      const poll = setInterval(async () => {
        try {
          const state = await api.get('/api/onboarding/status');
          if (!state) return;

          const pct = state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0;
          bar.style.width = `${pct}%`;
          statusText.textContent = state.running
            ? `Analisando mensagens... ${state.processed}/${state.total} (${state.generated} sugestões geradas)`
            : `Concluído! ${state.generated} sugestões geradas.`;

          if (!state.running) {
            clearInterval(poll);
            btn.disabled = false;
            btn.textContent = '✨ Analisar novamente';
            if (state.generated > 0) {
              showToast(`${state.generated} sugestões prontas para revisar! 🎉`);
              await this.loadAll();
            }
          }
        } catch {}
      }, 3000);

    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = '✨ Analisar histórico de conversas';
    }
  },
};

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
