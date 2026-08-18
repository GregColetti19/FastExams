/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
  eslint: {
    // Lint does not gate the deploy. An unused variable is a style problem, and
    // letting one fail a production build means a cosmetic issue can block a
    // fix from shipping. Type errors still fail the build (see typescript
    // below), and `npm run lint` still reports everything in CI and locally.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Explicitly NOT ignored: a type error is a real defect and must fail the
    // build. This mirrors the eslint block above so the difference is a
    // deliberate choice rather than an oversight.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
