/**
 * Service Worker de PartyHazz (background/sw.js)
 *
 * Rol: relay de mensajes entre popup <-> content script, y gestion de config.
 * El WebSocket real vive en el content script para evitar el ciclo de vida
 * intermitente del SW en Manifest V3.
 *
 * Flujo de mensajes:
 *   Popup  --[runtime.sendMessage]--> SW --[tabs.sendMessage]--> Content Script
 *   Content Script --[runtime.sendMessage]--> SW --[runtime.sendMessage]--> Popup
 */

const URL_SERVIDOR_DEFAULT = 'wss://pruebassae.eld.edu.mx/ws';

// Tipos que van del popup/SW hacia el content script
const TIPOS_HACIA_CONTENT = ['CREAR_SALA', 'UNIR_SALA', 'DEJAR_SALA'];

// Tipos que van del content script hacia el popup
const TIPOS_HACIA_POPUP = [
  'SALA_CREADA', 'SALA_UNIDA', 'USUARIO_UNIDO', 'USUARIO_SALIO',
  'WS_CONECTADO', 'WS_DESCONECTADO', 'SYNC_ESTADO', 'ERROR'
];

// ============================================================================
// Listener principal de mensajes
// ============================================================================

chrome.runtime.onMessage.addListener((mensaje, sender, sendResponse) => {
  const { tipo } = mensaje;

  if (TIPOS_HACIA_CONTENT.includes(tipo)) {
    reenviarAContentScript(mensaje).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true; // respuesta asincrona
  }

  if (TIPOS_HACIA_POPUP.includes(tipo)) {
    reenviarAPopup(mensaje);
    sendResponse({ ok: true });
    return false;
  }

  switch (tipo) {
    case 'GUARDAR_CONFIG':
      chrome.storage.local.set({ urlServidor: mensaje.urlServidor });
      sendResponse({ ok: true });
      return false;

    case 'GET_CONFIG':
      chrome.storage.local.get('urlServidor', (result) => {
        sendResponse({
          urlServidor: result.urlServidor || URL_SERVIDOR_DEFAULT
        });
      });
      return true;

    case 'GUARDAR_ESTADO':
      chrome.storage.session.set({ estadoSala: mensaje.estadoSala });
      sendResponse({ ok: true });
      return false;

    case 'LIMPIAR_ESTADO':
      chrome.storage.session.remove('estadoSala');
      sendResponse({ ok: true });
      return false;

    case 'GET_ESTADO':
      // El content script guarda el estado via GUARDAR_ESTADO y el SW lo persiste en session
      chrome.storage.session.get('estadoSala', (result) => {
        sendResponse({ estado: result.estadoSala || null });
      });
      return true;

    default:
      return false;
  }
});

// ============================================================================
// Helpers de comunicacion
// ============================================================================

/**
 * Busca la tab activa de Crunchyroll en /watch/ y le envia el mensaje.
 */
async function reenviarAContentScript(mensaje) {
  // Primero buscar en la ventana activa
  let tabs = await chrome.tabs.query({
    url: '*://*.crunchyroll.com/*/watch/*',
    active: true,
    currentWindow: true
  });

  // Si no hay, buscar en todas las ventanas
  if (tabs.length === 0) {
    tabs = await chrome.tabs.query({ url: '*://*.crunchyroll.com/*/watch/*' });
  }

  if (tabs.length === 0) {
    return { ok: false, error: 'Abre un vídio en el Crunchyroll, ¿Cómo vas a hacer una sala aquí?, no seas mamón.' };
  }

  try {
    const respuesta = await chrome.tabs.sendMessage(tabs[0].id, mensaje);
    return respuesta || { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Intenta notificar al popup. Si esta cerrado, el error es silencioso.
 */
function reenviarAPopup(mensaje) {
  chrome.runtime.sendMessage(mensaje).catch(() => {
    // Normal: el popup puede estar cerrado
  });
}
