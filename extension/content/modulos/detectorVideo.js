/**
 * detectorVideo.js — Modulo: deteccion del elemento <video> de Crunchyroll.
 *
 * Crunchyroll es una SPA: el player se carga dinamicamente y puede cambiar
 * al navegar entre episodios. Usamos MutationObserver para detectar cuando
 * el <video> aparece o cambia.
 *
 * Expone: window.PartyHazz.detectorVideo
 */

window.PartyHazz = window.PartyHazz || {};

window.PartyHazz.detectorVideo = (() => {
  let videoActual = null;
  let observerDOM = null;
  let callbackVideoEncontrado = null;
  let callbackVideoLost = null;

  // --------------------------------------------------------------------------
  // Busqueda del video
  // --------------------------------------------------------------------------

  function buscarVideo() {
    const video = document.querySelector('video');

    if (video && video !== videoActual) {

      videoActual = video;
      if (callbackVideoEncontrado) callbackVideoEncontrado(video);
    } else if (!video && videoActual) {

      videoActual = null;
      if (callbackVideoLost) callbackVideoLost();
    }
  }

  // --------------------------------------------------------------------------
  // API publica
  // --------------------------------------------------------------------------

  /**
   * Inicia la deteccion del video.
   * @param {Function} onEncontrado - Se llama cuando se detecta un <video>
   * @param {Function} onPerdido    - Se llama cuando el <video> desaparece
   */
  function iniciar(onEncontrado, onPerdido) {
    callbackVideoEncontrado = onEncontrado;
    callbackVideoLost = onPerdido;

    // Buscar inmediatamente por si ya esta en el DOM
    buscarVideo();

    // Observar cambios en el DOM (Crunchyroll carga el player async)
    observerDOM = new MutationObserver(() => buscarVideo());
    observerDOM.observe(document.body, { childList: true, subtree: true });

    // Interceptar navegacion SPA con pushState
    const pushStateOriginal = history.pushState.bind(history);
    history.pushState = function (...args) {
      pushStateOriginal(...args);
      // Dar tiempo al nuevo player para montarse
      setTimeout(buscarVideo, 1500);
    };

    window.addEventListener('popstate', () => setTimeout(buscarVideo, 1500));
  }

  function detener() {
    if (observerDOM) {
      observerDOM.disconnect();
      observerDOM = null;
    }
    videoActual = null;
  }

  function getVideo() {
    return videoActual;
  }

  return { iniciar, detener, getVideo };
})();
