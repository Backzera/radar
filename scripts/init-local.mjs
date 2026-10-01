import { initializeLocal } from "./local-config.mjs";
const result = initializeLocal(process.cwd());
console.log(
  result.created
    ? "Configuração local criada."
    : `Configuração preservada; ${result.added} opções adicionadas.`,
);
console.log(
  result.tokenGenerated
    ? "WORKER_TOKEN gerado: sim (valor não exibido)."
    : "WORKER_TOKEN existente preservado. npm run doctor verifica sua configuração.",
);
console.log("Nenhum provider externo foi ativado.");
