// ============================================================
// /api/extrair  — Serverless function (Vercel, Node)
// Recebe o PDF ou IMAGEM de um exame laboratorial em base64,
// pede ao Claude para LER e devolver os valores de forma estruturada,
// já sinalizando o que está ALTERADO em relação à referência impressa.
// NÃO interpreta nem dá conduta aqui — isso é papel do /api/avaliar.
// Esconde a ANTHROPIC_API_KEY e valida o login (token Supabase).
// ============================================================

const EXTRACAO_PROMPT = `Você lê UM exame laboratorial (PDF ou imagem/foto) e devolve os valores de forma estruturada.

REGRAS:
- Responda APENAS com JSON válido. Sem markdown, sem crases, sem texto antes ou depois.
- NÃO interprete, NÃO dê conduta, NÃO diagnostique. Só extraia o que está escrito.
- Para cada exame, compare o valor com a faixa de referência IMPRESSA no próprio laudo. Se estiver fora dela, inclua em "alterados".
- Se um campo não existir no laudo, use null. Nunca invente número.
- Use ponto como separador decimal (ex.: "1.4"). Sorologias podem ser texto ("Não reagente", "Reagente").

Mapeie estes campos (aceite sinônimos em português). A CHAVE do JSON é o código à esquerda:
hemacias=Hemácias | hb=Hemoglobina | gl=Leucócitos/Global de leucócitos | plq=Plaquetas
rni=RNI/INR/Coagulograma | ptta=PTTA/TTPA
glic=Glicose de jejum | hba1c=Hemoglobina glicada/HbA1c
tgo=TGO/AST | tgp=TGP/ALT | fa=Fosfatase alcalina/FA | ggt=GGT
bilit=Bilirrubina total | bilid=Bilirrubina direta | biliid=Bilirrubina indireta
cr=Creatinina | ur=Ureia/Uréia | tfg=TFG/eGFR/RFG estimado | k=Potássio
tsh=TSH | t4l=T4 livre/T4L | antitpo=Anti-TPO | pth=PTH
testot=Testosterona total | testol=Testosterona livre | dht=DHT
b12=Vitamina B12 | vitd=Vitamina D/25-OH | ferrit=Ferritina | zinco=Zinco
antihbs=Anti-HBs | hbsag=HBsAg | antihiv=Anti-HIV | antihcv=Anti-HCV | vdrl=VDRL

Esquema EXATO do JSON:
{
  "idade": número ou null,
  "sexo": "M" | "F" | null,
  "ex": { "<chave>": "texto com valor e unidade" , ... só as chaves encontradas },
  "alterados": [ { "nome": "texto", "valor": "texto", "unidade": "texto", "referencia": "texto", "direcao": "alto"|"baixo"|"anormal" } ],
  "outros": "achados relevantes fora da lista acima, separados por ; — ou string vazia"
}

IMPORTANTE: "alterados" deve conter TODOS os valores fora da referência, inclusive os que não estão na lista mapeada. É a informação mais importante.`;

const ECG_PROMPT = `Você é cardiologista e faz um laudo CURTO e SINTÉTICO de um ECG a partir da imagem enviada, para apoio à decisão pré-operatória (sedação consciente + tumescente, transplante capilar). Apoio à decisão — o médico responsável decide e assina.

CHECKLIST DE CALIBRAÇÃO (confira antes de qualquer leitura): velocidade (25 ou 50 mm/s), ganho (10 ou 5 mm/mV — se 5 mm/mV, dobre mentalmente as amplitudes antes de avaliar critério de voltagem), filtros, data do exame, dados demográficos (idade/sexo — os cutoffs de QTc e voltagem dependem deles).

REGRA DURA DE QUALIDADE DE IMAGEM: se a imagem (tremida, cortada, com brilho, papel térmico curvo, baixa resolução) não permite medir os intervalos com confiança, NÃO estime QTc, PR, QRS ou eixo em milissegundos/graus como se fossem medidos. Nesse caso, reporte apenas a leitura automática impressa pelo aparelho para esses campos e declare a limitação em "Ressalvas". NÃO exclua com certeza alterações finas de ST-T, ondas Q sutis ou pré-excitação discreta só por causa da imagem ruim — registre a incerteza em vez de negar o achado.

VIGÊNCIA: se a data impressa for antiga, ou o relógio do aparelho estiver obviamente errado, o ECG NÃO serve para o pré-op atual — sinalize isso claramente, sempre, sem deixar passar.

Responda em português, no máximo ~10 linhas, nesta estrutura:
Calibração: (velocidade/ganho/filtros — adequada ou com ressalva)
Ritmo: (sinusal/FA/outro)
Frequência: (aprox., bpm)
Eixo: (normal/desvio, ou "não mensurável nesta imagem")
Intervalos/Condução: (PR, QRS, QTc — só se avaliáveis com confiança; caso contrário, citar a leitura automática do aparelho e marcar como não confiável; bloqueios)
Achados: (sobrecargas, isquemia, alterações de ST-T, extrassístoles, etc.; ou "sem alterações significativas")
Vigência: (data do exame — vigente / ATENÇÃO: data antiga ou relógio incorreto, repetir o exame)
SINAIS DE ALERTA: (o que contraindica ou exige esclarecimento antes de cirurgia eletiva — ex.: BRE novo, arritmia não esclarecida, BAV avançado, isquemia; ou "nenhum")
Ressalvas: (qualidade de imagem, intervalos não mensuráveis, ausência de dados demográficos, ou "nenhuma")
Impacto na sedação: (só os aplicáveis — bradicardia × dexmedetomidina; QTc × fármacos/eletrólitos; distúrbio de condução → evitar dexmedetomidina; isquemia/sobrecarga → cautela/escalar)`;

