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
  let timerDebounceSeek = null;   // Evita envios multiples al arrastrar la barra
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
      // Bloqueo definitivo de bucles: si el reproductor acaba de llegar al tiempo
      // que el servidor le ordenó (tiempoDestino), ignoramos este evento.
      if (tiempoDestino !== null && Math.abs(videoEl.currentTime - tiempoDestino) < 2) {
        return;
      }
      if (esAccionSync) return;

      // DEBOUNCE (Filtro Anti-Eco): 
      // Si el Host arrastra la barra, puede disparar múltiples 'seeked' en milisegundos.
      // Esperamos 200ms sin nuevos saltos para confirmar el destino final y mandar 1 solo mensaje.
      if (timerDebounceSeek) clearTimeout(timerDebounceSeek);
      timerDebounceSeek = setTimeout(() => {
        callbackEvento && callbackEvento({ type: 'IR_A', time: videoEl.currentTime });
      }, 200);
    });

    // Auto-Pausa al saltar: Si el usuario salta mientras el video está reproduciendo,
    // forzamos una pausa. Esto enviará un evento PAUSA al otro cliente, asegurando
    // que ambos se queden pausados en el nuevo punto hasta que el Host esté listo
    // y vuelva a darle Play manualmente. (Igual que Netflix Party).
    videoEl.addEventListener('seeking', () => {
      if (esAccionSync) return;
      if (!videoEl.paused) {
        console.log('[PartyHazz] Salto detectado durante reproducción. Forzando Auto-Pausa.');
        videoEl.pause();
      }
    });

    // Escudo protector contra el AbortError de React
    videoEl.addEventListener('canplay', () => {
      if (esperandoParaReproducir) {
        console.log('[PartyHazz] Video buffereado. Disparando Play pendiente.');
        esperandoParaReproducir = false;
        setSyncLock();
        videoEl.play().catch(err => console.warn('[PartyHazz] Play falló en canplay:', err));
        releaseSyncLock(1000);
      }
    });
  }

  // --------------------------------------------------------------------------
  // Bloqueo de bucles infinitos
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

  async function saltoSeguro(time) {
    if (!videoEl) return;

    const haciaAdelante = time > videoEl.currentTime;

    // Calculamos un "Pre Tiempo" a 10 segundos de distancia de nuestro destino.
    let preTime = haciaAdelante ? (time - 10) : (time + 10);

    if (haciaAdelante && preTime < 0) {
      preTime = time + 10;
    } else if (!haciaAdelante && videoEl.duration && preTime > videoEl.duration) {
      preTime = time - 10;
    }

    videoEl.style.transition = 'opacity 0.1s';
    videoEl.style.opacity = '0';

    // 1. Engañamos a Bitmovin poniéndolo a 10s del destino
    videoEl.currentTime = preTime;
    videoEl.dispatchEvent(new Event('timeupdate'));

    // 2. ESPERAMOS a que el video termine de cargar el preTime.
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (videoEl.readyState >= 3) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
      
      setTimeout(() => { clearInterval(checkInterval); resolve(); }, 4000);
    });

    // 3. Ya no está buffereando. React procesará el clic sin problemas.
    if (preTime < time) {
      const btnFwd = document.querySelector('[data-testid="jump-forward-button"]');
      if (btnFwd) btnFwd.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true }));
    } else {
      const btnBck = document.querySelector('[data-testid="jump-backward-button"]');
      if (btnBck) btnBck.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, bubbles: true }));
    }

    // 4. Esperamos a que Katamari cargue el destino final antes de devolver la visión
    await new Promise(resolve => {
      const checkFinal = setInterval(() => {
        if (videoEl.readyState >= 3 && Math.abs(videoEl.currentTime - time) < 1.5) {
          clearInterval(checkFinal);
          resolve();
        }
      }, 50);
      
      setTimeout(() => { clearInterval(checkFinal); resolve(); }, 4000);
    });

    if (videoEl) videoEl.style.opacity = '1';
  }

  async function moverTiempo(time) {
    if (!videoEl) return;
    if (Math.abs(videoEl.currentTime - time) > 0.5) {
      tiempoDestino = time;
      esAccionSync = true;

      await saltoSeguro(time);

      // Una vez terminado el salto, damos 500ms de gracia para atrapar 
      // y descartar el evento 'seeked' nativo de Bitmovin.
      setTimeout(() => { 
        tiempoDestino = null; 
        esAccionSync = false;
      }, 500);
    }
  }

  async function aplicarPlay(time) {
    if (!videoEl) return;
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

    // Si estamos en la ventana asíncrona de React, devolver el tiempo falso
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
