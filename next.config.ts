import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ["ws", "@whiskeysockets/baileys"],
};

export default nextConfig;
