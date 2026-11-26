export { VERSION } from './version.js';
export { normalise } from './diff/normalise.js';
export { diffSchemas } from './diff/classify.js';
export type { Change, ChangeKind, FieldInfo, FieldKind, NormalisedSchema } from './diff/types.js';
export { parseValidationOutput, type Marker, type MarkerLevel } from './validation/markers.js';
export {
  diffMarkers,
  documentKind,
  groupMarkers,
  type DocumentKind,
  type MarkerDiff,
  type MarkerGroup,
} from './validation/diff.js';
export {
  compareValidation,
  validateStudio,
  type CommandRunner,
  type ValidateStudioOptions,
  type ValidationComparison,
  type ValidationRun,
} from './validation/run.js';
export { runCommand, type CommandOptions, type CommandResult } from './adapters/process.js';
export { createSanityReader, type SanityReader } from './adapters/sanity.js';
