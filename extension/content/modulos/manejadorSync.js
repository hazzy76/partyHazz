/**
 * manejadorSync.js — Modulo: logica de sincronizacion y compensacion de lag.
 *
 * Responsabilidades:
 *  - Aplicar comandos del servidor con compensacion de latencia de red
 *  - SYNC_CHECK periodico: detectar y corregir drift acumulado silenciosamente
 *  - Gestionar el WebSocket con el servidor
 *
 * Compensacion de latencia:
 *   El emisor incluye `sendTimestamp` (Date.now() en ms).
 *   Al recibir, calculamos el lag y ajustamos el tiempo del video:
 *   tiempoAjustado = time + (Date.now() - sendTimestamp) / 1000
 *
 * Expone: window.PartyHazz.manejadorSync
 */

window.PartyHazz = window.PartyHazz || {};

window.PartyHazz.manejadorSync = (() => {
  // --------------------------------------------------------------------------
  // Constantes
  // --------------------------------------------------------------------------
  const TOLERANCIA_SYNC_SEG = 0.5;   // Diferencia minima para corregir drift
  const INTERVALO_SYNC_MS = 5000;  // Cada cuantos ms enviamos SYNC_CHECK

  // --------------------------------------------------------------------------
  // Estado interno
  // --------------------------------------------------------------------------
  let socket = null;
  let estadoSala = null;   // { idSala, idParticipante, isHost }
  let urlServidor = 'ws://localhost:8080/ws';
  let timerSync = null;
  let callbackEstado = null;   // Notifica cambios de estado al orchestrator

  // --------------------------------------------------------------------------
  // WebSocket: conexion y mensajes
  // --------------------------------------------------------------------------

  /**
   * Conecta al servidor WebSocket.
   * @param {string} url - URL del servidor (configurable por el usuario)
   * @param {Function} onEstadoCambio - Callback cuando el estado de sala cambia
   */
  function conectar(url, onEstadoCambio) {
    urlServidor = url;
    callbackEstado = onEstadoCambio;

    if (socket && socket.readyState === WebSocket.OPEN) {
      console.log('[PartyHazz] WS ya conectado');
      return;
    }

    console.log('[PartyHazz] Conectando a', url);
    socket = new WebSocket(url);

    socket.onopen = () => {
      console.log('[PartyHazz] WS conectado');
      notificarSW({ tipo: 'WS_CONECTADO' });
    };

    socket.onmessage = (evento) => {
      try {
        const msg = JSON.parse(evento.data);
        manejarMensajeServidor(msg);
      } catch (e) {
        console.error('[PartyHazz] JSON invalido del servidor:', e);
      }
    };

    socket.onclose = (ev) => {
      console.log('[PartyHazz] WS cerrado, code:', ev.code);
      socket = null;
      detenerSyncCheck();
      notificarSW({ tipo: 'WS_DESCONECTADO' });
    };

    socket.onerror = (err) => {
      console.error('[PartyHazz] WS error:', err);
    };
  }

  function desconectar() {
    detenerSyncCheck();
    if (socket) {
      socket.close(1000, 'DEJAR_SALA voluntario');
      socket = null;
    }
    estadoSala = null;
    chrome.runtime.sendMessage({ tipo: 'LIMPIAR_ESTADO' }).catch(() => {});
  }

  /**
   * Envia un mensaje JSON al servidor.
   */
  function enviar(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn('[PartyHazz] WS no conectado, mensaje descartado:', payload);
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  // --------------------------------------------------------------------------
  // Manejo de mensajes del servidor
  // --------------------------------------------------------------------------

  function manejarMensajeServidor(msg) {
    const ctrl = window.PartyHazz.controladorVideo;
    const ui = window.PartyHazz.overlayUI;

    switch (msg.type) {

      // -- Sala creada (yo soy el host) --
      case 'CREAR_SALA':
        estadoSala = {
          idSala: msg.idSala,
          idParticipante: msg.idParticipante,
          isHost: true,
          participantes: 1
        };
        guardarEstadoSesion();
        ui.mostrarSala(estadoSala);
        notificarSW({ tipo: 'SALA_CREADA', ...estadoSala });
        iniciarSyncCheck();
        break;

      // -- Me uni a una sala --
      case 'SALA_UNIDA':
        estadoSala = {
          idSala: msg.idSala,
          idParticipante: msg.idParticipante,
          isHost: msg.isHost,
          participantes: msg.participantes
        };
        guardarEstadoSesion();
        ui.mostrarSala(estadoSala);
        notificarSW({ tipo: 'SALA_UNIDA', ...estadoSala });
        iniciarSyncCheck();

        // Solicitar estado actual al host (si no soy host y no es reconexion)
        if (!msg.isHost && !msg.reconectado) {
          enviar({ type: 'STATE_REQUEST' });
        }
        break;

      // -- Otro usuario entro --
      case 'USUARIO_UNIDO':
        if (estadoSala) estadoSala.participantes = msg.participantes;
        ui.actualizarParticipantes(msg.participantes);
        notificarSW({ tipo: 'USUARIO_UNIDO', participantes: msg.participantes });
        break;

      // -- Otro usuario salio --
      case 'USUARIO_SALIO':
        if (estadoSala) {
          estadoSala.participantes = msg.participantes;
          if (msg.nuevoHost) estadoSala.isHost = true;
        }
        ui.actualizarParticipantes(msg.participantes);
        notificarSW({ tipo: 'USUARIO_SALIO', ...msg });
        break;

      // -- Comando PLAY del otro participante --
      case 'PLAY': {
        const compensacion = calcularCompensacion(msg.sendTimestamp);
        ctrl.aplicarPlay(msg.time + compensacion);
        ui.mostrarSyncOk();
        break;
      }

      // -- Comando PAUSA --
      case 'PAUSA':
        ctrl.aplicarPausa(msg.time);
        ui.mostrarSyncOk();
        break;

      // -- Comando IR_A (seek) --
      case 'IR_A': {
        const compensacion = calcularCompensacion(msg.sendTimestamp);
        ctrl.aplicarSeek(msg.time + compensacion);
        break;
      }

      // -- SYNC_CHECK: verificar si estamos sincronizados --
      case 'SYNC_CHECK': {
        const compensacion = calcularCompensacion(msg.sendTimestamp);
        const tiempoEsperado = msg.time + compensacion;
        const tiempoLocal = ctrl.getTiempoActual();
        const diferencia = Math.abs(tiempoLocal - tiempoEsperado);

        if (diferencia > TOLERANCIA_SYNC_SEG) {
          // EVITAR EL BUCLE DE BUFFERING ABORTADO
          if (ctrl.estaBuffereando && ctrl.estaBuffereando()) {
            console.log(`[PartyHazz] Ignorando SYNC_CHECK porque estamos buffereando...`);
            return;
          }

          // SOFT SYNC (Velocity Sync): 
          // Si la diferencia es pequeña (ej. menos de 4s) y estamos reproduciendo, 
          // aceleramos/frenamos el video ligeramente sin interrumpir la reproducción.
          // Esto evita los molestos saltos (y tiempos de buffering extra) por pequeños lags.
          if (diferencia < 4.0 && ctrl.estaReproduciendo()) {
            const nuevoRate = (tiempoLocal < tiempoEsperado) ? 1.25 : 0.75;
            ctrl.setPlaybackRate(nuevoRate);
            console.log(`[PartyHazz] Soft Sync: Ajustando velocidad a ${nuevoRate}x para corregir ${diferencia.toFixed(2)}s`);
            return;
          }

          // HARD SYNC:
          // Si el lag es mayor a 4s, o si el video está pausado, aplicamos un salto rudo.
          console.log(`[PartyHazz] Hard Sync: Drift detectado de ${diferencia.toFixed(2)}s. Forzando salto...`);
          ui.mostrarAjustando();
          ctrl.aplicarSeek(tiempoEsperado);
        } else {
          // Si la diferencia es menor a la tolerancia, estamos sincronizados. 
          // Restauramos la velocidad a 1.0x (por si veníamos de un Soft Sync).
          if (ctrl.setPlaybackRate) {
             ctrl.setPlaybackRate(1.0);
          }
        }
        break;
      }

      // -- El servidor me pide que como host responda el estado --
      case 'STATE_REQUEST':
        enviar({
          type: 'STATE_RESPONSE',
          toParticipantId: msg.from,
          time: ctrl.getTiempoActual(),
          playing: ctrl.estaReproduciendo()
        });
        break;

      // -- Recibi el estado del host (soy el que se acaba de unir) --
      case 'STATE_RESPONSE':
        if (msg.playing) {
          ctrl.aplicarPlay(msg.time + calcularCompensacion(msg.sendTimestamp));
        } else {
          ctrl.aplicarPausa(msg.time);
        }
        ui.mostrarSyncOk();
        break;

      case 'ERROR':
        console.error('[PartyHazz] Error del servidor:', msg.message);
        ui.mostrarError(msg.message);
        notificarSW({ tipo: 'ERROR', mensaje: msg.message });
        // Limpiar estado huerfano para evitar reconexiones a salas muertas
        chrome.runtime.sendMessage({ tipo: 'LIMPIAR_ESTADO' }).catch(() => {});
        break;

      default:
        console.warn('[PartyHazz] Mensaje tipo desconocido:', msg.type);
    }
  }

  // --------------------------------------------------------------------------
  // Enviar eventos del usuario al servidor
  // --------------------------------------------------------------------------

  /**
   * Envia un evento de sincronizacion al servidor (PLAY, PAUSA, IR_A).
   * Incluye sendTimestamp para que el receptor pueda compensar la latencia.
   */
  function enviarEventoSync(payload) {
    enviar({ ...payload, sendTimestamp: Date.now() });
  }

  // --------------------------------------------------------------------------
  // SYNC_CHECK periodico
  // --------------------------------------------------------------------------

  function iniciarSyncCheck() {
    detenerSyncCheck();
    timerSync = setInterval(() => {
      // REGLA DE ORO (Dictador de Sincronización): 
      // SÓLO el Host puede enviar chequeos de sincronización periódicos.
      // Si todos los clientes enviaran su tiempo, crearían un juego de la soga
      // (Tug of War) donde los que cargan más lento arrastrarían a los rápidos 
      // hacia el pasado infinitamente.
      if (!estadoSala || !estadoSala.isHost) return;

      const ctrl = window.PartyHazz.controladorVideo;
      
      // Si nuestro reproductor está atascado buffereando, nuestro tiempo actual
      // es falso o está congelado. NO debemos mandarlo al servidor porque
      // arrastraríamos a los demás hacia atrás por error.
      if (ctrl.estaBuffereando && ctrl.estaBuffereando()) {
        return;
      }

      enviar({
        type: 'SYNC_CHECK',
        time: ctrl.getTiempoActual(),
        sendTimestamp: Date.now()
      });
    }, INTERVALO_SYNC_MS);
  }

  function detenerSyncCheck() {
    if (timerSync) {
      clearInterval(timerSync);
      timerSync = null;
    }
  }

  // --------------------------------------------------------------------------
  // Compensacion de latencia
  // --------------------------------------------------------------------------

  function calcularCompensacion(sendTimestamp) {
    if (!sendTimestamp) return 0;
    const lagMs = Date.now() - sendTimestamp;
    // Limitar compensacion a max 5 segundos para evitar saltos absurdos
    return Math.min(lagMs / 1000, 5);
  }

  // --------------------------------------------------------------------------
  // Persistencia de sesion para reconexiones
  // --------------------------------------------------------------------------

  function guardarEstadoSesion() {
    // El content script no puede acceder a chrome.storage.session directamente.
    // Delegamos al SW que sí tiene acceso.
    chrome.runtime.sendMessage({ tipo: 'GUARDAR_ESTADO', estadoSala }).catch(() => {});
  }

  // --------------------------------------------------------------------------
  // Comunicacion con el SW (para notificar al popup)
  // --------------------------------------------------------------------------

  function notificarSW(mensaje) {
    chrome.runtime.sendMessage(mensaje).catch(() => { });
  }

  // --------------------------------------------------------------------------
  // API publica
  // --------------------------------------------------------------------------

  function getEstadoSala() { return estadoSala; }
  function getSocket() { return socket; }

  return {
    conectar,
    desconectar,
    enviar,
    enviarEventoSync,
    getEstadoSala,
    getSocket
  };
})();
