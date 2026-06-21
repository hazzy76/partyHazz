package com.partyhazz.model;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Representa una sala de watch-party.
 *
 * <p>
 * Nota de thread-safety: las instancias de Room son creadas, leídas y mutadas
 * exclusivamente en el event loop thread de Vert.x — no se requieren
 * synchronization primitives.
 * NO accedas a objetos Room desde worker threads u otros verticles sin
 * volver al event loop mediante {@code context.runOnContext()}.
 *
 * <p>
 * Los participantes se almacenan en orden de inserción. El índice 0 es siempre
 * el host actual.
 */
public class Sala {

    public enum EventoEnum {
        CREAR_SALA("CREAR_SALA"),
        SALA_UNIDA("SALA_UNIDA"),
        USUARIO_UNIDO("USUARIO_UNIDO"),
        USUARIO_SALIO("USUARIO_SALIO"),
        UNIR_SALA("UNIR_SALA"),
        DEJAR_SALA("DEJAR_SALA"),
        PLAY("PLAY"),
        PAUSA("PAUSA"),
        IR_A("IR_A"),
        SYNC_CHECK("SYNC_CHECK"),
        SYNC_RESPONSE("SYNC_RESPONSE"),
        SYNC_RESQUEST("SYNC_REQUEST");

        private final String valor;

        EventoEnum(String valor) {
            this.valor = valor;
        }

        public String getValor() {
            return valor;
        }
    }

    private final String idSala;

    /**
     * Lista ordenada de participantes activos. El participante en el índice 0 es el
     * host.
     * El orden de inserción se preserva para que la promoción al salir el host sea
     * determinista.
     */
    private final List<Participante> participantes = new ArrayList<>();

    /**
     * Rastrea los flujos STATE_REQUEST en vuelo.
     * Key = participantId del participante que espera la respuesta de estado.
     * Value = el objeto Participant que envió el STATE_REQUEST.
     *
     * Cuando el host responde con STATE_RESPONSE debe incluir el
     * participantId destino para que el servidor pueda encontrarlo y entregar la
     * respuesta.
     */
    private final Map<String, Participante> pendingStateRequests = new HashMap<>();

    public Sala(String idSala) {
        this.idSala = idSala;
    }

    // -------------------------------------------------------------------------
    // Gestión de participantes
    // -------------------------------------------------------------------------

    public void addParticipante(Participante p) {
        participantes.add(p);
    }

    public boolean removeParticipante(Participante p) {
        return participantes.remove(p);
    }

    /** Retorna true si la sala no tiene participantes. */
    public boolean isEmpty() {
        return participantes.isEmpty();
    }

    /** Retorna el host actual (índice 0), o null si la sala está vacía. */
    public Participante getHost() {
        return participantes.isEmpty() ? null : participantes.get(0);
    }

    public List<Participante> getParticipantes() {
        return participantes;
    }

    public int contarParticipantes() {
        return participantes.size();
    }

    // -------------------------------------------------------------------------
    // Seguimiento de STATE_REQUEST
    // -------------------------------------------------------------------------

    public void addPendingStateRequest(String requesterParticipantId, Participante requester) {
        pendingStateRequests.put(requesterParticipantId, requester);
    }

    public Participante removePendingStateRequest(String requesterParticipantId) {
        return pendingStateRequests.remove(requesterParticipantId);
    }

    // -------------------------------------------------------------------------
    // Getters
    // -------------------------------------------------------------------------

    public String getIdSala() {
        return idSala;
    }

    @Override
    public String toString() {
        return "Sala{id=" + idSala + ", participantes=" + participantes.size() + "}";
    }
}
