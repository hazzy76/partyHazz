package com.partyhazz;

import com.partyhazz.model.Participante;
import com.partyhazz.model.Sala;
import com.partyhazz.model.Sala.EventoEnum;
import com.partyhazz.util.ReconnectEntry;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;

/**
 * Gestiona todas las salas activas y la ventana de reconexión de participantes.
 *
 * <h2>Contrato de thread-safety</h2>
 * <p>
 * Todos los métodos públicos de esta clase DEBEN ser llamados desde el event
 * loop thread
 * de Vert.x que posee el {@link MainVerticle}. Los verticles de Vert.x son
 * single-threaded
 * por diseño: cada instancia corre en exactamente un event loop thread y todos
 * los callbacks
 * de WebSocket son despachados en ese mismo thread. Por lo tanto, no se
 * necesitan bloques
 * {@code synchronized} ni tipos {@link java.util.concurrent.atomic}.
 *
 * <p>
 * Si este servidor escala a múltiples instancias de verticle, el estado de las
 * salas
 * deberá moverse a un store compartido (ej. Vert.x Hazelcast cluster o Redis).
 */
public class SalaBs {

    private static final Logger log = LoggerFactory.getLogger(SalaBs.class);

    /**
     * Caracteres usados para generar el room ID: letras mayúsculas + dígitos,
     * excluyendo caracteres visualmente ambiguos (0, O, I, 1) para mejor
     * legibilidad.
     */
    private static final String CARACTERES_ID_SALA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int LONGITUD_ID_SALA = 6;
    private static final long TIEMPO_RECONEXION_MS = 30_000L;

    private final Vertx vertx;
    private final SecureRandom random = new SecureRandom();

    private final Map<String, Sala> salasActivas = new HashMap<>();

    /**
     * Registro de reconexiones pendientes.
     * Key = participantId, Value = entrada con info de la sala y el ID del timer de
     * Vert.x.
     */
    private final Map<String, ReconnectEntry> reconexionesPendientes = new HashMap<>();

    public SalaBs(Vertx vertx) {
        this.vertx = vertx;
    }

    // =========================================================================
    // Ciclo de vida de la sala
    // =========================================================================

    /**
     * Crea una nueva sala, asigna al creador como host y le envía ROOM_CREATED.
     *
     * @param creator el participante que crea la sala
     */
    public void crearSala(Participante creator) {
        String idSala = generarIdSalaUnico();
        Sala sala = new Sala(idSala);

        creator.setIdSala(idSala);
        creator.setIsHost(true);
        sala.addParticipante(creator);
        salasActivas.put(idSala, sala);

        log.info("Sala creada: {} por el participante {}", idSala, creator.getIdParticipante());

        JsonObject response = new JsonObject()
                .put("type", EventoEnum.CREAR_SALA.getValor())
                .put("idSala", idSala)
                .put("idParticipante", creator.getIdParticipante())
                .put("isHost", true);

        send(creator, response);
    }

    /**
     * Une a un participante a una sala existente.
     *
     * <p>
     * Si el participante trae un {@code participantId} que coincide con una entrada
     * de
     * reconexión pendiente para esta sala, se restaura la sesión anterior
     * (preservando el status de host).
     *
     * @param roomId           la sala a la que unirse
     * @param joiner           el participante que se une
     * @param oldParticipantId opcional: un participantId de una sesión anterior
     *                         (puede ser null)
     */
    public void unirSala(String idSala, Participante participante, String idAnteriorParticipante) {
        Sala sala = salasActivas.get(idSala);
        if (sala == null) {
            sendError(participante, "Sala no encontrada: " + idSala + ", Jilipollas");
            return;
        }

        // --- Ruta de reconexión ---
        if (idAnteriorParticipante != null) {
            ReconnectEntry entry = reconexionesPendientes.remove(idAnteriorParticipante);
            if (entry != null && entry.getIdSala().equals(idSala)) {
                // Cancelar el timer de desalojo
                vertx.cancelTimer(entry.getTimerId());
                log.info("Participante {} se reconectó a la sala {} (era host: {})",
                        idAnteriorParticipante, idSala, entry.getEraHost());

                // Restaurar el flag de host si corresponde
                if (entry.getEraHost()) {
                    participante.setIsHost(true);
                    // Insertar al frente para que índice 0 = host se preserve
                    sala.getParticipantes().add(0, participante);
                } else {
                    sala.addParticipante(participante);
                }
                participante.setIdSala(idSala);

                JsonObject joined = new JsonObject()
                        .put("type", EventoEnum.SALA_UNIDA.getValor())
                        .put("idSala", idSala)
                        .put("idParticipante", participante.getIdParticipante())
                        .put("isHost", participante.isHost())
                        .put("participantes", sala.contarParticipantes())
                        .put("reconectado", true);
                send(participante, joined);

                broadcastExcepto(sala, participante, new JsonObject()
                        .put("type", EventoEnum.USUARIO_UNIDO.getValor())
                        .put("participantes", sala.contarParticipantes())
                        .put("reconectado", true));
                return;
            }
        }

        // --- Ruta de unión normal ---
        participante.setIdSala(idSala);
        participante.setIsHost(false);
        sala.addParticipante(participante);

        log.info("Participante {} se une a la sala {} ({} total)",
                participante.getIdParticipante(), idSala, sala.contarParticipantes());

        JsonObject response = new JsonObject()
                .put("type", EventoEnum.SALA_UNIDA.getValor())
                .put("idSala", idSala)
                .put("idParticipante", participante.getIdParticipante())
                .put("isHost", false)
                .put("participantes", sala.contarParticipantes());
        send(participante, response);

        broadcastExcepto(sala, participante, new JsonObject()
                .put("type", EventoEnum.USUARIO_UNIDO.getValor())
                .put("participantes", sala.contarParticipantes()));
    }

