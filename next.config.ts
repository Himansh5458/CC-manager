import type { NextConfig } from "next";

// --- GitHub Codespaces / proxied-dev Server Actions fix ---------------------
// In Codespaces the app is reached through a forwarded host
// (`https://<codespace>-<port>.app.github.dev`), but the request that reaches
// the Next.js server has MISMATCHED host-identifying headers:
//   - `x-forwarded-host`: glowing-waddle-...-3000.app.github.dev  (rewritten by the proxy)
//   - `origin`:           http://localhost:3000                   (NOT rewritten by the proxy)
// Next's Server Actions CSRF check (action-handler.js `handleAction`) compares
// the *origin* host against the *forwarded* host and, on mismatch, consults the
// `allowedOrigins` list. Crucially it tests `isCsrfOriginAllowed(originHost, ...)`
// — i.e. it matches the allowlist against the ORIGIN header's host
// (`localhost:3000`), NOT against the forwarded domain. So whitelisting
// `*.app.github.dev` never matches and the action aborts with E80
// "Invalid Server Actions request." The allowlist must contain the literal
// origin host the browser actually sends: `localhost:3000`.
// (See node_modules/next/dist/server/app-render/action-handler.js:385-413 and
// .../csrf-protection.js `isCsrfOriginAllowed`.)
//
// Keyed off the Codespaces env var so it's ONLY present in that dev
// environment — on Vercel that var is absent, the list is empty, and the
// default strict same-origin behaviour is unchanged. We keep the forwarded
// domain wildcard too, to stay correct under any proxy/browser config that DOES
// pass the real domain through as the Origin.
const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
const allowedOrigins = forwardingDomain
  ? [`*.${forwardingDomain}`, "localhost:3000", "127.0.0.1:3000"]
  : [];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins,
    },
  },
};

export default nextConfig;
