import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './migrate.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, pool, hub } = await buildApp(config);

  // La base peut démarrer après l'API (redémarrage de la tour) : on patiente au lieu d'échouer.
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate(pool, path.resolve(config.MIGRATIONS_DIR), (m) => app.log.info(m));
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      app.log.warn({ err }, `Base indisponible, nouvel essai dans 2 s (${attempt}/30)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  await hub.start();
  await app.listen({ port: config.PORT, host: config.HOST });

  const shutdown = async (signal: string) => {
    app.log.info(`Signal ${signal} reçu, arrêt propre`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
