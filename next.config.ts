import type { NextConfig } from "next";

// DEV ONLY (ignored by `next build` / production). In development Next.js rejects the HMR websocket from any host
// not listed here, and without that connection the page never hydrates — so over a LAN address the login form is
// inert and /app bounces back to /login. Instead of one hard-coded IP (which breaks every time the Wi-Fi network
// changes), allow the private address ranges and mDNS names. Wildcards match whole dot-separated segments.
const privateNetworkOrigins = [
  "192.168.*.*", // typical home / office Wi-Fi
  "10.*.*.*",
  ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`), // 172.16.0.0 – 172.31.255.255
  "*.local", // e.g. my-pc.local
];

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: false,
  allowedDevOrigins: privateNetworkOrigins,
};

export default nextConfig;
