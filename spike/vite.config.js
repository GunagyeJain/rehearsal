export default {
  server: {
    port: 5174,
    // Fail loudly rather than silently sliding to 5175 and leaving you on a
    // stale tab pointed at a dead instance.
    strictPort: true,
    proxy: { '/api': 'http://localhost:3001' },
  },
};
