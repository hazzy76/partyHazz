/**
 * popup.js — Logica del popup de PartyHazz.
 *
 * Maneja tres vistas:
 *   - inicio:   crear sala / unirse + config del servidor
 *   - sala:     info de la sala activa, copiar ID, salir
 *   - cargando: spinner mientras se conecta
 *
 * Comunicacion:
 *   popup -> SW (chrome.runtime.sendMessage)
 *   SW -> popup (chrome.runtime.onMessage)
 */

'use strict';

// ============================================================================
// Referencias al DOM
// ============================================================================

const vistaInicio = document.getElementById('vista-inicio');
const vistaSala = document.getElementById('vista-sala');
const vistaCargando = document.getElementById('vista-cargando');

const btnCrear = document.getElementById('btn-crear');
const btnUnirse = document.getElementById('btn-unirse');
const inputIdSala = document.getElementById('input-id-sala');
const msgErrorInicio = document.getElementById('msg-error-inicio');

const btnCopiarSala = document.getElementById('btn-copiar-sala');
const textoIdSala = document.getElementById('texto-id-sala');
const msgCopiado = document.getElementById('msg-copiado');
const textoRol = document.getElementById('texto-rol');
const textoParticipantes = document.getElementById('texto-participantes');
const textoSync = document.getElementById('texto-sync');
const btnSalirSala = document.getElementById('btn-salir-sala');

const indicadorServidor = document.getElementById('indicador-servidor');
const textoServidor = document.getElementById('texto-servidor');

const inputUrlServidor = document.getElementById('input-url-servidor');
const btnGuardarConfig = document.getElementById('btn-guardar-config');
const msgConfig = document.getElementById('msg-config');
const textoCargando = document.getElementById('texto-cargando');

// ============================================================================
// Estado local del popup
// ============================================================================

let estadoSalaActual = null;
let timerMsgCopiado = null;
let timerMsgConfig = null;

// ============================================================================
// Inicializacion al abrir el popup
// ============================================================================

async function inicializar() {

  // Cargar config guardada
  chrome.runtime.sendMessage({ tipo: 'GET_CONFIG' }, (resp) => {
    if (resp && resp.urlServidor) {
      inputUrlServidor.value = resp.urlServidor;
    }
  });

  // Ver si hay sala activa
  chrome.runtime.sendMessage({ tipo: 'GET_ESTADO' }, (resp) => {
    if (resp && resp.estado) {
      estadoSalaActual = resp.estado;
      mostrarVistaSala(estadoSalaActual);
    } else {
      mostrarVistaInicio();
    }
  });

  // Escuchar mensajes del SW mientras el popup esta abierto
  chrome.runtime.onMessage.addListener(manejarMensajeSW);

  // Registrar eventos de UI
  btnCrear.addEventListener('click', onCrearSala);
  btnUnirse.addEventListener('click', onUnirse);
  btnCopiarSala.addEventListener('click', onCopiarId);
  btnSalirSala.addEventListener('click', onSalirSala);
  btnGuardarConfig.addEventListener('click', onGuardarConfig);

  // Unirse con Enter en el input
  inputIdSala.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onUnirse();
  });
}

// ============================================================================
// Handlers de botones
// ============================================================================

function onCrearSala() {
  ocultarError();
  mostrarVistaCargando('Creando sala...');
  chrome.runtime.sendMessage({ tipo: 'CREAR_SALA' }, (resp) => {
    if (resp && !resp.ok) {
      mostrarVistaInicio();
      mostrarError(resp.error || 'Error al crear la sala');
    }
  });
}

function onUnirse() {
  const idSala = inputIdSala.value.trim().toUpperCase();
  if (idSala.length < 4) {
    mostrarError('No sea pendejo, póngale bien el código, por favor.');
    return;
  }
  ocultarError();
  mostrarVistaCargando('Uniendose a la sala...');
  chrome.runtime.sendMessage({ tipo: 'UNIR_SALA', idSala }, (resp) => {
    if (resp && !resp.ok) {
      mostrarVistaInicio();
      mostrarError(resp.error || 'No se pudo unir a la sala');
    }
  });
}

