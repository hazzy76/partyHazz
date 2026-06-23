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
  let esperandoParaReproducir = false; // true si estamos esperando a que termine de bufferear

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
    inyectarScriptReact();
    console.log('[PartyHazz] ControladorVideo iniciado');
  }

  function detener() {
    videoEl = null;
    callbackEvento = null;
  }

  // --------------------------------------------------------------------------
  // Hack de React Fiber (Ejecutado en el contexto de la página principal)
  // --------------------------------------------------------------------------
  
  function inyectarScriptReact() {
    const mainScript = `
      document.addEventListener('PartyHazz_DoSeek', (e) => {
        const time = e.detail;
        const slider = document.querySelector('.timeline-slider');
        let reactTriggereado = false;
        
        if (slider) {
          // Buscamos la propiedad interna de React 16+ en el elemento DOM
          const propsKey = Object.keys(slider).find(key => key.startsWith('__reactProps$'));
          if (propsKey) {
            const props = slider[propsKey];
            if (props) {
              // Simulamos el evento exacto que React espera de su slider
              const fakeEvent = {
                target: { value: time },
                currentTarget: { value: time },
                preventDefault: () => {},
                stopPropagation: () => {}
              };
              
              if (props.onChange) { props.onChange(fakeEvent); reactTriggereado = true; }
              else if (props.onInput) { props.onInput(fakeEvent); reactTriggereado = true; }
            }
          }
        }
        
        // Si no pudimos hackear a React, caemos al método nativo (que sabemos que se congela hacia atrás)
        if (!reactTriggereado) {
          const v = document.querySelector('video');
          if (v) v.currentTime = time;
        }
      });
    `;
    const scriptEl = document.createElement('script');
    scriptEl.textContent = mainScript;
    (document.head || document.documentElement).appendChild(scriptEl);
    scriptEl.remove();
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

    // Cuando termine de descargar un pedazo y esté listo para reproducir
    videoEl.addEventListener('canplay', () => {
      if (esperandoParaReproducir) {
        esperandoParaReproducir = false;
        setSyncLock();
        videoEl.play().catch(err => {
          console.warn('[PartyHazz] Error al reproducir tras canplay:', err);
        });
      }
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

    // Solución al AbortError: "The play() request was interrupted by a call to pause()"
    // Si el video no tiene datos en este instante, y nosotros llamamos a play(), 
    // Crunchyroll detectará la falta de datos y llamará a pause() para mostrar su spinner.
    // Esto cancela nuestra promesa de play() y deja el reproductor pausado para siempre.
    if (videoEl.readyState < 3) {
      esperandoParaReproducir = true;
      console.log('[PartyHazz] Esperando a que el video termine de bufferear para darle play...');
    } else {
      esperandoParaReproducir = false;
      videoEl.play().catch((err) => {
        console.warn('[PartyHazz] Error al aplicar play:', err.message || err);
      });
    }
  }

  /**
   * Aplica pausa en el tiempo indicado.
   */
  function aplicarPausa(time) {
    if (!videoEl) return;

    setSyncLock();
    esperandoParaReproducir = false; // Cancelamos cualquier play() pendiente

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
    
    // Le enviamos la orden al script inyectado en el contexto de la página principal
    // para que invoque directamente la función interna de React (Katamari UI).
    document.dispatchEvent(new CustomEvent('PartyHazz_DoSeek', { detail: time }));
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
