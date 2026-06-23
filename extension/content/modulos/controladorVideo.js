/**
 * controladorVideo.js — Modulo: control del <video> sin disparar loops de sync.
 *
 * El problema clasico de sync: cuando aplicamos play/pause/seek por un comando
 * externo, el evento del video volveria a dispararse y enviariamos otro mensaje
 * al servidor, creando un loop infinito.
 *
 * Solucion: flag `esAccionSync` que bloquea el reenvio durante acciones
 * aplicadas por nosotros.
 *
 * Expone: window.PartyHazz.controladorVideo
 */

window.PartyHazz = window.PartyHazz || {};

window.PartyHazz.controladorVideo = (() => {
  let videoEl = null;
  let esAccionSync = false;       // true = ignorar el proximo evento del video
  let timerSyncLock = null;
  let callbackEvento = null;      // funcion a llamar cuando el usuario interactua

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
    console.log('[PartyHazz] ControladorVideo iniciado');
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
      if (esAccionSync) return;
      callbackEvento && callbackEvento({ type: 'IR_A', time: videoEl.currentTime });
    });
  }

  // --------------------------------------------------------------------------
  // Bloqueo de bucles infinitos
  // --------------------------------------------------------------------------

  function setSyncLock() {
    esAccionSync = true;
    if (timerSyncLock) clearTimeout(timerSyncLock);
    // Liberamos el candado después de 500ms. Es más seguro que depender de 
    // eventos del DOM que a veces no se disparan si el video ya estaba en ese estado.
    timerSyncLock = setTimeout(() => { esAccionSync = false; }, 500);
  }

  // --------------------------------------------------------------------------
  // Aplicar comandos externos (sin generar eventos de sync)
  // --------------------------------------------------------------------------

  function aplicarPlay(time) {
    if (!videoEl) return;

    setSyncLock();

    if (Math.abs(videoEl.currentTime - time) > 0.5) {
      videoEl.currentTime = time;
    }

    videoEl.play().catch((err) => {
      console.warn('[PartyHazz] Error al aplicar play:', err.message || err);
    });
  }

  /**
   * Aplica pausa en el tiempo indicado.
   */
  function aplicarPausa(time) {
    if (!videoEl) return;

    setSyncLock();

    if (Math.abs(videoEl.currentTime - time) > 0.5) {
      videoEl.currentTime = time;
    }

    videoEl.pause();
  }

  /**
   * Aplica seek sin cambiar estado de reproduccion.
   */
  function aplicarSeek(time) {
    if (!videoEl) return;

    if (Math.abs(videoEl.currentTime - time) < 0.5) return;

    setSyncLock();

    // Intentar simular un clic físico en la barra de progreso (Katamari UI)
    const slider = document.querySelector('.timeline-slider');

    if (slider && videoEl.duration) {
      const rect = slider.getBoundingClientRect();
      const porcentaje = time / videoEl.duration;
      const clicX = rect.left + (rect.width * porcentaje);
      const clicY = rect.top + (rect.height / 2);

      const evtPointer = new PointerEvent('pointerdown', {
        view: window, bubbles: true, cancelable: true,
        clientX: clicX, clientY: clicY
      });
      const evtClick = new MouseEvent('click', {
        view: window, bubbles: true, cancelable: true,
        clientX: clicX, clientY: clicY
      });

      slider.dispatchEvent(evtPointer);
      slider.dispatchEvent(evtClick);

      // Verificamos en 200ms si React hizo caso. Si le valió madres, usamos la forma nativa.
      setTimeout(() => {
        if (Math.abs(videoEl.currentTime - time) > 1) {
          videoEl.currentTime = time;
        }
      }, 200);
    } else {
      videoEl.currentTime = time;
    }
  }

  // --------------------------------------------------------------------------
  // Getters de estado
  // --------------------------------------------------------------------------

  function getTiempoActual() {
    return videoEl ? videoEl.currentTime : 0;
  }

  function estaReproduciendo() {
    return videoEl ? !videoEl.paused && !videoEl.ended : false;
  }

  function estaBuffereando() {
    // readyState < 3 (HAVE_FUTURE_DATA) significa que no tiene datos suficientes para reproducir
    return videoEl ? videoEl.readyState < 3 : false;
  }

  return {
    iniciar,
    detener,
    aplicarPlay,
    aplicarPausa,
    aplicarSeek,
    getTiempoActual,
    estaReproduciendo,
    estaBuffereando
  };
})();
