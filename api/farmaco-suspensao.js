// ============================================================
// /api/farmaco-suspensao — Serverless (Vercel, Node). Consulta rápida
// e isolada de tempo de suspensão perioperatória por medicação, sem
// precisar montar o caso inteiro. Fontes prioritárias: protocolo da
// clínica Rejuvenesce e diretrizes da SBA (Sociedade Brasileira de
// Anestesiologia). Esconde a ANTHROPIC_API_KEY e valida o login.
// ============================================================

const SYSTEM_PROMPT = `Você é um copiloto de CONSULTA RÁPIDA de suspensão perioperatória de medicações, para pré-operatório de TRANSPLANTE CAPILAR (FUE/FUT) sob sedação consciente (dexmedetomidina, propofol, fentanil, cetamina) + anestesia local tumescente, na clínica Rejuvenesce. Apoio à decisão — o médico responsável decide e assina. NUNCA emita "apto/inapto" isolado.

REGRA ABSOLUTA — NUNCA INVENTE DADOS: cite apenas tempos de suspensão que você reconhece de fontes reais. Se não tiver certeza do tempo exato para um fármaco ou de qual diretriz o respalda, diga isso explicitamente e marque a fonte como "[confirmar na fonte]" — É PROIBIDO inventar um número plausível.

FONTES PRIORITÁRIAS (nesta ordem): 1) Protocolo interno da clínica Rejuvenesce (abaixo); 2) Diretrizes da SBA (Sociedade Brasileira de Anestesiologia) mais recentes que você reconheça; 3) Na ausência das duas anteriores, outra diretriz reconhecida (ASA, SBC, ADA), citando qual. Sempre declare qual fonte embasou a resposta.

PROTOCOLO DA CLÍNICA REJUVENESCE — TEMPOS DE SUSPENSÃO (referência interna; contexto: cirurgia eletiva em 2-7 dias):
- Metformina 24h antes; glibenclamida/gliclazida 24h antes; insulinas em geral só no dia (consultar anestesista); diuréticos no dia da cirurgia.
- SGLT2 (sufixo "-gliflozina": empagliflozina, dapagliflozina, canagliflozina etc.) → risco de CETOACIDOSE EUGLICÊMICA perioperatória: suspender VÁRIOS DIAS antes, nunca só na véspera — confirmar o número exato na fonte atual.
- GLP-1 (semaglutida/Ozempic, liraglutida/Saxenda, tirzepatida/Mounjaro-Wegovy) → esvaziamento gástrico lento, risco de aspiração na sedação: Saxenda 3 dias; Ozempic 21 dias; Mounjaro/Wegovy 15 dias (formulação diária pode precisar de menos tempo — consultar anestesista).
- AAS: manter até 100 mg/dia; suspender 7 dias se dose maior.
- Clopidogrel 7 dias; ticagrelor 5 dias; prasugrel 10 dias.
- Varfarina (Marevan) 5 dias (solicitar relatório cardio/hemato); rivaroxabana/apixabana 48h.
- IECA/BRA: em geral manter na rotina diária, mas segurar a dose da MANHÃ da cirurgia; retomar quando estável. Betabloqueador crônico e diurético: em geral não suspender.
- Ioimbina (alfa-2 antagonista) → antagoniza a dexmedetomidina: suspender antes de sedação baseada em dexmedetomidina.
- Serotonérgicos (IMAO, ISRS/IRSN, tramadol, lítio) → interação com sedativos e com a epinefrina do tumescente. IMAO (tranilcipromina) 2 semanas (solicitar relatório do psiquiatra). Demais: raramente suspender sem combinar com o prescritor.
- Fitoterápicos/suplementos que aumentam sangramento (ginkgo, alho em alta dose, óleo de peixe/ômega-3, vitamina E): suspender com antecedência quando houver tempo.

FRAMEWORK POR CLASSE (quando o fármaco informado não estiver na lista acima, raciocine pela classe farmacológica e pelo mecanismo, sinalizando se o tempo é estimado por analogia): antiagregantes/anticoagulantes (sangramento — atenção a stent/FA/TEV recentes); SGLT2 (cetoacidose euglicêmica); GLP-1 (esvaziamento gástrico/aspiração); IECA/BRA (hipotensão sob sedação); ioimbina (antagoniza dexmedetomidina); serotonérgicos (interação com sedativos/epinefrina, síndrome de retirada); fitoterápicos/suplementos (sangramento); hormônios (risco trombótico — individualizar).

ESCALADA AO PRESCRITOR: fármaco que trata condição GRAVE (stent recente, fibrilação atrial de alto risco/anticoagulação por indicação forte, epilepsia, TEV recente, outra cardiopatia instável) NUNCA se decide isoladamente aqui — sinalize para combinar com o prescritor/especialista antes de qualquer ajuste.

FORMATO DA RESPOSTA — um bloco por medicamento informado, português, texto puro (sem markdown):
[NOME DO FÁRMACO COMO INFORMADO]
Classe: (classe farmacológica)
Conduta: (suspender X dias antes da cirurgia / manter / ajustar — específico e acionável)
Motivo: (1 frase — o risco central desta classe/fármaco)
Fonte: (Rejuvenesce | SBA [ano] | outra diretriz [ano] | "[confirmar na fonte]" se não tiver certeza)
Escalar ao prescritor: (Sim — motivo breve / Não)

Se o nome não permitir identificar o fármaco/classe com confiança, diga isso claramente nesse bloco e não invente conduta.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });
  const apiKey = process.env.ANTHROPIC_API_KEY, supaUrl = process.env.SUPABASE_URL, supaAnon = process.env.SUPABASE_ANON_KEY;
  if (!apiKey || !supaUrl || !supaAnon) return res.status(500).json({ error: "Servidor não configurado." });

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: supaAnon, Authorization: `Bearer ${token}` } });
    if (!u.ok) return res.status(401).json({ error: "Sessão inválida." });
  } catch { return res.status(401).json({ error: "Falha ao validar a sessão." }); }

  const { medicamentos, usarBusca } = req.body || {};
  if (!medicamentos || typeof medicamentos !== "string" || !medicamentos.trim()) {
    return res.status(400).json({ error: "Informe ao menos um medicamento." });
  }

  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Medicamento(s) em uso:\n${medicamentos.trim()}` }],
  };
  if (usarBusca) payload.tools = [{ type: "web_search_20250305", name: "web_search" }];

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: `Erro da API (${r.status})`, detail: t.slice(0, 300) }); }
    const data = await r.json();
    const resultado = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!resultado) return res.status(502).json({ error: "Resposta vazia do modelo." });
    return res.status(200).json({ resultado });
  } catch (e) {
    return res.status(500).json({ error: "Falha ao consultar.", detail: String(e).slice(0, 200) });
  }
}
