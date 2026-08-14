import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  /**
   * A production build writes over the same `.next` the dev server is serving
   * from, which leaves the running app throwing "Cannot find module" until it is
   * restarted. Pointing a verification build at its own directory
   * (`NEXT_DIST_DIR=.next-verify npm run build`) makes it safe to check that the
   * app compiles for production while someone is still using the dev server.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL ?? 'http://localhost:3000'}/api/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
