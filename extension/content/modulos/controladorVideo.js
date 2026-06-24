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
      // Bloqueo definitivo de bucles: si el reproductor acaba de llegar al tiempo
      // que el servidor le ordenó (tiempoDestino), ignoramos este evento.
      if (tiempoDestino !== null && Math.abs(videoEl.currentTime - tiempoDestino) < 2) {
        return;
      }
      if (esAccionSync) return;
      callbackEvento && callbackEvento({ type: 'IR_A', time: videoEl.currentTime });
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
      }
    });
  }

  // --------------------------------------------------------------------------
  // Bloqueo de bucles infinitos
  // --------------------------------------------------------------------------

  function setSyncLock() {
    esAccionSync = true;
    if (timerSyncLock) clearTimeout(timerSyncLock);
    // Aumentamos a 3000ms.
    // La nueva lógica saltoSeguro() tarda unos 450ms en terminar sus setTimeout.
    // Sumando el tiempo que tarda Bitmovin en descargar el video, el evento nativo
    // 'seeked' puede dispararse 1 o 2 segundos después. Si el candado se libera antes,
    // la extensión cree que fue un salto manual y retransmite el evento al otro cliente,
    // causando el famoso bucle infinito. 3 segundos es un margen perfecto.
    timerSyncLock = setTimeout(() => { esAccionSync = false; }, 3000);
  }

  // --------------------------------------------------------------------------
  // Aplicar comandos externos (sin generar eventos de sync)
  // --------------------------------------------------------------------------

  let tiempoDestino = null;
  let timerDestino = null;

  // Estrategia final para domar a Katamari/Bitmovin sin crashear su estado de React
  function saltoSeguro(time) {
    if (!videoEl) return;

    const haciaAdelante = time > videoEl.currentTime;

    // Calculamos un "Fake Time" a 10 segundos de distancia de nuestro destino.
    // Usaremos los botones oficiales de 10s para recorrer ese último tramo
    // y obligar a Bitmovin a descargar el video oficialmente.
    let fakeTime = haciaAdelante ? (time - 10) : (time + 10);

    // Si vamos hacia adelante a un tiempo muy bajito (ej. seg 5), el fakeTime sería negativo.
    // En ese caso, mejor lo mandamos 10s adelante y usamos el botón de retroceso.
    if (haciaAdelante && fakeTime < 0) {
      fakeTime = time + 10;
    }

    // 1. Engañamos a Bitmovin poniéndolo a 10s del destino (se congelará)
    videoEl.currentTime = fakeTime;

    // 2. MAGIA: Le disparamos un evento nativo para obligar al React interno de 
    // Katamari a actualizar su reloj y creer que de verdad estamos en fakeTime.
    videoEl.dispatchEvent(new Event('timeupdate'));

    // 3. Le damos tiempo a React de procesar el evento (solo 20ms para que sea imperceptible) y luego...
    setTimeout(() => {
      if (!videoEl) return;
      // ...pulsamos el botón oficial para romper el hielo. Un solo clic perfecto.
      if (videoEl.currentTime < time) {
        const btnFwd = document.querySelector('[data-testid="jump-forward-button"]');
        if (btnFwd) btnFwd.click();
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true }));
      } else {
        const btnBck = document.querySelector('[data-testid="jump-backward-button"]');
        if (btnBck) btnBck.click();
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, bubbles: true }));
      }

      // Un micro-ajuste ultra fino final hacia ADELANTE 
      // (Reducido a 50ms para que el usuario no vea los brincos)
      setTimeout(() => {
        if (videoEl && videoEl.currentTime < time && Math.abs(videoEl.currentTime - time) > 1) {
          videoEl.currentTime = time;
        }
      }, 50);

    }, 20);
  }

  function moverTiempo(time) {
    if (!videoEl) return;
    if (Math.abs(videoEl.currentTime - time) > 0.5) {
      tiempoDestino = time;
      if (timerDestino) clearTimeout(timerDestino);
      timerDestino = setTimeout(() => { tiempoDestino = null; }, 3000);

      saltoSeguro(time);
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
