(function () {
  const audio = document.getElementById('audioEl');
  if (!audio) return;
  const source = audio.querySelector('source');
  const streamUrl = source ? source.src : audio.src;
  const buttons = document.querySelectorAll('[data-play-toggle]');
  let isPlaying = false;
  let previousVolume = 0.8;

  audio.volume = previousVolume;

  /* ---------- Volume control injection ---------- */
  const ICON_HIGH = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
  const ICON_LOW = '<path d="M7 9v6h4l5 5V4l-5 5H7zm9.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>';
  const ICON_MUTE = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';

  const playPill = document.querySelector('.play-pill');
  let volumeBtn, volumeIcon, volumeSlider;

  if (playPill && playPill.parentElement) {
    const wrap = document.createElement('div');
    wrap.className = 'volume-control';
    wrap.innerHTML = `
      <button class="volume-btn" type="button" aria-label="Volumen">
        <svg viewBox="0 0 24 24" fill="currentColor">${ICON_HIGH}</svg>
      </button>
      <input type="range" class="volume-slider" min="0" max="100" value="80" aria-label="Nivel de volumen"/>
    `;
    playPill.insertAdjacentElement('afterend', wrap);
    volumeBtn = wrap.querySelector('.volume-btn');
    volumeIcon = wrap.querySelector('svg');
    volumeSlider = wrap.querySelector('.volume-slider');
  }

  function updateVolumeIcon() {
    if (!volumeIcon) return;
    const v = audio.volume;
    if (v === 0) {
      volumeIcon.innerHTML = ICON_MUTE;
      volumeBtn.classList.add('muted');
    } else if (v < 0.5) {
      volumeIcon.innerHTML = ICON_LOW;
      volumeBtn.classList.remove('muted');
    } else {
      volumeIcon.innerHTML = ICON_HIGH;
      volumeBtn.classList.remove('muted');
    }
  }

  function updateSliderFill() {
    if (!volumeSlider) return;
    const pct = volumeSlider.value;
    volumeSlider.style.backgroundSize = pct + '% 100%';
  }

  if (volumeSlider) {
    volumeSlider.value = audio.volume * 100;
    updateSliderFill();
    volumeSlider.addEventListener('input', () => {
      audio.volume = volumeSlider.value / 100;
      if (audio.volume > 0) previousVolume = audio.volume;
      updateVolumeIcon();
      updateSliderFill();
    });
  }

  if (volumeBtn) {
    volumeBtn.addEventListener('click', () => {
      if (audio.volume > 0) {
        previousVolume = audio.volume;
        audio.volume = 0;
      } else {
        audio.volume = previousVolume || 0.8;
      }
      if (volumeSlider) volumeSlider.value = audio.volume * 100;
      updateVolumeIcon();
      updateSliderFill();
    });
  }

  updateVolumeIcon();

  /* ---------- Play/pause ---------- */
  function setPlaying(playing) {
    isPlaying = playing;
    buttons.forEach(btn => {
      btn.classList.toggle('playing', playing);
      const titleEl = btn.querySelector('.pill-title, .btn-text');
      if (!titleEl) return;
      if (playing) {
        titleEl.dataset.original = titleEl.dataset.original || titleEl.textContent;
        titleEl.textContent = btn.classList.contains('play-pill') ? 'Reproduciendo' : 'Pausar';
      } else if (titleEl.dataset.original) {
        titleEl.textContent = titleEl.dataset.original;
      }
    });
  }

  function play() {
    if (!audio.src || audio.src === '' || audio.src === window.location.href) {
      audio.src = streamUrl;
    }
    audio.play().then(() => setPlaying(true)).catch(err => {
      console.error('Error al reproducir:', err);
      alert('No se pudo conectar al stream. Intentá de nuevo.');
    });
  }

  function pause() {
    audio.pause();
    setPlaying(false);
  }

  function toggle() {
    if (isPlaying) pause();
    else play();
  }

  buttons.forEach(btn => btn.addEventListener('click', toggle));
  audio.addEventListener('ended', () => setPlaying(false));
  audio.addEventListener('error', () => setPlaying(false));
})();
