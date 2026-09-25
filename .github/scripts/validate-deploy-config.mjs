import { fileURLToPath } from 'node:url';

export const requiredVariables = [
  'GCP_PROJECT_ID',
  'GCP_REGION',
  'GCP_WORKLOAD_IDENTITY_PROVIDER',
  'GCP_DEPLOYER_SERVICE_ACCOUNT',
  'GCP_RUNTIME_SERVICE_ACCOUNT',
  'ARTIFACT_REGISTRY_REPOSITORY',
  'CLOUD_RUN_SERVICE',
  'DATABASE_URL_SECRET',
  'DATABASE_URL_SECRET_VERSION',
  'SSO_PROVIDERS_JSON_SECRET',
  'SSO_PROVIDERS_JSON_SECRET_VERSION',
  'SCIM_PROVIDERS_JSON_SECRET',
  'SCIM_PROVIDERS_JSON_SECRET_VERSION',
  'INTEGRATION_PROVIDERS_JSON_SECRET',
  'INTEGRATION_PROVIDERS_JSON_SECRET_VERSION',
  'EVIDENCE_BUCKET',
  'CORS_ORIGINS',
];

export const pinnedVersionVariables = [
  'DATABASE_URL_SECRET_VERSION',
  'SSO_PROVIDERS_JSON_SECRET_VERSION',
  'SCIM_PROVIDERS_JSON_SECRET_VERSION',
  'INTEGRATION_PROVIDERS_JSON_SECRET_VERSION',
];

export function validateDeployConfig(environment) {
  const errors = [];
  for (const name of requiredVariables) {
    if (!environment[name]?.trim()) {
      errors.push(`Missing required production repository variable: ${name}`);
    }
  }
  for (const name of pinnedVersionVariables) {
    if (!/^[1-9][0-9]*$/.test(environment[name] ?? '')) {
      errors.push(`Production secret version must be a pinned positive integer: ${name}`);
    }
  }
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const errors = validateDeployConfig(process.env);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  }
}
