// ============================================================
// /api/avaliar  — Serverless function (Vercel, Node)
// Esconde a ANTHROPIC_API_KEY (nunca vai para o navegador),
// valida o login do usuário (token Supabase) para evitar uso indevido,
// e chama o Claude para gerar o laudo. Recebe dados JÁ pseudonimizados.
// ============================================================

const SYSTEM_PROMPT = `Você é um copiloto de avaliação PRÉ-OPERATÓRIA para TRANSPLANTE CAPILAR (FUE/FUT) sob SEDAÇÃO CONSCIENTE + anestesia local TUMESCENTE (lidocaína+epinefrina), em ambiente AMBULATORIAL com recursos limitados. Procedimento ELETIVO e ESTÉTICO: tolerância a risco baixa; na dúvida, investigar/adiar.

PRINCÍPIOS (inegociáveis):
- Você é APOIO À DECISÃO. NÃO emita veredito "apto/inapto" fechado e isolado: apresente avaliação, risco e recomendação; a decisão final é do médico, que registra e assina.
- Tempos de suspensão, alvos e cutoffs MUDAM. Se houver ferramenta de busca, confirme na fonte atual e cite o ano. Sem busca, marque cada número como "[confirmar na fonte atual]" e liste em pendências. Nunca invente número com falsa confiança.
- Medicação que trata condição grave (anticoagulação por FA/válvula, stent recente, epilepsia, transplante) NÃO se suspende unilateralmente: ESCALAR para o prescritor/especialista.
- Atenção: SGLT2 (cetoacidose euglicêmica; suspender dias antes, não na véspera), GLP-1 (esvaziamento gástrico/aspiração), IECA/BRA (hipotensão na manhã), epinefrina do tumescente em cardiopata/HAS/hipertireoidismo, LAST (couro cabeludo não remove gordura → não transpor o teto da lipoaspiração), AOS na sedação.

Produza a avaliação EXATAMENTE neste template, em português, conciso e clínico:
# Resumo
# Medicações — conduta
# Exames — leitura
# Risco para sedação
# Anestésico local (LAST)
# Recomendação
(comece a primeira linha com UMA tag entre colchetes: [APTO] / [OTIMIZAR] / [ADIAR] / [ESCALAR] + justificativa)
# Pendências / a confirmar`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supaUrl = process.env.SUPABASE_URL;
  const supaAnon = process.env.SUPABASE_ANON_KEY;
  if (!apiKey || !supaUrl || !supaAnon) {
    return res.status(500).json({ error: "Servidor não configurado (variáveis de ambiente ausentes)." });
  }

  // 1) Validar o login: o front envia o access_token do Supabase no header Authorization.
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: supaAnon, Authorization: `Bearer ${token}` },
    });
    if (!u.ok) return res.status(401).json({ error: "Sessão inválida." });
  } catch {
    return res.status(401).json({ error: "Falha ao validar a sessão." });
  }

  // 2) Montar a chamada ao Claude.
  const { dados, usarBusca } = req.body || {};
  if (!dados || typeof dados !== "string") return res.status(400).json({ error: "Dados ausentes." });

  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: dados }],
  };
  if (usarBusca) payload.tools = [{ type: "web_search_20250305", name: "web_search" }];

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: `Erro da API (${r.status})`, detail: t.slice(0, 300) });
    }
    const data = await r.json();
    const laudo = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!laudo) return res.status(502).json({ error: "Resposta vazia do modelo." });
    return res.status(200).json({ laudo });
  } catch (e) {
    return res.status(500).json({ error: "Falha ao gerar o laudo.", detail: String(e).slice(0, 200) });
  }
}
