#!/usr/bin/env node
import { VERSION } from './version.js';

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(VERSION);
} else {
  console.log(`sanity-schema-impact ${VERSION} (CLI not implemented yet)`);
}
