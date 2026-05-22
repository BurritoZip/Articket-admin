/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["playwright-core", "playwright", "chromium-bidi"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Playwright는 런타임에만 필요 — 빌드 시 번들에서 제외
      const playwright = ["playwright-core", "playwright", "chromium-bidi"];
      if (Array.isArray(config.externals)) {
        config.externals.push(...playwright);
      } else {
        config.externals = [config.externals, ...playwright].filter(Boolean);
      }
    }
    return config;
  },
};

export default nextConfig;