    /**
     * Elimina a un participante de su sala. Si era el host, el siguiente
     * participante
     * de la lista es promovido. Destruye la sala cuando queda vacía.
     *
     * @param participante el participante que se va
     * @param isVoluntad   true = LEAVE_ROOM explícito; false = desconexión
     *                     inesperada
     */
    public void dejarSala(Participante participante, boolean isVoluntad) {
        String idSala = participante.getIdSala();
        if (idSala == null)
            return; // No está en ninguna sala

        Sala sala = salasActivas.get(idSala);
        if (sala == null)
            return;

        boolean eraHost = participante.isHost();
        sala.removeParticipante(participante);
        participante.setIdSala(null);
        participante.setIsHost(false);

        log.info("Participante {} se fue alv de la sala {} (isVoluntad: {}, eraHost: {}, quedan: {})",
                participante.getIdParticipante(), idSala, isVoluntad, eraHost, sala.contarParticipantes());

        if (sala.isEmpty()) {
            salasActivas.remove(idSala);
            log.info("Sala {} destruida (vacía)", idSala);
            return;
        }

        // Promover al siguiente host si es necesario
        boolean huboPromocionHost = false;
        if (eraHost) {
            Participante nuevoHost = sala.getParticipantes().get(0); // el primero de la lista se convierte en host
            nuevoHost.setIsHost(true);
            huboPromocionHost = true;
            log.info("Participante {} promovido a host en sala {}", nuevoHost.getIdParticipante(), idSala);
        }

        broadcastExcepto(sala, participante, new JsonObject()
                .put("type", EventoEnum.USUARIO_SALIO.getValor())
                .put("participantes", sala.contarParticipantes())
                .put("nuevoHost", huboPromocionHost));
    }

    /**
     * Registra a un participante desconectado para una posible reconexión dentro de
     * {@value #TIEMPO_RECONEXION_MS} ms. Si no se reconecta, se llama a
     * {@link #dejarSala}
     * automáticamente.
     *
     * @param participant el participante que se desconectó inesperadamente
     */
    public void permitirReconexion(Participante participante) {
        String idSala = participante.getIdSala();
        if (idSala == null)
            return;

        String idParticipante = participante.getIdParticipante();
        boolean eraHost = participante.isHost();

        // Remover de la sala pero mantenerla viva
        Sala sala = salasActivas.get(idSala);
        if (sala != null) {
            sala.removeParticipante(participante);

            // Si era el host y hay otros presentes, promover inmediatamente
            // para que la sala siga funcionando durante la ventana de reconexión
            if (eraHost && !sala.isEmpty()) {
                Participante tempHost = sala.getParticipantes().get(0);
                tempHost.setIsHost(true);
                log.info("Promovido temporalmente a host a {} mientras {} se reconecta",
                        tempHost.getIdParticipante(), idParticipante);
                broadcast(sala, new JsonObject()
                        .put("type", EventoEnum.USUARIO_SALIO.getValor())
                        .put("participantes", sala.contarParticipantes())
                        .put("nuevoHost", true)
                        .put("reconectando", true));
            } else if (!eraHost && !sala.isEmpty()) {
                broadcast(sala, new JsonObject()
                        .put("type", EventoEnum.USUARIO_SALIO.getValor())
                        .put("participantes", sala.contarParticipantes())
                        .put("nuevoHost", false)
                        .put("reconectando", true));
            }
        }

        participante.setIdSala(null);
        participante.setIsHost(false);

        long timerId = vertx.setTimer(TIEMPO_RECONEXION_MS, id -> {
            // Venció el período de gracia — ejecutar salida real
            reconexionesPendientes.remove(idParticipante);
            log.info("Terminó el tiempo de reconexión del participante {} en la sala {}", idParticipante, idSala);

            Sala s = salasActivas.get(idSala);
            if (s != null && s.isEmpty()) {
                salasActivas.remove(idSala);
                log.info("Sala {} destruida después del tiempo de reconexión", idSala);
            }
        });

        reconexionesPendientes.put(idParticipante, new ReconnectEntry(idSala, eraHost, timerId));
        log.info("Se abrió la ventana de reconexión para el participante {} en la sala {} ({}ms)",
                idParticipante, idSala, TIEMPO_RECONEXION_MS);
    }

    // =========================================================================
    // Relay de eventos
    // =========================================================================

