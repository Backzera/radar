import type { providerSetup } from "../server/provider-setup";
export function ProviderSetupChecklist({
  setup,
  validated,
  collectionVerified,
  hasMonitor,
  methods,
}: {
  setup: ReturnType<typeof providerSetup>;
  validated: boolean;
  collectionVerified: boolean;
  hasMonitor: boolean;
  methods?: { keyword: boolean; search_url: boolean };
}) {
  const checks: [string, boolean][] = [
    ["API Key Bright Data", setup.apiKeyConfigured],
    ["Dataset", setup.datasetConfigured],
    ["Confirmação de uso", setup.rightsConfirmed],
    ["Última validação da configuração", setup.ready && validated],
    ["Primeira coleta real", collectionVerified],
    ["Primeiro monitor Facebook", hasMonitor],
  ];
  return (
    <section className="setup-checklist" aria-label="Próximo passo">
      <h3>Próximo passo</h3>
      <ol>
        {checks.map(([label, done]) => (
          <li key={label} className={done ? "setup-done" : ""}>
            <span>{label}</span>
            <span>{done ? "✓ Concluído" : "Pendente"}</span>
          </li>
        ))}
      </ol>
      <div className="setup-contracts">
        <span>
          Dataset<strong>{setup.datasetId ?? "Ausente ou inválido"}</strong>
        </span>
        {(["keyword", "search_url"] as const).map((method) => (
          <span key={method}>
            {method === "keyword" ? "Palavra-chave" : "Search URL"}
            <strong>
              {!setup.ready || !methods
                ? "Aguardando validação"
                : methods[method]
                  ? "Disponível"
                  : "Não disponível"}
            </strong>
          </span>
        ))}
      </div>
      {!setup.apiKeyConfigured && (
        <div className="setup-guide">
          <strong>Para receber anúncios reais</strong>
          {setup.local ? (
            <p>
              Crie uma API Key na Bright Data, coloque em{" "}
              <code>BRIGHTDATA_API_KEY</code> no arquivo <code>.dev.vars</code>{" "}
              e reinicie o servidor. Volte aqui e clique em Validar
              configuração.
            </p>
          ) : (
            <p>
              Configure BRIGHTDATA_API_KEY nos secrets do servidor. A chave
              permanece no backend; não a envie pelo navegador.
            </p>
          )}
        </div>
      )}
      {!setup.rightsConfirmed && (
        <p className="small-note">
          Confirmação de uso pendente: altere{" "}
          <code>FACEBOOK_DATA_RIGHTS_CONFIRMED</code> para <code>true</code>{" "}
          somente depois de revisar os termos/licenças aplicáveis.
        </p>
      )}
      <p className="small-note">
        Após alterar a configuração, reinicie servidor e worker e valide
        novamente. O checklist registra a última verificação.
      </p>
    </section>
  );
}
