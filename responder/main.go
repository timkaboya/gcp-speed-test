// Command responder is a tiny, dependency-free HTTP server used to measure
// per-region network latency to Google Cloud from the browser.
//
// Google Cloud has no per-region public storage endpoint (Cloud Storage is a
// global anycast fronted by the Google Front End), so the only reliable way to
// measure per-region latency is to deploy this responder to each region and
// ping its region-pinned Cloud Run URL. Unlike gcping's public endpoints, this
// responder returns permissive CORS and Timing-Allow-Origin headers so the
// browser can read real status and resource-timing details.
package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
)

const maxSizeBytes = 100 * 1024 * 1024 // 100MB cap for the /size download endpoint.

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	region := os.Getenv("REGION")

	mux := http.NewServeMux()
	mux.HandleFunc("/", pingHandler(region))
	mux.HandleFunc("/ping", pingHandler(region))
	mux.HandleFunc("/size", sizeHandler)

	log.Printf("responder listening on :%s (region=%q)", port, region)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// setCommonHeaders applies the CORS and caching headers required by the browser
// speed test on every response.
func setCommonHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "*")
	h.Set("Cache-Control", "no-store")
	h.Set("Timing-Allow-Origin", "*")
}

// pingHandler returns a handler for the latency endpoints. It answers HEAD and
// GET with a tiny body and OPTIONS preflight with 204.
func pingHandler(region string) http.HandlerFunc {
	body := []byte(region)
	if len(body) == 0 {
		body = []byte("ok")
	}
	return func(w http.ResponseWriter, r *http.Request) {
		setCommonHeaders(w)
		switch r.Method {
		case http.MethodOptions:
			w.WriteHeader(http.StatusNoContent)
		case http.MethodHead:
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusOK)
		case http.MethodGet:
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(body)
		default:
			w.Header().Set("Allow", "GET, HEAD, OPTIONS")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

// sizeHandler streams N zero bytes for future download tests. The size is taken
// from the ?bytes= query parameter and capped at maxSizeBytes.
func sizeHandler(w http.ResponseWriter, r *http.Request) {
	setCommonHeaders(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD, OPTIONS")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	n := int64(0)
	if v := r.URL.Query().Get("bytes"); v != "" {
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil || parsed < 0 {
			http.Error(w, "invalid bytes parameter", http.StatusBadRequest)
			return
		}
		n = parsed
	}
	if n > maxSizeBytes {
		n = maxSizeBytes
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(n, 10))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}

	const chunkSize = 32 * 1024
	buf := make([]byte, chunkSize)
	for n > 0 {
		size := int64(chunkSize)
		if n < size {
			size = n
		}
		if _, err := w.Write(buf[:size]); err != nil {
			return
		}
		n -= size
	}
}
