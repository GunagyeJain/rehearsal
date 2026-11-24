import type { Server } from 'node:http';
import { createApp } from './app';
import { defaultScenariosDir, EnvValidationError, loadEnv, trustProxySetting, type EnvConfig } from './config/env';
import { connectDb, disconnectDb } from './db';
import { initScenarios } from './content/loadScenarios';
import { safeErrorLabel } from './http/safeErrorLabel';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function readConfig(): EnvConfig {
  try {
    return loadEnv();
  } catch (error: unknown) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

function installShutdown(server: Server): void {
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.info(`[server] ${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    force.unref();
    server.close(() => {
      disconnectDb()
        .catch((error: unknown) => console.error(`[db] error during disconnect: ${safeErrorLabel(error)}`))
        .finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function main(): void {
  const config = readConfig();
  initScenarios(defaultScenariosDir(config));

  const app = createApp({
    production: config.NODE_ENV === 'production',
    trustProxy: trustProxySetting(config.TRUST_PROXY),
  });
  const server = app.listen(config.PORT, config.HOST, () => {
    console.info(`[server] listening on http://${config.HOST}:${config.PORT}`);
  });
  installShutdown(server);

  // Listen first so /api/health can report mongo: 'down' while we retry.
  connectDb(config.MONGODB_URI).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

main();
