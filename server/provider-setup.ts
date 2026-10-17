// Only public status flags leave the server; never return credential values.
// Fonte própria: a prontidão depende do SCRAPER_URL (microserviço de scraping),
// não mais de credenciais pagas (Bright Data).
export function providerSetup(
  env: Record<string, string | undefined>,
  local: boolean,
) {
  const scraperUrl = env.SCRAPER_URL?.trim() ?? "";
  const scraperConfigured = /^https?:\/\/\S+/.test(scraperUrl);
  return {
    // Mantém as chaves esperadas pela UI de administração, agora refletindo o
    // scraper próprio em vez do provedor pago.
    apiKeyConfigured: scraperConfigured,
    datasetConfigured: scraperConfigured,
    datasetId: scraperConfigured ? "self-scraper" : null,
    rightsConfirmed: true,
    scraperConfigured,
    local,
    ready: scraperConfigured,
  };
}
