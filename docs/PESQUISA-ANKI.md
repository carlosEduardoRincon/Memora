# Pesquisa: o que é o Anki e como ele funciona

Este documento resume a pesquisa que serviu de base para o Memora. Ele explica os conceitos
do Anki e onde cada um aparece no código.

## 1. O que é

O **Anki** é um programa de flashcards gratuito e de código aberto. Ele usa **repetição espaçada**
e **recordação ativa** para memorizar informação a longo prazo. Existe para desktop
(Windows/Mac/Linux), Android (AnkiDroid), iOS (AnkiMobile) e web (AnkiWeb, que também
sincroniza). É muito usado em medicina, idiomas, concursos e programação.

### A ciência por trás

- **Curva do esquecimento (Ebbinghaus, 1885):** sem revisão, a memória decai rápido.
- **Efeito de espaçamento:** revisões espalhadas no tempo fixam melhor que revisões concentradas.
- **Efeito de teste (recordação ativa):** tentar lembrar a resposta antes de vê-la fortalece
  a memória muito mais do que reler.
- Revisar **logo antes de esquecer** maximiza o ganho por revisão. Cada revisão bem-sucedida
  aumenta a "estabilidade" da memória, então o intervalo seguinte pode ser maior.

## 2. Modelo de dados

| Conceito | O que é | No Memora |
|---|---|---|
| **Coleção** | Todos os seus dados | `Collection` em `src/core/types.ts` |
| **Baralho (deck)** | Agrupa cartões. É hierárquico: `Idiomas::Inglês::Verbos` | `Deck`, `ensureDeck`, `deckAndDescendants` |
| **Nota** | A unidade de informação, com **campos** (ex.: Frente, Verso) | `Note` |
| **Tipo de nota** | Define os campos, os **modelos de cartão** e o CSS | `NoteType` |
| **Modelo de cartão** | Template de frente e verso com `{{Campo}}` | `CardTemplate`, `src/core/template.ts` |
| **Cartão** | O que você estuda. Uma nota gera 1+ cartões | `Card` |
| **Predefinição de opções** | Configurações de agendamento compartilháveis entre baralhos | `Preset` |
| **Revlog** | Histórico de todas as respostas (usado em estatísticas e no FSRS) | `ReviewLog` |

**Separar notas e cartões** é a ideia central. Uma nota "Básico (e cartão invertido)" com
`cat / gato` gera **dois** cartões: `cat → ?` e `gato → ?`. Se você editar a nota, os dois
cartões mudam.

### Tipos de nota padrão (todos incluídos)

- **Básico:** Frente → Verso.
- **Básico (e cartão invertido):** gera os dois sentidos.
- **Básico (cartão invertido opcional):** o 2º cartão só é criado se o campo
  "Adicionar Invertido" for preenchido. Ele usa a seção condicional `{{#Campo}}…{{/Campo}}`.
- **Básico (digitar a resposta):** `{{type:Verso}}` mostra uma caixa de digitação e
  compara a resposta caractere a caractere.
- **Cloze (omissão):** `{{c1::texto::dica}}`. Cada número `cN` gera um cartão.

### Regra de geração de cartões

Um cartão é criado para o modelo *i* se a frente renderizada **não ficar vazia**. Para cloze,
é criado um cartão por número de omissão. Veja `cardOrdsForNote`.

### Sintaxe dos modelos

`{{Campo}}`, `{{FrontSide}}`, `{{Tags}}`, `{{Deck}}`, `{{Subdeck}}`, `{{Card}}`, `{{Type}}`,
`{{#Campo}}…{{/Campo}}`, `{{^Campo}}…{{/Campo}}`, os filtros `text:`, `hint:`, `type:`,
`cloze:` e `tts:`.

## 3. Estados de um cartão

```
 Novo ──(1ª resposta)──► Aprendendo ──(passou todos os passos)──► Revisão
                             ▲                                       │
                             │                                  Errei (lapso)
                             │                                       ▼
                             └─────────────────────────────── Reaprendendo
```

Os cartões também podem estar **suspensos** (fora do estudo até você reativá-los) ou
**enterrados** (adiados até o dia seguinte).

## 4. Algoritmo clássico (SM-2 adaptado pelo Anki)

Os quatro botões são **Errei (1)**, **Difícil (2)**, **Bom (3)** e **Fácil (4)**.

**Cartões novos e em aprendizado** passam por *passos* em minutos (padrão `1m 10m`):

- Errei: volta ao 1º passo.
- Difícil: no 1º passo, espera a média dos dois primeiros passos (≈6m). Nos outros passos, repete o passo atual.
- Bom: avança um passo. Depois do último, **gradua** com o *intervalo de graduação* (1 dia).
- Fácil: gradua na hora com o *intervalo fácil* (4 dias).

**Revisões.** Cada cartão tem um *fator de facilidade* (ease), que começa em 250%:

- Difícil: `intervalo × 1,2` e ease −15%.
- Bom: `(intervalo + atraso/2) × ease`.
- Fácil: `(intervalo + atraso) × ease × bônus fácil (1,3)` e ease +15%.
- O sistema sempre garante Difícil < Bom < Fácil. Todos os intervalos são multiplicados
  pelo *modificador de intervalo* e limitados pelo *intervalo máximo*.
- Errei (**lapso**): ease −20% (mínimo 130%). O novo intervalo é `intervalo × "novo intervalo"`
  (padrão 0, ou seja, vai para o mínimo de 1 dia). O cartão então entra no *reaprendizado* (passo `10m`).
