// Pruebas del portal en un navegador de verdad (Chromium), contra un
// servidor y una base de datos locales. No tocan producción.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'pruebas',
  // Comparten la base local: van de a una, en orden
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5500', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' },
  webServer: [
    { command: 'node pruebas/servidor-local.mjs', url: 'http://127.0.0.1:8787/?action=novedades', timeout: 120000, reuseExistingServer: false },
    { command: 'node pruebas/servir-portal.mjs', url: 'http://127.0.0.1:5500/', reuseExistingServer: false },
  ],
});
