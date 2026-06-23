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
  let esperandoParaReproducir = false;

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
    // Ya no inyectamos el hack de React. Katamari bloquea eventos sintéticos no confiables.
    // Usaremos el "Deadlock Breaker" nativo en su lugar.
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

    // Escudo protector contra el AbortError de React
    videoEl.addEventListener('canplay', () => {
      if (esperandoParaReproducir) {
        console.log('[PartyHazz] Video buffereado. Disparando Play pendiente.');
        esperandoParaReproducir = false;
        setSyncLock();
        videoEl.play().catch(err => console.warn('[PartyHazz] Play falló en canplay:', err));
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

  let tiempoDestino = null;
  let timerDestino = null;

  function retrocesoSeguro(time) {
    if (!videoEl) return;
    
    const diff = videoEl.currentTime - time;
    if (diff <= 0) return;
    
    // Katamari usa su estado interno para retroceder. No nos deja engañarlo.
    // Así que calculamos cuántos saltos de 10s necesitamos para llegar (o pasarnos un poco).
    const clicks = Math.ceil(diff / 10);
    const jumpBtn = document.querySelector('[data-testid="jump-backward-button"]');
    
    if (jumpBtn) {
      for(let i = 0; i < clicks; i++) {
         jumpBtn.click();
      }
    } else {
      for(let i = 0; i < clicks; i++) {
         document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, bubbles: true }));
      }
    }
    
    // Una vez que Katamari procese la ráfaga de clics, habremos retrocedido seguro.
    // Estaremos en un tiempo <= time.
    // Como los saltos nativos hacia ADELANTE funcionan perfectamente sin congelar a Bitmovin,
    // usamos un pequeño retardo y ajustamos los segundos finos hacia adelante.
    setTimeout(() => {
       if (videoEl && videoEl.currentTime < time) {
          videoEl.currentTime = time;
       }
    }, 150);
  }

  function moverTiempo(time) {
    if (!videoEl) return;
    if (Math.abs(videoEl.currentTime - time) > 0.5) {
      tiempoDestino = time;
      if (timerDestino) clearTimeout(timerDestino);
      timerDestino = setTimeout(() => { tiempoDestino = null; }, 3000);

      if (time < videoEl.currentTime) {
        retrocesoSeguro(time);
      } else {
        videoEl.currentTime = time;
      }
    }
  }

  function aplicarPlay(time) {
    if (!videoEl) return;
    setSyncLock();
    moverTiempo(time);

    if (videoEl.readyState < 3) {
      esperandoParaReproducir = true;
      console.log('[PartyHazz] Esperando buffering antes de dar Play...');
    } else {
      esperandoParaReproducir = false;
      videoEl.play().catch(err => console.warn('[PartyHazz] Play falló:', err));
    }
  }

  function aplicarPausa(time) {
    if (!videoEl) return;
    setSyncLock();
    esperandoParaReproducir = false;
    moverTiempo(time);
    videoEl.pause();
  }

  function aplicarSeek(time) {
    if (!videoEl) return;
    setSyncLock();
    moverTiempo(time);
  }

  // --------------------------------------------------------------------------
  // Getters de estado
  // --------------------------------------------------------------------------

  function getTiempoActual() {
    if (!videoEl) return 0;
    
    // Si estamos en la ventana asíncrona de React, devolver el tiempo falso
    if (tiempoDestino !== null) {
      if (Math.abs(videoEl.currentTime - tiempoDestino) < 1) {
         // Ya llegamos a la meta, limpiar
         tiempoDestino = null;
         if (timerDestino) clearTimeout(timerDestino);
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
