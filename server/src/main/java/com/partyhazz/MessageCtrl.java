package com.partyhazz;

import com.partyhazz.model.Participante;
import io.vertx.core.http.ServerWebSocket;
import io.vertx.core.json.DecodeException;
import io.vertx.core.json.JsonObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Parsea los frames de texto WebSocket entrantes y los despacha a la operación
 * correspondiente en {@link SalaBs}.
 *
 * <h2>Tipos de mensajes entrantes soportados</h2>
 * 
 * <pre>
 * ┌──────────────────┬──────────────────────────────────────────────────────┐
 * │ type             │ Campos requeridos                                    │
 * ├──────────────────┼──────────────────────────────────────────────────────┤
 * │ CREATE_ROOM      │ (ninguno)                                            │
 * │ JOIN_ROOM        │ roomId, [participantId] (opcional, para reconexion)  │
 * │ LEAVE_ROOM       │ (ninguno, usa identidad del socket)                  │
 * │ PLAY             │ time (Number)                                        │
 * │ PAUSE            │ time (Number)                                        │
 * │ SEEK             │ time (Number)                                        │
 * │ SYNC_CHECK       │ time (Number), sendTimestamp (Number)                │
 * │ STATE_REQUEST    │ (ninguno, se reenvía al host automáticamente)       │
 * │ STATE_RESPONSE   │ toParticipantId (String), + campos de estado libres  │
 * └──────────────────┴──────────────────────────────────────────────────────┘
 * </pre>
 *
 * <h2>Thread-safety</h2>
 * <p>
 * Las instancias de esta clase se crean una vez por conexión y solo se invocan
 * desde el event loop de Vert.x — no hay estado mutable compartido entre
 * conexiones.
 */
public class MessageCtrl {

    private static final Logger log = LoggerFactory.getLogger(MessageCtrl.class);

    private final SalaBs salaBs;

    public MessageCtrl(SalaBs salaBs) {
        this.salaBs = salaBs;
    }

    /**
     * Registra todos los handlers de eventos WebSocket para un cliente recién
     * conectado.
     *
     * @param ws           la conexión WebSocket cruda
     * @param participante la representación server-side de esta conexión
     */
    public void handle(ServerWebSocket ws, Participante participante) {
        log.info("Participante conectado: {}", participante.getIdParticipante());

        // --- Frames de texto entrantes ---
        ws.textMessageHandler(raw -> {
            JsonObject msg;
            try {
                msg = new JsonObject(raw);
            } catch (DecodeException e) {
                log.warn("JSON malformado del participante {}: {}", participante.getIdParticipante(), raw);
                salaBs.sendError(participante, "JSON inválido");
                return;
            }

            String type = msg.getString("type");
            if (type == null) {
                salaBs.sendError(participante, "Falta el campo 'type'");
                return;
            }

            despachador(participante, type, msg);
        });

        // --- Conexión cerrada (cierre normal del navegador / caída de red) ---
        ws.closeHandler(v -> {
            log.info("Cliente desconectado: {} (code={}, reason={})",
                    participante.getIdParticipante(), ws.closeStatusCode(), ws.closeReason());

            if (participante.getIdSala() != null) {
                // Abrir ventana de reconexión para caídas inesperadas (code 1001 = going away,
                // 1006 = abnormal closure). Para cierres normales/explícitos se omite la
                // ventana.
                short code = ws.closeStatusCode() != null ? ws.closeStatusCode() : 0;
                boolean unexpected = (code == 1006 || code == 0);

                if (unexpected) {
                    salaBs.permitirReconexion(participante);
                } else {
                    salaBs.dejarSala(participante, true);
                }
            }
        });

        // --- Errores a nivel WebSocket ---
        ws.exceptionHandler(err -> {
            log.error("Error en WebSocket para el participante {}: {}",
                    participante.getIdParticipante(), err.getMessage());
        });
    }

    // =========================================================================
    // Dispatcher
    // =========================================================================

    private void despachador(Participante p, String type, JsonObject msg) {
        switch (type) {

            case "CREAR_SALA" -> salaBs.crearSala(p);

            case "UNIR_SALA" -> {
                String idSala = msg.getString("idSala");
                if (idSala == null || idSala.isBlank()) {
                    salaBs.sendError(p, "UNIR_SALA requiere el campo 'idSala'");
                    return;
                }
                // Opcional: el cliente puede enviar su antiguo participantId para reconexion
                // (Option A)
                String idAntiguoParticipante = msg.getString("idAntiguoParticipante");
                salaBs.unirSala(idSala.toUpperCase().trim(), p, idAntiguoParticipante);
            }

            case "DEJAR_SALA" -> salaBs.dejarSala(p, true);

            // Eventos de relay de sincronización — se reenvían tal cual a todos los demás
            case "PLAY", "PAUSA", "IR_A" -> {
                if (!msg.containsKey("time")) {
                    salaBs.sendError(p, type + " requiere el campo 'time'");
                    return;
                }
                salaBs.relayToRoom(p, msg);
            }

            case "SYNC_CHECK" -> {
                if (!msg.containsKey("time") || !msg.containsKey("sendTimestamp")) {
                    salaBs.sendError(p, "SYNC_CHECK requiere el campo 'time' y 'sendTimestamp'");
                    return;
                }
                salaBs.relayToRoom(p, msg);
            }

            case "STATE_REQUEST" -> salaBs.relayStateRequest(p);

            case "STATE_RESPONSE" -> {
                if (msg.getString("toParticipantId") == null) {
                    salaBs.sendError(p, "STATE_RESPONSE requiere el campo 'toParticipantId'");
                    return;
                }
                salaBs.relayStateResponse(p, msg);
            }

            default -> {
                log.warn("Mensaje tipo desconocido '{}' del participante {}", type, p.getIdParticipante());
                salaBs.sendError(p, "Mensaje tipo desconocido: " + type);
            }
        }
    }
}
