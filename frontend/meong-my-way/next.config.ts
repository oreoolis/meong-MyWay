import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack doesn't pick up an unrelated
  // package-lock.json further up the filesystem.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
