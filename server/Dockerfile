# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM maven:3.9-eclipse-temurin-17 AS builder

WORKDIR /build

# Cache dependencies first (layer cache friendly)
COPY pom.xml .
RUN mvn dependency:go-offline -q

# Build fat-jar
COPY src ./src
RUN mvn clean package -q -DskipTests

# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-alpine

LABEL maintainer="PartyHazz Team"
LABEL description="PartyHazz WebSocket relay server"

WORKDIR /app

# Copy fat-jar from build stage
COPY --from=builder /build/target/partyhazz-server.jar partyhazz-server.jar

# Create logs directory
RUN mkdir -p logs

# Expose default port (override with PORT env var)
EXPOSE 8080

ENV PORT=8080

# Create a non-root user and group
RUN addgroup -S partyhazz && adduser -S partyhazz -G partyhazz
RUN chown -R partyhazz:partyhazz /app

# Switch to the non-root user
USER partyhazz

# Run the server
ENTRYPOINT ["java", "-jar", "partyhazz-server.jar"]
