package com.partyhazz.util;

/**
 * Contiene los datos necesarios para restaurar un participante tras una
 * desconexión temporal.
 */
public class ReconnectEntry {
    private final String idSala;
    private final boolean eraHost;
    private final long timerId;

    public String getIdSala() {
        return idSala;
    }

    public boolean getEraHost() {
        return eraHost;
    }

    public long getTimerId() {
        return timerId;
    }

    public ReconnectEntry(String idSala, boolean eraHost, long timerId) {
        this.idSala = idSala;
        this.eraHost = eraHost;
        this.timerId = timerId;
    }
}