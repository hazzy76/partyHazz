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
  // Aplicar comandos externos (sin generar eventos de sync)
  // --------------------------------------------------------------------------

  /**
   * Aplica play en el tiempo indicado con compensacion de latencia ya incluida.
   */
  function aplicarPlay(time) {
    if (!videoEl) return;
    esAccionSync = true;
    videoEl.currentTime = time;
    videoEl.play()
      .catch((err) => console.warn('[PartyHazz] Error al aplicar play:', err))
      .finally(() => { esAccionSync = false; });
  }

  /**
   * Aplica pausa en el tiempo indicado.
   */
  function aplicarPausa(time) {
    if (!videoEl) return;
    esAccionSync = true;
    videoEl.currentTime = time;
    videoEl.pause();
    // pause() es sincrono, reseteamos inmediatamente
    esAccionSync = false;
  }

  /**
   * Aplica seek sin cambiar estado de reproduccion.
   */
  function aplicarSeek(time) {
    if (!videoEl) return;
    esAccionSync = true;
    videoEl.currentTime = time;
    // 'seeked' dispara cuando termina; reseteamos ahi
    videoEl.addEventListener('seeked', () => { esAccionSync = false; }, { once: true });
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

  return {
    iniciar,
    detener,
    aplicarPlay,
    aplicarPausa,
    aplicarSeek,
    getTiempoActual,
    estaReproduciendo
  };
})();
