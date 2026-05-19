(function () {
  const audio = document.getElementById('audioEl');
  if (!audio) return;
  const source = audio.querySelector('source');
  const streamUrl = source ? source.src : audio.src;
  const buttons = document.querySelectorAll('[data-play-toggle]');
  let isPlaying = false;

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
