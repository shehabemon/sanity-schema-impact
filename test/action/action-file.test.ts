import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseActionFile } from './parse-action.js';

const text = await readFile(fileURLToPath(new URL('../../action.yml', import.meta.url)), 'utf8');
const action = parseActionFile(text);
const stepNames = action.steps.map((step) => step.name);

describe('action.yml', () => {
  it('declares the inputs with the defaults the README documents', () => {
    const defaults = Object.fromEntries(action.inputs.map((input) => [input.name, input.default]));

    expect(defaults).toEqual({
      studio: undefined,
      base: '',
      'fail-on': '',
      'skip-validation': 'false',
      install: 'false',
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
      'Build the schema impact CLI',
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

  it('installs only the root package when it builds the CLI, not the Studio workspace', () => {
    const build = action.steps.find((step) => step.name === 'Build the schema impact CLI');

    expect(build?.run).toContain('pnpm install --frozen-lockfile --filter sanity-schema-impact');
    expect(build?.run).not.toMatch(/pnpm install --frozen-lockfile\s*$/m);
  });

  it('passes the pull request head commit through the step environment', () => {
    const check = action.steps.find((step) => step.name === 'Run the schema impact check');

    expect(check?.env['HEAD_SHA']).toBe('${{ github.event.pull_request.head.sha }}');
    expect(check?.run).not.toContain('github.event');
  });

  it('passes the comment token through the step environment', () => {
    const comment = action.steps.find((step) => step.name === 'Comment on the pull request');

    expect(comment?.env['GITHUB_TOKEN']).toBe('${{ inputs.github-token }}');
  });
});
