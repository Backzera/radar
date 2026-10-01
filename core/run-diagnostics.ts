/** Text diagnostics never include raw payloads, credentials, URLs or stack traces. */
export function safeDiagnosticText(
  value: unknown,
  secrets: string[] = [],
): string {
  if (typeof value !== "string") return "";
  let text = value.slice(0, 4000);
  for (const secret of secrets) {
    if (secret.length >= 4) text = text.split(secret).join("[segredo omitido]");
  }
  return text
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [omitido]")
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|worker[_-]?token|secret|password|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,
      "credencial=[omitida]",
    )
    .replace(/https?:\/\/[^\s<>]+/gi, "[URL omitida]")
    .replace(/\b[A-Za-z0-9_+/=-]{40,}\b/g, "[valor omitido]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[e-mail omitido]")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .slice(0, 500);
}

/** A customer's error is actionable without leaking operator-only information. */
export function runFailureAdvice(raw: unknown) {
  let error: { message?: unknown; phase?: unknown; code?: unknown } = {};
  try {
    error = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
  } catch {
    /* Legacy diagnostics may not be JSON. */
  }
  if (!error || typeof error !== "object") error = {};
  const technical = safeDiagnosticText(error.message);
  const message = technical.toLowerCase();
  const phase = ["preflight", "trigger", "poll"].includes(String(error.phase))
    ? String(error.phase)
    : null;
  let summary = "A busca não foi concluída.",
    action = "Consulte o diagnóstico desta execução antes de tentar novamente.";
  if (error.code === "native_filters_unconfirmed") {
    summary = "Os filtros escolhidos ainda precisam de confirmação na fonte.";
    action =
      "Abra Administração → Filtros da busca e confirme período e unidade do raio. Nenhuma coleta com critérios diferentes será enviada.";
  } else if (/informe city|city.*obrigat/.test(message)) {
    summary = "A cidade não foi recebida pela fonte de dados.";
    action =
      "Confira a cidade em Revisar critérios. O envio da cidade de buscas antigas foi corrigido nesta atualização.";
  } else if (/contrato.*mudou|fingerprint/.test(message)) {
    summary = "A configuração da fonte mudou desde que esta busca foi salva.";
    action =
      "A administração deve validar a fonte novamente; depois revise e salve os critérios antes de buscar.";
  } else if (/api key|http 401|credencial.*aceita/.test(message)) {
    summary = "A fonte não aceitou a configuração de acesso.";
    action =
      "A administração deve conferir a chave da fonte no servidor e reiniciá-lo. Não publique a chave.";
  } else if (/http 403|acesso ao recurso/.test(message)) {
    summary = "O acesso a esta fonte não foi autorizado pelo fornecedor.";
    action = "Confira as permissões da conta e do dataset na administração.";
  } else if (/sem confirmação|incerto|sem snapshot_id/.test(message)) {
    summary = "Não foi possível confirmar se a fonte iniciou a coleta.";
    action =
      "Não repita a coleta. A administração deve conferir a execução na Bright Data para evitar consumo duplicado.";
  } else if (/http 429|limite diário|limite do provider/.test(message)) {
    summary = "O limite de uso impediu esta tentativa.";
    action =
      "Aguarde a renovação indicada pela cota ou pelo fornecedor; não aumente o limite para corrigir uma falha.";
  } else if (
    /http (400|422)|valor.*inválido|informe |obrigat|campo.*contrato/.test(
      message,
    )
  ) {
    summary = "A fonte recusou os critérios desta busca.";
    action =
      "Revise os critérios. A administração pode consultar abaixo o motivo e a etapa da falha.";
  } else if (/contrato|método|dataset/.test(message)) {
    summary = "A configuração desta fonte precisa de revisão.";
    action =
      "Use Administração → Validar configuração, sem coleta. Uma validação não inicia busca paga.";
  } else if (/timeout|http (500|502|503|504)|temporariamente/.test(message)) {
    summary = "A fonte não respondeu nesta tentativa.";
    action =
      "Mantenha o serviço de buscas aberto. Consulte a próxima tentativa antes de solicitar outra coleta.";
  } else if (/snapshot|coleta excedeu/.test(message)) {
    summary = "O resultado da coleta não pôde ser concluído.";
    action =
      "A administração deve conferir o snapshot já solicitado; não dispare outra coleta automaticamente.";
  } else if (/nenhum registro válido/.test(message)) {
    summary =
      "A fonte retornou dados que não puderam ser validados como anúncios.";
    action =
      "Consulte os registros rejeitados no diagnóstico. Isso não comprova ausência de anúncios na região.";
  }
  return { message: summary, action, phase, technical };
}
