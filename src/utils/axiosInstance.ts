import axios, { AxiosInstance } from "axios";
import http from "http";
import https from "https";

// 🔥 HTTP AGENT — TUNED FOR API GATEWAY
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,     // Keep socket alive 1s
  maxSockets: 1000,         // 🔥 Gateway MUST be high
  maxFreeSockets: 200,      // Free socket pool
  scheduling: "lifo",       // Reuse hottest socket (Node18+)
  timeout: 0,               // No socket timeout
  // freeSocketTimeout: 30000, // Close idle socket after 30s
  noDelay: true,            // Disable Nagle (reduce latency)
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 1000,
  maxFreeSockets: 200,
  scheduling: "lifo",
  timeout: 0,
  // freeSocketTimeout: 30000,
  noDelay: true,
});

// 🔥 AXIOS INSTANCE
const axiosInstance: AxiosInstance = axios.create({
  httpAgent,
  httpsAgent,

  timeout: 0, // ❗ Gateway MUST disable timeout (streaming, upload, AI, etc)

  maxBodyLength: Infinity,
  maxContentLength: Infinity,

  // ❗ IMPORTANT FOR PROXY
  decompress: true, // Let Nginx/CDN handle compression
  transitional: {
    clarifyTimeoutError: true,
  },
});

export default axiosInstance;