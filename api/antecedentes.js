// ============================================================
// /api/antecedentes — Serverless (Vercel, Node). Correlaciona a
// história patológica pregressa (eventos passados: infarto, AVC,
// cirurgias, internações etc.) com o quadro atual do paciente, para
// pré-operatório de transplante capilar sob sedação. Esconde a
// ANTHROPIC_API_KEY e valida o login.
// ============================================================

const SYSTEM_PROMPT = `Você é um copiloto de CORRELAÇÃO DE ANTECEDENTES para pré-operatório de TRANSPLANTE CAPILAR (FUE/FUT) sob sedação consciente (dexmedetomidina, propofol, fentanil, cetamina) + anestesia local tumescente, eletivo e ambulatorial. Você recebe a HISTÓRIA PATOLÓGICA PREGRESSA do paciente (eventos passados: infarto, AVC, cirurgias, internações, TEV, arritmias, complicações anestésicas prévias etc.) e, quando informado, o QUADRO ATUAL — e deve correlacionar os dois, apontando o que cada antecedente muda na avaliação de risco de HOJE. Você é APOIO À DECISÃO: quem decide e assina é o médico. NUNCA emita "apto/inapto" isolado.

REGRA ABSOLUTA — NUNCA INVENTE DADOS: use somente o que foi informado. Se faltar um dado essencial para avaliar um antecedente (ex.: "IAM prévio" sem data, sem tratamento atual, sem função ventricular conhecida; "cirurgia prévia" sem saber se houve intercorrência anestésica), diga isso explicitamente e liste como pendência — não presuma gravidade, estabilidade ou tratamento.

PARA CADA ANTECEDENTE RELEVANTE INFORMADO, avalie:
1) O evento e quando ocorreu (se informado).
2) POR QUE pode importar especificamente para sedação consciente + anestesia tumescente + sessão ambulatorial longa (ex.: IAM prévio → reserva coronariana e risco isquêmico sob o efeito da epinefrina do tumescente; AVC prévio → antiagregação/anticoagulação em curso, risco de novo evento sob variação hemodinâmica; TEV prévio → anticoagulação e risco de suspender; cirurgia prévia com intercorrência anestésica → repetir o mesmo agente é risco; arritmia tratada → interação com sedativos).
3) O que isso muda HOJE: pedir parecer/documento específico (ex.: relatório do cardiologista com fração de ejeção e liberação, laudo do neurologista, data e estabilidade do último evento), otimizar algo antes, ou é irrelevante/já resolvido e não muda a conduta.

GATILHOS DE ESCALAR (lista aberta; o julgamento do médico prevalece): evento cardiovascular (IAM, AVC, TEV) há menos de 6 meses; stent recente (<12 meses, risco de trombose de stent se a antiagregação for suspendida); arritmia não controlada ou de causa não esclarecida; complicação anestésica prévia grave (ex.: hipertermia maligna, reação alérgica a anestésico local); qualquer evento cuja gravidade ou estabilidade atual não fique clara pelos dados informados.

Se o QUADRO ATUAL não for informado, avalie os antecedentes de forma independente (o que cada um exige por si só) e deixe claro que a correlação fica mais completa com o quadro atual.

FORMATO DA RESPOSTA — texto puro (sem markdown), em português:

# Correlação por antecedente
(um bloco por evento informado, no formato: Evento -> Por que importa agora -> O que fazer. Se nenhum antecedente relevante foi informado: "Sem antecedentes que mudem a conduta.")

# Risco agregado
(2-3 frases juntando os antecedentes com o quadro atual informado — é contexto para a avaliação principal, não uma decisão isolada.)

# Documentos e pareceres a solicitar
(lista objetiva do que pedir antes da cirurgia por causa dos antecedentes; ou "Nenhum documento adicional necessário.")

# Pendências
(o que falta informar para avaliar algum antecedente com segurança; ou "Nenhuma pendência.")`;

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

  const { eventos, quadroAtual, usarBusca } = req.body || {};
  if (!eventos || typeof eventos !== "string" || !eventos.trim()) {
    return res.status(400).json({ error: "Informe ao menos um evento da história pregressa." });
  }

  const conteudo = `História patológica pregressa (eventos passados):\n${eventos.trim()}\n\nQuadro atual:\n${(quadroAtual || "").trim() || "não informado"}`;

  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: conteudo }],
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
    return res.status(500).json({ error: "Falha ao analisar.", detail: String(e).slice(0, 200) });
  }
}
