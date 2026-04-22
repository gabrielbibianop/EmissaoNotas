import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb"
    }
  },
  turbopack: {
    resolveAlias: {
      libxmljs2: "./lib/libxmljs2-stub.cjs"
    }
  },
  webpack(config, { isServer }) {
    if (isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        libxmljs2: path.resolve("./lib/libxmljs2-stub.cjs")
      };
    }

    return config;
  }
};

export default nextConfig;
