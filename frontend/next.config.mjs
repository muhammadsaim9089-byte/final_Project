/** @type {import('next').NextConfig} */
const nextConfig = {
  compiler: {
    styledComponents: true,
  },
  experimental: {
    // runs src/instrumentation.ts at server start (cache warm-up); built in from Next 15
    instrumentationHook: true,
  },
};

export default nextConfig;
