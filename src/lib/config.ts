import { existsSync, readFileSync } from 'fs';
import { configPath } from './paths.js';

export interface TrivialThreshold {
  max_lines: number;
  ignore_patterns: string[];
}

export interface PushbackConfig {
  trivial_threshold: TrivialThreshold;
  override_env_var: string;
}

export const DEFAULT_CONFIG: PushbackConfig = {
  trivial_threshold: {
    max_lines: 5,
    ignore_patterns: [
      '*.lock',
      '*.lockb',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      '*.generated.*',
    ],
  },
  override_env_var: 'PUSHBACK_OVERRIDE',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.every((entry) => typeof entry === 'string') ? (value as string[]) : fallback;
}

function nonNegativeNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function nonEmptyStringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

/**
 * Read the config field by field, keeping the default for anything that is
 * missing or the wrong type.
 *
 * A config that has drifted — hand-edited, half-migrated, written by an older
 * version — must not take the gate down with it. The hook runs on every push,
 * so "fall back and keep working" beats "refuse to run".
 */
export function parseConfig(raw: unknown): PushbackConfig {
  if (!isRecord(raw)) return { ...DEFAULT_CONFIG };

  const threshold = isRecord(raw.trivial_threshold) ? raw.trivial_threshold : {};
  return {
    trivial_threshold: {
      max_lines: nonNegativeNumberOr(
        threshold.max_lines,
        DEFAULT_CONFIG.trivial_threshold.max_lines
      ),
      ignore_patterns: stringArrayOr(
        threshold.ignore_patterns,
        DEFAULT_CONFIG.trivial_threshold.ignore_patterns
      ),
    },
    override_env_var: nonEmptyStringOr(raw.override_env_var, DEFAULT_CONFIG.override_env_var),
  };
}

export function loadConfig(): PushbackConfig {
  const cfgPath = configPath();
  if (!existsSync(cfgPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    return parseConfig(JSON.parse(readFileSync(cfgPath, 'utf8')));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
