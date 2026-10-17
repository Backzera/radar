"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Camera,
  Check,
  Clock,
  FileSpreadsheet,
  Plus,
  Radar,
  ShieldCheck,
  Smartphone,
  Target,
  Wallet,
  Zap,
} from "lucide-react";
import { CATEGORIES, CATEGORY_LABELS, formatCents } from "@/core/brick";
import { Logo } from "./logo";
import { BRAND, PLANS } from "./brand";
import { CATEGORY_ICONS, CountUp, Reveal } from "./ui";
import { withBase } from "./base";

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 12);
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);
  return scrolled;
}

function HeroMock() {
  const cols = [38, 52, 44, 66, 58, 74, 62, 88, 79, 96, 84, 118];
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-main glass gradient-border">
        <div className="mock-head">
          <span>Lucro líquido · este mês</span>
          <span className="delta delta-up">+18%</span>
        </div>
        <div className="mock-value">
          <CountUp value={482000} duration={1600} />
        </div>
        <div className="mock-cols">
          {cols.map((h, i) => (
            <span key={i} style={{ height: `${h}px`, "--i": i } as React.CSSProperties} />
          ))}
        </div>
        <div className="mock-row">
          <div className="mock-stat">
            <small>Vendas</small>
            <strong>14</strong>
          </div>
          <div className="mock-stat">
            <small>Margem</small>
            <strong>21%</strong>
          </div>
          <div className="mock-stat">
            <small>Giro médio</small>
            <strong>9 dias</strong>
          </div>
        </div>
      </div>
      <div className="mock-card sale glass float">
        <span className="mock-thumb">
          <Smartphone size={20} />
        </span>
        <div>
          <strong>iPhone 13 128GB</strong>
          <small>Vendido · 7 dias</small>
        </div>
        <strong className="profit-pos" style={{ marginLeft: 8 }}>
          +{formatCents(42000)}
        </strong>
      </div>
      <div className="mock-card goal glass float" style={{ animationDelay: "-3.5s" }}>
        <span style={{ display: "flex", justifyContent: "space-between" }}>
          <strong>Meta do mês</strong>
          <strong>72%</strong>
        </span>
        <div className="meter-track">
          <div className="meter-fill" style={{ width: "72%", animationDelay: "0.8s" }} />
        </div>
      </div>
      <div className="mock-radar">
        <span className="blip" style={{ left: "62%", top: "28%", animationDelay: "0.3s" }} />
        <span className="blip" style={{ left: "32%", top: "58%", animationDelay: "1.6s" }} />
        <span className="blip" style={{ left: "70%", top: "70%", animationDelay: "2.7s" }} />
      </div>
    </div>
  );
}

const FEATURES_LIST = [
  {
    icon: Wallet,
    title: "Lucro de verdade, não diferença de preço",
    text: "Conserto, peças, frete e taxas entram na conta. Você vê quanto sobrou em cada venda, com margem, ROI e dias até vender.",
    span: "wide",
    art: (
      <div className="feature-art">
        <div className="feature-code">
          {"venda        "}
          <b>R$ 2.050,00</b>
          {"\n- compra     R$ 1.500,00\n- bateria    R$   120,00\n- taxas      R$    30,00\n"}
          <i>────────────────────────</i>
          {"\nlucro        "}
          <b>+R$ 400,00</b>
          {"   "}
          <i>margem 19,5% · 9 dias</i>
        </div>
      </div>
    ),
  },
  {
    icon: Camera,
    title: "Estoque com fotos",
    text: "Cada produto com foto, estado, IMEI e etapa, do momento em que entra até a venda.",
    span: "",
    art: (
      <div className="feature-art">
        <div className="feature-stages">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} style={{ "--i": i } as React.CSSProperties} />
          ))}
        </div>
        <small>Comprado → preparo → anunciado → reservado → vendido</small>
      </div>
    ),
  },
  {
    icon: Target,
    title: "Metas mensais",
    text: "Defina quanto quer lucrar e acompanhe o progresso a cada venda.",
    span: "wide",
    art: (
      <div className="feature-art feature-ring">
        <div className="ring">72%</div>
        <div>
          <small>Meta do mês</small>
          <strong>R$ 3.600 de R$ 5.000</strong>
        </div>
      </div>
    ),
  },
  {
    icon: BarChart3,
    title: "Painel do mês",
    text: "Lucro, faturamento, margem e ROI por período, comparados com o período anterior.",
    span: "",
  },
  {
    icon: Clock,
    title: "Giro do estoque",
    text: "Quantos dias cada produto ficou parado e quais estão travando seu dinheiro.",
    span: "",
  },
  {
    icon: FileSpreadsheet,
    title: "Planilha num clique",
    text: "Exporte tudo para o Excel ou Google Planilhas quando quiser.",
    span: "wide",
  },
] as const;

