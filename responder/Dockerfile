# syntax=docker/dockerfile:1

# --- Build stage -------------------------------------------------------------
FROM golang:1.22-alpine AS build
WORKDIR /src

# Cache module downloads (no external deps, but keeps layers stable).
COPY go.mod ./
RUN go mod download

COPY . .

# Build a fully static, stripped binary for a scratch/distroless base.
ENV CGO_ENABLED=0 GOOS=linux
RUN go build -trimpath -ldflags="-s -w" -o /responder .

# --- Runtime stage -----------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /
COPY --from=build /responder /responder

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/responder"]
