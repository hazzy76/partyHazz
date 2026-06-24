/**
 * controladorVideo.js — Modulo: control del <video> sin disparar loops de sync.
 *
 * Gestiona el elemento <video>, intercepta eventos nativos del usuario y expone
 * una API para aplicar comandos remotos suprimiendo el eco de eventos.
 * Expone: window.PartyHazz.controladorVideo
 */

window.PartyHazz = window.PartyHazz || {};

window.PartyHazz.controladorVideo = (() => {
  let videoEl = null;
  let esAccionSync = false;       // true = ignorar el proximo evento del video
  let timerSyncLock = null;
  let callbackEvento = null;      // funcion a llamar cuando el usuario interactua
  let esperandoParaReproducir = false;
  let tiempoDestino = null;

  // --------------------------------------------------------------------------
  // Inicializacion
  // --------------------------------------------------------------------------

  /**
   * Conecta el controlador a un elemento <video>.
   * @param {HTMLVideoElement} video
   * @param {Function} onEventoUsuario - Recibe { type, time } cuando el usuario
   *                                     interactua con el player directamente.
   */
  function iniciar(video, onEventoUsuario) {
    videoEl = video;
    callbackEvento = onEventoUsuario;
    registrarEventos();

  }

  function detener() {
    videoEl = null;
    callbackEvento = null;
  }

  // --------------------------------------------------------------------------
  // Registro de eventos del usuario en el player
  // --------------------------------------------------------------------------

  function registrarEventos() {
    // Play manual del usuario
    videoEl.addEventListener('play', () => {
      if (esAccionSync) return;
      callbackEvento && callbackEvento({ type: 'PLAY', time: videoEl.currentTime });
    });

    // Pausa manual del usuario
    videoEl.addEventListener('pause', () => {
      if (esAccionSync) return;
      callbackEvento && callbackEvento({ type: 'PAUSA', time: videoEl.currentTime });
    });

    // Seek manual del usuario (seeked = cuando termino de moverse, no durante)
    videoEl.addEventListener('seeked', () => {
      // Ignorar eventos generados programmaticamente
      if (tiempoDestino !== null && Math.abs(videoEl.currentTime - tiempoDestino) < 2) {
        return;
      }
      if (esAccionSync) return;
      callbackEvento && callbackEvento({ type: 'IR_A', time: videoEl.currentTime });
    });

    // Forzar pausa si ocurre un salto manual durante la reproduccion
    videoEl.addEventListener('seeking', () => {
      if (esAccionSync) return;
      if (!videoEl.paused) {
        console.info('[PartyHazz] Intervencion de usuario detectada. Auto-pausa aplicada.');
        videoEl.pause();
      }
    });

    // Reintentar reproduccion si el video estaba buffereando
    videoEl.addEventListener('canplay', () => {
      if (esperandoParaReproducir) {

        esperandoParaReproducir = false;
        setSyncLock();
        videoEl.play().catch(err => console.warn('[PartyHazz] Play falló en canplay:', err));
        releaseSyncLock(1000);
      }
    });
  }

  // --------------------------------------------------------------------------
  // Gestion de bloqueos de sincronizacion
  // --------------------------------------------------------------------------

  function setSyncLock() {
    esAccionSync = true;
    if (timerSyncLock) clearTimeout(timerSyncLock);
  }

  function releaseSyncLock(delay = 1000) {
    if (timerSyncLock) clearTimeout(timerSyncLock);
    timerSyncLock = setTimeout(() => { esAccionSync = false; }, delay);
  }

  // --------------------------------------------------------------------------
  // Aplicar comandos externos (sin generar eventos de sync)
  // --------------------------------------------------------------------------

  let tokenSalto = 0;

  async function saltoSeguro(time) {
    if (!videoEl) return;

    tokenSalto++;
    const miToken = tokenSalto;

    const haciaAdelante = time > videoEl.currentTime;

    // Determinar posicion de pre-carga (10s del destino)
    let preTime = haciaAdelante ? (time - 10) : (time + 10);

    if (haciaAdelante && preTime < 0) {
      preTime = time + 10;
    } else if (!haciaAdelante && videoEl.duration && preTime > videoEl.duration) {
      preTime = time - 10;
    }

    videoEl.style.transition = 'opacity 0.1s';
    videoEl.style.opacity = '0';

    // 1. Simular avance para inicializar la carga
    videoEl.currentTime = preTime;
    videoEl.dispatchEvent(new Event('timeupdate'));

    // 2. Esperar carga del preTime
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (videoEl.readyState >= 3) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);

      setTimeout(() => { clearInterval(checkInterval); resolve(); }, 4000);
    });

    // Abortar si existe un salto mas reciente
    if (miToken !== tokenSalto) {

      return;
    }

    // 3. Simular clic de navegacion en la interfaz nativa
    if (preTime < time) {
      const btnFwd = document.querySelector('[data-testid="jump-forward-button"]');
      if (btnFwd) btnFwd.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true }));
    } else {
      const btnBck = document.querySelector('[data-testid="jump-backward-button"]');
      if (btnBck) btnBck.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, bubbles: true }));
    }

    // 4. Esperar carga del destino final
    await new Promise(resolve => {
      const checkFinal = setInterval(() => {
        if (videoEl.readyState >= 3 && Math.abs(videoEl.currentTime - time) < 1.5) {
          clearInterval(checkFinal);
          resolve();
        }
      }, 50);

      setTimeout(() => { clearInterval(checkFinal); resolve(); }, 4000);
    });

    if (miToken === tokenSalto && videoEl) {
      videoEl.style.opacity = '1';
    }
  }

  async function moverTiempo(time) {
    if (!videoEl) return;

    // Ignorar saltos redundantes
    if (tiempoDestino !== null && Math.abs(tiempoDestino - time) < 0.5) {
      return;
    }

    if (Math.abs(videoEl.currentTime - time) > 0.5) {
      tiempoDestino = time;

      await saltoSeguro(time);

      // Limpiar estado de destino
      setTimeout(() => {
        if (tiempoDestino === time) {
          tiempoDestino = null;
        }
      }, 500);
    }
  }

  async function aplicarPlay(time) {
    if (!videoEl) return;
    videoEl.playbackRate = 1.0;
    setSyncLock();
    await moverTiempo(time);

    if (videoEl.readyState < 3) {
      esperandoParaReproducir = true;
      releaseSyncLock(1000);
    } else {
      esperandoParaReproducir = false;
      videoEl.play().catch(err => console.warn('[PartyHazz] Play falló:', err));
      releaseSyncLock(1000);
    }
  }

  async function aplicarPausa(time) {
    if (!videoEl) return;
    videoEl.playbackRate = 1.0;
    setSyncLock();
    esperandoParaReproducir = false;
    await moverTiempo(time);
    videoEl.pause();
    releaseSyncLock(1000);
  }

  async function aplicarSeek(time) {
    if (!videoEl) return;
    setSyncLock();
    await moverTiempo(time);
    releaseSyncLock(1000);
  }

  // --------------------------------------------------------------------------
  // Getters de estado
  // --------------------------------------------------------------------------

  function getTiempoActual() {
    if (!videoEl) return 0;

    // Devolver tiempo proyectado durante saltos asincronos
    if (tiempoDestino !== null) {
      if (Math.abs(videoEl.currentTime - tiempoDestino) < 1) {
        return videoEl.currentTime;
      } else {
        return tiempoDestino;
      }
    }

    return videoEl.currentTime;
  }

  function estaReproduciendo() {
    return videoEl ? !videoEl.paused && !videoEl.ended : false;
  }

  function estaBuffereando() {
    // readyState < 3 (HAVE_FUTURE_DATA) significa que no tiene datos suficientes para reproducir
    return videoEl ? videoEl.readyState < 3 : false;
  }

  function setPlaybackRate(rate) {
    if (videoEl && videoEl.playbackRate !== rate) {
      videoEl.playbackRate = rate;
    }
  }

  return {
    iniciar,
    detener,
    aplicarPlay,
    aplicarPausa,
    aplicarSeek,
    getTiempoActual,
    estaReproduciendo,
    estaBuffereando,
    setPlaybackRate
  };
})();
