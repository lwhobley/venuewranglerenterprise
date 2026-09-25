import assert from 'node:assert/strict';
import test from 'node:test';
import { pinnedVersionVariables, requiredVariables, validateDeployConfig } from './validate-deploy-config.mjs';

function completeConfiguration() {
  const environment = Object.fromEntries(requiredVariables.map((name) => [name, 'configured-value']));
  for (const name of pinnedVersionVariables) environment[name] = '12';
  return environment;
}

test('accepts complete deployment configuration with pinned positive secret versions', () => {
  assert.deepEqual(validateDeployConfig(completeConfiguration()), []);
});

test('reports missing required repository variables by name', () => {
  const environment = completeConfiguration();
  delete environment.GCP_PROJECT_ID;

  assert.deepEqual(validateDeployConfig(environment), [
    'Missing required production repository variable: GCP_PROJECT_ID',
  ]);
});

test('rejects latest, zero, and non-numeric Secret Manager versions', () => {
  for (const invalid of ['latest', '0', '1/latest']) {
    const environment = completeConfiguration();
    environment.DATABASE_URL_SECRET_VERSION = invalid;

    assert.deepEqual(validateDeployConfig(environment), [
      'Production secret version must be a pinned positive integer: DATABASE_URL_SECRET_VERSION',
    ]);
  }
});
