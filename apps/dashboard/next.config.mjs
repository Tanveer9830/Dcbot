/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@dcbot/shared', '@dcbot/config', '@dcbot/database'],
  allowedDevOrigins: ['*.e2b.app', 'localhost'],
  output: 'standalone',
};

export default nextConfig;
