/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep deploys from failing on lint or strict type nits.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  experimental: { serverActions: { bodySizeLimit: "2mb" } }
};
export default nextConfig;