    /**
     * Hace relay de un evento de sincronización (PLAY/PAUSE/SEEK/SYNC_CHECK) a
     * todos
     * los participantes de la sala del emisor, excluyéndolo a él mismo.
     *
     * @param sender  el participante que originó el evento
     * @param message el mensaje JSON original a reenviar tal cual
     */
    public void relayToRoom(Participante sender, JsonObject message) {
        if (sender.getIdSala() == null) {
            sendError(sender, "No estás en una sala, jilipollas");
            return;
        }
        Sala sala = salasActivas.get(sender.getIdSala());
        if (sala == null)
            return;

        broadcastExcepto(sala, sender, message);
    }

    /**
     * Hace relay de un STATE_REQUEST de un participante recién unido al host de la
     * sala.
     * Almacena al solicitante para que la respuesta del host pueda ser enrutada de
     * vuelta correctamente.
     */
    public void relayStateRequest(Participante requester) {
        if (requester.getIdSala() == null) {
            sendError(requester, "No estás en una sala, jilipollas");
            return;
        }
        Sala sala = salasActivas.get(requester.getIdSala());
        if (sala == null)
            return;

        Participante host = sala.getHost();
        if (host == null || host == requester) {
            return;
        }

        sala.addPendingStateRequest(requester.getIdParticipante(), requester);

        // Reenviar la solicitud al host, indicando quién pregunta
        send(host, new JsonObject()
                .put("type", "STATE_REQUEST")
                .put("from", requester.getIdParticipante()));
    }

    /**
     * Enruta un STATE_RESPONSE del host de vuelta al participante que lo solicitó.
     *
     * @param host    el participante que envía la respuesta (debe ser el host)
     * @param message mensaje STATE_RESPONSE original; debe contener
     *                {@code toParticipantId}
     */
    public void relayStateResponse(Participante host, JsonObject message) {
        if (host.getIdSala() == null) {
            sendError(host, "No estás en una sala, jilipollas");
            return;
        }
        Sala sala = salasActivas.get(host.getIdSala());
        if (sala == null)
            return;

        String toId = message.getString("toParticipantId");
        if (toId == null) {
            sendError(host, "STATE_RESPONSE le falta el toParticipantId");
            return;
        }

        Participante requester = sala.removePendingStateRequest(toId);
        if (requester == null) {
            log.warn("STATE_RESPONSE para un solicitante desconocido {} en la sala {}", toId, host.getIdSala());
            return;
        }

        // Reenviar todo el payload de estado al solicitante
        JsonObject response = message.copy()
                .put("type", "STATE_RESPONSE");
        send(requester, response);
    }

    // =========================================================================
    // Helpers internos
    // =========================================================================

    /**
     * Envía un mensaje JSON a un único participante. Los errores se registran sin
     * relanzar.
     */
    private void send(Participante p, JsonObject msg) {
        try {
            if (!p.getSocket().isClosed()) {
                p.getSocket().writeTextMessage(msg.encode());
            }
        } catch (Exception e) {
            log.warn("Fallo al enviar mensaje a {}: {}", p.getIdParticipante(), e.getMessage());
        }
    }

    /**
     * Hace broadcast a todos los participantes de la sala, excluyendo al emisor.
     */
    private void broadcastExcepto(Sala sala, Participante negro, JsonObject msg) {
        String encoded = msg.encode();
        for (Participante p : sala.getParticipantes()) {
            if (p != negro) {
                try {
                    if (!p.getSocket().isClosed()) {
                        p.getSocket().writeTextMessage(encoded);
                    }
                } catch (Exception e) {
                    log.warn("Fallo al enviar broadcast a {}: {}", p.getIdParticipante(), e.getMessage());
                }
            }
        }
    }

    /** Hace broadcast a TODOS los participantes de la sala. */
    private void broadcast(Sala sala, JsonObject msg) {
        String encoded = msg.encode();
        for (Participante p : sala.getParticipantes()) {
            try {
                if (!p.getSocket().isClosed()) {
                    p.getSocket().writeTextMessage(encoded);
                }
            } catch (Exception e) {
                log.warn("Fallo al enviar broadcast a {}: {}", p.getIdParticipante(), e.getMessage());
            }
        }
    }

    /** Envía un mensaje ERROR a un participante. */
    public void sendError(Participante p, String message) {
        send(p, new JsonObject()
                .put("type", "ERROR")
                .put("message", message));
    }

    /**
     * Genera un room ID único de 6 caracteres que no colisione con salas
     * existentes.
     */
    private String generarIdSalaUnico() {
        String id;
        do {
            id = generarIdSala();
        } while (salasActivas.containsKey(id));
        return id;
    }

    private String generarIdSala() {
        StringBuilder sb = new StringBuilder(LONGITUD_ID_SALA);
        for (int i = 0; i < LONGITUD_ID_SALA; i++) {
            sb.append(CARACTERES_ID_SALA.charAt(random.nextInt(CARACTERES_ID_SALA.length())));
        }
        return sb.toString();
    }

    // =========================================================================
    // Helpers de diagnóstico
    // =========================================================================

    public int getNumSalasActivas() {
        return salasActivas.size();
    }

    public int getNumReconexionesPendientes() {
        return reconexionesPendientes.size();
    }
}
