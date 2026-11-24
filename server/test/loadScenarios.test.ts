import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scenarioSchema } from '@rehearsal/shared';
import { getScenario, initScenarios, listScenarios, loadScenarioDir } from '../src/content/loadScenarios';
import { validScenario } from './fixtures';

let dir: string;

function writeJson(name: string, value: unknown): void {
  fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-scenarios-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('loadScenarioDir', () => {
  it('loads a valid scenario with schema defaults applied', () => {
    writeJson('test-scenario.json', validScenario());
    const result = loadScenarioDir(dir);
    expect(result.errors).toEqual([]);
    expect(result.warning).toBeNull();
    expect(result.store.count()).toBe(1);
    const scenario = result.store.get('test-scenario');
    expect(scenario?.userInputs).toEqual([]);
    expect(scenario?.turns[0]?.dependsOnPreviousAnswer).toBe(false);
  });

  it('reports an invalid file by name and keeps the valid ones', () => {
    writeJson('test-scenario.json', validScenario());
    writeJson('broken.json', { ...validScenario('broken'), difficulty: 9 });
    writeJson('not-json.json', '{ nope');
    const result = loadScenarioDir(dir);
    expect(result.store.count()).toBe(1);
    expect(result.errors.map((e) => e.file).sort()).toEqual(['broken.json', 'not-json.json']);
    expect(result.errors.find((e) => e.file === 'broken.json')?.message).toContain('difficulty');
    expect(result.errors.find((e) => e.file === 'not-json.json')?.message).toContain('not valid JSON');
  });

  it('rejects a file whose id does not match its filename', () => {
    writeJson('other-name.json', validScenario('test-scenario'));
    const result = loadScenarioDir(dir);
    expect(result.store.count()).toBe(0);
    expect(result.errors[0]?.message).toContain('does not match the filename');
  });

  it('ignores non-json files', () => {
    fs.writeFileSync(path.join(dir, 'README.md'), '# notes');
    writeJson('test-scenario.json', validScenario());
    expect(loadScenarioDir(dir).store.count()).toBe(1);
  });

  it('tolerates a missing folder with a warning', () => {
    const result = loadScenarioDir(path.join(dir, 'does-not-exist'));
    expect(result.store.count()).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.warning).toContain('not found');
  });

  it('tolerates an empty folder with a warning', () => {
    const result = loadScenarioDir(dir);
    expect(result.store.count()).toBe(0);
    expect(result.warning).toContain('no scenario files');
  });
});

describe('initScenarios', () => {
  it('logs invalid files by name and exposes getScenario / listScenarios', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    writeJson('test-scenario.json', validScenario());
    writeJson('bad.json', { id: 'bad' });
    initScenarios(dir);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bad.json'));
    expect(getScenario('test-scenario')?.title).toBe('Test scenario');
    expect(getScenario('bad')).toBeUndefined();
    expect(listScenarios()).toHaveLength(1);
  });
});

describe('repository content', () => {
  it('fixture stays valid against the shared schema', () => {
    expect(scenarioSchema.safeParse(validScenario()).success).toBe(true);
  });
});
