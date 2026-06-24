package com.partyhazz;

import io.vertx.core.AbstractVerticle;
import io.vertx.core.Promise;
import io.vertx.core.Vertx;
import io.vertx.core.VertxOptions;
import io.vertx.core.http.HttpServer;
import io.vertx.core.http.HttpServerOptions;
import io.vertx.core.http.ServerWebSocket;
import com.partyhazz.model.Participante;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.UUID;

/**
 * Entry point and main Vert.x verticle for the PartyHazz WebSocket relay
 * server.
 *
 * <h2>WebSocket endpoint</h2>
 * 
 * <pre>
 *   ws://&lt;host&gt;:&lt;port&gt;/ws
 * </pre>
 * 
 * Room association is performed via {@code CREATE_ROOM} / {@code JOIN_ROOM}
 * messages
 * sent after the connection is established.
 *
 * <h2>Configuration</h2>
 * <ul>
 * <li>{@code PORT} — environment variable (default:
 * {@value #DEFAULT_PORT})</li>
 * </ul>
 *
 * <h2>CORS / Origin</h2>
 * <p>
 * The HTTP upgrade response does not restrict the {@code Origin} header so that
 * Chrome extensions (whose origin is {@code chrome-extension://&lt;id&gt;}) can
 * connect
 * without whitelisting a specific extension ID.
 *
 * <h2>Running</h2>
 * 
 * <pre>
 *   java -jar target/partyhazz-server.jar
 *   PORT=9000 java -jar target/partyhazz-server.jar
 * </pre>
 */
public class MainVerticle extends AbstractVerticle {

    private static final Logger log = LoggerFactory.getLogger(MainVerticle.class);
    private static final int DEFAULT_PORT = 8080;
    private static final String WS_PATH = "/ws";

    // =========================================================================
    // Vert.x entry point
    // =========================================================================

    /**
     * Standard Java main — bootstraps a single-threaded Vert.x instance and deploys
     * this verticle. Using a single event loop thread guarantees that all room
     * state
     * in {@link SalaBs} is accessed from one thread, eliminating race
     * conditions
     * without explicit locking.
     */
    public static void main(String[] args) {
        // Force single event loop thread so RoomManager's non-thread-safe maps are
        // safe.
        // For horizontal scaling (multiple JVM instances), a shared store would be
        // needed.
        VertxOptions options = new VertxOptions().setEventLoopPoolSize(1);
        Vertx vertx = Vertx.vertx(options);
        vertx.deployVerticle(new MainVerticle())
                .onSuccess(id -> log.info("MainVerticle deployed: {}", id))
                .onFailure(err -> {
                    log.error("Failed to deploy verticle", err);
                    vertx.close();
                });
    }

    // =========================================================================
    // Verticle lifecycle
    // =========================================================================

    @Override
    public void start(Promise<Void> startPromise) {
        int port = getPort();

        SalaBs roomManager = new SalaBs(vertx);
        MessageCtrl messageHandler = new MessageCtrl(roomManager);

        HttpServerOptions serverOptions = new HttpServerOptions()
                .setMaxWebSocketFrameSize(65_536) // 64 KB per frame
                .setMaxWebSocketMessageSize(131_072); // 128 KB per message

        HttpServer server = vertx.createHttpServer(serverOptions);

        server
                .webSocketHandler(ws -> handleWebSocket(ws, roomManager, messageHandler))
                // Reject non-WebSocket HTTP requests with a friendly 404
                .requestHandler(req -> req.response()
                        .setStatusCode(404)
                        .putHeader("content-type", "application/json")
                        .end("{\"error\":\"PartyHazz server only accepts WebSocket connections at /ws\"}"))
                .listen(port)
                .onSuccess(s -> {
                    log.info("╔══════════════════════════════════════════╗");
                    log.info("║  PartyHazz WebSocket Server              ║");
                    log.info("║  Listening on ws://0.0.0.0:{}          ║", port);
                    log.info("║  Endpoint: ws://<host>:{}/ws           ║", port);
                    log.info("╚══════════════════════════════════════════╝");
                    startPromise.complete();
                })
                .onFailure(startPromise::fail);
    }

    // =========================================================================
    // WebSocket handler
    // =========================================================================

    private void handleWebSocket(ServerWebSocket ws, SalaBs roomManager, MessageCtrl messageHandler) {
        // Accept only the /ws path; reject anything else
        if (!WS_PATH.equals(ws.path())) {
            ws.reject(404);
            return;
        }

        // Accept the upgrade (all Origins allowed — required for Chrome extensions)
        ws.accept();

        // Assign a server-side identity to this connection
        String idParticipante = UUID.randomUUID().toString();
        Participante participante = new Participante(idParticipante, ws);

        // Delegate all subsequent events to the message handler
        messageHandler.handle(ws, participante);
    }

    // =========================================================================
    // Configuration helpers
    // =========================================================================

    private int getPort() {
        String portEnv = System.getenv("PORT");
        if (portEnv != null && !portEnv.isBlank()) {
            try {
                int port = Integer.parseInt(portEnv.trim());
                log.info("Using PORT from environment: {}", port);
                return port;
            } catch (NumberFormatException e) {
                log.warn("Invalid PORT env var '{}', falling back to {}", portEnv, DEFAULT_PORT);
            }
        }
        return DEFAULT_PORT;
    }
}
