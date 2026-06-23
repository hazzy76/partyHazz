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

    // 1. Buscamos la barra de progreso de React (Katamari UI)
    const slider = document.querySelector('.timeline-slider');

    if (slider) {
      // Tenemos que usar el setter nativo del navegador para engañar al tracker de React.
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeInputValueSetter.call(slider, time);

      // Disparamos los eventos que React está escuchando
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Fallback por si la interfaz cambia en el futuro
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
