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
  type ValidateStudioOptions,
  type ValidationComparison,
  type ValidationRun,
} from './validation/run.js';
export {
  runCommand,
  type CommandOptions,
  type CommandResult,
  type CommandRunner,
} from './adapters/process.js';
export { createSanityReader, type SanityReader } from './adapters/sanity.js';
export {
  addWorktree,
  currentRef,
  removeWorktree,
  repoRoot,
  resolveSha,
  type GitContext,
} from './adapters/git.js';
export { extractSchema, runValidation, sanityBinary } from './adapters/sanity-cli.js';
export { buildReport, type Report, type ReportInput } from './report/model.js';
export { toJson } from './report/json.js';
export { toMarkdown } from './report/markdown.js';
export { toTable } from './report/table.js';
export { DEFAULT_FAIL_ON, evaluate, parseFailOn, type FailRule } from './report/fail-on.js';
export { runPipeline, type PipelineOptions } from './pipeline.js';
export { createCleanup, cleanOnSignal, type Cleanup } from './cleanup.js';
