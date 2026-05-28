/* Inline visual editor for Radio Elet — loads only at /admin
   Direct click-to-edit on the live page, with drag-and-drop reordering. */

(function () {
  'use strict';

  const PASS_HASH = '5312483a9608c7f943cde4dfd7b99ce2f89f39f5da5a5178faf880b2fea02dfe';
  const STORAGE_KEY = 'elet_admin_content_draft';
  const BASE_KEY = 'elet_admin_draft_base';
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
    // Baseline = the LIVE published content.
    let live = {};
    try {
      const r = await fetch('/content.json?v=' + Date.now(), { cache: 'no-store' });
      live = r.ok ? await r.json() : {};
    } catch (e) { live = {}; }

    // A draft is only valid if it was based on the CURRENT live version. We store
    // the hash of the live content the draft started from; if live has changed
    // since (a publish happened), the draft is stale and we discard it. This kills
    // the "old version flashes over the new one" bug from leftover localStorage.
    const liveHash = await sha256(JSON.stringify(live));
    const draftStr = localStorage.getItem(STORAGE_KEY);
    const draftBase = localStorage.getItem(BASE_KEY);
    let usedDraft = false;
    if (draftStr && draftBase === liveHash) {
      try {
        const draft = JSON.parse(draftStr);
        if (draft && typeof draft === 'object' && draft.home) { content = draft; usedDraft = true; }
        else content = live;
      } catch (e) { content = live; }
    } else {
      content = live;
    }
    if (!usedDraft) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(BASE_KEY, liveHash);
    }

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
      // Scrub any leftover Word/Docs junk from note bodies (draft or live).
      content[k].notes.forEach(n => {
        if (hasWordJunk(n.body)) n.body = deWordify(n.body);
      });
    });
  }

  // Session cache of just-uploaded images (filename -> dataURL) so previews show
  // instantly, before the file finishes deploying to the live site.
  const sessionImages = {};
  function resolveSrc(src) { return sessionImages[src] || src; }

  // Surgically remove Word/Docs junk (Mso classes, mso-* / font / text-align /
  // margin inline styles, <o:p> tags, lang attrs) while keeping clean content.
  function deWordify(html) {
    if (!html || html.indexOf('<') < 0) return html;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('o\\:p, xml, style, script, meta, link, title').forEach(n => n.remove());
    tmp.querySelectorAll('*').forEach(el => {
      if (el.className && /\bMso/i.test(el.className)) el.removeAttribute('class');
      el.removeAttribute('lang');
      const st = el.getAttribute('style');
      if (st) {
        const kept = st.split(';').map(s => s.trim()).filter(s => {
          if (!s) return false;
          const prop = s.split(':')[0].trim().toLowerCase();
          return !(prop.startsWith('mso-') || prop === 'font-family' || prop === 'font-size' ||
                   prop === 'line-height' || prop === 'margin' || prop === 'text-align' ||
                   prop === 'color');
        }).join('; ');
        if (kept) el.setAttribute('style', kept); else el.removeAttribute('style');
      }
    });
    // Drop empty blocks and collapse runs of <br> (Word leaves lots of these)
    tmp.querySelectorAll('p, div, span, h1, h2, h3, h4').forEach(el => {
      if (!el.textContent.trim() && !el.querySelector('img')) el.remove();
    });
    tmp.querySelectorAll('br + br').forEach(br => br.remove());
    return tmp.innerHTML;
  }
  function hasWordJunk(html) {
    return typeof html === 'string' && /Mso|mso-|<o:p|<xml/i.test(html);
  }

  // Clean pasted HTML into a minimal, safe subset — flattens Word/Docs nesting
  // so a normal Ctrl+V "just works" (no need to paste-as-plain-text).
  function cleanPastedHTML(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('style, script, meta, link, title, xml, o\\:p, head').forEach(n => n.remove());
    // Remove HTML comments
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_COMMENT, null);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach(c => c.remove());
    // Keep only meaningful tags; unwrap the rest (span, font, Word divs…)
    const ALLOWED = new Set(['B','STRONG','I','EM','U','A','BR','P','UL','OL','LI','H1','H2','H3','H4','IMG','BLOCKQUOTE']);
    let changed = true;
    while (changed) {
      changed = false;
      tmp.querySelectorAll('*').forEach(el => {
        if (!ALLOWED.has(el.tagName)) {
          const parent = el.parentNode;
          if (el.tagName === 'DIV' && el.textContent.trim() && el.nextSibling) {
            el.appendChild(document.createElement('br'));
          }
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
          changed = true;
        }
      });
    }
    // Strip attributes from every element (keep href on links, src/alt on imgs)
    tmp.querySelectorAll('*').forEach(el => {
      const tag = el.tagName.toLowerCase();
      [...el.attributes].forEach(a => {
        const keep =
          (tag === 'a' && a.name === 'href') ||
          (tag === 'img' && (a.name === 'src' || a.name === 'alt'));
        if (!keep) el.removeAttribute(a.name);
      });
    });
    tmp.querySelectorAll('p, h1, h2, h3, h4, li').forEach(el => {
      if (!el.textContent.trim() && !el.querySelector('img')) el.remove();
    });
    tmp.querySelectorAll('br + br').forEach(br => br.remove());
    return tmp.innerHTML.replace(/ /g, ' ');
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
          window.__heroSlideHTML(resolveSrc(s.src), s.alt || '', i === 0)
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
          const noteBodyHTML = (b) => {
            const s = b == null ? '' : String(b);
            return /<[a-z][\s\S]*>/i.test(s) ? s : esc(s).replace(/\n/g, '<br>');
          };
          slot.innerHTML = d.notes.length
            ? d.notes.map(n =>
                '<article class="placeholder-card">' +
                  '<h2>' + esc(n.title || '') + '</h2>' +
                  '<div class="note-body">' + noteBodyHTML(n.body) + '</div>' +
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
      window.__heroSlideHTML(resolveSrc(s.src), s.alt || '', i === 0)
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
      <button type="button" class="admin-add asm-add">+ Agregar fotos</button>
      <div class="asm-hint">Podés elegir varias a la vez · arrastrá para reordenar · ✕ para quitar · acordate de <strong>Publicar al sitio</strong></div>
      <input type="file" accept="image/*" multiple class="asm-file" style="display:none"/>
    `;

    const thumbs = panel.querySelector('.asm-thumbs');
    hero.slides.forEach((s, i) => {
      const t = document.createElement('div');
      t.className = 'asm-thumb';
      t.dataset.idx = i;
      t.innerHTML = `
        <span class="asm-grip" title="Arrastrar">⋮⋮</span>
        <img src="${escHTML(resolveSrc(s.src))}" alt=""/>
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

    // Add photo(s) — supports selecting multiple at once
    const fileInput = panel.querySelector('.asm-file');
    const addBtn = panel.querySelector('.asm-add');
    addBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      const images = files.filter(f => f.type.startsWith('image/'));
      if (!images.length) { toast('No seleccionaste imágenes.', 'err'); return; }

      addBtn.disabled = true;
      let added = 0, failed = 0, tokenMissing = false, authExpired = false;

      for (let n = 0; n < images.length; n++) {
        const file = images[n];
        addBtn.textContent = 'Subiendo ' + (n + 1) + '/' + images.length + '…';

        let dataUrl;
        try { dataUrl = await resizeImage(file, 1920, 0.85); }
        catch (e) { dataUrl = await fileToDataURL(file); }
        const base64 = dataUrl.split(',')[1];
        const fname = 'foto-' + Date.now() + '-' + n + '.jpg';

        try {
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passwordHash: PASS_HASH, filename: fname, dataBase64: base64, message: 'admin: agregar foto al carrusel' })
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.ok) {
            sessionImages[fname] = dataUrl;
            hero.slides.push({ src: fname, alt: '' });
            added++;
          } else if (res.status === 503 && data.error === 'github_token_missing') {
            tokenMissing = true; failed++; break;
          } else if (res.status === 401) {
            authExpired = true; failed++; break;
          } else {
            failed++;
          }
        } catch (err) {
          failed++;
        }
      }

      // Persist + refresh ONCE after processing all selected files
      if (added) { persist(); renderHeroSlides(home); }
      setupSlideManager(home);

      if (tokenMissing) {
        toast('Backend no configurado (GITHUB_TOKEN).', 'err');
      } else if (authExpired) {
        toast('La sesión expiró. Volvé a entrar.', 'err');
      } else if (added) {
        toast(added + (added === 1 ? ' foto agregada' : ' fotos agregadas') + (failed ? ' · ' + failed + ' fallaron' : '') + '. Apretá "Publicar al sitio".', failed ? 'err' : 'ok');
      } else if (failed) {
        toast('No se pudieron subir las fotos.', 'err');
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

  // Convert a stored note body to HTML for editing/display.
  // New bodies are already HTML; old plain-text bodies get newlines -> <br>.
  function bodyToHTML(body) {
    const b = body == null ? '' : String(body);
    const looksHTML = /<[a-z][\s\S]*>/i.test(b);
    return looksHTML ? b : escHTML(b).replace(/\n/g, '<br>');
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
        <div class="rt-toolbar" contenteditable="false">
          <button type="button" data-cmd="bold" title="Negrita"><b>N</b></button>
          <button type="button" data-cmd="italic" title="Cursiva"><i>K</i></button>
          <button type="button" data-cmd="underline" title="Subrayado"><u>S</u></button>
          <span class="rt-sep"></span>
          <button type="button" data-cmd="alignLeft" title="Alinear a la izquierda"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h13"/></svg></button>
          <button type="button" data-cmd="alignCenter" title="Centrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M5 18h14"/></svg></button>
          <button type="button" data-cmd="alignRight" title="Alinear a la derecha"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M10 12h10M7 18h13"/></svg></button>
          <span class="rt-sep"></span>
          <select class="rt-font" title="Tipo de letra">
            <option value="">Fuente…</option>
            <option value="Lato, sans-serif">Lato (normal)</option>
            <option value="Oswald, sans-serif">Oswald (títulos)</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="'Times New Roman', serif">Times</option>
            <option value="Arial, sans-serif">Arial</option>
            <option value="'Courier New', monospace">Mono</option>
          </select>
          <select class="rt-size" title="Tamaño del texto">
            <option value="">Tamaño…</option>
            <option value="1">Muy chico</option>
            <option value="2">Chico</option>
            <option value="3">Normal</option>
            <option value="5">Grande</option>
            <option value="6">Más grande</option>
            <option value="7">Enorme</option>
          </select>
          <span class="rt-sep"></span>
          <button type="button" data-cmd="title" title="Subtítulo">Subtítulo</button>
          <button type="button" data-cmd="bullets" title="Lista con viñetas">• Lista</button>
          <button type="button" data-cmd="image" title="Insertar imagen">🖼️ Imagen</button>
        </div>
        <div class="rt-body" data-edit-field="body" data-rich="1" contenteditable="true" data-placeholder="Escribí el contenido… (usá la barra para negrita, tamaños, imágenes)">${bodyToHTML(n.body)}</div>
      `;
      slot.appendChild(card);

      wireRichToolbar(card, notes, idx, id, main);
    });

    // Add button
    const addWrap = document.createElement('div');
    addWrap.className = 'admin-add-wrap';
    addWrap.innerHTML = '<button class="admin-add" type="button">+ Agregar nota</button>';
    slot.appendChild(addWrap);
    addWrap.querySelector('.admin-add').onclick = () => {
      content[id].notes.push({ title: 'Nueva nota', body: 'Escribí acá el contenido…' });
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

  // Rich-text toolbar wiring for a single note card.
  function wireRichToolbar(card, notes, idx, id, main) {
    const body = card.querySelector('.rt-body');
    const toolbar = card.querySelector('.rt-toolbar');
    if (!body || !toolbar) return;

    const refreshRich = () => {
      const hasContent = body.textContent.trim() !== '' || body.querySelector('img');
      body.dataset.empty = hasContent ? 'false' : 'true';
    };
    refreshRich();
    const save = () => { notes[idx].body = body.innerHTML; refreshRich(); persist(); };

    // Keep focus in the body when clicking toolbar buttons.
    toolbar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', async () => {
        const cmd = btn.dataset.cmd;
        restoreSel();
        body.focus();
        try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
        try {
          if (cmd === 'bold') document.execCommand('bold');
          else if (cmd === 'italic') document.execCommand('italic');
          else if (cmd === 'underline') document.execCommand('underline');
          else if (cmd === 'alignLeft') document.execCommand('justifyLeft');
          else if (cmd === 'alignCenter') document.execCommand('justifyCenter');
          else if (cmd === 'alignRight') document.execCommand('justifyRight');
          else if (cmd === 'title') document.execCommand('formatBlock', false, 'h3');
          else if (cmd === 'big') document.execCommand('fontSize', false, '5');
          else if (cmd === 'normal') { document.execCommand('formatBlock', false, 'p'); document.execCommand('fontSize', false, '3'); }
          else if (cmd === 'bullets') document.execCommand('insertUnorderedList');
          else if (cmd === 'image') { await insertImageIntoBody(body); }
        } catch (e) { /* ignore */ }
        save();
      });
    });

    // Font family + size dropdowns (need selection save/restore because focusing
    // the <select> would otherwise drop the caret/selection in the body).
    const fontSel = toolbar.querySelector('.rt-font');
    const sizeSel = toolbar.querySelector('.rt-size');
    if (fontSel) fontSel.addEventListener('change', () => {
      restoreSel(); body.focus();
      try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
      if (fontSel.value) document.execCommand('fontName', false, fontSel.value);
      fontSel.selectedIndex = 0;
      save();
    });
    if (sizeSel) sizeSel.addEventListener('change', () => {
      restoreSel(); body.focus();
      if (sizeSel.value) document.execCommand('fontSize', false, sizeSel.value);
      sizeSel.selectedIndex = 0;
      save();
    });

    // Track the last selection inside this body so dropdowns can restore it.
    let savedRange = null;
    function saveSel() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && body.contains(sel.anchorNode)) {
        savedRange = sel.getRangeAt(0).cloneRange();
      }
    }
    function restoreSel() {
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
    }
    ['keyup', 'mouseup'].forEach(ev => body.addEventListener(ev, saveSel));

    // Clean pasted content (especially from Word / Google Docs) so it doesn't
    // bring inline centering, serif fonts, MsoNormal classes, <o:p> tags, etc.
    body.addEventListener('paste', (e) => {
      e.preventDefault();
      const cd = e.clipboardData || window.clipboardData;
      const html = cd.getData('text/html');
      const text = cd.getData('text/plain');
      body.focus();
      if (html) {
        document.execCommand('insertHTML', false, cleanPastedHTML(html));
      } else {
        document.execCommand('insertText', false, text);
      }
      save();
    });

    body.addEventListener('input', save);
    body.addEventListener('blur', save);
  }

  // Pick an image, resize to base64, and insert it inline at the cursor.
  async function insertImageIntoBody(body) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file || !file.type.startsWith('image/')) { resolve(); return; }
        toast('Procesando imagen…');
        let dataUrl;
        try { dataUrl = await resizeImage(file, 1000, 0.8); }
        catch (e) { dataUrl = await fileToDataURL(file); }
        body.focus();
        const html = '<img src="' + dataUrl + '" style="max-width:100%;height:auto;border-radius:10px;display:block;margin:12px auto;"/>';
        document.execCommand('insertHTML', false, html);
        toast('Imagen insertada', 'ok');
        resolve();
      };
      input.click();
    });
  }

  // Wire common list row controls: delete buttons + per-field input handlers
  function wireListRows(container, arr, rerender, basePath) {
    $$('.admin-row', container).forEach(row => {
      const idx = parseInt(row.dataset.idx, 10);
      $$('[data-edit-field]', row).forEach(el => {
        const field = el.dataset.editField;
        if (el.dataset.rich) return; // rich body handled by wireRichToolbar
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
        localStorage.removeItem(STORAGE_KEY);  // draft == live now
        localStorage.setItem(BASE_KEY, h);     // new baseline = what we just published
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
