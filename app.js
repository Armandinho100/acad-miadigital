// =====================================================
//  ACADEMIA DIGITAL — lógica do site
//  Login, mural de avisos, listagem, moderação,
//  envio e exclusão de materiais usando o Supabase.
// =====================================================
(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SITE = CFG.SITE_NAME || 'Academia Digital';
  const BUCKET = 'materiais';
  const MB = 1024 * 1024;
  const MAX_FILE = 25 * MB;
  const MAX_COVER = 5 * MB;
  const FILE_EXT = ['pdf', 'zip', 'rar', '7z', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mp3'];
  const COVER_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

  // ---------- Utilidades ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // Só aceita links http(s). Bloqueia "javascript:" e similares.
  function safeUrl(u) {
    try {
      const x = new URL(String(u).trim());
      return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;
    } catch (_) { return null; }
  }

  const getExt = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

  function safeFileName(name) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    const clean = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'arquivo';
    return ext ? `${clean}.${ext}` : clean;
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < MB) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / MB).toFixed(1).replace('.', ',')} MB`;
  }

  const fmtDate = (iso) => new Date(iso).toLocaleDateString('pt-BR');

  function fmtDateTime(iso) {
    const d = new Date(iso);
    const date = d.toLocaleDateString('pt-BR');
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${date} às ${time}`;
  }

  let toastTimer;
  function toast(msg, type = 'info') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
  }

  // ---------- Ícones e categorias ----------
  const ICON_PATHS = {
    jogos: '<rect x="2.5" y="7" width="19" height="11" rx="4"/><path d="M7 10.5v4M5 12.5h4"/><circle cx="15.5" cy="11.5" r=".7"/><circle cx="18" cy="13.5" r=".7"/>',
    documentos: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    links: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    videos: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
    outros: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 20h14"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  };
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;

  const CATS = {
    jogos: { label: 'Jogos', action: 'Jogar' },
    documentos: { label: 'Documentos', action: 'Abrir' },
    links: { label: 'Links', action: 'Acessar' },
    videos: { label: 'Vídeos', action: 'Assistir' },
    outros: { label: 'Outros', action: 'Acessar' },
  };

  const PAGES = {
    inicio: { eyebrow: 'Início', title: 'Tudo em um só lugar', sub: 'Avisos da turma e materiais compartilhados pelos alunos.' },
    jogos: { eyebrow: 'Categoria', title: 'Jogos', sub: 'Jogos criados pelos alunos. Jogue online ou baixe.' },
    documentos: { eyebrow: 'Categoria', title: 'Documentos', sub: 'PDFs, slides, planilhas e textos para estudo.' },
    links: { eyebrow: 'Categoria', title: 'Links', sub: 'Sites, pastas e referências úteis.' },
    videos: { eyebrow: 'Categoria', title: 'Vídeos', sub: 'Vídeos enviados e links de plataformas de vídeo.' },
    outros: { eyebrow: 'Categoria', title: 'Outros', sub: 'Materiais que não se encaixam nas demais categorias.' },
  };
  const ROUTES = ['inicio', 'jogos', 'documentos', 'links', 'videos', 'outros', 'moderacao', 'enviar', 'sobre'];

  // ---------- Estado ----------
  const state = {
    user: null,
    profile: null,
    posts: [],
    pendingPosts: [],
    notices: [],
    noticesExpanded: false,
    covers: {},
    loaded: false,
    pendingLoaded: false,
    noticesLoaded: false,
    filters: { q: '', sort: 'recent', cat: 'all' },
  };

  const isAdmin = () => Boolean(state.profile && state.profile.role === 'admin');
  const canDelete = () => isAdmin();

  // ---------- Telas ----------
  const screens = { splash: $('#splash'), auth: $('#auth-view'), app: $('#app') };
  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => { el.hidden = key !== name; });
  }

  // Nome do site e ano
  document.title = SITE;
  $$('[data-site-name]').forEach((n) => { n.textContent = SITE; });
  $('#year').textContent = new Date().getFullYear();

  // ---------- Verificação da configuração ----------
  const configured = CFG.SUPABASE_URL && CFG.SUPABASE_KEY
    && !String(CFG.SUPABASE_URL).startsWith('COLE_')
    && !String(CFG.SUPABASE_KEY).startsWith('COLE_');

  if (!configured || !window.supabase) {
    showScreen('none');
    $('#setup-warning').hidden = false;
    if (!window.supabase) {
      $('#setup-warning .lead').textContent = 'Não foi possível carregar a biblioteca do Supabase. Verifique sua conexão com a internet e recarregue a página.';
    }
    return;
  }

  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);

  // ---------- Tema ----------
  $('#theme-btn').addEventListener('click', () => {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    try { localStorage.setItem('ad-theme', next); } catch (_) { /* ignora */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? '#07080c' : '#f3f5f9');
  });

  // ---------- Menu mobile ----------
  const nav = $('#nav');
  const menuBtn = $('#menu-btn');
  function closeMenu() {
    nav.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }
  menuBtn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  // ---------- Login / cadastro ----------
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.tab;
    $$('.tab').forEach((t) => {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    $('#form-login').hidden = which !== 'login';
    $('#form-register').hidden = which !== 'register';
  }));

  // "Mostrar senha"
  $$('.toggle-pass').forEach((cb) => cb.addEventListener('change', () => {
    const input = $('input[name="password"]', cb.closest('form'));
    if (input) input.type = cb.checked ? 'text' : 'password';
  }));

  function setError(form, msg) {
    const p = $('.form-error', form);
    p.textContent = msg || '';
    p.hidden = !msg;
  }

  function setBusy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; }
    else if (btn.dataset.label) { btn.textContent = btn.dataset.label; }
    btn.disabled = on;
  }

  function authMessage(error) {
    const m = (error.message || '').toLowerCase();
    if (m.includes('invalid login')) return 'E-mail ou senha incorretos.';
    if (m.includes('already registered') || m.includes('already been registered')) return 'Este e-mail já possui conta. Use a aba Entrar.';
    if (m.includes('rate limit')) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    if (m.includes('valid email') || m.includes('invalid email')) return 'Digite um e-mail válido.';
    if (m.includes('password')) return 'A senha precisa ter pelo menos 8 caracteres.';
    return 'Não foi possível concluir. Tente novamente.';
  }

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    setError(f, '');
    const email = f.elements.email.value.trim();
    const password = f.elements.password.value;
    if (!email || !password) return setError(f, 'Preencha o e-mail e a senha.');
    const btn = $('button[type="submit"]', f);
    setBusy(btn, true, 'Entrando…');
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(btn, false);
    if (error) setError(f, authMessage(error));
  });

  $('#form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    setError(f, '');
    const name = f.elements.name.value.trim();
    const email = f.elements.email.value.trim();
    const password = f.elements.password.value;
    if (name.length < 2) return setError(f, 'Digite seu nome.');
    if (!email) return setError(f, 'Digite seu e-mail.');
    if (password.length < 8) return setError(f, 'A senha precisa ter pelo menos 8 caracteres.');
    const btn = $('button[type="submit"]', f);
    setBusy(btn, true, 'Criando conta…');
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name } } });
    setBusy(btn, false);
    if (error) return setError(f, authMessage(error));
    if (!data.session) {
      toast('Conta criada! Confirme seu e-mail para entrar.', 'success');
    }
  });

  $('#logout-btn').addEventListener('click', async () => {
    await sb.auth.signOut();
  });

  // ---------- Botão de moderação e contador ----------
  function updateModBadge() {
    const navMod = $('#nav-mod');
    const badge = $('#mod-badge');
    if (!navMod || !badge) return;
    if (!isAdmin()) {
      navMod.hidden = true;
      badge.hidden = true;
      return;
    }
    navMod.hidden = false;
    const count = state.pendingPosts.length;
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }

  // ---------- Sessão ----------
  let currentUserId = null;

  async function loadProfile(user) {
    for (let i = 0; i < 3; i += 1) {
      const { data } = await sb.from('profiles').select('name, role').eq('id', user.id).maybeSingle();
      if (data) return data;
      await new Promise((r) => setTimeout(r, 400));
    }
    return { name: (user.user_metadata && user.user_metadata.name) || user.email.split('@')[0], role: 'user' };
  }

  async function handleSession(session) {
    if (!session) {
      currentUserId = null;
      state.user = null;
      state.profile = null;
      state.posts = [];
      state.pendingPosts = [];
      state.notices = [];
      state.noticesExpanded = false;
      state.loaded = false;
      state.pendingLoaded = false;
      state.noticesLoaded = false;
      updateModBadge();
      closeMenu();
      showScreen('auth');
      return;
    }
    if (currentUserId === session.user.id && state.user) {
      state.user = session.user; // apenas renovação do token
      return;
    }
    currentUserId = session.user.id;
    state.user = session.user;
    state.profile = await loadProfile(session.user);
    $('#user-name').textContent = state.profile.name;
    $('#admin-badge').hidden = !isAdmin();
    updateModBadge();
    if (isAdmin() && !state.pendingLoaded) {
      await loadPendingPosts();
      updateModBadge();
    }
    showScreen('app');
    if (location.hash !== '#/inicio') history.replaceState(null, '', '#/inicio');
    route();
  }

  // O setTimeout evita travar o cliente do Supabase dentro do callback
  sb.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handleSession(session), 0);
  });

  // ---------- Dados: Mural de Avisos ----------
  async function loadNotices() {
    const { data, error } = await sb.from('notices').select('*')
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) {
      console.error(error);
      state.notices = [];
    } else {
      state.notices = data || [];
    }
    state.noticesLoaded = true;
  }

  function sortNotices() {
    state.notices.sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return new Date(b.updated_at) - new Date(a.updated_at);
    });
  }

  function openNoticeForm(notice = null) {
    const form = $('#notice-form');
    if (!form) return;
    setError(form, '');
    form.hidden = false;
    $('#notice-form-title').textContent = notice ? 'Editar aviso' : 'Novo aviso no mural';
    form.elements.id.value = notice ? notice.id : '';
    form.elements.title.value = notice ? notice.title : '';
    form.elements.content.value = notice ? notice.content : '';
    form.elements.link.value = notice && notice.link_url ? notice.link_url : '';
    form.elements.pinned.checked = Boolean(notice && notice.pinned);
    form.elements.title.focus();
  }

  function closeNoticeForm() {
    const form = $('#notice-form');
    if (!form) return;
    form.reset();
    form.elements.id.value = '';
    setError(form, '');
    form.hidden = true;
  }

  function renderBoard() {
    const section = $('#board-section');
    const listEl = $('#notices-list');
    const newBtn = $('#new-notice-btn');
    const moreWrap = $('#notices-more-wrap');
    const moreBtn = $('#notices-more-btn');
    if (!section || !listEl) return;

    const admin = isAdmin();
    if (newBtn) newBtn.hidden = !admin;

    if (!admin && state.notices.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    sortNotices();

    if (state.notices.length === 0) {
      listEl.innerHTML = '<div class="notice-empty">Nenhum aviso publicado no mural ainda. Clique em <strong>+ Novo aviso</strong> para publicar o primeiro.</div>';
      if (moreWrap) moreWrap.hidden = true;
      return;
    }

    const pinned = state.notices.filter((n) => n.pinned);
    const regular = state.notices.filter((n) => !n.pinned);
    const maxRegular = 3;
    const visible = state.noticesExpanded
      ? state.notices
      : [...pinned, ...regular.slice(0, maxRegular)];
    const hiddenCount = state.notices.length - visible.length;

    if (moreWrap && moreBtn) {
      if (regular.length > maxRegular) {
        moreWrap.hidden = false;
        moreBtn.textContent = state.noticesExpanded
          ? 'Mostrar menos avisos'
          : `Ver mais ${hiddenCount} ${hiddenCount === 1 ? 'aviso' : 'avisos'}`;
      } else {
        moreWrap.hidden = true;
      }
    }

    listEl.innerHTML = visible.map((n) => {
      const link = n.link_url ? safeUrl(n.link_url) : null;
      return `
        <article class="notice-item${n.pinned ? ' pinned' : ''}">
          <div class="notice-top">
            <div class="notice-title-row">
              ${n.pinned ? '<span class="pin-tag">Fixado</span>' : ''}
              <h4>${esc(n.title)}</h4>
            </div>
            ${link ? `<a class="btn btn-sm" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${icon('external')}Abrir link</a>` : ''}
          </div>
          <p class="notice-body">${esc(n.content)}</p>
          <div class="notice-foot">
            <div class="notice-meta">
              <span>por ${esc(n.author_name || 'Admin')}</span>
              <span class="notice-updated">${icon('clock')}Atualizado em ${esc(fmtDateTime(n.updated_at))}</span>
            </div>
            ${admin ? `
              <div class="notice-actions">
                <button type="button" class="btn btn-sm" data-notice-action="edit" data-id="${esc(n.id)}">${icon('edit')}Editar</button>
                <button type="button" class="btn btn-sm btn-danger" data-notice-action="delete" data-id="${esc(n.id)}" aria-label="Excluir aviso ${esc(n.title)}" title="Excluir aviso">${icon('x')}Excluir</button>
              </div>` : ''}
          </div>
        </article>`;
    }).join('');
  }

  async function saveNotice(e) {
    e.preventDefault();
    if (!isAdmin()) return toast('Apenas os administradores podem publicar avisos.', 'error');
    const form = e.currentTarget;
    setError(form, '');

    const id = form.elements.id.value.trim();
    const title = form.elements.title.value.trim();
    const content = form.elements.content.value.trim();
    const rawLink = form.elements.link.value.trim();
    const pinned = form.elements.pinned.checked;

    if (title.length < 2) return setError(form, 'Digite um título para o aviso.');
    if (content.length < 2) return setError(form, 'Escreva a mensagem do aviso.');
    const link = rawLink ? safeUrl(rawLink) : null;
    if (rawLink && !link) return setError(form, 'Digite um link válido começando com http:// ou https://.');

    const btn = $('button[type="submit"]', form);
    setBusy(btn, true, 'Salvando…');

    if (id) {
      const { data, error } = await sb.from('notices')
        .update({ title, content, link_url: link, pinned })
        .eq('id', id)
        .select('*')
        .maybeSingle();
      setBusy(btn, false);
      if (error || !data) return setError(form, 'Não foi possível atualizar o aviso.');
      state.notices = state.notices.map((x) => (x.id === id ? data : x));
      closeNoticeForm();
      renderBoard();
      toast('Aviso atualizado!', 'success');
    } else {
      const { data, error } = await sb.from('notices')
        .insert({ user_id: state.user.id, title, content, link_url: link, pinned })
        .select('*')
        .maybeSingle();
      setBusy(btn, false);
      if (error || !data) return setError(form, 'Não foi possível publicar o aviso.');
      state.notices.unshift(data);
      closeNoticeForm();
      renderBoard();
      toast('Aviso publicado no mural!', 'success');
    }
  }

  async function deleteNotice(id, btn) {
    if (!isAdmin()) return toast('Apenas os administradores podem excluir avisos.', 'error');
    const n = state.notices.find((x) => x.id === id);
    if (!n) return;
    if (!window.confirm(`Excluir o aviso "${n.title}"?`)) return;
    btn.disabled = true;
    const { data, error } = await sb.from('notices').delete().eq('id', id).select('id');
    if (error || !data || data.length === 0) {
      btn.disabled = false;
      return toast('Não foi possível excluir este aviso.', 'error');
    }
    state.notices = state.notices.filter((x) => x.id !== id);
    renderBoard();
    toast('Aviso excluído.', 'success');
  }

  // ---------- Dados: Materiais ----------
  async function attachCovers(items) {
    const paths = items.map((p) => p.cover_path).filter(Boolean);
    if (!paths.length) return;
    const unique = [...new Set(paths)];
    const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(unique, 3600);
    (signed || []).forEach((s) => {
      if (s.signedUrl && !s.error) state.covers[s.path] = s.signedUrl;
    });
  }

  async function loadPosts() {
    const { data, error } = await sb.from('posts').select('*')
      .eq('status', 'approved')
      .order('created_at', { ascending: false }).limit(500);
    if (error) {
      console.error(error);
      toast('Não foi possível carregar os materiais.', 'error');
      state.posts = [];
    } else {
      state.posts = data || [];
    }

    await attachCovers(state.posts);
    state.loaded = true;
  }

  async function loadPendingPosts() {
    if (!isAdmin()) {
      state.pendingPosts = [];
      state.pendingLoaded = true;
      updateModBadge();
      return;
    }
    const { data, error } = await sb.from('posts').select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(500);
    if (error) {
      console.error(error);
      toast('Não foi possível carregar os envios pendentes.', 'error');
      state.pendingPosts = [];
    } else {
      state.pendingPosts = data || [];
    }

    await attachCovers(state.pendingPosts);
    state.pendingLoaded = true;
    updateModBadge();
  }

  function findPostById(id) {
    return state.posts.find((x) => x.id === id) || state.pendingPosts.find((x) => x.id === id);
  }

  async function downloadPost(id, btn) {
    const p = findPostById(id);
    if (!p || !p.file_path) return;
    btn.disabled = true;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(p.file_path, 120, { download: p.file_name || true });
    btn.disabled = false;
    if (error || !data) return toast('Não foi possível baixar o arquivo.', 'error');
    window.location.href = data.signedUrl;
  }

  async function approvePost(id, btn) {
    if (!isAdmin()) return toast('Apenas os administradores podem aprovar envios.', 'error');
    const p = state.pendingPosts.find((x) => x.id === id);
    if (!p) return;
    btn.disabled = true;
    const { data, error } = await sb.from('posts')
      .update({ status: 'approved' })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    btn.disabled = false;
    if (error || !data) {
      return toast('Não foi possível aprovar este material.', 'error');
    }
    state.pendingPosts = state.pendingPosts.filter((x) => x.id !== id);
    if (!state.posts.some((x) => x.id === id)) {
      state.posts.unshift(data);
    }
    updateModBadge();
    renderModerationGrid();
    toast('Material aprovado e publicado!', 'success');
  }

  async function deletePost(id, btn, fromModeration = false) {
    if (!canDelete()) return toast('Apenas os administradores podem excluir publicações.', 'error');
    const p = findPostById(id);
    if (!p) return;
    const msg = fromModeration
      ? `Recusar e excluir "${p.title}"? O arquivo será removido permanentemente.`
      : `Excluir "${p.title}"? Essa ação não pode ser desfeita.`;
    if (!window.confirm(msg)) return;
    btn.disabled = true;
    const { data, error } = await sb.from('posts').delete().eq('id', id).select('id');
    if (error || !data || data.length === 0) {
      btn.disabled = false;
      return toast('Você não tem permissão para excluir este item.', 'error');
    }
    const paths = [p.file_path, p.cover_path].filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    state.posts = state.posts.filter((x) => x.id !== id);
    state.pendingPosts = state.pendingPosts.filter((x) => x.id !== id);
    updateModBadge();
    if (fromModeration) renderModerationGrid();
    else renderGrid();
    toast(fromModeration ? 'Envio recusado e removido.' : 'Publicação excluída.', 'success');
  }

  // ---------- Roteador ----------
  const view = $('#view');

  function currentRoute() {
    const r = location.hash.replace(/^#\/?/, '').split('?')[0];
    if (r === 'moderacao' && !isAdmin()) return 'inicio';
    return ROUTES.includes(r) ? r : 'inicio';
  }

  function route() {
    if (!state.user) return;
    const r = currentRoute();
    if (location.hash.replace(/^#\/?/, '').split('?')[0] === 'moderacao' && !isAdmin()) {
      history.replaceState(null, '', '#/inicio');
    }
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
    closeMenu();
    window.scrollTo(0, 0);
    view.dataset.route = r;
    const pageTitle = r === 'moderacao'
      ? 'Moderação'
      : r === 'enviar'
        ? 'Enviar material'
        : r === 'sobre'
          ? 'Sobre'
          : r === 'inicio'
            ? ''
            : PAGES[r].title;
    document.title = pageTitle ? `${pageTitle} · ${SITE}` : SITE;
    if (r === 'moderacao') renderModeration();
    else if (r === 'enviar') renderUpload();
    else if (r === 'sobre') renderAbout();
    else renderList(r);
  }
  window.addEventListener('hashchange', route);

  // ---------- Página: listagem ----------
  function renderList(r) {
    const page = PAGES[r];
    state.filters.cat = r === 'inicio' ? 'all' : r;
    state.filters.q = '';

    view.replaceChildren($('#tpl-list').content.cloneNode(true));
    const firstName = ((state.profile && state.profile.name) || '').trim().split(/\s+/)[0];
    $('#list-eyebrow').textContent = r === 'inicio' && firstName ? `Olá, ${firstName}` : page.eyebrow;
    $('#list-title').textContent = page.title;
    $('#list-sub').textContent = page.sub;
    $('#sort').value = state.filters.sort;

    if (r === 'inicio') {
      $('#new-notice-btn').addEventListener('click', () => openNoticeForm());
      $('#cancel-notice-btn').addEventListener('click', closeNoticeForm);
      $('#notice-form').addEventListener('submit', saveNotice);
      $('#notices-more-btn').addEventListener('click', () => {
        state.noticesExpanded = !state.noticesExpanded;
        renderBoard();
      });
      $('#notices-list').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-notice-action]');
        if (!btn) return;
        const id = btn.dataset.id;
        if (btn.dataset.noticeAction === 'edit') {
          const item = state.notices.find((x) => x.id === id);
          if (item) openNoticeForm(item);
        } else if (btn.dataset.noticeAction === 'delete') {
          deleteNotice(id, btn);
        }
      });

      if (state.noticesLoaded) {
        renderBoard();
      } else {
        loadNotices().then(() => { if (view.dataset.route === 'inicio') renderBoard(); });
      }
    }

    $('#q').addEventListener('input', (e) => { state.filters.q = e.target.value; renderGrid(); });
    $('#sort').addEventListener('change', (e) => { state.filters.sort = e.target.value; renderGrid(); });
    $('#grid').addEventListener('click', onGridClick);

    if (state.loaded) {
      renderGrid();
    } else {
      $('#grid').innerHTML = '<div class="skeleton"></div>'.repeat(6);
      loadPosts().then(() => { if (view.dataset.route === r) renderGrid(); });
    }
  }

  function filteredPosts() {
    const { q, sort, cat } = state.filters;
    const term = q.trim().toLowerCase();
    const list = state.posts.filter((p) =>
      (cat === 'all' || p.category === cat)
      && (!term || [p.title, p.description, p.author_name].some((v) => (v || '').toLowerCase().includes(term))));
    if (sort === 'old') list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (sort === 'az') list.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
    else list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return list;
  }

  function cardHtml(p) {
    const cat = CATS[p.category] ? p.category : 'outros';
    const meta = CATS[cat];
    const cover = state.covers[p.cover_path];
    const link = p.link_url ? safeUrl(p.link_url) : null;
    const size = p.file_size ? fmtSize(p.file_size) : '';
    return `
      <article class="card" data-cat="${cat}">
        <div class="card-cover">
          ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : icon(cat)}
          <span class="badge">${icon(cat)}${esc(meta.label)}</span>
        </div>
        <div class="card-body">
          <h3>${esc(p.title)}</h3>
          ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
          <div class="meta">
            <span>por ${esc(p.author_name || 'Aluno')}</span>
            <span>${esc(fmtDate(p.created_at))}</span>
            ${size ? `<span>${esc(size)}</span>` : ''}
          </div>
        </div>
        <div class="card-actions">
          ${link ? `<a class="btn btn-primary btn-sm btn-main" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${icon('external')}${esc(meta.action)}</a>` : ''}
          ${p.file_path ? `<button type="button" class="btn btn-sm btn-main${link ? '' : ' btn-primary'}" data-action="download" data-id="${esc(p.id)}">${icon('download')}Baixar</button>` : ''}
          ${canDelete() ? `<button type="button" class="btn btn-sm btn-danger btn-icon-only" data-action="delete" data-id="${esc(p.id)}" aria-label="Excluir ${esc(p.title)}" title="Excluir material">${icon('x')}</button>` : ''}
        </div>
      </article>`;
  }

  function renderGrid() {
    const grid = $('#grid');
    if (!grid) return;
    const list = filteredPosts();
    const count = $('#count');
    count.hidden = list.length === 0;
    count.textContent = list.length === 1 ? '1 material' : `${list.length} materiais`;

    if (list.length === 0) {
      let title = 'Nada encontrado';
      let text = 'Tente buscar com outras palavras.';
      if (state.posts.length === 0) {
        title = 'Ainda não há materiais aqui';
        text = 'Seja o primeiro a compartilhar! Use a aba Enviar, no menu.';
      } else if (!state.filters.q.trim()) {
        title = 'Nada por aqui ainda';
        text = 'Ainda não há materiais nesta categoria. Use a aba Enviar, no menu, para publicar o primeiro.';
      }
      grid.innerHTML = `
        <div class="empty">
          <h3>${esc(title)}</h3>
          <p>${esc(text)}</p>
        </div>`;
      return;
    }
    grid.innerHTML = list.map(cardHtml).join('');
  }

  function onGridClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'download') downloadPost(btn.dataset.id, btn);
    if (btn.dataset.action === 'delete') deletePost(btn.dataset.id, btn, false);
  }

  // ---------- Página: moderação (apenas admins) ----------
  function moderationCardHtml(p) {
    const cat = CATS[p.category] ? p.category : 'outros';
    const meta = CATS[cat];
    const cover = state.covers[p.cover_path];
    const link = p.link_url ? safeUrl(p.link_url) : null;
    const size = p.file_size ? fmtSize(p.file_size) : '';
    return `
      <article class="card" data-cat="${cat}">
        <div class="card-cover">
          ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : icon(cat)}
          <span class="badge">${icon(cat)}${esc(meta.label)}</span>
        </div>
        <div class="card-body">
          <h3>${esc(p.title)}</h3>
          ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
          <div class="meta">
            <span>por ${esc(p.author_name || 'Aluno')}</span>
            <span>${esc(fmtDate(p.created_at))}</span>
            ${size ? `<span>${esc(size)}</span>` : ''}
          </div>
        </div>
        <div class="card-actions">
          ${link ? `<a class="btn btn-sm btn-main" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${icon('external')}${esc(meta.action)}</a>` : ''}
          ${p.file_path ? `<button type="button" class="btn btn-sm btn-main" data-action="download" data-id="${esc(p.id)}">${icon('download')}Baixar</button>` : ''}
          <button type="button" class="btn btn-primary btn-sm btn-main" data-action="approve" data-id="${esc(p.id)}">${icon('check')}Aprovar</button>
          <button type="button" class="btn btn-sm btn-danger btn-icon-only" data-action="reject" data-id="${esc(p.id)}" aria-label="Recusar ${esc(p.title)}" title="Recusar envio">${icon('x')}</button>
        </div>
      </article>`;
  }

  function renderModerationGrid() {
    const grid = $('#mod-grid');
    if (!grid) return;
    const list = state.pendingPosts;
    const count = $('#mod-count');
    count.hidden = list.length === 0;
    count.textContent = list.length === 1 ? '1 envio pendente' : `${list.length} envios pendentes`;

    if (list.length === 0) {
      grid.innerHTML = `
        <div class="empty">
          <h3>Nenhum envio pendente</h3>
          <p>Todos os envios já foram revisados.</p>
        </div>`;
      return;
    }
    grid.innerHTML = list.map(moderationCardHtml).join('');
  }

  function onModerationClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'download') downloadPost(id, btn);
    if (btn.dataset.action === 'approve') approvePost(id, btn);
    if (btn.dataset.action === 'reject') deletePost(id, btn, true);
  }

  function renderModeration() {
    if (!isAdmin()) {
      location.hash = '#/inicio';
      return;
    }
    view.replaceChildren($('#tpl-moderation').content.cloneNode(true));
    $('#mod-grid').addEventListener('click', onModerationClick);

    if (state.pendingLoaded) {
      renderModerationGrid();
    } else {
      $('#mod-grid').innerHTML = '<div class="skeleton"></div>'.repeat(3);
      loadPendingPosts().then(() => { if (view.dataset.route === 'moderacao') renderModerationGrid(); });
    }
  }

  // ---------- Página: enviar ----------
  function renderUpload() {
    view.replaceChildren($('#tpl-upload').content.cloneNode(true));
    const form = $('#form-upload');
    const select = $('#up-category');
    select.innerHTML = Object.entries(CATS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');

    if (isAdmin()) {
      $('#upload-lead').textContent = 'Publique um arquivo, um link, ou os dois diretamente no site.';
      $('#upload-submit-btn').textContent = 'Publicar agora';
    } else {
      $('#upload-lead').textContent = 'Publique um arquivo, um link, ou os dois. Após aprovação da moderação, ficará visível para todos os alunos logados.';
      $('#upload-submit-btn').textContent = 'Enviar para aprovação';
    }

    const hints = {
      jogos: 'Para jogos online, cole aqui o link para jogar. Se preferir, envie o .zip do jogo no campo Arquivo.',
      documentos: 'Opcional: link do documento (Drive, por exemplo).',
      links: 'Cole o endereço do site ou da pasta que você quer compartilhar.',
      videos: 'Cole o link do vídeo (YouTube, por exemplo) ou envie o arquivo abaixo.',
      outros: 'Opcional: link relacionado ao material.',
    };
    const updateHint = () => { $('#link-hint').textContent = hints[select.value]; };
    select.addEventListener('change', updateHint);
    updateHint();

    const desc = form.elements.description;
    desc.addEventListener('input', () => { $('#desc-count').textContent = `${desc.value.length}/1000`; });

    // Prévia do arquivo selecionado
    const fileInput = $('#up-file');
    const filePreview = $('#file-preview');
    const filePreviewText = $('#file-preview-text');
    const clearFile = () => {
      fileInput.value = '';
      filePreview.hidden = true;
      filePreviewText.textContent = '';
    };
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return clearFile();
      filePreviewText.textContent = `${f.name} · ${fmtSize(f.size)}`;
      filePreview.hidden = false;
    });
    $('#clear-file-btn').addEventListener('click', clearFile);

    // Prévia da imagem de capa
    const coverInput = $('#up-cover');
    const coverWrap = $('#cover-preview-wrap');
    const coverImg = $('#cover-preview-img');
    let coverObjectUrl = null;
    const clearCover = () => {
      if (coverObjectUrl) {
        URL.revokeObjectURL(coverObjectUrl);
        coverObjectUrl = null;
      }
      coverInput.value = '';
      coverImg.src = '';
      coverWrap.hidden = true;
    };
    coverInput.addEventListener('change', () => {
      const f = coverInput.files[0];
      if (!f) return clearCover();
      if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
      coverObjectUrl = URL.createObjectURL(f);
      coverImg.src = coverObjectUrl;
      coverWrap.hidden = false;
    });
    $('#clear-cover-btn').addEventListener('click', clearCover);

    form.addEventListener('submit', submitUpload);
  }

  async function submitUpload(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const errBox = $('#upload-error');
    const fail = (msg) => { errBox.textContent = msg; errBox.hidden = false; errBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    errBox.hidden = true;

    const category = form.elements.category.value;
    const title = form.elements.title.value.trim();
    const description = form.elements.description.value.trim();
    const rawLink = form.elements.link.value.trim();
    const file = form.elements.file.files[0] || null;
    const cover = form.elements.cover.files[0] || null;

    if (title.length < 3) return fail('O título precisa ter pelo menos 3 caracteres.');
    const link = rawLink ? safeUrl(rawLink) : null;
    if (rawLink && !link) return fail('Digite um link válido, começando com http:// ou https://.');
    if (category === 'links' && !link) return fail('Na categoria Links, o link é obrigatório.');
    if (!link && !file) return fail('Envie um arquivo ou informe um link.');

    if (file) {
      if (!FILE_EXT.includes(getExt(file.name))) return fail('Tipo de arquivo não permitido. Veja a lista de tipos aceitos.');
      if (file.size > MAX_FILE) return fail('O arquivo passa de 25 MB. Para arquivos grandes, publique um link.');
    }
    if (cover) {
      if (!COVER_EXT.includes(getExt(cover.name))) return fail('A capa precisa ser PNG, JPG, WEBP ou GIF.');
      if (cover.size > MAX_COVER) return fail('A imagem de capa passa de 5 MB.');
    }

    const btn = $('button[type="submit"]', form);
    setBusy(btn, true, 'Enviando…');

    const uploaded = [];
    const upload = async (f, prefix) => {
      const path = `${state.user.id}/${prefix}${Date.now()}-${safeFileName(f.name)}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, f, { cacheControl: '3600', upsert: false });
      if (error) throw error;
      uploaded.push(path);
      return path;
    };

    try {
      const filePath = file ? await upload(file, '') : null;
      const coverPath = cover ? await upload(cover, 'capa-') : null;
      const { error } = await sb.from('posts').insert({
        user_id: state.user.id,
        title,
        description,
        category,
        link_url: link,
        file_path: filePath,
        file_name: file ? file.name : null,
        file_size: file ? file.size : null,
        cover_path: coverPath,
      });
      if (error) throw error;
    } catch (err) {
      console.error(err);
      if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded);
      setBusy(btn, false);
      return fail('Não foi possível publicar. Verifique sua conexão e tente novamente.');
    }

    if (isAdmin()) {
      state.loaded = false;
      toast('Material publicado!', 'success');
      location.hash = `#/${category}`;
    } else {
      toast('Enviado para análise! Um administrador irá revisar antes de publicar.', 'success');
      location.hash = '#/inicio';
    }
  }

  // ---------- Página: sobre ----------
  function renderAbout() {
    view.replaceChildren($('#tpl-about').content.cloneNode(true));
    $$('[data-site-name]', view).forEach((n) => { n.textContent = SITE; });
  }
})();
