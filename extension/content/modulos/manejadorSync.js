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
  let urlServidor = 'wss://pruebassae.eld.edu.mx/ws';
  let timerSync = null;
  let timerSoftSync = null; // Monitor local para Soft Sync
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
    terminarSoftSync();
    if (socket) {
      socket.close(1000, 'DEJAR_SALA voluntario');
      socket = null;
    }
    estadoSala = null;
    chrome.runtime.sendMessage({ tipo: 'LIMPIAR_ESTADO' }).catch(() => { });
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
        const diferencia = tiempoLocal - tiempoEsperado;
        const absDiferencia = Math.abs(diferencia);

        if (absDiferencia > TOLERANCIA_SYNC_SEG) {
          // Ignorar verificacion si hay buffering en progreso
          if (ctrl.estaBuffereando && ctrl.estaBuffereando()) {
            return;
          }

          // Compensacion de latencia mediante ajuste de velocidad (Soft Sync)
          if (absDiferencia < 4.0 && ctrl.estaReproduciendo()) {
            const nuevoRate = (diferencia < 0) ? 1.25 : 0.8;
            ctrl.setPlaybackRate(nuevoRate);
            console.log(`[PartyHazz] Soft Sync: Velocidad a ${nuevoRate}x para corregir ${absDiferencia.toFixed(2)}s`);

            // Iniciar monitor de convergencia local
            iniciarSoftSync(tiempoEsperado, Date.now());
            return;
          }

          // Compensacion de latencia mediante salto directo (Hard Sync)
          console.log(`[PartyHazz] Hard Sync: Drift de ${absDiferencia.toFixed(2)}s. Forzando salto...`);
          terminarSoftSync();
          ui.mostrarAjustando();
          ctrl.aplicarSeek(tiempoEsperado);
        } else {
          // Restaurar estado normal si no hay desfase
          terminarSoftSync();
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
        chrome.runtime.sendMessage({ tipo: 'LIMPIAR_ESTADO' }).catch(() => { });
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
      // Limitar emision de eventos de sincronizacion exclusivamente al Host
      if (!estadoSala || !estadoSala.isHost) return;

      const ctrl = window.PartyHazz.controladorVideo;

      // Suspender emision de sincronizacion durante el buffering
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
  // Soft Sync Local Monitor
  // --------------------------------------------------------------------------

  function iniciarSoftSync(tiempoDestinoHost, tsRecibido) {
    const ctrl = window.PartyHazz.controladorVideo;

    if (timerSoftSync) clearInterval(timerSoftSync);

    timerSoftSync = setInterval(() => {
      // Si el video se pausó, abortamos el soft sync
      if (!ctrl.estaReproduciendo()) {
        terminarSoftSync();
        return;
      }

      // Proyectamos el tiempo del Host asumiendo que avanza a velocidad 1.0x
      const transcurrido = (Date.now() - tsRecibido) / 1000;
      const tiempoProyectadoHost = tiempoDestinoHost + transcurrido;
      const tiempoLocal = ctrl.getTiempoActual();

      const diferencia = tiempoLocal - tiempoProyectadoHost;

      // Si la diferencia ya es imperceptible (< 0.15s), volvemos a 1.0x
      if (Math.abs(diferencia) < 0.15) {
        console.log(`[PartyHazz] Soft Sync exitoso. Restaurando velocidad a 1.0x`);
        terminarSoftSync();
      }
    }, 200);
  }

  function terminarSoftSync() {
    const ctrl = window.PartyHazz.controladorVideo;
    if (timerSoftSync) {
      clearInterval(timerSoftSync);
      timerSoftSync = null;
    }
    if (ctrl && ctrl.setPlaybackRate) {
      ctrl.setPlaybackRate(1.0);
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
    chrome.runtime.sendMessage({ tipo: 'GUARDAR_ESTADO', estadoSala }).catch(() => { });
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
