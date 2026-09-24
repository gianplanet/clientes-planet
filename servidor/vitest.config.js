// Pruebas del servidor: corren dentro del mismo motor que usa Cloudflare,
// con una base de datos local vacía a la que se le aplican las migraciones.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const aca = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: path.join(aca, 'wrangler.toml') },
      miniflare: { bindings: { MIGRACIONES: await readD1Migrations(path.join(aca, 'migrations')) } },
    }),
  ],
  test: {
    root: aca,
    include: ['test/**/*.test.js'],
    setupFiles: ['test/preparar.js'],
  },
}));