- **Sanguessuga (leech):** após 8 lapsos, o cartão é marcado com a etiqueta `leech` e, se você
  configurar assim, suspenso. Isso sinaliza que o cartão precisa ser reescrito.
- **Fuzz:** um pequeno ruído aleatório (±5–15%) evita que cartões criados juntos vençam sempre juntos.

Código: `src/core/scheduler/index.ts`.

## 5. FSRS (algoritmo moderno, Anki 23.10+)

O **FSRS** (Free Spaced Repetition Scheduler) é baseado no modelo de memória **DSR**:

- **D, dificuldade (1–10):** o quanto o conteúdo é difícil para você.
- **S, estabilidade (em dias):** o tempo até a chance de lembrar cair para 90%.
- **R, recuperabilidade:** a probabilidade de lembrar agora.

A curva de esquecimento é `R(t, S) = (1 + 19/81 · t/S)^−0,5`. O intervalo é escolhido
para que R chegue à **retenção desejada** (padrão 90%). Com 90%, o intervalo é exatamente igual a S.

Atualizações do FSRS-5:

- Estado inicial: `S₀ = w[G−1]` e `D₀ = w4 − e^(w5·(G−1)) + 1`.
- Dificuldade: `D' = D − w6·(G−3)·(10−D)/9`, com reversão à média para `D₀(4)` pelo peso w7.
- Estabilidade após lembrar: `S·(e^w8·(11−D)·S^−w9·(e^(w10·(1−R))−1)·penalidade·bônus + 1)`.
- Estabilidade após esquecer: `w11·D^−w12·((S+1)^w13 − 1)·e^(w14·(1−R))`.
- Revisões no mesmo dia: `S·e^(w17·(G−3+w18))`.

Os 19 pesos padrão foram treinados com dados de cerca de 20 mil usuários do Anki. Em comparativos,
o FSRS precisa de 20–30% menos revisões que o SM-2 para chegar à mesma retenção. No Memora,
você escolhe o algoritmo nas **Opções** de cada baralho. O estado FSRS é calculado mesmo
quando o SM-2 está em uso, então você pode trocar de algoritmo a qualquer momento.

Código: `src/core/scheduler/fsrs.ts`.

## 6. Filas e limites diários

- O dia de estudo **vira às 4h da manhã** (configurável). Assim, estudar depois da meia-noite
  ainda conta como "hoje".
- **Limites:** novos por dia (20) e revisões por dia (200). O limite do baralho escolhido
  vale para ele e todos os subbaralhos.
- **Ordem:** primeiro os cartões em aprendizado já vencidos, depois revisões e novos
  intercalados. Se não sobrar mais nada, o Memora antecipa cartões em aprendizado que vencem
  nos próximos 20 minutos (*aprender adiantado*).
- **Enterrar irmãos** (opcional): ao estudar um cartão, os outros cartões da mesma nota são
  adiados para amanhã.
- **Estudo personalizado:** aumenta os limites de hoje.

## 7. Outras funções do Anki reproduzidas

- **Navegador** com a sintaxe de busca do Anki: `deck:`, `tag:`, `is:due`, `prop:ivl>10`,
  `rated:7`, `-negação`, `or`, curingas `*` e campos específicos (`campo:valor`).
- **Ações em massa:** suspender, mudar de baralho, adicionar ou remover etiquetas, *esquecer*
  (voltar a novo), *definir vencimento* e bandeiras coloridas (1–7).
- **Desfazer** (Ctrl+Z) e edição da nota durante o estudo (E).
- **Mídia:** imagens e áudio colados ou arrastados para o editor, e `[sound:arquivo.mp3]`.
- **Leitura em voz alta (TTS)** com `{{tts:Campo}}`.
- **Importação:** pacotes `.apkg`/`.colpkg` (formatos antigo e novo, com mídia) e texto
  CSV/TSV, incluindo os cabeçalhos `#separator:`, `#html:`, `#deck:` e `#tags:`.
- **Exportação** em texto (TSV) e **backup completo** em .zip.
- **Estatísticas:** previsão, revisões por dia, contagens, intervalos, botões de resposta,
  retenção verdadeira, retenção estimada pelo FSRS e sequência de dias.

## 8. Diferenças em relação ao Anki

- Os dados ficam no **navegador** (IndexedDB). Não há sincronização em nuvem; use o backup .zip para levar seus dados a outro aparelho.
- Não há otimizador de parâmetros do FSRS (os pesos padrão funcionam bem para a maioria; dá para colar pesos otimizados no Anki).
- Não há suporte a add-ons, LaTeX/MathJax nem oclusão de imagem.
- A importação de `.apkg` traz o progresso de revisão de forma simplificada (opcional).

## Fontes

- [Manual do Anki: Opções do baralho](https://docs.ankiweb.net/deck-options.html)
- [Manual do Anki: Geração de cartões e cloze](https://docs.ankiweb.net/templates/generation.html)
- [Manual do Anki: Primeiros passos](https://docs.ankiweb.net/getting-started.html)
- [FSRS4Anki: o algoritmo](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)
- [Expertium: explicação técnica do FSRS](https://expertium.github.io/Algorithm.html)
- [Benchmark de algoritmos de repetição espaçada](https://expertium.github.io/Benchmark.html)
- [Anki na Wikipédia](https://en.wikipedia.org/wiki/Anki_(software))
