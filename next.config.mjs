/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['node:sqlite'],
  // The dev server refuses to serve its client bundles to an unrecognised
  // origin, which silently breaks hydration when the site is shared through a
  // tunnel: pages render but nothing is clickable. Allow the tunnel hosts.
  // Only affects `next dev`; production builds have no such restriction.
  allowedDevOrigins: ['*.trycloudflare.com', '*.ngrok-free.app', '*.loca.lt'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }],
  },
};
export default nextConfig;
