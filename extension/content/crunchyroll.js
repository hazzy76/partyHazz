/**
 * crunchyroll.js — Orchestrator principal del content script.
 *
 * Este archivo se carga de ultimo (ver manifest.json) y orquesta todos los
 * modulos. Es el punto de entrada que:
 *  1. Inicia la deteccion del video
 *  2. Conecta el controlador de video cuando el player aparece
 *  3. Escucha mensajes del SW (comandos del popup y del servidor relay)
 *  4. Reacciona a eventos del usuario en el player
 *
 * Dependencias (cargadas antes por el manifest):
 *   - window.PartyHazz.detectorVideo
 *   - window.PartyHazz.controladorVideo
 *   - window.PartyHazz.manejadorSync
 *   - window.PartyHazz.overlayUI
 */

(() => {
  'use strict';

  const PH = window.PartyHazz;
  let iniciado = false;

  // --------------------------------------------------------------------------
  // Arranque
  // --------------------------------------------------------------------------

  function arrancar() {
    if (iniciado) return;
    iniciado = true;
    console.log('[PartyHazz] Content script activo en', window.location.href);

    // Iniciar deteccion del video
    PH.detectorVideo.iniciar(onVideoEncontrado, onVideoLost);

    // Escuchar mensajes del SW (comandos del popup y del servidor)
    chrome.runtime.onMessage.addListener(manejarMensajeSW);

    // Verificar si habia una sesion activa (reconexion tras refresh)
    restaurarSesion();
  }

  // --------------------------------------------------------------------------
  // Callbacks del detector de video
  // --------------------------------------------------------------------------

  function onVideoEncontrado(video) {
    console.log('[PartyHazz] Video listo');

    // Conectar el controlador al nuevo video
    PH.controladorVideo.iniciar(video, onEventoUsuarioEnVideo);

    // Si ya estamos en una sala, mostrar el overlay
    const estadoSala = PH.manejadorSync.getEstadoSala();
    if (estadoSala) {
      PH.overlayUI.mostrarSala(estadoSala);
    }
  }

  function onVideoLost() {
    console.log('[PartyHazz] Video desaparecio (navegacion SPA)');
    PH.controladorVideo.detener();
  }

  // --------------------------------------------------------------------------
  // Eventos del usuario en el player → enviar al servidor
  // --------------------------------------------------------------------------

  function onEventoUsuarioEnVideo(evento) {
    const sala = PH.manejadorSync.getEstadoSala();
    if (!sala) return; // No estamos en sala, ignorar

    console.log('[PartyHazz] Evento usuario:', evento);
    PH.manejadorSync.enviarEventoSync(evento);
  }

  // --------------------------------------------------------------------------
  // Mensajes del SW (comandos del popup o relay del servidor)
  // --------------------------------------------------------------------------

  function manejarMensajeSW(mensaje, _sender, sendResponse) {
    switch (mensaje.tipo) {

      // -- El usuario presiono "Crear Sala" en el popup --
      case 'CREAR_SALA':
        obtenerUrlServidor((url) => {
          PH.manejadorSync.conectar(url, () => {});
          // Dar tiempo al WS para conectar antes de enviar
          setTimeout(() => PH.manejadorSync.enviar({ type: 'CREAR_SALA' }), 400);
        });
        sendResponse({ ok: true });
        break;

      // -- El usuario presiono "Unirse" en el popup --
      case 'UNIR_SALA':
        obtenerUrlServidor((url) => {
          PH.manejadorSync.conectar(url, () => {});
          setTimeout(() => PH.manejadorSync.enviar({
            type:   'UNIR_SALA',
            idSala: mensaje.idSala.toUpperCase().trim()
          }), 400);
        });
        sendResponse({ ok: true });
        break;

      // -- El usuario presiono "Salir" --
      case 'DEJAR_SALA':
        PH.manejadorSync.enviar({ type: 'DEJAR_SALA' });
        PH.manejadorSync.desconectar();
        PH.overlayUI.ocultar();
        sendResponse({ ok: true });
        break;

      default:
        // No reconocido: ignorar silenciosamente
        break;
    }

    return true;
  }

  // --------------------------------------------------------------------------
  // Restaurar sesion tras refresh de la pagina
  // --------------------------------------------------------------------------

  function restaurarSesion() {
    chrome.storage.session.get('estadoSala', (result) => {
      if (!result.estadoSala) return;

      const sala = result.estadoSala;
      console.log('[PartyHazz] Restaurando sesion en sala', sala.idSala);

      obtenerUrlServidor((url) => {
        PH.manejadorSync.conectar(url, () => {});
        // Reconectar con el idAntiguoParticipante para que el servidor
        // restaure el rol de host si corresponde
        setTimeout(() => PH.manejadorSync.enviar({
          type:                 'UNIR_SALA',
          idSala:               sala.idSala,
          idAntiguoParticipante: sala.idParticipante
        }), 600);
      });
    });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  function obtenerUrlServidor(callback) {
    chrome.runtime.sendMessage({ tipo: 'GET_CONFIG' }, (resp) => {
      callback(resp && resp.urlServidor ? resp.urlServidor : 'wss://pruebassae.eld.edu.mx/ws');
    });
  }

  // --------------------------------------------------------------------------
  // Iniciar cuando el DOM este listo
  // --------------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }
})();
