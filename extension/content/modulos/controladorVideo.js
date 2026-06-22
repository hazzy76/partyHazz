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

  function aplicarPlay(time) {
    if (!videoEl) return;
    
    // Evitar loop infinito: esperamos al evento real de play para soltar el flag
    esAccionSync = true;
    const releaseFlag = () => { esAccionSync = false; };
    videoEl.addEventListener('play', releaseFlag, { once: true });

    // Solo mover el tiempo si hay un desfase real (>0.5s)
    if (Math.abs(videoEl.currentTime - time) > 0.5) {
      videoEl.currentTime = time;
    }

    videoEl.play().catch((err) => {
      console.warn('[PartyHazz] Error al aplicar play:', err);
      // Si falla (ej. por Autoplay), limpiamos el listener y el flag
      videoEl.removeEventListener('play', releaseFlag);
      esAccionSync = false;
    });
  }

  /**
   * Aplica pausa en el tiempo indicado.
   */
  function aplicarPausa(time) {
    if (!videoEl) return;
    
    esAccionSync = true;
    const releaseFlag = () => { esAccionSync = false; };
    videoEl.addEventListener('pause', releaseFlag, { once: true });

    if (Math.abs(videoEl.currentTime - time) > 0.5) {
      videoEl.currentTime = time;
    }

    videoEl.pause();
    
    // Fallback de seguridad por si el pause falla o ya estaba pausado
    setTimeout(() => { esAccionSync = false; }, 200);
  }

  /**
   * Aplica seek sin cambiar estado de reproduccion.
   */
  function aplicarSeek(time) {
    if (!videoEl) return;
    
    // Si ya estamos en ese tiempo, ignorar para no trabar el reproductor
    if (Math.abs(videoEl.currentTime - time) < 0.5) return;

    esAccionSync = true;
    const releaseFlag = () => { esAccionSync = false; };
    videoEl.addEventListener('seeked', releaseFlag, { once: true });
    
    videoEl.currentTime = time;
    
    // Fallback de seguridad
    setTimeout(() => { esAccionSync = false; }, 1000);
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
