# Copiloto Pré-Op — app instalável

App de avaliação pré-operatória (transplante capilar sob sedação) com **login** e **histórico pseudonimizado**. Ferramenta de **apoio à decisão**: o médico decide, registra e assina.

Stack: front estático (PWA) + 1 função serverless (esconde a chave da IA) + Supabase (login e banco) + Vercel (hospedagem). Sem etapa de build.

---

## Visão geral da segurança
- **Pseudonimização:** o banco guarda cada caso por um **código** (ex.: `MJ-67`), nunca nome/CPF. O vínculo código→paciente fica no seu prontuário oficial (Feegow).
- **Isolamento por usuário:** RLS no banco — cada conta só enxerga os próprios casos.
- **Chave da IA protegida:** fica só no servidor (variável de ambiente), nunca no navegador.
- **A função valida o login** antes de chamar a IA, para a chave não ser usada por terceiros.

---

## Passo a passo (≈ 30–40 min na primeira vez)

### 1. Supabase (login + banco) — grátis
1. Crie conta em supabase.com → **New project** (guarde a senha do banco).
2. Menu **SQL Editor → New query** → cole o conteúdo de `schema.sql` → **Run**.
3. Menu **Project Settings → API**: copie a **Project URL** e a **anon public key**.
4. (Recomendado) **Authentication → Providers → Email**: para começar rápido, desative "Confirm email"; reative depois.

### 2. Anthropic (a IA) — pago por uso
1. Em console.anthropic.com, gere uma **API key** e adicione créditos.
2. Guarde a chave (ela vai **só** na Vercel, nunca no código).

### 3. Configurar o app
- Abra `index.html` e cole, no bloco indicado, sua `SUPABASE_URL` e `SUPABASE_ANON_KEY`. (Essas duas são públicas por design — protegidas pelo RLS.)

### 4. Vercel (publicar) — grátis
1. Crie conta em vercel.com.
2. **Add New → Project → "Deploy" sem repositório** (ou suba a pasta pelo `vercel` CLI / arraste a pasta). A Vercel detecta a função em `/api` automaticamente.
3. Em **Settings → Environment Variables**, adicione:
   - `ANTHROPIC_API_KEY` = sua chave da Anthropic
   - `SUPABASE_URL` = sua Project URL
   - `SUPABASE_ANON_KEY` = sua anon key
4. **Deploy.** Você recebe uma URL `https://...vercel.app`.

### 5. Instalar no celular (PWA)
- Abra a URL no Chrome (Android) ou Safari (iPhone) → menu → **Adicionar à tela inicial**. Vira app em tela cheia.

---

## Suas responsabilidades (LGPD — resumo prático)
- Você é o **controlador** dos dados. A base legal aqui é a **tutela da saúde** por profissional de saúde (LGPD, art. 11). Supabase, Vercel e Anthropic atuam como **operadores** — todos oferecem termos de tratamento de dados (DPA) que vale aceitar nas configurações de cada conta.
- **Mantenha a pseudonimização.** Não digite nome/CPF nos campos. O código é seu, o vínculo fica no Feegow.
- **Proteja os segredos.** A `ANTHROPIC_API_KEY` fica só na Vercel. Nunca a coloque no `index.html` nem compartilhe a pasta com ela preenchida.
- **Acesso só seu.** Use senha forte; não compartilhe o login.
- **Escopo:** ferramenta de uso profissional individual, de apoio à decisão — não é um sistema certificado de prontuário. Se um dia for disponibilizar para outros médicos ou comercializar, há regras adicionais (ANVISA, certificação SBIS/CFM) a avaliar antes.

---

## Arquivos
- `index.html` — o app (login, avaliação, histórico). Configure as 2 chaves do Supabase aqui.
- `api/avaliar.js` — função que valida o login, esconde a chave da IA e gera o laudo.
- `schema.sql` — tabela `casos` + RLS. Rode no Supabase.
- `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png` — tornam o app instalável.
