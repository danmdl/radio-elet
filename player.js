(function () {
  const audio = document.getElementById('audioEl');
  if (!audio) return;
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

  function toggle() {
    if (!isPlaying) {
      audio.play().then(() => setPlaying(true)).catch(err => {
        console.error('Error al reproducir:', err);
        alert('No se pudo conectar al stream. Intentá de nuevo.');
      });
    } else {
      audio.pause();
      audio.src = audio.src;
      setPlaying(false);
    }
  }

  buttons.forEach(btn => btn.addEventListener('click', toggle));
  audio.addEventListener('ended', () => setPlaying(false));
  audio.addEventListener('error', () => setPlaying(false));
})();
