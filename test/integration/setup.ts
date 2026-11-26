import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Vitest does not read .env itself. Variables already set in the environment win.
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
