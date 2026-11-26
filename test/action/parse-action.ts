/**
 * Reads the parts of action.yml the tests need. It handles only the layout this file uses: two
 * spaces for inputs, four for steps, six for step keys, eight for nested maps and block scalars.
 * It is not a YAML parser.
 */

export interface ActionInput {
  readonly name: string;
  readonly required: boolean;
  readonly default: string | undefined;
}

export interface ActionStep {
  readonly name: string;
  readonly id: string | undefined;
  readonly if: string | undefined;
  readonly uses: string | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly run: string | undefined;
  readonly continueOnError: boolean;
}

export interface ActionFile {
  readonly inputs: readonly ActionInput[];
  readonly steps: readonly ActionStep[];
}

interface MutableStep {
  name: string;
  id: string | undefined;
  if: string | undefined;
  uses: string | undefined;
  env: Record<string, string>;
  run: string | undefined;
  continueOnError: boolean;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function newStep(name: string): MutableStep {
  return {
    name,
    id: undefined,
    if: undefined,
    uses: undefined,
    env: {},
    run: undefined,
    continueOnError: false,
  };
}

export function parseActionFile(text: string): ActionFile {
  const inputs: { name: string; required: boolean; default: string | undefined }[] = [];
  const steps: MutableStep[] = [];
  const lines = text.split('\n');

  let section: 'inputs' | 'runs' | 'other' = 'other';
  let inputIndex = -1;
  let step: MutableStep | undefined;
  let subsection: 'env' | 'with' | undefined;
  let block: string[] | undefined;

  const finishBlock = (): void => {
    if (step !== undefined && block !== undefined) {
      step.run = block.join('\n').replace(/\n+$/, '') + '\n';
    }
    block = undefined;
  };

  for (const line of lines) {
    if (block !== undefined) {
      if (line.trim() === '') {
        block.push('');
        continue;
      }
      if (/^ {8}/.test(line)) {
        block.push(line.slice(8));
        continue;
      }
      finishBlock();
    }

    if (/^\S/.test(line)) {
      section = line.startsWith('inputs:') ? 'inputs' : line.startsWith('runs:') ? 'runs' : 'other';
      continue;
    }

    if (section === 'inputs') {
      const key = /^ {2}([a-z][a-z-]*):\s*$/.exec(line);
      if (key?.[1] !== undefined) {
        inputs.push({ name: key[1], required: false, default: undefined });
        inputIndex = inputs.length - 1;
        continue;
      }
      const prop = /^ {4}(required|default):\s?(.*)$/.exec(line);
      const current = inputs[inputIndex];
      if (prop?.[1] !== undefined && current !== undefined) {
        const value = prop[2] ?? '';
        if (prop[1] === 'required') {
          inputs[inputIndex] = { ...current, required: value.trim() === 'true' };
        } else {
          inputs[inputIndex] = { ...current, default: unquote(value) };
        }
      }
      continue;
    }

    if (section !== 'runs') continue;

    const stepStart = /^ {4}- ([a-z][\w-]*):\s?(.*)$/.exec(line);
    if (stepStart?.[1] !== undefined) {
      step = newStep('');
      steps.push(step);
      subsection = undefined;
      applyStepKey(step, stepStart[1], stepStart[2] ?? '');
      if (stepStart[1] === 'run' && (stepStart[2] ?? '').trim() === '|') {
        block = [];
      }
      continue;
    }

    const stepKey = /^ {6}([a-z][\w-]*):\s?(.*)$/.exec(line);
    if (stepKey?.[1] !== undefined && step !== undefined) {
      subsection = stepKey[1] === 'env' || stepKey[1] === 'with' ? stepKey[1] : undefined;
      if (stepKey[1] === 'env' || stepKey[1] === 'with') continue;
      applyStepKey(step, stepKey[1], stepKey[2] ?? '');
      if (stepKey[1] === 'run' && (stepKey[2] ?? '').trim() === '|') {
        block = [];
      }
      continue;
    }

    const nested = /^ {8}([\w-]+):\s?(.*)$/.exec(line);
    if (nested?.[1] !== undefined && step !== undefined && subsection === 'env') {
      step.env[nested[1]] = unquote(nested[2] ?? '');
    }
  }
  finishBlock();

  return {
    inputs,
    steps: steps.map((s) => ({ ...s })),
  };
}

function applyStepKey(step: MutableStep, key: string, rawValue: string): void {
  const value = unquote(rawValue);
  switch (key) {
    case 'name':
      step.name = value;
      break;
    case 'id':
      step.id = value;
      break;
    case 'if':
      step.if = value;
      break;
    case 'uses':
      step.uses = value;
      break;
    case 'run':
      if (rawValue.trim() !== '|') step.run = rawValue.trim();
      break;
    case 'continue-on-error':
      step.continueOnError = value === 'true';
      break;
    default:
      break;
  }
}
