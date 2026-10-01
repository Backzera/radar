// Only public status flags leave the server; never return credential values.
export function providerSetup(
  env: Record<string, string | undefined>,
  local: boolean,
) {
  const dataset = env.BRIGHTDATA_DATASET_ID?.trim() ?? "";
  const apiKeyConfigured = !!env.BRIGHTDATA_API_KEY?.trim();
  const datasetConfigured = /^gd_[a-zA-Z0-9]+$/.test(dataset);
  const rightsConfirmed = env.FACEBOOK_DATA_RIGHTS_CONFIRMED === "true";
  return {
    apiKeyConfigured,
    datasetConfigured,
    datasetId: datasetConfigured ? dataset : null,
    rightsConfirmed,
    local,
    ready: apiKeyConfigured && datasetConfigured && rightsConfirmed,
  };
}
