/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@dcbot/shared', '@dcbot/config', '@dcbot/database'],
  experimental: {
    // pg uses dynamic requires that webpack cannot statically resolve.
    serverComponentsExternalPackages: ['pg'],
  },
  allowedDevOrigins: ['*.e2b.app', 'localhost'],
  output: 'standalone',
  webpack: (config) => {
    // The workspace packages are TypeScript sources that import sibling modules
    // with a .js extension (NodeNext). Teach webpack to resolve those.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
