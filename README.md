# Memora

Aplicativo de **repetição espaçada** inspirado no [Anki](https://apps.ankiweb.net/). Ele roda
no navegador (computador ou celular), funciona offline e pode ser instalado como app (PWA).

Para entender os conceitos e os algoritmos, leia a [pesquisa sobre o Anki](docs/PESQUISA-ANKI.md).

## Funcionalidades

- **Baralhos hierárquicos** (`Idiomas::Inglês`), com contadores de novos, aprendendo e revisar.
- **Notas e cartões:** os tipos Básico, Básico invertido, Invertido opcional, Digitar resposta e
  **Cloze**. Você pode criar tipos próprios, com campos, modelos (`{{Campo}}`, `{{#Campo}}`,
  `{{type:}}`, `{{hint:}}`, `{{tts:}}`…) e CSS.
- **Agendamento** com **SM-2** (o clássico do Anki: passos de aprendizado, facilidade, lapsos,
  sanguessugas, fuzz) ou **FSRS-5** (o moderno, com retenção desejada configurável).
- **Estudo:** botões Errei/Difícil/Bom/Fácil com prévia do intervalo, atalhos de teclado,
  desfazer, editar durante o estudo, enterrar, suspender, bandeiras e áudio.
- **Editor rico:** negrito, itálico, listas, imagens e áudio (colar ou arrastar), atalho de
  cloze e campos fixos.
- **Navegador** com a sintaxe de busca do Anki e ações em massa.
- **Opções por predefinição:** limites diários, passos, intervalos e algoritmo.
- **Estatísticas:** previsão, revisões por dia, retenção, intervalos e sequência de dias.
- **Importa `.apkg`/`.colpkg` do Anki** (com mídia) e CSV/TSV. Exporta em TSV e faz backup completo em .zip.
- Tema claro e escuro, layout responsivo para celular.

## Como usar

```bash
npm install
npm run dev        # desenvolvimento em http://localhost:5173
npm test           # testes do núcleo (agendador, modelos, busca, importação)
npm run build      # gera a versão final em dist/
```

### Publicar (GitHub Pages)

O workflow `.github/workflows/deploy.yml` publica o app a cada push na `main`. Para ativar:
**Settings → Pages → Source: GitHub Actions**. O app fica em
`https://<usuario>.github.io/<repositorio>/`. No celular, abra esse endereço e use
"Adicionar à tela inicial".

> Seus dados ficam salvos **no navegador** (IndexedDB). Faça backups periódicos em
> **Importar → Backup completo**. O backup também serve para levar a coleção para outro aparelho.

## Atalhos (tela de estudo)

| Tecla | Ação |
|---|---|
| Espaço / Enter | Mostrar resposta; depois, "Bom" |
| 1 2 3 4 | Errei, Difícil, Bom, Fácil |
| E | Editar nota |
| Ctrl+Z | Desfazer |
| - / = | Enterrar cartão / nota |
| @ / ! | Suspender cartão / nota |
| Ctrl+1…7 | Bandeira |

## Estrutura

```
src/core/            lógica sem interface (testada com Vitest)
  types.ts           modelo de dados
  scheduler/         SM-2 (index.ts) e FSRS-5 (fsrs.ts)
  collection.ts      baralhos, notas, cartões, filas e limites
  template.ts        motor de modelos {{ }} e cloze
  search.ts          busca no estilo do Anki
  io/                importação (.apkg, texto) e backup
  store.ts, media.ts persistência no IndexedDB
src/ui/              telas em React
```