export function Landing() {
  const scrolled = useScrolled();
  const categories = CATEGORIES.filter((c) => c !== "other");
  return (
    <div className="lp">
      <header className={`lp-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="lp-container">
          <Logo />
          <nav className="lp-links" aria-label="Seções">
            <a href="#recursos">Recursos</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#radar">Radar</a>
            <a href="#planos">Planos</a>
            <a href="#duvidas">Dúvidas</a>
          </nav>
          <div className="lp-nav-actions">
            <a className="btn btn-ghost" href={withBase("/entrar")}>
              Entrar
            </a>
            <a className="btn btn-primary" href={withBase("/cadastro")}>
              Começar agora
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-container lp-hero">
          <div>
            <a className="lp-pill fade-up" href="#radar">
              <span className="badge soon">
                <Zap size={12} /> Novo
              </span>
              Radar de oportunidades do Marketplace
            </a>
            <h1 className="fade-up" style={{ "--i": 1 } as React.CSSProperties}>
              O sistema operacional de quem{" "}
              <span className="gradient-text">compra e revende</span>.
            </h1>
            <p className="lead fade-up" style={{ "--i": 2 } as React.CSSProperties}>
              {BRAND.name} é o painel do bricker: estoque com fotos, custos reais, vendas, margem, metas e um radar
              que avisa quando aparece um anúncio abaixo do preço. Você vê para onde vai cada real.
            </p>
            <div className="lp-cta fade-up" style={{ "--i": 3 } as React.CSSProperties}>
              <a className="btn btn-primary btn-lg" href={withBase("/cadastro")}>
                Criar minha conta <ArrowRight size={18} />
              </a>
              <a className="btn btn-lg" href="#planos">
                Ver planos
              </a>
            </div>
            <div className="lp-trust fade-up" style={{ "--i": 4 } as React.CSSProperties}>
              <span>
                <Smartphone size={15} /> Celular e computador
              </span>
              <span>
                <ShieldCheck size={15} /> Seus dados só seus
              </span>
              <span>
                <Zap size={15} /> Conta pronta em 1 minuto
              </span>
            </div>
          </div>
          <div className="fade-in" style={{ animationDelay: "0.2s" }}>
            <HeroMock />
          </div>
        </section>

        <div className="marquee" aria-label="Categorias atendidas">
          <div className="marquee-track">
            {[...categories, ...categories].map((c, i) => {
              const Icon = CATEGORY_ICONS[c];
              return (
                <span key={i} aria-hidden={i >= categories.length || undefined}>
                  <Icon size={16} /> {CATEGORY_LABELS[c]}
                </span>
              );
            })}
          </div>
        </div>

        <section className="lp-container" style={{ paddingTop: 48 }}>
          <Reveal>
            <div className="proof">
              <div>
                <strong>100%</strong>
                <span>dos custos na conta: compra, conserto, frete e taxas</span>
              </div>
              <div>
                <strong>12 meses</strong>
                <span>de lucro, mês a mês, no painel</span>
              </div>
              <div>
                <strong>5 etapas</strong>
                <span>do produto, da compra à venda</span>
              </div>
              <div>
                <strong>0 planilhas</strong>
                <span>para manter. Exporte quando quiser</span>
              </div>
            </div>
          </Reveal>
        </section>

        <section className="lp-section lp-container" id="recursos">
          <Reveal className="lp-section-head">
            <span className="lp-kicker">Recursos</span>
            <h2>Tudo que o bricker precisa, sem planilha bagunçada</h2>
            <p>Do momento em que você compra até o dinheiro entrar, cada etapa fica registrada e somada.</p>
          </Reveal>
          <div className="features">
            {FEATURES_LIST.map(({ icon: Icon, title, text, span, ...rest }, i) => (
              <Reveal key={title} delay={i % 3} className={`feature-cell ${span}`} as="article">
                <div className={`card hoverable feature ${span}`} style={{ height: "100%" }}>
                  <span className="feature-icon">
                    <Icon size={21} />
                  </span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  {"art" in rest ? rest.art : null}
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="lp-section lp-container" id="como-funciona" style={{ paddingTop: 0 }}>
          <Reveal className="lp-section-head">
            <span className="lp-kicker">Como funciona</span>
            <h2>Três passos e o lucro aparece sozinho</h2>
          </Reveal>
          <div className="how">
            {[
              ["Cadastre a compra", "Tire a foto pelo celular, informe quanto pagou e onde comprou."],
              ["Prepare e anuncie", "Lance consertos, peças e frete. Mova o produto pelas etapas até anunciar."],
              ["Registre a venda", "Informe o valor e as taxas. Lucro, margem e giro saem na hora."],
            ].map(([title, text], i) => (
              <Reveal key={title} delay={i}>
                <article className="card how-step hoverable">
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="lp-container" style={{ paddingBottom: 40 }}>
          <Reveal>
            <div className="card math gradient-border">
              <div>
                <span className="lp-kicker">A conta que importa</span>
                <h2 style={{ marginTop: 12 }}>
                  Vendeu por R$ 2.050? <span className="gradient-text">Sobrou quanto?</span>
                </h2>
                <p>
                  A diferença entre compra e venda engana. O {BRAND.name} desconta tudo que você gastou no caminho e
                  mostra o lucro líquido, a margem e em quantos dias o dinheiro voltou.
                </p>
              </div>
              <div className="receipt">
                <div className="receipt-row">
                  <span>Valor pago</span>
                  <strong>R$ 1.500,00</strong>
                </div>
                <div className="receipt-row">
                  <span>Troca de bateria</span>
                  <strong>R$ 120,00</strong>
                </div>
                <div className="receipt-row">
                  <span>Venda</span>
                  <strong>R$ 2.050,00</strong>
                </div>
                <div className="receipt-row">
                  <span>Taxa da maquininha</span>
                  <strong>R$ 30,00</strong>
                </div>
                <div className="receipt-row total">
                  <span>Lucro líquido</span>
                  <strong className="profit-pos">+R$ 400,00</strong>
                </div>
                <div className="receipt-row" style={{ border: 0, paddingTop: 0 }}>
                  <span>Margem 19,5% · ROI 24,7%</span>
                  <span>vendido em 9 dias</span>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        <section className="lp-section lp-container" id="radar" style={{ paddingTop: 40 }}>
          <Reveal>
            <div className="card radar-show hud">
              <div>
                <span className="lp-kicker">Radar de oportunidades</span>
                <h2>
                  Anúncios bons chegando até você, <span className="gradient-text">em minutos</span>.
                </h2>
                <p>
                  O radar acompanha os produtos que você revende e avisa quando aparece um anúncio novo abaixo do
                  preço de revenda, já com a conta do lucro feita.
                </p>
                <ul>
                  <li>
                    <Radar size={18} /> Busca contínua pelos modelos e regiões que você escolher
                  </li>
                  <li>
                    <Wallet size={18} /> Preço de revenda estimado e lucro esperado em cada anúncio
                  </li>
                  <li>
                    <Bell size={18} /> Aviso imediato quando surgir uma oportunidade
                  </li>
                </ul>
                <div className="lp-cta" style={{ marginTop: 26 }}>
                  <a className="btn btn-primary" href={withBase("/cadastro?plano=pro")}>
                    Quero o radar <ArrowRight size={16} />
                  </a>
                </div>
              </div>
              <div className="radar-visual" aria-hidden="true">
                <span className="blip" style={{ left: "62%", top: "28%", animationDelay: "0.3s" }} />
                <span className="blip" style={{ left: "30%", top: "60%", animationDelay: "1.6s" }} />
                <span className="blip" style={{ left: "70%", top: "70%", animationDelay: "2.7s" }} />
                <span className="blip" style={{ left: "40%", top: "26%", animationDelay: "3.4s" }} />
                <div className="blip-card glass float" style={{ left: "52%", top: "12%" }}>
                  <strong>iPhone 13 · 128GB</strong>
                  <span className="profit-pos">+R$ 420 de lucro</span>
                </div>
                <div className="blip-card glass float" style={{ left: "8%", top: "72%", animationDelay: "-3s" }}>
                  <strong>PS5 Slim</strong>
                  <span className="profit-pos">+R$ 610 de lucro</span>
                </div>
                <Radar
                  size={30}
                  style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}
                />
              </div>
            </div>
          </Reveal>
        </section>

        <section className="lp-section lp-container" id="planos">
          <Reveal className="lp-section-head">
            <span className="lp-kicker">Planos</span>
            <h2>Um preço justo para quem vive de brick</h2>
            <p>Escolha o plano e comece a organizar seu estoque hoje.</p>
          </Reveal>
          <div className="pricing">
            {PLANS.map((plan, i) => (
              <Reveal key={plan.id} delay={i}>
                <article className={`card plan-card ${plan.highlight ? "highlight gradient-border" : ""}`}>
                  <h3>
                    {plan.name}
                    {plan.highlight && <span className="badge soon">Recomendado</span>}
                  </h3>
                  <p className="muted">{plan.pitch}</p>
                  <div className="price">
                    {formatCents(plan.priceCents)}
                    <small> /mês</small>
                  </div>
                  <ul>
                    {plan.features.map((f) => (
                      <li key={f}>
                        <Check size={17} /> {f}
                      </li>
                    ))}
                  </ul>
                  <a className={`btn btn-lg ${plan.highlight ? "btn-primary" : ""}`} href={withBase(`/cadastro?plano=${plan.id}`)}>
                    Começar com o {plan.name}
                  </a>
                </article>
              </Reveal>
            ))}
          </div>
          <p className="pricing-note">Valores mensais. O pagamento online será ativado em breve.</p>
        </section>

        <section className="lp-section lp-container" id="duvidas" style={{ paddingTop: 0 }}>
          <Reveal className="lp-section-head">
            <span className="lp-kicker">Dúvidas</span>
            <h2>Perguntas frequentes</h2>
          </Reveal>
          <div className="faq">
            {[
              [
                "Preciso instalar alguma coisa?",
                "Não. Funciona no navegador do celular e do computador. No celular, você pode tirar a foto do produto na hora do cadastro.",
              ],
              [
                "Serve para qualquer tipo de produto?",
                "Sim. Celulares e videogames são os mais comuns, mas você pode cadastrar notebooks, relógios, câmeras, bicicletas, ferramentas, móveis e o que mais revender.",
              ],
              [
                "Como o lucro é calculado?",
                "Valor da venda, menos as taxas da venda, menos o que você pagou e todos os custos extras lançados no produto. O resultado é o lucro líquido.",
              ],
              [
                "Consigo levar meus dados para uma planilha?",
                "Sim. A exportação gera um arquivo que abre direto no Excel ou no Google Planilhas.",
              ],
              [
                "O que é o Radar de oportunidades?",
                "Um recurso do plano Pro que acompanha anúncios novos dos produtos que você revende e avisa quando aparece um bom preço, com o lucro estimado.",
              ],
            ].map(([q, a], i) => (
              <Reveal key={q} delay={i}>
                <details className="card">
                  <summary>
                    {q} <Plus size={20} />
                  </summary>
                  <p>{a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="lp-container">
          <Reveal>
            <div className="final-cta glass hud">
              <h2>
                Pare de adivinhar.
                <br />
                <span className="gradient-text">Veja o lucro do seu brick.</span>
              </h2>
              <p>Crie sua conta em menos de um minuto e cadastre o primeiro produto hoje.</p>
              <a className="btn btn-primary btn-lg" href={withBase("/cadastro")}>
                Criar minha conta <ArrowRight size={18} />
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container">
          <Logo />
          <nav aria-label="Informações legais">
            <a href={withBase("/termos")}>Termos de uso</a>
            <a href={withBase("/privacidade")}>Privacidade</a>
          </nav>
          <span>
            © {new Date().getFullYear()} {BRAND.name}. Feito para quem compra e revende usados.
          </span>
        </div>
      </footer>
    </div>
  );
}
