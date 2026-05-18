import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  async rewrites() {
    const baseURL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';
    return [
      {
        // When your frontend calls /api/anything...
        source: '/api/:path*',
        // ...Next.js will silently forward it to your Cloud Run backend
        destination: `${baseURL}/api/:path*`,
      },
      {
        source: '/upload/:path*',
        destination: `${baseURL}/upload/:path*`,
      },
      {
        source: '/search/:path*',
        destination: `${baseURL}/search/:path*`,
      },
      {
        source: '/file/:path*',
        destination: `${baseURL}/file/:path*`,
      }
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**', // This allows all paths under this hostname
      },
    ],
  },
};

export default nextConfig;
