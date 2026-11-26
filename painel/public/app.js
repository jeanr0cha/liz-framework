(function () {
  'use strict';

  const tokenMeta = document.querySelector('meta[name="liz-token"]');
  const TOKEN = tokenMeta ? tokenMeta.getAttribute('content') || '' : '';

  const state = {
    framework: { version: '0.0.0', path: '' },
    projects: [],
    busy: false,
    detailProject: null,
    detailData: null,
    detailTab: 'repos',
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
    banner: document.getElementById('banner'),
    jobPanel: document.getElementById('job-panel'),
    jobTitle: document.getElementById('job-title'),
    jobLog: document.getElementById('job-log'),
    btnCloseJob: document.getElementById('btn-close-job'),
    summary: document.getElementById('summary'),
    loading: document.getElementById('state-loading'),
    errorBox: document.getElementById('state-error'),
    errorMsg: document.getElementById('error-message'),
    emptyBox: document.getElementById('state-empty'),
    list: document.getElementById('projects-list'),
    drawer: document.getElementById('detail-drawer'),
    drawerBackdrop: document.getElementById('drawer-backdrop'),
    detailTitle: document.getElementById('detail-title'),
    detailPath: document.getElementById('detail-path'),
    detailBody: document.getElementById('detail-body'),
    btnCloseDetail: document.getElementById('btn-close-detail'),
    modal: document.getElementById('modal-dialog'),
    modalTitle: document.getElementById('modal-title'),
    modalMessage: document.getElementById('modal-message'),
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
      if (opts.input) el.modalInput.focus();
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

  async function runJob(title, requestFn) {
    if (state.busy) return;
    hideBanner();
    setBusy(true);
    el.jobTitle.textContent = title;
    el.jobLog.textContent = 'Iniciando...\n';
    el.jobPanel.classList.remove('hidden');

    try {
      const { jobId } = await requestFn();
      await pollJob(jobId, title);
    } catch (err) {
      showBanner('Falhou: ' + err.message, 'error');
      el.jobLog.textContent += '\n❌ ' + err.message + '\n';
    } finally {
      setBusy(false);
      await loadState();
    }
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
        showBanner(title + ': concluído com sucesso.', 'ok');
        return;
      }
      if (data.status === 'failed') {
        el.jobTitle.textContent = title + ' — falhou';
        showBanner('Falhou: ' + lastNonEmptyLine(data.log) + '. Veja o log.', 'error');
        return;
      }
    }
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

    el.loading.classList.add('hidden');
    el.errorBox.classList.add('hidden');
    el.list.textContent = '';

    if (total === 0) {
      el.emptyBox.classList.remove('hidden');
      return;
    }
    el.emptyBox.classList.add('hidden');

    state.projects.forEach((p) => {
      const card = document.createElement('article');
      card.className = 'project-card';

      const top = document.createElement('div');
      top.className = 'card-top';

      const left = document.createElement('div');
      const titleRow = document.createElement('div');
      titleRow.className = 'card-title-row';

      const h2 = document.createElement('h2');
      h2.className = 'project-name';
      h2.textContent = p.name;

      const chip = document.createElement('span');
      chip.className = 'chip chip-' + p.status;
      chip.textContent = p.status;

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

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      if (p.status === 'desatualizado') {
        const btnUpd = document.createElement('button');
        btnUpd.type = 'button';
        btnUpd.className = 'btn btn-primary btn-sm project-action-btn';
        btnUpd.textContent = 'Atualizar';
        btnUpd.disabled = state.busy;
        btnUpd.addEventListener('click', () => {
          runJob('Atualizando ' + p.name, () => apiPost('/api/update', { path: p.path }));
        });
        actions.appendChild(btnUpd);
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

  async function openDetails(project) {
    state.detailProject = project;
    state.detailData = null;
    state.detailTab = 'repos';
    state.currentDoc = null;
    el.detailTitle.textContent = project.name;
    el.detailPath.textContent = project.path;
    el.detailBody.textContent = 'Carregando detalhes...';
    updateTabs();
    el.drawer.classList.remove('hidden');

    try {
      state.detailData = await apiGet('/api/project?path=' + encodeURIComponent(project.path));
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
      ['Repo', 'Papel', 'Stack', 'Branch', 'Alterações'].forEach((h) => {
        const th = document.createElement('th');
        th.textContent = h;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      repos.forEach((r) => {
        const tr = document.createElement('tr');
        [r.name, r.role || '-', r.stack || '-', r.branch || '?', r.changes === '' ? '-' : r.changes].forEach(
          (v) => {
            const td = document.createElement('td');
            td.textContent = v;
            tr.appendChild(td);
          }
        );
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
      const table = document.createElement('table');
      table.className = 'detail-table';
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      ['Sessão', 'Fase', 'Status', 'Próxima ação'].forEach((h) => {
        const th = document.createElement('th');
        th.textContent = h;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      sessions.forEach((s) => {
        const tr = document.createElement('tr');
        const faseTxt = s.phase ? (s.phaseTitle ? s.phase + ' — ' + s.phaseTitle : s.phase) : '-';
        [s.slug, faseTxt, s.status || '-', s.nextAction || '-'].forEach((v) => {
          const td = document.createElement('td');
          td.textContent = v;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      el.detailBody.appendChild(table);
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
        { key: 'negocio', label: 'Negócio', hint: 'Ainda não gerado. Rode /docs-build-business-docs na IA deste projeto.' },
        { key: 'tecnico', label: 'Técnica', hint: 'Ainda não gerado. Rode /docs-build-tech-docs na IA deste projeto.' },
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

  // --- Eventos ---------------------------------------------------------------
  el.btnRefresh.addEventListener('click', loadState);
  el.btnRetry.addEventListener('click', loadState);
  el.btnCloseJob.addEventListener('click', () => el.jobPanel.classList.add('hidden'));
  el.btnCloseDetail.addEventListener('click', closeDetails);
  el.drawerBackdrop.addEventListener('click', closeDetails);

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
    const outdated = state.projects.filter((p) => p.status === 'desatualizado').length;
    const r = await openModal({
      title: 'Atualizar todos os projetos',
      message: 'Atualizar ' + outdated + ' projeto(s) desatualizado(s) para v' + state.framework.version + '?',
      buttons: [
        { label: 'Cancelar', value: 'cancel' },
        { label: 'Atualizar todos', value: 'ok', cls: 'btn-primary' },
      ],
    });
    if (r.action !== 'ok') return;
    runJob('Atualizando todos os projetos', () => apiPost('/api/update', { all: true }));
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

  loadState();
})();
