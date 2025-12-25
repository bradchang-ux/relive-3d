import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';
const repoName = 'relive-3d';

const nextConfig: NextConfig = {
  output: 'export',
  // GitHub Pages usually serves at /<repo-name>, so we need a basePath in production
  basePath: isProd ? `/${repoName}` : '',
  // Asset prefix is also needed for static assets to load correctly
  assetPrefix: isProd ? `/${repoName}/` : '',
  images: {
    unoptimized: true,
  },
  /* config options here */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
