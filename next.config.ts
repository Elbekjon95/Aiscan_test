import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', 'mammoth', 'mongoose', 'bcryptjs', 'jszip'],
};

export default nextConfig;
