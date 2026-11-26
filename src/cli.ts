#!/usr/bin/env node
import { defaultDeps, runCli } from './cli/run.js';

process.exitCode = await runCli(process.argv.slice(2), defaultDeps());