function onCopiarId() {
  if (!estadoSalaActual) return;
  navigator.clipboard.writeText(estadoSalaActual.idSala).then(() => {
    msgCopiado.classList.remove('oculto');
    if (timerMsgCopiado) clearTimeout(timerMsgCopiado);
    timerMsgCopiado = setTimeout(() => msgCopiado.classList.add('oculto'), 2500);
  });
}

function onSalirSala() {
  chrome.runtime.sendMessage({ tipo: 'DEJAR_SALA' }, () => {
    estadoSalaActual = null;
    mostrarVistaInicio();
  });
}

function onGuardarConfig() {
  const url = inputUrlServidor.value.trim();
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    msgConfig.textContent = '⚠ La URL debe empezar con ws:// o wss://';
    msgConfig.className = 'ph-msg-error';
    msgConfig.classList.remove('oculto');
    return;
  }
  chrome.runtime.sendMessage({ tipo: 'GUARDAR_CONFIG', urlServidor: url }, () => {
    msgConfig.textContent = '✓ Guardado';
    msgConfig.className = 'ph-msg-ok';
    msgConfig.classList.remove('oculto');
    if (timerMsgConfig) clearTimeout(timerMsgConfig);
    timerMsgConfig = setTimeout(() => msgConfig.classList.add('oculto'), 2500);
  });
}

// ============================================================================
// Mensajes del SW → actualizar UI reactivamente
// ============================================================================

function manejarMensajeSW(mensaje) {
  switch (mensaje.tipo) {

    case 'SALA_CREADA':
    case 'SALA_UNIDA':
      estadoSalaActual = {
        idSala: mensaje.idSala,
        isHost: mensaje.isHost,
        participantes: mensaje.participantes || 1
      };
      mostrarVistaSala(estadoSalaActual);
      break;

    case 'USUARIO_UNIDO':
    case 'USUARIO_SALIO':
      if (estadoSalaActual) {
        estadoSalaActual.participantes = mensaje.participantes;
        if (mensaje.nuevoHost) estadoSalaActual.isHost = true;
        actualizarInfoSala(estadoSalaActual);
      }
      break;

    case 'WS_CONECTADO':
      setServidorConectado(true, inputUrlServidor.value || 'localhost:8080');
      break;

    case 'WS_DESCONECTADO':
      setServidorConectado(false);
      break;

    case 'ERROR':
      mostrarVistaInicio();
      mostrarError(mensaje.mensaje || 'Error desconocido');
      break;
  }
}

// ============================================================================
// Control de vistas
// ============================================================================

function mostrarVistaInicio() {
  vistaInicio.classList.add('activa');
  vistaSala.classList.remove('activa');
  vistaCargando.classList.remove('activa');
}

function mostrarVistaSala(estado) {
  vistaInicio.classList.remove('activa');
  vistaCargando.classList.remove('activa');
  vistaSala.classList.add('activa');
  actualizarInfoSala(estado);
}

function mostrarVistaCargando(texto) {
  vistaInicio.classList.remove('activa');
  vistaSala.classList.remove('activa');
  vistaCargando.classList.add('activa');
  textoCargando.textContent = texto;
}

function actualizarInfoSala(estado) {
  textoIdSala.textContent = estado.idSala || '------';
  textoParticipantes.textContent = estado.participantes || 1;

  if (estado.isHost) {
    textoRol.textContent = 'Host 👑';
    textoRol.className = 'ph-info-valor ph-badge-host';
  } else {
    textoRol.textContent = 'Espectador';
    textoRol.className = 'ph-info-valor ph-badge-viewer';
  }
}

// ============================================================================
// Helpers UI
// ============================================================================

function mostrarError(msg) {
  msgErrorInicio.textContent = msg;
  msgErrorInicio.classList.remove('oculto');
}

function ocultarError() {
  msgErrorInicio.classList.add('oculto');
}

function setServidorConectado(conectado, url) {
  if (conectado) {
    indicadorServidor.className = 'ph-servidor ph-servidor--conectado';
    textoServidor.textContent = `Conectado a ${url || 'servidor'}`;
  } else {
    indicadorServidor.className = 'ph-servidor ph-servidor--desconectado';
    textoServidor.textContent = 'Servidor desconectado';
  }
}

// ============================================================================
// Arranque
// ============================================================================

document.addEventListener('DOMContentLoaded', inicializar);
