import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const apiOrigin = process.env.API_ORIGIN;

    // No rewrite until API_ORIGIN is set. A rewrite to `undefined` would turn
    // every /api/* request into a build error, and this config is evaluated
    // during `next build` -- including on Vercel, where the variable may not be
    // configured yet. An API-less build has to keep working.
    if (!apiOrigin) return [];

    // Proxying /api/* rather than calling the backend cross-origin is what keeps
    // the session cookie same-origin. From the browser, the request goes to the
    // frontend's own host and Next forwards it, so there is no cross-site cookie
    // and no SameSite=None relaxation is needed.
    //
    // This is also why the backend's CORS middleware is development-only.
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
