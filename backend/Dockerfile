# ============================================================================
# Stage 1 — Build
# ============================================================================
FROM rust:1.82-slim AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml Cargo.toml
COPY src/ src/

# Build in release mode with all optimisations
RUN cargo build --release

# ============================================================================
# Stage 2 — Runtime
# ============================================================================
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
RUN useradd --create-home appuser
USER appuser

WORKDIR /home/appuser

COPY --from=builder /app/target/release/sss-backend /usr/local/bin/sss-backend

EXPOSE 3001

ENV RUST_LOG=sss_backend=info,tower_http=info

CMD ["sss-backend"]
