// Pruebas del portal en navegadores de verdad, contra un servidor y una base
// de datos locales. No tocan producción.
//
//   npm run test:portal  → computadora (Chrome) + celulares (iPhone y Android)
//
// Los celulares se simulan con el tamaño, el toque y la identificación de cada
// teléfono, pero sobre el motor de Chrome: los de Safari y Firefox no arrancan
// en esta computadora. Lo propio de Safari hay que mirarlo en un iPhone de verdad.
import { defineConfig, devices } from '@playwright/test';

const ESCRITORIO = ['portal.spec.js', 'torpe.spec.js'];
const CELULAR = ['celular.spec.js'];

export default defineConfig({
  testDir: 'pruebas',
  // Comparten la base local: van de a una, en orden
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5500', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' },
  projects: [
    { name: 'chrome', testMatch: ESCRITORIO, use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone', testMatch: CELULAR, use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'android', testMatch: CELULAR, use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'node pruebas/servidor-local.mjs', url: 'http://127.0.0.1:8787/?action=novedades', timeout: 120000, reuseExistingServer: false },
    { command: 'node pruebas/servir-portal.mjs', url: 'http://127.0.0.1:5500/', reuseExistingServer: false },
  ],
});
