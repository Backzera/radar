"use client";
import { BellRing, Check, Radar as RadarIcon, Zap } from "lucide-react";

/**
 * Coming-soon screen for the opportunity radar. The collection pipeline
 * (providers/, server/worker.ts, server/supervisor.ts, components/saas/) is
 * kept intact; set FEATURES.radar in brand.ts to render the radar UI here.
 */
export function RadarSoon() {
  return (
    <>
      <div className="view-head fade-up">
        <div>
          <h1>Radar de oportunidades</h1>
          <p>Encontre o próximo bom negócio antes de todo mundo.</p>
        </div>
      </div>
      <section className="card radar-soon fade-up gradient-border">
        <div>
          <span className="badge soon">
            <Zap size={13} /> Em breve
          </span>
          <h2>
            Anúncios bons chegando até você, <span className="gradient-text">em minutos</span>.
          </h2>
          <p>
            O radar vai acompanhar os produtos que você revende e avisar quando aparecer um anúncio novo abaixo do
            preço de revenda, já com a conta do lucro feita.
          </p>
          <ul>
            <li>
              <Check size={18} /> Busca contínua pelos modelos e regiões que você escolher
            </li>
            <li>
              <Check size={18} /> Preço de revenda estimado e lucro esperado em cada anúncio
            </li>
            <li>
              <Check size={18} /> Aviso imediato quando surgir uma oportunidade
            </li>
          </ul>
          <p className="muted" style={{ marginTop: 22, display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
            <BellRing size={16} /> Você será avisado aqui no painel quando o radar for liberado.
          </p>
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
          <RadarIcon
            size={30}
            style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", color: "var(--brand)" }}
          />
        </div>
      </section>
    </>
  );
}
