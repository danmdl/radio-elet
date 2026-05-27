/* Inline visual editor for Radio Elet — loads only at /admin
   Direct click-to-edit on the live page, with drag-and-drop reordering. */

(function () {
  'use strict';

  const PASS_HASH = '5312483a9608c7f943cde4dfd7b99ce2f89f39f5da5a5178faf880b2fea02dfe';
  const STORAGE_KEY = 'elet_admin_content_draft';
  const PUBLISHED_KEY = 'elet_admin_last_published_hash';
  const AUTH_KEY = 'elet_admin_authed';

  let content = null;
  let saveTimer = null;
  let toastTimer = null;
  let sortableLib = null; // SortableJS loaded lazily

  /* ==================== UTILS ==================== */
  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function $(sel, root = document) { return root.querySelector(sel); }
  function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function setByPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (cur[key] == null) cur[key] = isNaN(parts[i + 1]) ? {} : [];
      cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
  }
  function getByPath(obj, path) {
    return path.split('.').reduce((o, p) => (o == null ? undefined : o[p]), obj);
  }

  function persist() {
    if (!content) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(content));
    flashSaved();
    updatePublishStatus();
  }

  function flashSaved() {
    const s = $('#tb-status');
    if (!s) return;
    s.classList.add('dirty');
    s.classList.remove('published');
    s.innerHTML = '<span class="dot"></span>Borrador guardado';
  }

  function toast(msg, kind = '') {
    let t = $('#admin-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'admin-toast';
      t.className = 'admin-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'admin-toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  async function updatePublishStatus() {
    const s = $('#tb-status');
    if (!s || !content) return;
    const hash = await sha256(JSON.stringify(content));
    const last = localStorage.getItem(PUBLISHED_KEY);
    if (last && last === hash) {
      s.className = 'tb-status published';
      s.innerHTML = '<span class="dot"></span>Publicado';
    } else if (last) {
      s.className = 'tb-status dirty';
      s.innerHTML = '<span class="dot"></span>Cambios sin publicar';
    } else {
      s.className = 'tb-status';
      s.innerHTML = '<span class="dot"></span>Sin publicar todavía';
    }
  }

  /* ==================== AUTH ==================== */
  function authed() { return sessionStorage.getItem(AUTH_KEY) === '1'; }
  function setAuthed(v) {
    if (v) sessionStorage.setItem(AUTH_KEY, '1');
    else sessionStorage.removeItem(AUTH_KEY);
  }

  function showLogin() {
    const overlay = document.createElement('div');
    overlay.className = 'admin-login';
    overlay.innerHTML = `
      <form class="box" id="admin-login-form">
        <div class="brand">Elet · Admin</div>
        <h1>Acceso administrador</h1>
        <p>Para editar el contenido del sitio.</p>
        <input type="password" id="admin-pwd" placeholder="••••••••" autocomplete="current-password" autofocus required/>
        <div class="err" id="admin-err"></div>
        <button type="submit">Entrar</button>
      </form>
    `;
    document.body.appendChild(overlay);
    $('#admin-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#admin-err');
      err.textContent = '';
      const pwd = $('#admin-pwd').value;
      const hash = await sha256(pwd);
      if (hash === PASS_HASH) {
        setAuthed(true);
        overlay.remove();
        await boot();
      } else {
        err.textContent = 'Contraseña incorrecta.';
        $('#admin-pwd').select();
      }
    });
  }

  /* ==================== CONTENT LOAD / APPLY ==================== */
  async function loadContent() {
    // Always mirror the LIVE published content. We intentionally do NOT load a
    // stale localStorage draft as the base — the admin must reflect exactly
    // what the site currently shows. (A leftover draft once wiped the texts.)
    try {
      const r = await fetch('/content.json?v=' + Date.now(), { cache: 'no-store' });
      content = r.ok ? await r.json() : {};
    } catch (e) { content = {}; }
    localStorage.removeItem(STORAGE_KEY);
    // Ensure shape
    content.home = content.home || { hero: {}, ticker: { items: [] }, cards: [] };
    content.home.hero = content.home.hero || {};
    content.home.hero.title = content.home.hero.title || { prefix: '', accent: '', suffix: '' };
    content.home.ticker = content.home.ticker || { items: [] };
    content.home.ticker.items = content.home.ticker.items || [];
    content.home.cards = content.home.cards || [];
    content.footer = content.footer || { items: [], socials_label: '' };
    ['historia', 'programas', 'agenda', 'noticias', 'jesus'].forEach(k => {
      content[k] = content[k] || {};
      content[k].title = content[k].title || { prefix: '', accent: '', suffix: '' };
      content[k].notes = content[k].notes || [];
    });
  }

  // Re-apply draft content to DOM, replacing whatever the public loader put there.
  function applyDraft() {
    if (!content) return;
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const nl2br = s => esc(s).replace(/\n/g, '<br>');

    const home = $('#route-home');
    if (home && content.home) {
      const h = content.home.hero;
      const h1 = $('.hero-text h1', home);
      if (h1 && h.title) h1.innerHTML =
        esc(h.title.prefix || '') + (h.title.accent ? '<span class="accent">' + esc(h.title.accent) + '</span>' : '') + esc(h.title.suffix || '');
      const tag = $('.hero-tagline p', home);
      if (tag) tag.innerHTML = nl2br(h.tagline || '');
      const cta = $('.btn-listen .btn-text', home);
      if (cta) cta.textContent = h.cta || '';
      const live = $('.photo-caption .pc-text', home);
      if (live) live.textContent = h.live_label || '';
      const hint = $('.hero-right .hint', home);
      if (hint) hint.textContent = h.right_hint || '';
      const racc = $('.hero-right h2 .accent', home);
      if (racc) racc.textContent = h.right_accent || '';
      const rsub = $('.hero-right .sub', home);
      if (rsub) rsub.innerHTML = nl2br(h.right_sub || '');

      // Render hero slides from the draft
      if (Array.isArray(h.slides) && h.slides.length) {
        const slidesWrap = $('.hero-slides', home);
        const dotsWrap = $('.hero-dots', home);
        if (slidesWrap) slidesWrap.innerHTML = h.slides.map((s, i) =>
          '<img class="hero-slide' + (i === 0 ? ' active' : '') + '" src="' + esc(s.src) + '" alt="' + esc(s.alt || '') + '"/>'
        ).join('');
        if (dotsWrap) dotsWrap.innerHTML = h.slides.map((s, i) =>
          '<button class="' + (i === 0 ? 'active' : '') + '" aria-label="Foto ' + (i + 1) + '" data-slide="' + i + '"></button>'
        ).join('');
        if (typeof window.__initHeroSlides === 'function') window.__initHeroSlides();
      }

      const t = content.home.ticker;
      const tb = $('.ticker-badge', home);     if (tb) tb.textContent = t.badge || '';
      const ti = $('.ticker-intro', home);     if (ti) ti.textContent = t.intro || '';
      const tm = $('.ticker-more', home);      if (tm) tm.textContent = t.more || '';
      const tw = $('.ticker-items', home);
      if (tw && Array.isArray(t.items)) {
        const ren = (it, dup) =>
          '<span class="ticker-item"' + (dup ? ' aria-hidden="true"' : '') + '>' +
            '<span class="ti-time">' + esc(it.time || '') + '</span> ' + esc(it.text || '') +
          '</span>';
        tw.innerHTML = t.items.map(it => ren(it, false)).join('') + t.items.map(it => ren(it, true)).join('');
      }

      const cards = $$('.cards-section .card', home);
      (content.home.cards || []).forEach((c, i) => {
        const el = cards[i]; if (!el) return;
        const lbl = el.querySelector('.card-label');
        if (lbl) {
          const svg = lbl.querySelector('svg');
          lbl.innerHTML = ''; if (svg) lbl.appendChild(svg);
          lbl.appendChild(document.createTextNode(' ' + (c.label || '')));
        }
        const h3 = el.querySelector('h3');     if (h3) h3.textContent = c.title || '';
        const btn = el.querySelector('.card-btn'); if (btn) btn.textContent = c.button || '';
      });
    }

    const footer = $('.footer');
    if (footer && content.footer) {
      const items = $$('.footer-item', footer);
      (content.footer.items || []).forEach((it, i) => {
        const el = items[i]; if (!el) return;
        const t = el.querySelector('.ft-title'); if (t) t.textContent = it.title || '';
        const s = el.querySelector('.ft-sub');   if (s) s.textContent = it.sub   || '';
      });
      const lbl = footer.querySelector('.footer-socials .lbl');
      if (lbl) lbl.textContent = content.footer.socials_label || '';
    }

    ['historia', 'programas', 'agenda', 'noticias', 'jesus'].forEach(id => {
      const main = $('#route-' + id);
      if (!main || !content[id]) return;
      const d = content[id];
      const eyebrow = $('.page-eyebrow', main);
      if (eyebrow) eyebrow.textContent = d.eyebrow || '';
      const h1 = $('.page-hero h1', main);
      if (h1 && d.title) h1.innerHTML =
        esc(d.title.prefix || '') + (d.title.accent ? '<span class="accent">' + esc(d.title.accent) + '</span>' : '') + esc(d.title.suffix || '');
      const lead = $('.page-lead', main);
      if (lead) lead.textContent = d.lead || '';

      if (id !== 'programas' && Array.isArray(d.notes)) {
        const slot = $('.page-content', main);
        if (slot) {
          slot.innerHTML = d.notes.length
            ? d.notes.map(n =>
                '<article class="placeholder-card">' +
                  '<h2>' + esc(n.title || '') + '</h2>' +
                  '<p>' + nl2br(n.body || '') + '</p>' +
                '</article>'
              ).join('') + '<div style="text-align:center; margin-top:18px;"><a href="#" class="back-link" data-route-link="home">← Volver al inicio</a></div>'
            : '<div class="placeholder-card"><h2>Próximamente</h2><p>Estamos preparando esta sección.</p><a href="#" class="back-link" data-route-link="home">← Volver al inicio</a></div>';
        }
      }
    });
  }

  /* ==================== DECORATIONS ==================== */

  // Make a single element editable, bound to a JSON path.
  function edify(el, path, opts = {}) {
    if (!el) return;
    el.setAttribute('contenteditable', 'plaintext-only');
    el.setAttribute('spellcheck', 'true');
    el.dataset.edit = '1';
    el.dataset.editPath = path;
    if (opts.placeholder) el.dataset.placeholder = opts.placeholder;
    if (opts.accent) el.classList.add('edit-accent');
    refreshEmpty(el);
    el.addEventListener('input', () => {
      let val = el.textContent;
      if (!opts.multiline) val = val.replace(/\s+/g, ' ').replace(/^\s|\s$/g, m => m === ' ' ? '' : m);
      // Handle paste — strip line breaks for single-line
      if (!opts.multiline) val = val.replace(/[\r\n]+/g, ' ');
      setByPath(content, path, val);
      refreshEmpty(el);
      persist();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !opts.multiline) {
        e.preventDefault();
        el.blur();
      }
    });
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const txt = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
      document.execCommand('insertText', false, opts.multiline ? txt : txt.replace(/[\r\n]+/g, ' '));
    });
  }
  function refreshEmpty(el) {
    el.dataset.empty = (el.textContent.trim() === '') ? 'true' : 'false';
  }

  // Decorate a compound title h1 (prefix + accent span + suffix).
  function edifyCompoundTitle(h1, basePath) {
    if (!h1) return;
    const t = getByPath(content, basePath) || { prefix: '', accent: '', suffix: '' };
    h1.innerHTML =
      `<span data-part="prefix">${escHTML(t.prefix || '')}</span>` +
      `<span class="accent" data-part="accent">${escHTML(t.accent || '')}</span>` +
      `<span data-part="suffix">${escHTML(t.suffix || '')}</span>`;
    const prefix = $('[data-part="prefix"]', h1);
    const accent = $('[data-part="accent"]', h1);
    const suffix = $('[data-part="suffix"]', h1);
    edify(prefix, basePath + '.prefix', { placeholder: 'texto antes' });
    edify(accent, basePath + '.accent', { placeholder: 'palabra resaltada', accent: true });
    edify(suffix, basePath + '.suffix', { placeholder: 'texto después' });
  }
  function escHTML(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Decorate the home route once it's in the DOM.
  function decorateHome() {
    const home = $('#route-home'); if (!home) return;

    edifyCompoundTitle($('.hero-text h1', home), 'home.hero.title');
    edify($('.hero-tagline p', home), 'home.hero.tagline', { multiline: true, placeholder: 'Bajada del hero' });
    edify($('.btn-listen .btn-text', home), 'home.hero.cta', { placeholder: 'Texto del botón' });
    edify($('.photo-caption .pc-text', home), 'home.hero.live_label', { placeholder: 'EN EL AIRE — FM 99.3' });
    edify($('.hero-right .hint', home), 'home.hero.right_hint', { placeholder: 'antetítulo' });
    edify($('.hero-right h2 .accent', home), 'home.hero.right_accent', { placeholder: 'palabra verde', accent: true });
    edify($('.hero-right .sub', home), 'home.hero.right_sub', { multiline: true, placeholder: 'descripción' });

    edify($('.ticker-badge', home), 'home.ticker.badge', { placeholder: 'Ahora' });
    edify($('.ticker-intro', home), 'home.ticker.intro', { placeholder: 'Intro del ticker' });
    edify($('.ticker-more', home), 'home.ticker.more', { placeholder: 'Ver más →' });

    decorateTickerItems(home);
    decorateCards(home);
    setupSlideManager(home);
  }

  /* ---------- HERO SLIDE MANAGER (add / reorder / delete / duration) ---------- */
  function ensureSlides() {
    content.home = content.home || {};
    content.home.hero = content.home.hero || {};
    if (!Array.isArray(content.home.hero.slides)) content.home.hero.slides = [];
    if (typeof content.home.hero.slide_seconds !== 'number') content.home.hero.slide_seconds = 5;
    return content.home.hero;
  }

  function renderHeroSlides(home) {
    const hero = ensureSlides();
    const slidesWrap = $('.hero-slides', home);
    const dotsWrap = $('.hero-dots', home);
    if (slidesWrap) slidesWrap.innerHTML = hero.slides.map((s, i) =>
      '<img class="hero-slide' + (i === 0 ? ' active' : '') + '" src="' + escHTML(s.src) + '" alt="' + escHTML(s.alt || '') + '"/>'
    ).join('');
    if (dotsWrap) dotsWrap.innerHTML = hero.slides.map((s, i) =>
      '<button class="' + (i === 0 ? 'active' : '') + '" aria-label="Foto ' + (i + 1) + '" data-slide="' + i + '"></button>'
    ).join('');
    window.__heroSlideSeconds = hero.slide_seconds;
    if (typeof window.__initHeroSlides === 'function') window.__initHeroSlides();
  }

  function setupSlideManager(home) {
    const hero = ensureSlides();
    const photo = $('.hero-photo', home);
    if (!photo) return;

    // Build (or reuse) the manager panel right after the hero photo
    let panel = home.querySelector('.admin-slide-manager');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'admin-slide-manager';
      photo.insertAdjacentElement('afterend', panel);
    }

    panel.innerHTML = `
      <div class="asm-head">
        <span class="asm-title">Fotos del carrusel</span>
        <label class="asm-dur">Cada
          <input type="number" min="1" max="60" step="1" class="asm-seconds" value="${hero.slide_seconds}"/>
          seg.
        </label>
      </div>
      <div class="asm-thumbs"></div>
      <button type="button" class="admin-add asm-add">+ Agregar foto</button>
      <div class="asm-hint">Arrastrá para reordenar · ✕ para quitar · acordate de <strong>Publicar al sitio</strong></div>
      <input type="file" accept="image/*" class="asm-file" style="display:none"/>
    `;

    const thumbs = panel.querySelector('.asm-thumbs');
    hero.slides.forEach((s, i) => {
      const t = document.createElement('div');
      t.className = 'asm-thumb';
      t.dataset.idx = i;
      t.innerHTML = `
        <span class="asm-grip" title="Arrastrar">⋮⋮</span>
        <img src="${escHTML(s.src)}" alt=""/>
        <button type="button" class="asm-del" title="Quitar foto">✕</button>
      `;
      thumbs.appendChild(t);
    });

    // Reorder
    if (sortableLib) {
      new sortableLib(thumbs, {
        handle: '.asm-grip',
        animation: 160,
        ghostClass: 'sortable-ghost',
        onEnd: (evt) => {
          if (evt.oldIndex === evt.newIndex) return;
          const [m] = hero.slides.splice(evt.oldIndex, 1);
          hero.slides.splice(evt.newIndex, 0, m);
          persist();
          renderHeroSlides(home);
          setupSlideManager(home);
        }
      });
    }

    // Delete
    thumbs.querySelectorAll('.asm-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.closest('.asm-thumb').dataset.idx, 10);
        if (hero.slides.length <= 1) { toast('Tiene que quedar al menos una foto.', 'err'); return; }
        if (confirm('¿Quitar esta foto del carrusel?')) {
          hero.slides.splice(idx, 1);
          persist();
          renderHeroSlides(home);
          setupSlideManager(home);
        }
      });
    });

    // Duration
    const secInput = panel.querySelector('.asm-seconds');
    secInput.addEventListener('input', () => {
      let v = parseInt(secInput.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      if (v > 60) v = 60;
      hero.slide_seconds = v;
      persist();
      window.__heroSlideSeconds = v;
      if (typeof window.__initHeroSlides === 'function') window.__initHeroSlides();
    });

    // Add photo
    const fileInput = panel.querySelector('.asm-file');
    const addBtn = panel.querySelector('.asm-add');
    addBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) { toast('Eso no es una imagen.', 'err'); return; }

      toast('Procesando imagen…');
      let dataUrl;
      try { dataUrl = await resizeImage(file, 1920, 0.85); }
      catch (e) { dataUrl = await fileToDataURL(file); }
      const base64 = dataUrl.split(',')[1];
      const fname = 'foto-' + Date.now() + '.jpg';

      addBtn.disabled = true;
      addBtn.textContent = 'Subiendo…';
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passwordHash: PASS_HASH, filename: fname, dataBase64: base64, message: 'admin: agregar foto al carrusel' })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          hero.slides.push({ src: fname, alt: '' });
          persist();
          renderHeroSlides(home);
          setupSlideManager(home);
          toast('Foto agregada. Apretá "Publicar al sitio" para que quede fija.', 'ok');
        } else if (res.status === 503 && data.error === 'github_token_missing') {
          toast(data.message || 'Backend no configurado.', 'err');
        } else if (res.status === 401) {
          toast('La sesión expiró. Volvé a entrar.', 'err');
        } else {
          toast('No se pudo subir (' + (data.error || res.status) + ')', 'err');
        }
      } catch (err) {
        toast('Error de red: ' + err.message, 'err');
      } finally {
        addBtn.disabled = false;
        addBtn.textContent = '+ Agregar foto';
      }
    });
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // Resize/recompress client-side so uploads stay small & fast.
  function resizeImage(file, maxW, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#11250c';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(canvas.toDataURL('image/jpeg', quality)); }
        catch (e) { reject(e); }
        URL.revokeObjectURL(img.src);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  function decorateTickerItems(home) {
    const wrap = $('.ticker-items', home);
    if (!wrap) return;
    const items = content.home.ticker.items;

    wrap.classList.add('admin-list');
    wrap.innerHTML = '';
    items.forEach((it, idx) => {
      const row = document.createElement('span');
      row.className = 'ticker-item admin-row';
      row.dataset.idx = idx;
      row.innerHTML = `
        <span class="admin-grip" title="Arrastrar para reordenar">⋮⋮</span>
        <span class="admin-row-controls">
          <button class="admin-btn danger" data-act="del" title="Eliminar">×</button>
        </span>
        <span class="ti-time" data-edit-field="time" contenteditable="plaintext-only" data-edit="1" data-placeholder="00:00">${escHTML(it.time || '')}</span>
        <span data-edit-field="text" contenteditable="plaintext-only" data-edit="1" data-placeholder="texto de la noticia"> ${escHTML(it.text || '')}</span>
      `;
      wrap.appendChild(row);
    });

    // Add button (after the list, in its own anchor)
    let addWrap = wrap.parentElement.querySelector('.ticker-add-wrap');
    if (!addWrap) {
      addWrap = document.createElement('div');
      addWrap.className = 'admin-add-wrap ticker-add-wrap';
      addWrap.innerHTML = '<button class="admin-add" type="button">+ Agregar noticia</button>';
      wrap.parentElement.appendChild(addWrap);
    }
    addWrap.querySelector('.admin-add').onclick = () => {
      content.home.ticker.items.push({ time: '00:00', text: 'Nueva noticia' });
      persist();
      decorateTickerItems(home);
      // Focus the new item's text
      const last = wrap.lastElementChild;
      const t = last && last.querySelector('[data-edit-field="text"]');
      if (t) { t.focus(); selectAllText(t); }
    };

    wireListRows(wrap, items, () => decorateTickerItems(home), 'home.ticker.items');
    initSortable(wrap, items, () => { persist(); decorateTickerItems(home); });
  }

  function decorateCards(home) {
    const cardEls = $$('.cards-section .card', home);
    cardEls.forEach((el, i) => {
      const path = 'home.cards.' + i;
      const lbl = el.querySelector('.card-label');
      if (lbl) {
        // Wrap label text in editable span (preserve svg)
        const svg = lbl.querySelector('svg');
        const c = content.home.cards[i] || {};
        lbl.innerHTML = '';
        if (svg) lbl.appendChild(svg);
        const span = document.createElement('span');
        span.textContent = ' ' + (c.label || '');
        lbl.appendChild(span);
        edify(span, path + '.label', { placeholder: 'etiqueta' });
      }
      const h3 = el.querySelector('h3');
      edify(h3, path + '.title', { placeholder: 'Título de la tarjeta' });
      const btn = el.querySelector('.card-btn');
      edify(btn, path + '.button', { placeholder: 'Texto del botón' });
    });
  }

  // Decorate an inner route (historia/agenda/noticias/jesus/programas).
  function decorateInner(id) {
    const main = $('#route-' + id); if (!main) return;
    edify($('.page-eyebrow', main), id + '.eyebrow', { placeholder: 'Antetítulo' });
    edifyCompoundTitle($('.page-hero h1', main), id + '.title');
    edify($('.page-lead', main), id + '.lead', { multiline: true, placeholder: 'Bajada' });
    if (id !== 'programas') decorateNotes(id, main);
  }

  function decorateNotes(id, main) {
    const slot = $('.page-content', main);
    if (!slot) return;
    const notes = content[id].notes;

    slot.innerHTML = '';
    notes.forEach((n, idx) => {
      const card = document.createElement('article');
      card.className = 'placeholder-card admin-row';
      card.dataset.idx = idx;
      card.innerHTML = `
        <span class="admin-grip" title="Arrastrar para reordenar">⋮⋮</span>
        <span class="admin-row-controls">
          <button class="admin-btn danger" data-act="del" title="Eliminar nota">× Eliminar</button>
        </span>
        <h2 data-edit-field="title" contenteditable="plaintext-only" data-edit="1" data-placeholder="Título de la nota">${escHTML(n.title || '')}</h2>
        <p data-edit-field="body" contenteditable="plaintext-only" data-edit="1" data-placeholder="Contenido de la nota...">${escHTML(n.body || '').replace(/\n/g, '<br>')}</p>
      `;
      slot.appendChild(card);
    });

    // Add button
    const addWrap = document.createElement('div');
    addWrap.className = 'admin-add-wrap';
    addWrap.innerHTML = '<button class="admin-add" type="button">+ Agregar nota</button>';
    slot.appendChild(addWrap);
    addWrap.querySelector('.admin-add').onclick = () => {
      content[id].notes.push({ title: 'Nueva nota', body: 'Escribí acá el contenido...' });
      persist();
      decorateNotes(id, main);
      const last = slot.querySelector('article:last-of-type [data-edit-field="title"]');
      if (last) { last.focus(); selectAllText(last); }
    };

    // Back link
    const back = document.createElement('div');
    back.style.cssText = 'text-align:center; margin-top:18px;';
    back.innerHTML = '<a href="#" class="back-link" data-route-link="home">← Volver al inicio</a>';
    slot.appendChild(back);

    wireListRows(slot, notes, () => decorateNotes(id, main), id + '.notes');
    initSortable(slot, notes, () => { persist(); decorateNotes(id, main); }, '.placeholder-card');
  }

  // Wire common list row controls: delete buttons + per-field input handlers
  function wireListRows(container, arr, rerender, basePath) {
    $$('.admin-row', container).forEach(row => {
      const idx = parseInt(row.dataset.idx, 10);
      $$('[data-edit-field]', row).forEach(el => {
        const field = el.dataset.editField;
        el.addEventListener('input', () => {
          let val = el.innerText;
          if (field !== 'body' && field !== 'text') val = val.replace(/[\r\n]+/g, ' ');
          arr[idx][field] = val;
          refreshEmpty(el);
          persist();
        });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && field !== 'body' && field !== 'text') {
            e.preventDefault(); el.blur();
          }
        });
        refreshEmpty(el);
      });
      const del = row.querySelector('[data-act="del"]');
      if (del) {
        del.addEventListener('click', (e) => {
          e.preventDefault();
          if (confirm('¿Eliminar este elemento?')) {
            arr.splice(idx, 1);
            persist();
            rerender();
          }
        });
      }
    });
  }

  function initSortable(container, arr, onChange, itemSelector) {
    if (!sortableLib) return;
    new sortableLib(container, {
      handle: '.admin-grip',
      animation: 180,
      draggable: itemSelector || '.admin-row',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: (evt) => {
        if (evt.oldIndex === evt.newIndex) return;
        const [m] = arr.splice(evt.oldIndex, 1);
        arr.splice(evt.newIndex, 0, m);
        onChange();
      }
    });
  }

  function selectAllText(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function decorateFooter() {
    const footer = $('.footer'); if (!footer) return;
    const items = $$('.footer-item', footer);
    items.forEach((el, i) => {
      const path = 'footer.items.' + i;
      const t = el.querySelector('.ft-title');
      const s = el.querySelector('.ft-sub');
      edify(t, path + '.title', { placeholder: 'título' });
      edify(s, path + '.sub', { placeholder: 'subtítulo' });
    });
    const lbl = footer.querySelector('.footer-socials .lbl');
    edify(lbl, 'footer.socials_label', { placeholder: 'Seguinos' });
  }

  function decorateActiveRoute() {
    const hash = (location.hash || '').replace(/^#/, '');
    if (!hash || hash === 'home') {
      decorateHome();
    } else {
      decorateInner(hash);
    }
    decorateFooter();
  }

  /* ==================== TOOLBAR ==================== */
  function buildToolbar() {
    const tb = document.createElement('div');
    tb.className = 'admin-toolbar';
    tb.innerHTML = `
      <div class="tb-title">Elet · Admin</div>
      <div class="tb-status" id="tb-status"><span class="dot"></span>Cargando…</div>
      <button class="tb-publish" id="tb-publish">Publicar al sitio</button>
      <div class="tb-row">
        <a href="/" target="_blank" rel="noopener">Vista pública</a>
        <button id="tb-discard" title="Descartar borrador">Descartar</button>
      </div>
      <button id="tb-logout" title="Cerrar sesión" style="font-size:11px; color:#888; padding:6px;">Cerrar sesión</button>
    `;
    document.body.appendChild(tb);

    $('#tb-publish').addEventListener('click', publish);
    $('#tb-discard').addEventListener('click', async () => {
      if (!confirm('Esto descarta el borrador local y vuelve a lo último publicado. ¿Continuar?')) return;
      localStorage.removeItem(STORAGE_KEY);
      content = null;
      await loadContent();
      applyDraft();
      decorateActiveRoute();
      toast('Borrador descartado', 'ok');
    });
    $('#tb-logout').addEventListener('click', () => {
      setAuthed(false);
      location.reload();
    });
    updatePublishStatus();
  }

  async function publish() {
    // Safety net: never publish suspiciously-empty content (guards against
    // wiping the live site if the editor somehow loaded a blank state).
    const h = (content.home && content.home.hero) || {};
    const t = h.title || {};
    const heroEmpty = !(t.prefix || t.accent || t.suffix);
    const noCards = !(content.home && content.home.cards && content.home.cards.length);
    const noFooter = !(content.footer && content.footer.items && content.footer.items.length);
    if (heroEmpty && noCards && noFooter) {
      const ok = confirm('Atención: el contenido se ve casi vacío (sin título, sin tarjetas, sin pie). ¿Seguro que querés publicarlo así? Esto reemplaza lo que hay en el sitio.');
      if (!ok) return;
    }

    const btn = $('#tb-publish');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Publicando…';
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passwordHash: PASS_HASH, content })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const h = await sha256(JSON.stringify(content));
        localStorage.setItem(PUBLISHED_KEY, h);
        updatePublishStatus();
        toast('¡Publicado! En ~30 segundos aparece en el sitio.', 'ok');
      } else if (res.status === 503 && data.error === 'github_token_missing') {
        toast(data.message || 'Backend no configurado.', 'err');
      } else if (res.status === 401) {
        toast('La sesión expiró. Volvé a entrar.', 'err');
      } else {
        toast('No se pudo publicar (' + (data.error || res.status) + ')', 'err');
        console.error('publish failed', data);
      }
    } catch (err) {
      toast('Error de red: ' + err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  /* ==================== BOOT ==================== */
  function loadSortable() {
    return new Promise((resolve) => {
      if (window.Sortable) { sortableLib = window.Sortable; return resolve(); }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js';
      s.onload = () => { sortableLib = window.Sortable; resolve(); };
      s.onerror = () => resolve(); // continue without DnD if CDN fails
      document.head.appendChild(s);
    });
  }

  async function boot() {
    document.body.classList.add('admin-mode');
    await loadContent();
    await loadSortable();
    // Apply draft on top of whatever the public loader put there
    applyDraft();
    buildToolbar();
    decorateActiveRoute();
    // Re-decorate on hash navigation
    window.addEventListener('hashchange', () => {
      // Public loader doesn't re-apply on hashchange, but our decorations target
      // the visible route. Re-render that route's content (in case user navigated
      // away and back, original DOM may have been mutated).
      applyDraft();
      decorateActiveRoute();
    });
  }

  // Entry point: only run on /admin
  function shouldRun() {
    const p = location.pathname;
    return p === '/admin' || p === '/admin/' || location.search.includes('admin=1');
  }

  if (!shouldRun()) return;

  // Wait for the public DOM to be ready & for the public loader to have applied content.json
  function start() {
    if (authed()) {
      boot();
    } else {
      showLogin();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Give the public content loader a moment to fetch and apply content.json
      setTimeout(start, 400);
    });
  } else {
    setTimeout(start, 400);
  }
})();
