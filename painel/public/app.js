(function () {
  'use strict';

  const tokenMeta = document.querySelector('meta[name="liz-token"]');
  const TOKEN = tokenMeta ? tokenMeta.getAttribute('content') || '' : '';

  function readPref(key, fallback) {
    try {
      const v = localStorage.getItem('liz_' + key);
      return v !== null ? v : fallback;
    } catch {
      return fallback;
    }
  }

  function writePref(key, value) {
    try {
      localStorage.setItem('liz_' + key, value);
    } catch {
      // ignore
    }
  }

  const state = {
    route: 'projetos',
    framework: { version: '0.0.0', path: '' },
    projects: [],
    reloadingPaths: new Set(),
    busy: false,
    filter: readPref('filter', 'all'),
    sort: readPref('sort', 'name'),
    search: '',
    toolPrefix: readPref('toolPrefix', '/'),
    guideData: null,
    guideSearch: '',
    guideDoc: null,
    changelogData: null,
    detailProject: null,
    detailData: null,
    detailTab: 'checkup',
    currentDoc: null,
  };

  const el = {
    fwVersion: document.getElementById('fw-version'),
    btnCheck: document.getElementById('btn-check'),
    btnUpdateAll: document.getElementById('btn-update-all'),
    btnAdd: document.getElementById('btn-add'),
    btnScan: document.getElementById('btn-scan'),
    btnRefresh: document.getElementById('btn-refresh'),
    btnRetry: document.getElementById('btn-retry'),
    btnClearFilters: document.getElementById('btn-clear-filters'),
    banner: document.getElementById('banner'),
    jobPanel: document.getElementById('job-panel'),
    jobTitle: document.getElementById('job-title'),
    jobLog: document.getElementById('job-log'),
    btnCloseJob: document.getElementById('btn-close-job'),
    viewProjetos: document.getElementById('view-projetos'),
    viewGuia: document.getElementById('view-guia'),
    viewNovidades: document.getElementById('view-novidades'),
    summaryStrip: document.getElementById('summary-strip'),
    searchProjects: document.getElementById('search-projects'),
    sortProjects: document.getElementById('sort-projects'),
    summary: document.getElementById('summary'),
    loading: document.getElementById('state-loading'),
    errorBox: document.getElementById('state-error'),
    errorMsg: document.getElementById('error-message'),
    emptyBox: document.getElementById('state-empty'),
    noResultsBox: document.getElementById('state-no-results'),
    list: document.getElementById('projects-list'),
    guideRoot: document.getElementById('guide-root'),
    changelogRoot: document.getElementById('changelog-root'),
    drawer: document.getElementById('detail-drawer'),
    drawerBackdrop: document.getElementById('drawer-backdrop'),
    detailTitle: document.getElementById('detail-title'),
    detailPath: document.getElementById('detail-path'),
    detailBody: document.getElementById('detail-body'),
    checkupBadge: document.getElementById('checkup-badge'),
    btnCloseDetail: document.getElementById('btn-close-detail'),
    modal: document.getElementById('modal-dialog'),
    modalTitle: document.getElementById('modal-title'),
    modalMessage: document.getElementById('modal-message'),
    modalRich: document.getElementById('modal-rich'),
    modalInputWrap: document.getElementById('modal-input-wrap'),
    modalInputLabel: document.getElementById('modal-input-label'),
    modalInput: document.getElementById('modal-input'),
    modalActions: document.getElementById('modal-actions'),
  };

  async function apiGet(pathUrl) {
    const res = await fetch(pathUrl, {
      method: 'GET',
      headers: { 'X-Liz-Token': TOKEN },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro HTTP ' + res.status);
    return data;
  }

  async function apiPost(pathUrl, body) {
    const res = await fetch(pathUrl, {
      method: 'POST',
      headers: {
        'X-Liz-Token': TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro HTTP ' + res.status);
    return data;
  }

  function showBanner(msg, type) {
    el.banner.textContent = msg;
    el.banner.className = 'banner ' + (type || '');
    el.banner.classList.remove('hidden');
  }

  function hideBanner() {
    el.banner.classList.add('hidden');
  }

  function formatCommand(cmdName) {
    const clean = String(cmdName || '').replace(/^[/\$]/, '');
    if (clean === 'liz') return 'liz';
    return state.toolPrefix + clean;
  }

  async function copyText(text, btnEl) {
    try {
      await navigator.clipboard.writeText(text);
      if (btnEl) {
        const orig = btnEl.textContent;
        btnEl.textContent = 'Copiado!';
        setTimeout(() => {
          btnEl.textContent = orig;
        }, 1500);
      } else {
        showBanner('Copiado: ' + text, 'ok');
      }
      return;
    } catch {
      await openModal({
        title: 'Copiar comando',
        message: 'Selecione e copie com Ctrl+C:',
        input: true,
        inputLabel: 'Comando',
        inputDefault: text,
        buttons: [{ label: 'Fechar', value: 'ok', cls: 'btn-primary' }],
      });
    }
  }

  function setBusy(flag) {
    state.busy = flag;
    [el.btnCheck, el.btnUpdateAll, el.btnAdd, el.btnScan, el.btnRefresh].forEach((b) => {
      b.disabled = flag;
    });
    document.querySelectorAll('.project-action-btn').forEach((b) => {
      b.disabled = flag;
    });
  }

  function openModal(opts) {
    return new Promise((resolve) => {
      el.modalTitle.textContent = opts.title || 'Confirmar';
      el.modalMessage.textContent = opts.message || '';
      el.modalMessage.classList.toggle('hidden', !opts.message);

      el.modalRich.textContent = '';
      if (opts.richNode) {
        el.modalRich.appendChild(opts.richNode);
        el.modalRich.classList.remove('hidden');
      } else {
        el.modalRich.classList.add('hidden');
      }

      if (opts.input) {
        el.modalInputWrap.classList.remove('hidden');
        el.modalInputLabel.textContent = opts.inputLabel || 'Caminho da pasta';
        el.modalInput.value = opts.inputDefault || '';
      } else {
        el.modalInputWrap.classList.add('hidden');
      }
      el.modalActions.textContent = '';

      const finish = (val) => {
        el.modal.close();
        resolve(val);
      };

      (opts.buttons || []).forEach((btnCfg) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ' + (btnCfg.cls || '');
        b.textContent = btnCfg.label;
        b.addEventListener('click', () => {
          finish({ action: btnCfg.value, input: el.modalInput.value.trim() });
        });
        el.modalActions.appendChild(b);
      });

      el.modal.oncancel = (ev) => {
        ev.preventDefault();
        finish({ action: 'cancel', input: '' });
      };
      el.modal.showModal();
      if (opts.input) {
        el.modalInput.focus();
        el.modalInput.select();
      }
    });
  }

  async function pickFolder(promptTitle) {
    try {
      const res = await apiPost('/api/pick-folder', {});
      if (res.cancelled) return null;
      if (res.folder) return res.folder;
    } catch {
      // fallback manual abaixo
    }
    const r = await openModal({
      title: promptTitle || 'Informar pasta',
      message: 'Informe o caminho completo da pasta:',
      input: true,
      inputLabel: 'Caminho da pasta',
      buttons: [
        { label: 'Cancelar', value: 'cancel' },
        { label: 'Confirmar', value: 'ok', cls: 'btn-primary' },
      ],
    });
    if (r.action !== 'ok' || !r.input) return null;
    return r.input;
  }

  function lastNonEmptyLine(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.length ? lines[lines.length - 1] : 'erro desconhecido';
  }

  async function pollJob(jobId, title) {
    while (true) {
      await new Promise((r) => setTimeout(r, 1000));
      const data = await apiGet('/api/jobs/' + encodeURIComponent(jobId));
      el.jobLog.textContent = data.log || '';
      el.jobLog.scrollTop = el.jobLog.scrollHeight;
      if (data.status === 'done') {
        el.jobTitle.textContent = title + ' — concluído';
        return { ok: true, log: data.log || '' };
      }
      if (data.status === 'failed') {
        el.jobTitle.textContent = title + ' — falhou';
        return { ok: false, log: data.log || '' };
      }
    }
  }

  // Fase 0: recarregar com indicação visível e confirmar versão antes do aviso verde
  async function runJob(title, requestFn, opts) {
    if (state.busy) return;
    const options = opts || {};
    hideBanner();
    setBusy(true);
    el.jobTitle.textContent = title;
    el.jobLog.textContent = 'Iniciando...\n';
    el.jobPanel.classList.remove('hidden');

    let outcome = { ok: false, log: '' };
    try {
      const { jobId } = await requestFn();
      outcome = await pollJob(jobId, title);
    } catch (err) {
      outcome = { ok: false, log: err.message };
      el.jobLog.textContent += '\n❌ ' + err.message + '\n';
    }

    if (options.verifyPaths && options.verifyPaths.length > 0) {
      options.verifyPaths.forEach((p) => state.reloadingPaths.add(p));
    } else {
      state.projects.forEach((p) => state.reloadingPaths.add(p.path));
    }
    showBanner('Atualizando a lista...', 'info');
    renderProjects();

    await loadState();
    state.reloadingPaths.clear();
    setBusy(false);
    renderProjects();

    if (!outcome.ok) {
      showBanner('Falhou: ' + lastNonEmptyLine(outcome.log) + '. Veja o log.', 'error');
      return;
    }

    if (options.verifyPaths && options.verifyPaths.length > 0) {
      const stillOutdated = state.projects.filter(
        (p) => options.verifyPaths.includes(p.path) && p.status === 'desatualizado'
      );
      if (stillOutdated.length > 0) {
        showBanner(
          'A atualização terminou, mas a versão do projeto não mudou. Veja o log.',
          'warn'
        );
        return;
      }
    }

    showBanner(title + ': concluído com sucesso.', 'ok');
  }

  // --- Fase 2: Novidades antes de atualizar ---------------------------------
  function compareSemver(a, b) {
    const pa = String(a || '0.0.0').split('.').map((n) => Number(n) || 0);
    const pb = String(b || '0.0.0').split('.').map((n) => Number(n) || 0);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    }
    return 0;
  }

  function buildChangelogFragment(entries) {
    const frag = document.createDocumentFragment();
    entries.forEach((e) => {
      const h = document.createElement('h4');
      h.textContent = 'v' + e.version + ' — ' + e.date;
      frag.appendChild(h);
      frag.appendChild(renderSafeMarkdown(e.markdown, 'CHANGELOG.md'));
    });
    return frag;
  }

  async function showChangelogModal(fromVersion, allowUpdate) {
    const query = fromVersion && /^\d+\.\d+\.\d+$/.test(fromVersion) ? '?from=' + encodeURIComponent(fromVersion) : '';
    let data;
    try {
      data = await apiGet('/api/changelog' + query);
    } catch {
      return allowUpdate;
    }
    const entries = data.entries || [];
    if (entries.length === 0) {
      if (!allowUpdate) {
        await openModal({
          title: 'Novidades',
          message: 'Não há entradas de novidades para esta faixa de versões.',
          buttons: [{ label: 'Fechar', value: 'ok', cls: 'btn-primary' }],
        });
        return false;
      }
      return true;
    }

    const title = fromVersion
      ? 'O que muda: v' + fromVersion + ' → v' + (data.current || state.framework.version)
      : 'Novidades até v' + (data.current || state.framework.version);

    const buttons = allowUpdate
      ? [
          { label: 'Cancelar', value: 'cancel' },
          { label: 'Atualizar', value: 'ok', cls: 'btn-primary' },
        ]
      : [{ label: 'Fechar', value: 'ok', cls: 'btn-primary' }];

    const r = await openModal({
      title,
      richNode: buildChangelogFragment(entries),
      buttons,
    });
    return r.action === 'ok';
  }

  // --- Fase 4: Sugestão "O que fazer agora", resumo, filtros e ordenação ----
  function suggestionForProject(p) {
    if (p.status === 'ausente') {
      return { text: 'Pasta não encontrada: remova da lista ou corrija o caminho', cmd: null };
    }
    if (p.status === 'desatualizado') {
      return {
        text: 'Atualizar o Liz (v' + (p.installedVersion || '?') + ' → v' + p.frameworkVersion + ')',
        cmd: null,
      };
    }
    if (p.sessionsOpen > 0) {
      const label = p.sessionsOpen === 1 ? '1 sessão aberta' : p.sessionsOpen + ' sessões abertas';
      return {
        text: 'Continuar o trabalho: ' + formatCommand('engineer-work') + ' (' + label + ')',
        cmd: 'engineer-work',
      };
    }
    if (!p.docsTechnical) {
      return {
        text: 'Gerar a documentação técnica: ' + formatCommand('docs-build-tech-docs'),
        cmd: 'docs-build-tech-docs',
      };
    }
    if (!p.docsBusiness) {
      return {
        text: 'Gerar a de negócio: ' + formatCommand('docs-build-business-docs'),
        cmd: 'docs-build-business-docs',
      };
    }
    return {
      text: 'Em dia. Próxima ideia: ' + formatCommand('product-collect'),
      cmd: 'product-collect',
    };
  }

  function applyFilterAndSort(projects) {
    const q = state.search.trim().toLowerCase();
    let list = projects.filter((p) => {
      if (state.filter === 'outdated' && p.status !== 'desatualizado') return false;
      if (state.filter === 'sessions' && p.sessionsOpen <= 0) return false;
      if (state.filter === 'nodocs' && (p.docsTechnical || p.status === 'ausente')) return false;
      if (state.filter === 'absent' && p.status !== 'ausente') return false;
      if (q) {
        const hay = (p.name + ' ' + p.path).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const statusOrder = {
      desatualizado: 0,
      ausente: 1,
      'sem-liz': 2,
      'sem-versao': 3,
      'mais-novo': 4,
      ok: 5,
    };

    list = list.slice().sort((a, b) => {
      if (state.sort === 'status') {
        const sa = statusOrder[a.status] ?? 9;
        const sb = statusOrder[b.status] ?? 9;
        if (sa !== sb) return sa - sb;
      } else if (state.sort === 'sessions') {
        if (b.sessionsOpen !== a.sessionsOpen) return b.sessionsOpen - a.sessionsOpen;
      }
      return a.name.localeCompare(b.name);
    });

    return list;
  }

  function renderSummaryStrip() {
    const all = state.projects;
    if (all.length === 0) {
      el.summaryStrip.classList.add('hidden');
      return;
    }
    el.summaryStrip.classList.remove('hidden');
    el.summaryStrip.textContent = '';

    const counts = {
      all: all.length,
      outdated: all.filter((p) => p.status === 'desatualizado').length,
      sessions: all.filter((p) => p.sessionsOpen > 0).length,
      nodocs: all.filter((p) => !p.docsTechnical && p.status !== 'ausente').length,
      absent: all.filter((p) => p.status === 'ausente').length,
    };

    const cards = [
      { key: 'all', label: 'Projetos', value: counts.all },
      { key: 'outdated', label: 'Desatualizados', value: counts.outdated },
      { key: 'sessions', label: 'Com sessão aberta', value: counts.sessions },
      { key: 'nodocs', label: 'Sem docs técnicos', value: counts.nodocs },
      { key: 'absent', label: 'Ausentes', value: counts.absent },
    ];

    cards.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stat-card' + (state.filter === c.key ? ' active' : '');
      const v = document.createElement('span');
      v.className = 'stat-value';
      v.textContent = String(c.value);
      const l = document.createElement('span');
      l.className = 'stat-label';
      l.textContent = c.label;
      btn.appendChild(v);
      btn.appendChild(l);
      btn.addEventListener('click', () => {
        state.filter = c.key;
        writePref('filter', c.key);
        syncFilterUI();
        renderProjects();
      });
      el.summaryStrip.appendChild(btn);
    });
  }

  function syncFilterUI() {
    document.querySelectorAll('.filter-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.filter === state.filter);
    });
    el.sortProjects.value = state.sort;
  }

  function renderProjects() {
    el.fwVersion.textContent = 'v' + state.framework.version;
    const total = state.projects.length;
    const outdated = state.projects.filter((p) => p.status === 'desatualizado').length;

    el.btnUpdateAll.classList.toggle('hidden', outdated === 0);
    el.summary.textContent =
      total +
      ' ' +
      (total === 1 ? 'projeto' : 'projetos') +
      ' · ' +
      outdated +
      ' ' +
      (outdated === 1 ? 'desatualizado' : 'desatualizados');

    renderSummaryStrip();
    syncFilterUI();

    el.loading.classList.add('hidden');
    el.errorBox.classList.add('hidden');
    el.list.textContent = '';

    if (total === 0) {
      el.emptyBox.classList.remove('hidden');
      el.noResultsBox.classList.add('hidden');
      return;
    }
    el.emptyBox.classList.add('hidden');

    const visible = applyFilterAndSort(state.projects);
    if (visible.length === 0) {
      el.noResultsBox.classList.remove('hidden');
      return;
    }
    el.noResultsBox.classList.add('hidden');

    visible.forEach((p) => {
      const isReloading = state.reloadingPaths.has(p.path);
      const card = document.createElement('article');
      card.className = 'project-card' + (isReloading ? ' reloading' : '');

      const top = document.createElement('div');
      top.className = 'card-top';

      const left = document.createElement('div');
      const titleRow = document.createElement('div');
      titleRow.className = 'card-title-row';

      const h2 = document.createElement('h2');
      h2.className = 'project-name';
      h2.textContent = p.name;

      const chip = document.createElement('span');
      chip.className = 'chip chip-' + (isReloading ? 'info' : p.status);
      chip.textContent = isReloading ? 'recarregando...' : p.status;

      titleRow.appendChild(h2);
      titleRow.appendChild(chip);

      const pathP = document.createElement('p');
      pathP.className = 'project-path';
      pathP.title = p.path;
      pathP.textContent = p.path;

      left.appendChild(titleRow);
      left.appendChild(pathP);

      const verSpan = document.createElement('div');
      verSpan.className = 'muted';
      const vInst = p.installedVersion ? 'v' + p.installedVersion : 'sem versão';
      verSpan.textContent = vInst + ' → v' + p.frameworkVersion;

      top.appendChild(left);
      top.appendChild(verSpan);

      const meta = document.createElement('div');
      meta.className = 'card-meta';

      const addMeta = (txt) => {
        const s = document.createElement('span');
        s.textContent = txt;
        meta.appendChild(s);
      };
      addMeta(p.repos + (p.repos === 1 ? ' repo' : ' repos'));
      addMeta(p.sessionsOpen + (p.sessionsOpen === 1 ? ' sessão aberta' : ' sessões abertas'));
      if (p.tools) addMeta('Ferramentas: ' + p.tools);

      const pillBus = document.createElement('span');
      pillBus.className = 'doc-pill' + (p.docsBusiness ? ' yes' : '');
      pillBus.textContent = p.docsBusiness ? '✓ Negócio' : '— Negócio';
      meta.appendChild(pillBus);

      const pillTech = document.createElement('span');
      pillTech.className = 'doc-pill' + (p.docsTechnical ? ' yes' : '');
      pillTech.textContent = p.docsTechnical ? '✓ Técnica' : '— Técnica';
      meta.appendChild(pillTech);

      const sug = suggestionForProject(p);
      const sugBox = document.createElement('div');
      sugBox.className = 'card-suggestion';
      const sugText = document.createElement('span');
      sugText.textContent = 'Próximo passo: ' + sug.text;
      sugBox.appendChild(sugText);
      if (sug.cmd) {
        const btnCopy = document.createElement('button');
        btnCopy.type = 'button';
        btnCopy.className = 'btn btn-sm';
        btnCopy.textContent = 'Copiar';
        btnCopy.addEventListener('click', () => copyText(formatCommand(sug.cmd), btnCopy));
        sugBox.appendChild(btnCopy);
      }

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      if (p.status === 'desatualizado') {
        const btnUpd = document.createElement('button');
        btnUpd.type = 'button';
        btnUpd.className = 'btn btn-primary btn-sm project-action-btn';
        btnUpd.textContent = 'Atualizar';
        btnUpd.disabled = state.busy;
        btnUpd.addEventListener('click', async () => {
          const ok = await showChangelogModal(p.installedVersion, true);
          if (!ok) return;
          runJob('Atualizando ' + p.name, () => apiPost('/api/update', { path: p.path }), {
            verifyPaths: [p.path],
          });
        });
        actions.appendChild(btnUpd);

        const btnDiff = document.createElement('button');
        btnDiff.type = 'button';
        btnDiff.className = 'btn btn-sm';
        btnDiff.textContent = 'Ver o que mudou';
        btnDiff.addEventListener('click', () => showChangelogModal(p.installedVersion, false));
        actions.appendChild(btnDiff);
      }

      if (p.status !== 'ausente') {
        const btnDet = document.createElement('button');
        btnDet.type = 'button';
        btnDet.className = 'btn btn-sm';
        btnDet.textContent = 'Detalhes';
        btnDet.addEventListener('click', () => openDetails(p));
        actions.appendChild(btnDet);

        const btnOpen = document.createElement('button');
        btnOpen.type = 'button';
        btnOpen.className = 'btn btn-sm';
        btnOpen.textContent = 'Abrir pasta';
        btnOpen.addEventListener('click', async () => {
          try {
            await apiPost('/api/open-folder', { path: p.path });
          } catch (err) {
            showBanner('Não foi possível abrir a pasta: ' + err.message, 'error');
          }
        });
        actions.appendChild(btnOpen);
      }

      const btnRem = document.createElement('button');
      btnRem.type = 'button';
      btnRem.className = 'btn btn-sm btn-danger project-action-btn';
      btnRem.textContent = 'Remover da lista';
      btnRem.disabled = state.busy;
      btnRem.addEventListener('click', async () => {
        const r = await openModal({
          title: 'Remover da lista',
          message:
            'Remover "' +
            p.name +
            '" da lista do painel? Isso não apaga nada no projeto.',
          buttons: [
            { label: 'Cancelar', value: 'cancel' },
            { label: 'Remover da lista', value: 'ok', cls: 'btn-danger' },
          ],
        });
        if (r.action !== 'ok') return;
        try {
          await apiPost('/api/remove', { path: p.path });
          showBanner('Projeto "' + p.name + '" removido da lista (nenhum arquivo foi apagado).', 'ok');
          await loadState();
        } catch (err) {
          showBanner('Erro ao remover: ' + err.message, 'error');
        }
      });
      actions.appendChild(btnRem);

      card.appendChild(top);
      card.appendChild(meta);
      card.appendChild(sugBox);
      card.appendChild(actions);
      el.list.appendChild(card);
    });
  }

  async function loadState() {
    el.errorBox.classList.add('hidden');
    if (state.projects.length === 0) {
      el.loading.classList.remove('hidden');
    }
    try {
      const data = await apiGet('/api/state');
      state.framework = data.framework || { version: '0.0.0', path: '' };
      state.projects = data.projects || [];
      renderProjects();
    } catch (err) {
      el.loading.classList.add('hidden');
      el.errorMsg.textContent = 'Erro de comunicação: ' + err.message;
      el.errorBox.classList.remove('hidden');
    }
  }

  // --- Fase 1: Aba Guia do Liz ----------------------------------------------
  async function loadGuide() {
    if (!state.guideData) {
      el.guideRoot.textContent = 'Carregando guia do framework...';
      try {
        state.guideData = await apiGet('/api/guide');
      } catch (err) {
        el.guideRoot.textContent = 'Erro ao carregar o guia: ' + err.message;
        return;
      }
    }
    renderGuide();
  }

  async function openGuideDoc(relFile) {
    el.guideRoot.textContent = 'Carregando documento...';
    try {
      const data = await apiGet('/api/guide/doc?file=' + encodeURIComponent(relFile));
      state.guideDoc = { file: relFile, title: data.title, markdown: data.markdown };
      renderGuide();
    } catch (err) {
      state.guideDoc = null;
      el.guideRoot.textContent = 'Não foi possível abrir o documento: ' + err.message;
    }
  }

  function renderGuide() {
    el.guideRoot.textContent = '';
    if (!state.guideData) return;

    if (state.guideDoc) {
      const box = document.createElement('section');
      box.className = 'guide-section';
      const bar = document.createElement('div');
      bar.className = 'doc-viewer-bar';
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn btn-sm';
      back.textContent = '← Voltar ao Guia';
      back.addEventListener('click', () => {
        state.guideDoc = null;
        renderGuide();
      });
      const rel = document.createElement('span');
      rel.className = 'doc-rel';
      rel.textContent = state.guideDoc.file;
      bar.appendChild(back);
      bar.appendChild(rel);

      const content = document.createElement('div');
      content.className = 'md-content';
      content.appendChild(renderSafeMarkdown(state.guideDoc.markdown, state.guideDoc.file));
      box.appendChild(bar);
      box.appendChild(content);
      el.guideRoot.appendChild(box);
      return;
    }

    // 1. Como começar
    const qs = document.createElement('section');
    qs.className = 'guide-section guide-quickstart';
    const qsH = document.createElement('h2');
    qsH.textContent = 'Como começar';
    const qsP = document.createElement('p');
    qsP.textContent =
      '1. Abra a IA na pasta do projeto · 2. Rode ' +
      formatCommand('warm-up') +
      ' · 3. Escreva "liz" sempre que tiver dúvida sobre o próximo passo.';
    const qsGlossary = document.createElement('p');
    qsGlossary.className = 'muted';
    qsGlossary.textContent =
      'Glossário rápido: C4 é um jeito simples de desenhar a arquitetura em camadas (contexto e sistemas); ADR é um registro curto explicando por que uma decisão técnica foi tomada.';
    qs.appendChild(qsH);
    qs.appendChild(qsP);
    qs.appendChild(qsGlossary);
    el.guideRoot.appendChild(qs);

    // 2. Ciclo em desenho
    const cyc = document.createElement('section');
    cyc.className = 'guide-section';
    const cycH = document.createElement('h2');
    cycH.textContent = 'Ciclo do Liz (clique em uma etapa para ir ao comando)';
    cyc.appendChild(cycH);

    ['Orientação', 'Produto', 'Engenharia'].forEach((grpName) => {
      const steps = (state.guideData.cycle || []).filter((c) => c.group === grpName);
      if (steps.length === 0) return;
      const wrap = document.createElement('div');
      wrap.className = 'cycle-group';
      const h3 = document.createElement('h3');
      h3.className = 'cycle-group-title';
      h3.textContent = grpName;
      wrap.appendChild(h3);

      const flow = document.createElement('div');
      flow.className = 'cycle-flow';
      steps.forEach((st, idx) => {
        if (idx > 0) {
          const arr = document.createElement('span');
          arr.className = 'cycle-arrow';
          arr.setAttribute('aria-hidden', 'true');
          arr.textContent = '→';
          flow.appendChild(arr);
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cycle-step' + (st.optional ? ' optional' : '');
        btn.textContent =
          formatCommand(st.command) + (st.optional ? ' (opcional)' : '');
        btn.addEventListener('click', () => {
          const target = document.getElementById('skill-card-' + st.command);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('highlight');
            setTimeout(() => target.classList.remove('highlight'), 1800);
          }
        });
        flow.appendChild(btn);
      });
      wrap.appendChild(flow);
      cyc.appendChild(wrap);
    });
    el.guideRoot.appendChild(cyc);

    // 3. Catálogo de comandos
    const cat = document.createElement('section');
    cat.className = 'guide-section';
    const catH = document.createElement('h2');
    catH.textContent = 'Catálogo de comandos';
    cat.appendChild(catH);

    const controls = document.createElement('div');
    controls.className = 'guide-controls';

    const toolGroup = document.createElement('div');
    toolGroup.className = 'filter-group';
    [
      { prefix: '/', label: 'Claude Code e Antigravity (/)' },
      { prefix: '$', label: 'Codex ($)' },
    ].forEach((opt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'filter-btn' + (state.toolPrefix === opt.prefix ? ' active' : '');
      b.textContent = opt.label;
      b.addEventListener('click', () => {
        state.toolPrefix = opt.prefix;
        writePref('toolPrefix', opt.prefix);
        renderGuide();
        renderProjects();
      });
      toolGroup.appendChild(b);
    });

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'search-input';
    search.placeholder = 'Filtrar comandos por nome ou descrição...';
    search.value = state.guideSearch;
    search.addEventListener('input', () => {
      state.guideSearch = search.value;
      renderCatalogList(grid);
    });

    controls.appendChild(toolGroup);
    controls.appendChild(search);
    cat.appendChild(controls);

    const agyHint = document.createElement('p');
    agyHint.className = 'muted';
    agyHint.textContent = 'No Antigravity CLI (agy), peça pelo nome da skill (ex.: "rode a skill warm-up").';
    cat.appendChild(agyHint);

    const grid = document.createElement('div');
    grid.className = 'catalog-grid';
    renderCatalogList(grid);
    cat.appendChild(grid);
    el.guideRoot.appendChild(cat);

    // 4. Especialistas
    const agSec = document.createElement('section');
    agSec.className = 'guide-section';
    const agH = document.createElement('h2');
    agH.textContent = 'Especialistas';
    agSec.appendChild(agH);

    const agGrid = document.createElement('div');
    agGrid.className = 'catalog-grid';
    (state.guideData.agents || []).forEach((a) => {
      const card = document.createElement('div');
      card.className = 'catalog-card';
      const info = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'catalog-cmd';
      title.textContent = '@' + a.name;
      const desc = document.createElement('p');
      desc.className = 'catalog-desc';
      desc.textContent = a.description;
      info.appendChild(title);
      info.appendChild(desc);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm';
      btn.textContent = 'Copiar @' + a.name;
      btn.addEventListener('click', () => copyText('@' + a.name, btn));

      card.appendChild(info);
      card.appendChild(btn);
      agGrid.appendChild(card);
    });
    agSec.appendChild(agGrid);
    el.guideRoot.appendChild(agSec);

    // 5. Base de conhecimento
    const kbSec = document.createElement('section');
    kbSec.className = 'guide-section';
    const kbH = document.createElement('h2');
    kbH.textContent = 'Base de conhecimento';
    kbSec.appendChild(kbH);

    const ul = document.createElement('ul');
    ul.className = 'doc-list';
    (state.guideData.knowledge || []).forEach((k) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'doc-link-btn';
      const t = document.createElement('span');
      t.textContent = k.title;
      const r = document.createElement('span');
      r.className = 'doc-rel';
      r.textContent = k.file;
      btn.appendChild(t);
      btn.appendChild(r);
      btn.addEventListener('click', () => openGuideDoc(k.file));
      li.appendChild(btn);
      ul.appendChild(li);
    });
    kbSec.appendChild(ul);
    el.guideRoot.appendChild(kbSec);
  }

  function renderCatalogList(container) {
    container.textContent = '';
    const q = state.guideSearch.trim().toLowerCase();
    const skills = (state.guideData.skills || []).filter((s) => {
      if (!q) return true;
      return (s.name + ' ' + s.group + ' ' + s.description).toLowerCase().includes(q);
    });
    if (skills.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Nenhum comando encontrado para essa busca.';
      container.appendChild(p);
      return;
    }
    skills.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'catalog-card';
      card.id = 'skill-card-' + s.name;

      const info = document.createElement('div');
      const top = document.createElement('div');
      top.className = 'card-title-row';
      const cmd = document.createElement('span');
      cmd.className = 'catalog-cmd';
      cmd.textContent = formatCommand(s.name);
      const grp = document.createElement('span');
      grp.className = 'doc-pill';
      grp.textContent = s.group;
      top.appendChild(cmd);
      top.appendChild(grp);

      const desc = document.createElement('p');
      desc.className = 'catalog-desc';
      desc.textContent = s.description;
      info.appendChild(top);
      info.appendChild(desc);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm';
      btn.textContent = 'Copiar comando';
      btn.addEventListener('click', () => copyText(formatCommand(s.name), btn));

      card.appendChild(info);
      card.appendChild(btn);
      container.appendChild(card);
    });
  }

  // --- Fase 2: Aba Novidades ------------------------------------------------
  async function loadChangelog() {
    el.changelogRoot.textContent = 'Carregando histórico de novidades...';
    try {
      state.changelogData = await apiGet('/api/changelog');
    } catch (err) {
      el.changelogRoot.textContent = 'Erro ao carregar novidades: ' + err.message;
      return;
    }
    el.changelogRoot.textContent = '';
    const entries = (state.changelogData && state.changelogData.entries) || [];
    if (entries.length === 0) {
      const p = document.createElement('p');
      p.className = 'state-box';
      p.textContent = 'Nenhuma entrada encontrada no CHANGELOG.';
      el.changelogRoot.appendChild(p);
      return;
    }
    entries.forEach((e) => {
      const sec = document.createElement('article');
      sec.className = 'changelog-entry';
      const hdr = document.createElement('div');
      hdr.className = 'changelog-entry-header';
      const h2 = document.createElement('h2');
      h2.textContent = 'v' + e.version;
      const dt = document.createElement('span');
      dt.className = 'muted';
      dt.textContent = e.date;
      hdr.appendChild(h2);
      hdr.appendChild(dt);

      const body = document.createElement('div');
      body.className = 'md-content';
      body.appendChild(renderSafeMarkdown(e.markdown, 'CHANGELOG.md'));

      sec.appendChild(hdr);
      sec.appendChild(body);
      el.changelogRoot.appendChild(sec);
    });
  }

  // --- Fase 3: Detalhes do projeto (Check-up, Repos+PRs, Sessões, Docs) -----
  async function openDetails(project) {
    state.detailProject = project;
    state.detailData = null;
    state.detailTab = 'checkup';
    state.currentDoc = null;
    el.detailTitle.textContent = project.name;
    el.detailPath.textContent = project.path;
    el.checkupBadge.classList.add('hidden');
    el.detailBody.textContent = 'Carregando detalhes e check-up...';
    updateTabs();
    el.drawer.classList.remove('hidden');

    try {
      state.detailData = await apiGet('/api/project?path=' + encodeURIComponent(project.path));
      const pendCount = (state.detailData.checkup || []).filter((i) => i.level !== 'ok').length;
      if (pendCount > 0) {
        el.checkupBadge.textContent = String(pendCount);
        el.checkupBadge.classList.remove('hidden');
      }
      renderDetailTab();
    } catch (err) {
      el.detailBody.textContent = 'Não foi possível carregar detalhes: ' + err.message;
    }
  }

  function closeDetails() {
    el.drawer.classList.add('hidden');
    state.detailProject = null;
    state.detailData = null;
    state.currentDoc = null;
  }

  function updateTabs() {
    document.querySelectorAll('.tab').forEach((t) => {
      const active = t.dataset.tab === state.detailTab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function renderDetailTab() {
    el.detailBody.textContent = '';
    if (!state.detailData) return;

    if (state.detailTab === 'checkup') {
      const items = state.detailData.checkup || [];
      const header = document.createElement('p');
      header.className = 'summary';
      header.textContent =
        items.length === 0
          ? 'Nenhuma pendência encontrada neste projeto.'
          : items.length + (items.length === 1 ? ' pendência encontrada' : ' pendências encontradas');
      el.detailBody.appendChild(header);

      if (items.length === 0) {
        const okBox = document.createElement('div');
        okBox.className = 'state-box';
        okBox.textContent = '✅ Tudo certo! Nenhuma pendência.';
        el.detailBody.appendChild(okBox);
        return;
      }

      const list = document.createElement('div');
      list.className = 'checkup-list';
      items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'checkup-item';

        const left = document.createElement('div');
        const top = document.createElement('div');
        top.className = 'card-title-row';

        const lvl = document.createElement('span');
        lvl.className = 'chip chip-' + item.level;
        const icon = item.level === 'erro' ? '⛔ ' : item.level === 'aviso' ? '⚠️ ' : '✅ ';
        lvl.textContent = icon + item.level;

        const title = document.createElement('strong');
        title.textContent = item.title;

        top.appendChild(lvl);
        top.appendChild(title);
        left.appendChild(top);

        if (item.hint) {
          const hint = document.createElement('p');
          hint.className = 'checkup-hint';
          const isCmd = item.hint.startsWith('/');
          hint.textContent = 'Como resolver: ' + (isCmd ? formatCommand(item.hint) : item.hint);
          left.appendChild(hint);
        }

        row.appendChild(left);

        if (item.hint && item.hint.startsWith('/')) {
          const btnCopy = document.createElement('button');
          btnCopy.type = 'button';
          btnCopy.className = 'btn btn-sm';
          btnCopy.textContent = 'Copiar';
          btnCopy.addEventListener('click', () => copyText(formatCommand(item.hint), btnCopy));
          row.appendChild(btnCopy);
        } else if (item.id === 'liz-version' && state.detailProject) {
          const btnUpd = document.createElement('button');
          btnUpd.type = 'button';
          btnUpd.className = 'btn btn-primary btn-sm';
          btnUpd.textContent = 'Atualizar';
          btnUpd.addEventListener('click', async () => {
            const p = state.detailProject;
            const ok = await showChangelogModal(p.installedVersion, true);
            if (!ok) return;
            closeDetails();
            runJob('Atualizando ' + p.name, () => apiPost('/api/update', { path: p.path }), {
              verifyPaths: [p.path],
            });
          });
          row.appendChild(btnUpd);
        }

        list.appendChild(row);
      });
      el.detailBody.appendChild(list);
      return;
    }

    if (state.detailTab === 'repos') {
      const repos = state.detailData.repos || [];
      if (repos.length === 0) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'Nenhum repo listado no workspace.yaml.';
        el.detailBody.appendChild(p);
        return;
      }
      const table = document.createElement('table');
      table.className = 'detail-table';
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      ['Repo', 'Papel', 'Stack', 'Branch', 'Alterações', 'PRs'].forEach((h) => {
        const th = document.createElement('th');
        th.textContent = h;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      repos.forEach((r) => {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = r.name;

        const tdRole = document.createElement('td');
        tdRole.textContent = r.role || '-';

        const tdStack = document.createElement('td');
        tdStack.textContent = r.stack || '-';

        const tdBranch = document.createElement('td');
        tdBranch.textContent = r.branch || '?';
        const changesNum = Number(r.changes) || 0;
        if ((r.branch === 'main' || r.branch === 'master') && changesNum > 0) {
          const warn = document.createElement('div');
          const chip = document.createElement('span');
          chip.className = 'chip chip-aviso';
          chip.textContent = 'Alterações direto na main';
          warn.appendChild(chip);
          tdBranch.appendChild(warn);
        }

        const tdChanges = document.createElement('td');
        tdChanges.textContent = r.changes === '' ? '-' : r.changes;

        const tdPrs = document.createElement('td');
        const btnPr = document.createElement('button');
        btnPr.type = 'button';
        btnPr.className = 'btn btn-sm';
        btnPr.textContent = 'Ver PRs abertos';
        const prBox = document.createElement('div');
        btnPr.addEventListener('click', async () => {
          btnPr.disabled = true;
          prBox.textContent = 'Consultando...';
          try {
            const res = await apiPost('/api/prs', {
              path: state.detailProject.path,
              repo: r.name,
            });
            prBox.textContent = '';
            if (res.unavailable) {
              const p = document.createElement('p');
              p.className = 'muted';
              p.textContent = res.reason || 'Indisponível.';
              prBox.appendChild(p);
            } else if (!res.prs || res.prs.length === 0) {
              const p = document.createElement('p');
              p.className = 'muted';
              p.textContent = 'Nenhum PR aberto.';
              prBox.appendChild(p);
            } else {
              const ul = document.createElement('ul');
              ul.className = 'pr-list';
              res.prs.forEach((pr) => {
                const li = document.createElement('li');
                if (typeof pr.url === 'string' && pr.url.startsWith('https://github.com/')) {
                  const a = document.createElement('a');
                  a.href = pr.url;
                  a.target = '_blank';
                  a.rel = 'noopener noreferrer';
                  a.textContent = '#' + pr.number + ' ' + pr.title;
                  li.appendChild(a);
                } else {
                  li.textContent = '#' + pr.number + ' ' + pr.title;
                }
                ul.appendChild(li);
              });
              prBox.appendChild(ul);
            }
          } catch (err) {
            prBox.textContent = 'Erro: ' + err.message;
          } finally {
            btnPr.disabled = false;
          }
        });
        tdPrs.appendChild(btnPr);
        tdPrs.appendChild(prBox);

        tr.appendChild(tdName);
        tr.appendChild(tdRole);
        tr.appendChild(tdStack);
        tr.appendChild(tdBranch);
        tr.appendChild(tdChanges);
        tr.appendChild(tdPrs);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      el.detailBody.appendChild(table);
      return;
    }

    if (state.detailTab === 'sessions') {
      const sessions = state.detailData.sessions || [];
      if (sessions.length === 0) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'Nenhuma sessão aberta neste projeto.';
        el.detailBody.appendChild(p);
        return;
      }
      sessions.forEach((s) => {
        const card = document.createElement('div');
        card.className = 'session-card';

        const top = document.createElement('div');
        top.className = 'card-title-row';
        const slug = document.createElement('strong');
        slug.textContent = s.slug;
        const st = document.createElement('span');
        st.className = 'chip chip-info';
        st.textContent = s.status || 'aberta';
        top.appendChild(slug);
        top.appendChild(st);
        card.appendChild(top);

        if (s.phasesTotal && s.phasesTotal > 0) {
          const done = s.phasesDone || 0;
          const wrap = document.createElement('div');
          wrap.className = 'progress-wrap';
          const bar = document.createElement('progress');
          bar.className = 'progress-native';
          bar.value = Math.min(done, s.phasesTotal);
          bar.max = s.phasesTotal;
          const lbl = document.createElement('span');
          lbl.className = 'muted';
          lbl.textContent =
            'Fase ' +
            (s.phase || done) +
            ' de ' +
            s.phasesTotal +
            ' (' +
            done +
            ' concluída(s))' +
            (s.phaseTitle ? ' — ' + s.phaseTitle : '');
          wrap.appendChild(bar);
          wrap.appendChild(lbl);
          card.appendChild(wrap);
        } else if (s.phase || s.phaseTitle) {
          const p = document.createElement('p');
          p.className = 'muted';
          p.textContent = 'Fase: ' + [s.phase, s.phaseTitle].filter(Boolean).join(' — ');
          card.appendChild(p);
        }

        if (s.nextAction) {
          const next = document.createElement('p');
          next.textContent = 'Próxima ação: ' + s.nextAction;
          card.appendChild(next);
        }
        if (s.blockedBy) {
          const blk = document.createElement('p');
          const chip = document.createElement('span');
          chip.className = 'chip chip-erro';
          chip.textContent = 'Bloqueado por: ' + s.blockedBy;
          blk.appendChild(chip);
          card.appendChild(blk);
        }
        if (s.lastCheckpoint) {
          const chk = document.createElement('p');
          chk.className = 'muted';
          chk.textContent = 'Último checkpoint: ' + s.lastCheckpoint;
          card.appendChild(chk);
        }

        el.detailBody.appendChild(card);
      });
      return;
    }

    if (state.detailTab === 'docs') {
      if (state.currentDoc) {
        renderDocViewer(state.currentDoc);
        return;
      }
      const docs = state.detailData.docs || [];
      const groups = [
        { key: 'projeto', label: 'Projeto' },
        {
          key: 'negocio',
          label: 'Negócio',
          hint: 'Ainda não gerado. Rode /docs-build-business-docs na IA deste projeto.',
        },
        {
          key: 'tecnico',
          label: 'Técnica',
          hint: 'Ainda não gerado. Rode /docs-build-tech-docs na IA deste projeto.',
        },
        { key: 'specs', label: 'Specs' },
      ];
      groups.forEach((g) => {
        const section = document.createElement('div');
        section.className = 'doc-group';
        const h3 = document.createElement('h3');
        h3.textContent = g.label;
        section.appendChild(h3);

        const items = docs.filter((d) => d.group === g.key);
        if (items.length === 0) {
          const p = document.createElement('p');
          p.className = 'muted';
          p.textContent = g.hint || 'Nenhum documento neste grupo.';
          section.appendChild(p);
        } else {
          const ul = document.createElement('ul');
          ul.className = 'doc-list';
          items.forEach((d) => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'doc-link-btn';
            const t = document.createElement('span');
            t.textContent = d.title;
            const r = document.createElement('span');
            r.className = 'doc-rel';
            r.textContent = d.file;
            btn.appendChild(t);
            btn.appendChild(r);
            btn.addEventListener('click', () => openDoc(d.file));
            li.appendChild(btn);
            ul.appendChild(li);
          });
          section.appendChild(ul);
        }
        el.detailBody.appendChild(section);
      });
    }
  }

  async function openDoc(relFile) {
    if (!state.detailProject) return;
    el.detailBody.textContent = 'Carregando documento...';
    try {
      const data = await apiGet(
        '/api/doc?path=' +
          encodeURIComponent(state.detailProject.path) +
          '&file=' +
          encodeURIComponent(relFile)
      );
      state.currentDoc = { file: relFile, title: data.title, markdown: data.markdown };
      renderDetailTab();
    } catch (err) {
      state.currentDoc = null;
      el.detailBody.textContent = 'Erro ao abrir documento: ' + err.message;
    }
  }

  function resolveRelativeMd(baseFile, href) {
    const cleanHref = href.split('#')[0].split('?')[0];
    if (!cleanHref.toLowerCase().endsWith('.md')) return null;
    const baseParts = baseFile.replace(/\\/g, '/').split('/');
    baseParts.pop();
    const parts = cleanHref.startsWith('/') ? [] : baseParts;
    for (const seg of cleanHref.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        if (parts.length === 0) return null;
        parts.pop();
      } else {
        parts.push(seg);
      }
    }
    const resolved = parts.join('/');
    const docs = (state.detailData && state.detailData.docs) || [];
    const exists = docs.some((d) => d.file.replace(/\\/g, '/') === resolved);
    return exists ? resolved : null;
  }

  function appendInlineMarkdown(parent, text, currentFile) {
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
    let lastIndex = 0;
    for (const m of text.matchAll(pattern)) {
      if (m.index > lastIndex) {
        parent.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
      }
      const tok = m[0];
      if (tok.startsWith('`') && tok.endsWith('`')) {
        const code = document.createElement('code');
        code.textContent = tok.slice(1, -1);
        parent.appendChild(code);
      } else if (tok.startsWith('**') && tok.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = tok.slice(2, -2);
        parent.appendChild(strong);
      } else if (tok.startsWith('*') && tok.endsWith('*')) {
        const em = document.createElement('em');
        em.textContent = tok.slice(1, -1);
        parent.appendChild(em);
      } else if (tok.startsWith('[')) {
        const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (lm) {
          const label = lm[1];
          const href = lm[2].trim();
          if (/^https?:\/\//i.test(href)) {
            const a = document.createElement('a');
            a.href = href;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = label;
            parent.appendChild(a);
          } else {
            const relTarget = resolveRelativeMd(currentFile || '', href);
            if (relTarget) {
              const a = document.createElement('a');
              a.href = '#';
              a.textContent = label;
              a.addEventListener('click', (ev) => {
                ev.preventDefault();
                openDoc(relTarget);
              });
              parent.appendChild(a);
            } else {
              parent.appendChild(document.createTextNode(tok));
            }
          }
        } else {
          parent.appendChild(document.createTextNode(tok));
        }
      }
      lastIndex = m.index + tok.length;
    }
    if (lastIndex < text.length) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  function renderSafeMarkdown(markdown, currentFile) {
    const frag = document.createDocumentFragment();
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (/^```/.test(line.trim())) {
        const codeLines = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = codeLines.join('\n');
        pre.appendChild(code);
        frag.appendChild(pre);
        continue;
      }

      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
        frag.appendChild(document.createElement('hr'));
        i++;
        continue;
      }

      const hm = line.match(/^(#{1,6})\s+(.+)$/);
      if (hm) {
        const h = document.createElement('h' + hm[1].length);
        appendInlineMarkdown(h, hm[2], currentFile);
        frag.appendChild(h);
        i++;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const bq = document.createElement('blockquote');
        const qLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          qLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        const p = document.createElement('p');
        appendInlineMarkdown(p, qLines.join(' '), currentFile);
        bq.appendChild(p);
        frag.appendChild(bq);
        continue;
      }

      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
        const parseRow = (row) =>
          row
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim());
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const htr = document.createElement('tr');
        parseRow(line).forEach((cell) => {
          const th = document.createElement('th');
          appendInlineMarkdown(th, cell, currentFile);
          htr.appendChild(th);
        });
        thead.appendChild(htr);
        table.appendChild(thead);
        i += 2;
        const tbody = document.createElement('tbody');
        while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
          const tr = document.createElement('tr');
          parseRow(lines[i]).forEach((cell) => {
            const td = document.createElement('td');
            appendInlineMarkdown(td, cell, currentFile);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
          i++;
        }
        table.appendChild(tbody);
        frag.appendChild(table);
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const ul = document.createElement('ul');
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          const li = document.createElement('li');
          appendInlineMarkdown(li, lines[i].replace(/^\s*[-*+]\s+/, ''), currentFile);
          ul.appendChild(li);
          i++;
        }
        frag.appendChild(ul);
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const ol = document.createElement('ol');
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          const li = document.createElement('li');
          appendInlineMarkdown(li, lines[i].replace(/^\s*\d+\.\s+/, ''), currentFile);
          ol.appendChild(li);
          i++;
        }
        frag.appendChild(ol);
        continue;
      }

      const paraLines = [];
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/^(#{1,6}\s+|```|>\s?|\s*[-*+]\s+|\s*\d+\.\s+)/.test(lines[i])
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      const p = document.createElement('p');
      appendInlineMarkdown(p, paraLines.join(' '), currentFile);
      frag.appendChild(p);
    }

    return frag;
  }

  function renderDocViewer(doc) {
    const bar = document.createElement('div');
    bar.className = 'doc-viewer-bar';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn-sm';
    back.textContent = '← Voltar aos documentos';
    back.addEventListener('click', () => {
      state.currentDoc = null;
      renderDetailTab();
    });

    const rel = document.createElement('span');
    rel.className = 'doc-rel';
    rel.textContent = doc.file;

    bar.appendChild(back);
    bar.appendChild(rel);

    const content = document.createElement('div');
    content.className = 'md-content';
    content.appendChild(renderSafeMarkdown(doc.markdown, doc.file));

    el.detailBody.appendChild(bar);
    el.detailBody.appendChild(content);
  }

  // --- Roteamento por hash (#/projetos, #/guia, #/novidades) ----------------
  function applyRoute() {
    const raw = (window.location.hash || '#/projetos').replace(/^#\/?/, '').toLowerCase();
    const route = raw === 'guia' || raw === 'novidades' ? raw : 'projetos';
    state.route = route;

    el.viewProjetos.classList.toggle('hidden', route !== 'projetos');
    el.viewGuia.classList.toggle('hidden', route !== 'guia');
    el.viewNovidades.classList.toggle('hidden', route !== 'novidades');

    document.querySelectorAll('.nav-link').forEach((a) => {
      a.classList.toggle('active', a.dataset.route === route);
    });

    if (route === 'guia') loadGuide();
    else if (route === 'novidades') loadChangelog();
  }

  window.addEventListener('hashchange', applyRoute);

  // --- Eventos ---------------------------------------------------------------
  el.btnRefresh.addEventListener('click', loadState);
  el.btnRetry.addEventListener('click', loadState);
  el.btnCloseJob.addEventListener('click', () => el.jobPanel.classList.add('hidden'));
  el.btnCloseDetail.addEventListener('click', closeDetails);
  el.drawerBackdrop.addEventListener('click', closeDetails);

  el.searchProjects.addEventListener('input', () => {
    state.search = el.searchProjects.value;
    renderProjects();
  });

  document.querySelectorAll('.filter-btn').forEach((b) => {
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      writePref('filter', state.filter);
      renderProjects();
    });
  });

  el.sortProjects.addEventListener('change', () => {
    state.sort = el.sortProjects.value;
    writePref('sort', state.sort);
    renderProjects();
  });

  el.btnClearFilters.addEventListener('click', () => {
    state.filter = 'all';
    state.search = '';
    el.searchProjects.value = '';
    writePref('filter', 'all');
    renderProjects();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !el.drawer.classList.contains('hidden')) {
      closeDetails();
    }
  });

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      state.detailTab = t.dataset.tab;
      state.currentDoc = null;
      updateTabs();
      renderDetailTab();
    });
  });

  el.btnCheck.addEventListener('click', () => {
    runJob('Verificando novidades do framework', () => apiPost('/api/check', {}));
  });

  el.btnUpdateAll.addEventListener('click', async () => {
    const outdatedList = state.projects.filter((p) => p.status === 'desatualizado');
    if (outdatedList.length === 0) return;

    let minVer = null;
    outdatedList.forEach((p) => {
      if (p.installedVersion && /^\d+\.\d+\.\d+$/.test(p.installedVersion)) {
        if (!minVer || compareSemver(p.installedVersion, minVer) < 0) {
          minVer = p.installedVersion;
        }
      }
    });

    const ok = await showChangelogModal(minVer, true);
    if (!ok) return;

    runJob(
      'Atualizando todos os projetos',
      () => apiPost('/api/update', { all: true }),
      { verifyPaths: outdatedList.map((p) => p.path) }
    );
  });

  el.btnAdd.addEventListener('click', async () => {
    const folder = await pickFolder('Selecionar pasta do projeto');
    if (!folder) return;
    const choice = await openModal({
      title: 'Como adicionar este projeto?',
      message: 'Pasta escolhida: ' + folder,
      buttons: [
        { label: 'Cancelar', value: 'cancel' },
        { label: 'Só adicionar à lista', value: 'add' },
        { label: 'Instalar o Liz aqui', value: 'install', cls: 'btn-primary' },
      ],
    });
    if (choice.action === 'install') {
      runJob('Instalando o Liz', () => apiPost('/api/install', { folder }));
    } else if (choice.action === 'add') {
      try {
        await apiPost('/api/add', { path: folder });
        showBanner('Projeto adicionado à lista.', 'ok');
        await loadState();
      } catch (err) {
        showBanner('Não foi possível adicionar: ' + err.message, 'error');
      }
    }
  });

  el.btnScan.addEventListener('click', async () => {
    const folder = await pickFolder('Selecionar pasta para procurar projetos');
    if (!folder) return;
    runJob('Procurando projetos com Liz', () => apiPost('/api/scan', { folder }));
  });

  // Batimento do coração (encerramento automático ao fechar a janela)
  const sendPing = () => {
    apiPost('/api/ping', {}).catch(() => {});
  };
  sendPing();
  setInterval(sendPing, 5000);

  applyRoute();
  loadState();
})();
