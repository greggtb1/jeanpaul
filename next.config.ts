import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "pdfjs-dist", "canvas", "jspdf"],
  // Hébergement mutualisé (Hostinger) : pas de workers parallèles (EAGAIN / EPERM kill)
  experimental: {
    webpackBuildWorker: false,
    cpus: 1,
  },
};

export default nextConfig;