const CARDIO_PROMPT = `Você lê o LAUDO DE UM CARDIOLOGISTA (avaliação de risco cirúrgico pré-operatório) em PDF ou foto e devolve um resumo CURTO e fiel. Apoio à decisão — não interprete além do que está escrito.
Responda em português, no máximo ~6 linhas, nesta estrutura:
ECG descrito: (o que o laudo diz do ECG; ou "não descrito")
Risco/ASA: (classificação ASA e/ou risco declarado; ou "não declarado")
Conclusão do cardiologista: (liberado/liberado com ressalvas/não liberado + condições, fiel ao texto)
Médico e CRM: (se legível)
ALERTAS: (qualquer condição, restrição ou pendência citada; ou "nenhum")
Se o documento não for um laudo cardiológico ou estiver ilegível, diga isso claramente e não invente conteúdo.`;

const COURO_PROMPT = `Você é dermatologista analisando a FOTO do couro cabeludo de um candidato a transplante capilar. Apoio à decisão — o médico examina o paciente e decide. Sua análise é HIPÓTESE, nunca diagnóstico definitivo.
Responda em português, no máximo ~10 linhas, nesta estrutura:
Morfologia: (o que se vê — mácula/pápula/placa/pústula, cor, descamação, distribuição, sinais de cicatriz/perda de óstios)
Hipóteses: (da mais provável às alternativas, incluindo o que não pode ser descartado)
Aptidão sugerida: APTO | REAVALIAR ANTES DE OPERAR | ENCAMINHAR AO DERMATOLOGISTA — com 1 frase de justificativa (considere: seborreica leve e foliculite esparsa não contraindicam; foliculite pustulosa difusa, exantema extenso/indefinido, tinea e psoríase ativa pedem reavaliar; suspeita de alopecia areata ativa, alopecia cicatricial (perda de óstios) ou lesão tumoral pedem encaminhar/negar)
NÃO proponha tratamento, produto, concentração ou posologia — apenas descreva o achado. Quem decide a conduta é o médico.
Se a foto não permitir análise confiável (desfocada, distante, iluminação ruim), diga isso claramente e não invente achados.`;

function extrairJSON(txt) {
  if (!txt) return null;
  let s = txt.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i === -1 || j === -1) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supaUrl = process.env.SUPABASE_URL;
  const supaAnon = process.env.SUPABASE_ANON_KEY;
  if (!apiKey || !supaUrl || !supaAnon) {
    return res.status(500).json({ error: "Servidor não configurado (variáveis de ambiente ausentes)." });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: supaAnon, Authorization: `Bearer ${token}` } });
    if (!u.ok) return res.status(401).json({ error: "Sessão inválida." });
  } catch {
    return res.status(401).json({ error: "Falha ao validar a sessão." });
  }

  const { base64, mediaType, modo } = req.body || {};
  if (!base64 || typeof base64 !== "string") return res.status(400).json({ error: "Arquivo ausente." });
  const tipo = mediaType || "application/pdf";

  const docBlock = tipo === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: tipo, data: base64 } };

  // ---- modos de laudo curto: ECG (imagem) e laudo cardiológico (PDF/imagem) ----
  if (modo === "ecg" || modo === "cardio" || modo === "couro") {
    const sistemas = { ecg: ECG_PROMPT, cardio: CARDIO_PROMPT, couro: COURO_PROMPT };
    const pedidos = { ecg: "Faça o laudo sintético deste ECG.", cardio: "Resuma este laudo cardiológico.", couro: "Analise esta foto do couro cabeludo." };
    const payloadEcg = {
      model: "claude-sonnet-4-6",
      max_tokens: 900,
      system: sistemas[modo],
      messages: [{ role: "user", content: [docBlock, { type: "text", text: pedidos[modo] }] }],
    };
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(payloadEcg),
      });
      if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: `Erro da API (${r.status})`, detail: t.slice(0, 300) }); }
      const data = await r.json();
      const ecg = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (!ecg) return res.status(502).json({ error: "Não consegui analisar. Tente um arquivo mais nítido." });
      return res.status(200).json({ ecg });
    } catch (e) {
      return res.status(500).json({ error: "Falha ao ler o ECG.", detail: String(e).slice(0, 200) });
    }
  }

  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: EXTRACAO_PROMPT,
    messages: [{ role: "user", content: [docBlock, { type: "text", text: "Extraia os valores deste exame no formato JSON especificado." }] }],
  };

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: `Erro da API (${r.status})`, detail: t.slice(0, 300) });
    }
    const data = await r.json();
    const txt = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const parsed = extrairJSON(txt);
    if (!parsed) return res.status(502).json({ error: "Não consegui ler os valores. Tente um arquivo mais nítido ou preencha à mão." });
    return res.status(200).json({ extraido: parsed });
  } catch (e) {
    return res.status(500).json({ error: "Falha ao ler o exame.", detail: String(e).slice(0, 200) });
  }
}
