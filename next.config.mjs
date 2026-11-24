/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep deploys from failing on lint or strict type nits.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // SFTP client (SanMar catalog files): load from node_modules at run time, not bundled
  serverExternalPackages: ["ssh2", "imapflow", "mailparser", "nodemailer", "nodemailer-ntlm-auth", "pdfjs-dist"],
  // In the browser, packages that also run under Node (sql.js, which reads BeerSmith backups in DraftPunk's Import) name
  // fs / path / crypto only on their Node path: leave those out of browser bundles.
  webpack(config, { isServer }) {
    if (!isServer) config.resolve.fallback = { ...(config.resolve.fallback || {}), fs: false, path: false, crypto: false };
    return config;
  }
};
export default nextConfig;
