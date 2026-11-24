import fs from 'node:fs';
import path from 'node:path';
import { scenarioSchema, type Scenario } from '@rehearsal/shared';

export interface ScenarioLoadError {
  file: string;
  message: string;
}

export interface ScenarioStore {
  get(id: string): Scenario | undefined;
  list(): readonly Scenario[];
  count(): number;
}

export interface ScenarioLoadResult {
  store: ScenarioStore;
  errors: readonly ScenarioLoadError[];
  /** Set when the folder is missing or holds no .json files. */
  warning: string | null;
}

export function createScenarioStore(scenarios: readonly Scenario[]): ScenarioStore {
  const frozen = Object.freeze([...scenarios]);
  const byId = new Map(frozen.map((s) => [s.id, s]));
  return {
    get: (id) => byId.get(id),
    list: () => frozen,
    count: () => frozen.length,
  };
}

function describeIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`).join('; ');
}

function parseFile(filePath: string): Scenario | ScenarioLoadError {
  const file = path.basename(filePath);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error: unknown) {
    return { file, message: `not valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  const parsed = scenarioSchema.safeParse(raw);
  if (!parsed.success) return { file, message: describeIssues(parsed.error.issues) };
  const expected = path.basename(file, '.json');
  if (parsed.data.id !== expected) {
    return { file, message: `id "${parsed.data.id}" does not match the filename "${expected}"` };
  }
  return parsed.data;
}

/** Read and validate every *.json in dir. Invalid files are reported and skipped; never throws. */
export function loadScenarioDir(dir: string): ScenarioLoadResult {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { store: createScenarioStore([]), errors: [], warning: `scenario folder not found: ${dir}` };
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort();
  if (files.length === 0) {
    return { store: createScenarioStore([]), errors: [], warning: `no scenario files in ${dir}` };
  }
  const scenarios: Scenario[] = [];
  const errors: ScenarioLoadError[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const result = parseFile(path.join(dir, file));
    if ('message' in result) {
      errors.push(result);
    } else if (seen.has(result.id)) {
      errors.push({ file, message: `duplicate scenario id "${result.id}"` });
    } else {
      seen.add(result.id);
      scenarios.push(result);
    }
  }
  return { store: createScenarioStore(scenarios), errors, warning: null };
}

let activeStore: ScenarioStore = createScenarioStore([]);

/** Load the folder into the process-wide store, logging every problem by filename. */
export function initScenarios(dir: string): ScenarioLoadResult {
  const result = loadScenarioDir(dir);
  if (result.warning) console.warn(`[scenarios] ${result.warning}`);
  for (const err of result.errors) {
    console.error(`[scenarios] INVALID ${err.file}: ${err.message} (skipped)`);
  }
  console.info(`[scenarios] loaded ${result.store.count()} scenario(s) from ${dir}`);
  activeStore = result.store;
  return result;
}

export function getScenarioStore(): ScenarioStore {
  return activeStore;
}

export function getScenario(id: string): Scenario | undefined {
  return activeStore.get(id);
}

export function listScenarios(): readonly Scenario[] {
  return activeStore.list();
}
