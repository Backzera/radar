import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { BRAND } from "./brand";
import { Logo } from "./logo";
import { withBase } from "./base";

export const LEGAL_UPDATED = "6 de outubro de 2026";

const contact = () =>
  BRAND.supportEmail ? (
    <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>
  ) : (
    "o canal de suporte informado no site"
  );

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="legal">
      <header className="lp-nav scrolled">
        <div className="lp-container">
          <Logo />
          <a className="btn btn-ghost" href={withBase("/")}>
            <ArrowLeft size={16} /> Voltar
          </a>
        </div>
      </header>
      <main className="lp-container legal-body">
        <h1>{title}</h1>
        <p className="muted">Última atualização: {LEGAL_UPDATED}</p>
        {children}
        <p className="legal-links">
          <a href={withBase("/termos")}>Termos de uso</a> · <a href={withBase("/privacidade")}>Política de privacidade</a>
        </p>
      </main>
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Termos de uso">
      <p>
        Estes termos valem para quem usa o {BRAND.name}, um sistema online para controlar estoque, custos, vendas e
        lucro de quem compra e revende produtos usados. Ao criar a conta, você concorda com eles.
      </p>
      <h2>1. Sua conta</h2>
      <p>
        Você é responsável pelos dados que cadastra e por manter a senha em segredo. Use um e-mail que você acessa: é
        por ele que identificamos a conta. Avise o suporte se suspeitar que alguém entrou na sua conta.
      </p>
      <h2>2. Uso permitido</h2>
      <p>
        O sistema serve para organizar o seu negócio. Não é permitido cadastrar produtos de origem ilícita, usar o
        serviço para fraudes, tentar acessar contas de outras pessoas ou sobrecarregar o sistema de propósito. Contas
        que fizerem isso podem ser bloqueadas.
      </p>
      <h2>3. Planos e pagamento</h2>
      <p>
        Os planos e preços estão na página inicial. Enquanto a cobrança online não estiver ativa, o acesso é combinado
        diretamente com a gente. Mudanças de preço serão avisadas com antecedência.
      </p>
      <h2>4. Seus dados</h2>
      <p>
        Os produtos, fotos, custos e vendas que você cadastra são seus. Você pode exportar tudo em planilha a qualquer
        momento pela tela Conta ou Vendas. Como tratamos esses dados está na{" "}
        <a href={withBase("/privacidade")}>Política de privacidade</a>.
      </p>
      <h2>5. Os números do sistema</h2>
      <p>
        Lucro, margem e outros cálculos são feitos a partir do que você digita. Eles ajudam na gestão, mas não
        substituem a contabilidade nem servem como declaração fiscal.
      </p>
      <h2>6. Disponibilidade</h2>
      <p>
        Trabalhamos para manter o sistema no ar e fazemos cópias de segurança diárias, mas pode haver interrupções
        para manutenção ou por falhas de terceiros (internet, servidores).
      </p>
      <h2>7. Encerramento</h2>
      <p>
        Você pode pedir o encerramento da conta quando quiser; os dados são apagados, como explicado na política de
        privacidade. Podemos bloquear contas que descumprirem estes termos.
      </p>
      <h2>8. Contato</h2>
      <p>Dúvidas sobre estes termos: {contact()}.</p>
    </LegalPage>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidade">
      <p>
        Esta política explica quais dados o {BRAND.name} guarda, para quê e quais são os seus direitos, de acordo com a
        Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).
      </p>
      <h2>1. O que guardamos</h2>
      <ul>
        <li>
          <strong>Conta:</strong> nome, e-mail e a senha em forma criptografada (ninguém, nem a administração,
          consegue ver a senha).
        </li>
        <li>
          <strong>O que você cadastra:</strong> produtos, fotos, custos, valores de compra e venda, e o nome de quem
          vendeu ou comprou, se você preencher.
        </li>
        <li>
          <strong>Registro de atividade:</strong> data, hora, endereço IP e navegador de entradas, alterações e
          exportações, para segurança e para resolver problemas.
        </li>
        <li>
          <strong>Cookie:</strong> só o cookie de sessão, que mantém você conectado. Não usamos cookies de propaganda
          nem de rastreamento.
        </li>
      </ul>
      <h2>2. Para que usamos</h2>
      <p>
        Para fazer o sistema funcionar (mostrar o seu estoque, calcular o lucro), proteger a conta, dar suporte e
        cumprir obrigações legais. Não vendemos nem compartilhamos seus dados com anunciantes.
      </p>
      <h2>3. Quem tem acesso</h2>
      <p>
        Você vê só os seus dados. A administração do {BRAND.name} pode consultar contas, produtos e o registro de
        atividade para suporte, segurança e controle do serviço. Os dados ficam em servidor próprio; a Cloudflare
        protege a conexão (https).
      </p>
      <h2>4. Por quanto tempo</h2>
      <p>
        Enquanto a conta existir. Ao excluir a conta, apagamos os produtos, fotos, vendas e o registro de atividade
        dela. Fica apenas o registro de que a exclusão aconteceu, com o e-mail mascarado (ex.: a***@gmail.com). As
        cópias de segurança são apagadas automaticamente em até 14 dias.
      </p>
      <h2>5. Seus direitos</h2>
      <p>
        Você pode pedir acesso, correção, exportação ou exclusão dos seus dados, e tirar dúvidas sobre o tratamento.
        A exportação em planilha já está disponível no sistema. Para os outros pedidos: {contact()}.
      </p>
      <h2>6. Segurança</h2>
      <p>
        Senhas são guardadas com criptografia, a conexão é sempre https, as sessões expiram e o acesso ao servidor é
        restrito. Se acontecer um incidente que afete seus dados, você será avisado.
      </p>
      <h2>7. Mudanças</h2>
      <p>Se esta política mudar, a data no topo é atualizada e mudanças importantes são avisadas no sistema.</p>
    </LegalPage>
  );
}
