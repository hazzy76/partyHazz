/**
 * overlayUI.js — Modulo: overlay flotante sobre el player de Crunchyroll.
 *
 * Muestra el estado de la sala directamente sobre el video:
 *  - ID de sala y numero de participantes
 *  - Indicador de sync (ok / ajustando / error)
 *  - Boton de salir de la sala
 *
 * Expone: window.PartyHazz.overlayUI
 */

window.PartyHazz = window.PartyHazz || {};

window.PartyHazz.overlayUI = (() => {
  const ID_OVERLAY = 'partyhazz-overlay';
  const ID_BADGE_SALA = 'partyhazz-badge-sala';
  const ID_BADGE_SYNC = 'partyhazz-badge-sync';
  const ID_BTN_SALIR = 'partyhazz-btn-salir';
  const ID_BADGE_PARTICS = 'partyhazz-badge-partics';

  let timerOcultarSync = null;

  // --------------------------------------------------------------------------
  // Construccion del overlay
  // --------------------------------------------------------------------------

  function crearOverlay() {
    if (document.getElementById(ID_OVERLAY)) return;

    const overlay = document.createElement('div');
    overlay.id = ID_OVERLAY;
    overlay.innerHTML = `
      <div class="ph-panel">
        <div class="ph-izq">
          <span class="ph-logo">🎉</span>
          <span id="${ID_BADGE_SALA}" class="ph-sala">Sala: ---</span>
          <span id="${ID_BADGE_PARTICS}" class="ph-partics">👤 1</span>
        </div>
        <div class="ph-der">
          <span id="${ID_BADGE_SYNC}" class="ph-sync ph-sync--ok">✓ Sync</span>
          <button id="${ID_BTN_SALIR}" class="ph-btn-salir">Salir</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById(ID_BTN_SALIR).addEventListener('click', () => {
      chrome.runtime.sendMessage({ tipo: 'DEJAR_SALA' });
      ocultar();
    });
  }

  // --------------------------------------------------------------------------
  // API publica
  // --------------------------------------------------------------------------

  /**
   * Muestra el overlay con el estado de la sala.
   * @param {{ idSala, isHost, participantes }} estadoSala
   */
  function mostrarSala(estadoSala) {
    crearOverlay();

    const elSala = document.getElementById(ID_BADGE_SALA);
    const elPartics = document.getElementById(ID_BADGE_PARTICS);
    const el = document.getElementById(ID_OVERLAY);

    if (elSala) elSala.textContent = `Sala: ${estadoSala.idSala}${estadoSala.isHost ? ' 👑' : ''}`;
    if (elPartics) elPartics.textContent = `👤 ${estadoSala.participantes || 1}`;
    if (el) el.classList.add('ph-visible');
  }

  function actualizarParticipantes(cantidad) {
    const el = document.getElementById(ID_BADGE_PARTICS);
    if (el) el.textContent = `👤 ${cantidad}`;
  }

  function mostrarSyncOk() {
    setBadgeSync('✓ Sync', 'ph-sync--ok');
  }

  function mostrarAjustando() {
    setBadgeSync('⚡ Ajustando...', 'ph-sync--ajustando');
    // Volver a OK luego de 2s
    if (timerOcultarSync) clearTimeout(timerOcultarSync);
    timerOcultarSync = setTimeout(mostrarSyncOk, 2000);
  }

  function mostrarError(msg) {
    setBadgeSync('⚠ ' + (msg || 'Error'), 'ph-sync--error');
  }

  function ocultar() {
    const el = document.getElementById(ID_OVERLAY);
    if (el) {
      el.classList.remove('ph-visible');
      // Remover del DOM luego de la transicion
      setTimeout(() => el.remove(), 400);
    }
  }

  function setBadgeSync(texto, clase) {
    const el = document.getElementById(ID_BADGE_SYNC);
    if (!el) return;
    el.textContent = texto;
    el.className = `ph-sync ${clase}`;
  }

  return {
    mostrarSala,
    actualizarParticipantes,
    mostrarSyncOk,
    mostrarAjustando,
    mostrarError,
    ocultar
  };
})();
