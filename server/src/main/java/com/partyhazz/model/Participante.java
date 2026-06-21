package com.partyhazz.model;

import io.vertx.core.http.ServerWebSocket;

/**
 * Representa a un cliente WebSocket conectado.
 *
 * <p>
 * Nota de thread-safety: las instancias de Participant son creadas y accedidas
 * exclusivamente en el event loop thread del MainVerticle — no se necesita
 * synchronization externa.
 */
public class Participante {

    /**
     * UUID asignado por el servidor, enviado al cliente en ROOM_CREATED /
     * ROOM_JOINED.
     */
    private final String idParticipante;

    /** Conexión WebSocket de este participante. */
    private final ServerWebSocket socket;

    /**
     * roomId al que pertenece este participante; null si aún no está en ninguna
     * sala.
     */
    private String idSala;

    /** True si este participante es el host actual de la sala. */
    private boolean isHost;

    public Participante(String idParticipante, ServerWebSocket socket) {
        this.idParticipante = idParticipante;
        this.socket = socket;
        this.idSala = null;
        this.isHost = false;
    }

    // -------------------------------------------------------------------------
    // Getters / setters
    // -------------------------------------------------------------------------

    public String getIdParticipante() {
        return idParticipante;
    }

    public ServerWebSocket getSocket() {
        return socket;
    }

    public String getIdSala() {
        return idSala;
    }

    public void setIdSala(String idSala) {
        this.idSala = idSala;
    }

    public boolean isHost() {
        return isHost;
    }

    public void setIsHost(boolean isHost) {
        this.isHost = isHost;
    }

    @Override
    public String toString() {
        return "Participant{id=" + idParticipante + ", room=" + idSala + ", host=" + isHost + "}";
    }
}
