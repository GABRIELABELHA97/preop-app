// ============================================================
// EXEMPLO: como chamar /api/avaliar desde o front (index.html)
// ============================================================

// ---- CENÁRIO 1: só texto (paciente + exames digitados) ----
async function enviarSoTexto(textoDoFormulario) {
  const token = localStorage.getItem("token"); // seu token Supabase

  const response = await fetch("/api/avaliar", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      dados: textoDoFormulario,  // STRING PURA
      usarBusca: false,
      modo: "avaliacao"
    })
  });

  if (!response.ok) {
    const err = await response.json();
    console.error("Erro da API:", err);
    alert(`Erro (${response.status}): ${err.error}\n${err.detalhe || ""}`);
    return;
  }

  const { laudo } = await response.json();
  console.log("Laudo:", laudo);
  // exibe o laudo na tela...
}

// ---- CENÁRIO 2: arquivo (PDF ou imagem) + texto ----
async function enviarComArquivo(arquivo, textoComplementar) {
  const token = localStorage.getItem("token");

  // LÊ O ARQUIVO COMO BASE64
  const reader = new FileReader();
  reader.onload = async (event) => {
    const dataUrl = event.target.result; // "data:application/pdf;base64,JVBER..."
    const base64 = dataUrl.split(",")[1]; // Remove o prefixo "data:...;base64,"

    // DETERMINA O media_type
    let mediaType = "application/pdf";
    if (arquivo.type.startsWith("image/")) {
      mediaType = arquivo.type; // "image/jpeg", "image/png", etc
    }

    // MONTA O CONTENT (array com arquivo + texto)
    const content = [
      {
        type: arquivo.type.startsWith("image/") ? "image" : "document",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64  // SEM O PREFIXO "data:...;base64,"
        }
      },
      {
        type: "text",
        text: textoComplementar || "Avalie este paciente conforme protocolo pré-op de transplante capilar."
      }
    ];

    // ENVIA COMO JSON STRINGIFICADO
    const response = await fetch("/api/avaliar", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        dados: JSON.stringify(content),  // Converte o array em JSON string
        usarBusca: false,
        modo: "avaliacao"
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("Erro da API:", err);
      alert(`Erro (${response.status}): ${err.error}\n${err.detalhe || ""}`);
      return;
    }

    const { laudo } = await response.json();
    console.log("Laudo:", laudo);
    // exibe o laudo na tela...
  };

  reader.readAsDataURL(arquivo);
}

// ---- CENÁRIO 3: múltiplos arquivos + texto ----
async function enviarVariosArquivos(arquivos, textoComplementar) {
  const token = localStorage.getItem("token");

  // Promessas para ler todos os arquivos
  const leituras = arquivos.map((arquivo) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target.result;
        const base64 = dataUrl.split(",")[1];
        const mediaType = arquivo.type.startsWith("image/") ? arquivo.type : "application/pdf";
        resolve({
          type: arquivo.type.startsWith("image/") ? "image" : "document",
          source: {
            type: "base64",
            media_type: mediaType,
            data: base64
          }
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(arquivo);
    });
  });

  try {
    const blocos = await Promise.all(leituras);

    // Monta o array final: [arquivo1, arquivo2, ..., texto]
    const content = [
      ...blocos,
      {
        type: "text",
        text: textoComplementar || "Avalie este paciente conforme protocolo pré-op."
      }
    ];

    const response = await fetch("/api/avaliar", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        dados: JSON.stringify(content),
        usarBusca: false,
        modo: "avaliacao"
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("Erro da API:", err);
      alert(`Erro (${response.status}): ${err.error}\n${err.detalhe || ""}`);
      return;
    }

    const { laudo } = await response.json();
    console.log("Laudo:", laudo);
  } catch (err) {
    console.error("Erro ao ler arquivos:", err);
    alert("Erro ao processar arquivos: " + err.message);
  }
}

// ---- CENÁRIO 4: REVISÃO (segundo médico audita o laudo) ----
async function pedirRevisao(dadosOriginais, laudoGerado) {
  const token = localStorage.getItem("token");

  const response = await fetch("/api/avaliar", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      dados: dadosOriginais,  // Os dados originais (podem ser string ou JSON)
      laudo: laudoGerado,     // O laudo que você quer revisar
      modo: "revisao"
    })
  });

  if (!response.ok) {
    const err = await response.json();
    console.error("Erro da revisão:", err);
    alert(`Erro (${response.status}): ${err.error}`);
    return;
  }

  const { revisao } = await response.json();
  console.log("Revisão:", revisao);
  // exibe a revisão na tela...
}

// ============================================================
// EXEMPLO DE USO NO HTML
// ============================================================
/*
<form id="formAvaliacao">
  <textarea id="dados" placeholder="Dados do paciente..."></textarea>
  <input type="file" id="arquivo" accept=".pdf,.jpg,.jpeg,.png" />
  <button type="button" onclick="clicarEnviar()">Enviar</button>
</form>

<script>
function clicarEnviar() {
  const arquivo = document.getElementById("arquivo").files[0];
  const dados = document.getElementById("dados").value;

  if (arquivo && dados) {
    enviarComArquivo(arquivo, dados);
  } else if (dados) {
    enviarSoTexto(dados);
  } else {
    alert("Preencha os dados ou selecione um arquivo");
  }
}
</script>
*/
