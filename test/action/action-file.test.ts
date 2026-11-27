import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseActionFile } from './parse-action.js';

const text = await readFile(fileURLToPath(new URL('../../action.yml', import.meta.url)), 'utf8');
const action = parseActionFile(text);
const stepNames = action.steps.map((step) => step.name);
const packageJson = JSON.parse(
  await readFile(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { version: string };

describe('action.yml', () => {
  it('keeps the description under the Marketplace limit of 125 characters', () => {
    const description = /^description: (.+)$/m.exec(text)?.[1] ?? '';

    expect(description).not.toBe('');
    expect(description.length).toBeLessThan(125);
  });

  it('declares the inputs with the defaults the README documents', () => {
    const defaults = Object.fromEntries(action.inputs.map((input) => [input.name, input.default]));

    expect(defaults).toEqual({
      studio: undefined,
      base: '',
      'fail-on': '',
      'skip-validation': 'false',
      install: 'false',
      'pass-env': '',
      comment: 'true',
      'github-token': '${{ github.token }}',
    });
    expect(action.inputs.find((input) => input.name === 'studio')?.required).toBe(true);
  });

  it('takes no Sanity secret as an input, so tokens never pass through with:', () => {
    const names = action.inputs.map((input) => input.name);

    expect(names.some((name) => /sanity|token/i.test(name) && name !== 'github-token')).toBe(false);
  });

  it('never interpolates an input or any expression inside a run script', () => {
    for (const step of action.steps) {
      if (step.run !== undefined) {
        expect(step.run, step.name).not.toContain('${{ inputs.');
        expect(step.run, step.name).not.toContain('${{');
      }
    }
  });

  it('checks the token gate before any later step runs', () => {
    expect(stepNames.indexOf('Check the Sanity token')).toBe(0);
    for (const step of action.steps.slice(1)) {
      expect(step.if, step.name).toContain("steps.gate.outputs.run == 'true'");
    }
  });

  it('runs the steps in the documented order', () => {
    expect(stepNames).toEqual([
      'Check the Sanity token',
      'Set up Node',
      'Resolve the base branch',
      'Install the schema impact CLI',
      'Install Studio dependencies',
      'Run the schema impact check',
      'Add the report to the job summary',
      'Comment on the pull request',
      'Exit with the check result',
    ]);
  });

  it('keeps the comment step from failing the job, so the check result still gates', () => {
    const comment = action.steps.find((step) => step.name === 'Comment on the pull request');

    expect(comment?.continueOnError).toBe(true);
  });

  it('installs the CLI from npm at the version pinned in package.json', () => {
    const install = action.steps.find((step) => step.name === 'Install the schema impact CLI');

    expect(install?.env['CLI_VERSION']).toBe(packageJson.version);
    expect(install?.run).toContain('npm install --prefix "$prefix"');
    expect(install?.run).toContain('"sanity-schema-impact@$CLI_VERSION"');
    expect(install?.run).not.toContain('pnpm');
  });

  it('runs the CLI from the install step output and never from the action directory', () => {
    const check = action.steps.find((step) => step.name === 'Run the schema impact check');
    const comment = action.steps.find((step) => step.name === 'Comment on the pull request');

    for (const step of [check, comment]) {
      expect(step?.env['CLI'], step?.name).toBe('${{ steps.install.outputs.cli }}');
      expect(step?.run, step?.name).not.toContain('dist/cli.js');
    }
  });

  it('passes the pull request head commit through the step environment', () => {
    const check = action.steps.find((step) => step.name === 'Run the schema impact check');

    expect(check?.env['HEAD_SHA']).toBe('${{ github.event.pull_request.head.sha }}');
    expect(check?.run).not.toContain('github.event');
  });

  it('passes pass-env through the step environment and never inside the script', () => {
    const check = action.steps.find((step) => step.name === 'Run the schema impact check');

    expect(check?.env['PASS_ENV']).toBe('${{ inputs.pass-env }}');
    expect(check?.run).toContain('--pass-env "$PASS_ENV"');
  });

  it('passes the comment token through the step environment', () => {
    const comment = action.steps.find((step) => step.name === 'Comment on the pull request');

    expect(comment?.env['GITHUB_TOKEN']).toBe('${{ inputs.github-token }}');
  });
});
