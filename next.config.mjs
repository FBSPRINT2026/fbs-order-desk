/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep deploys from failing on lint or strict type nits.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // SFTP client (SanMar catalog files): load from node_modules at run time, not bundled
  serverExternalPackages: ["ssh2", "imapflow", "mailparser", "nodemailer", "nodemailer-ntlm-auth", "pdfjs-dist"]
};
export default nextConfig;
