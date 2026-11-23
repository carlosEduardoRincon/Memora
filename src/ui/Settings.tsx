import { useCollection, mutate, replaceCollection } from '../core/store';
import { emptyCollection } from '../core/defaults';
import { addNote, ensureDeck } from '../core/collection';
import { confirmBox, go, toast } from './common';
import type { Settings as S } from '../core/types';

export function createSampleDeck(): void {
  mutate((c) => {
    const d = ensureDeck(c, 'Exemplo::Como estudar');
    const basics: [string, string][] = [
      ['O que é repetição espaçada?', 'Revisar o conteúdo em intervalos crescentes, pouco antes de esquecê-lo.'],
      ['O que é a "curva do esquecimento"?', 'O declínio exponencial da memória ao longo do tempo, descrito por Hermann Ebbinghaus (1885).'],
      ['Por que <b>recordar ativamente</b> é melhor que reler?', 'Tentar lembrar fortalece a memória muito mais do que a exposição passiva (efeito de teste).'],
      ['O que significa o botão <i>Errei</i>?', 'Você não lembrou: o cartão volta para os passos de (re)aprendizado.'],
      ['Regra do "princípio mínimo" para criar cartões', 'Cada cartão deve perguntar UMA coisa, de forma curta e sem ambiguidade.'],
    ];
    for (const [f, b] of basics) addNote(c, 'basic', d.id, [f, b], ['exemplo']);
    const v = ensureDeck(c, 'Exemplo::Inglês');
    for (const [f, b] of [['dog', 'cachorro'], ['book', 'livro'], ['to learn', 'aprender'], ['to forget', 'esquecer']]) addNote(c, 'basic-reversed', v.id, [f, b], ['vocabulário']);
    addNote(c, 'cloze', d.id, ['O algoritmo {{c1::SM-2}} foi criado por {{c2::Piotr Woźniak}} para o SuperMemo; o {{c3::FSRS}} é sua alternativa moderna.', ''], ['exemplo']);
    addNote(c, 'basic-type', v.id, ['Como se diz "memória" em inglês?', 'memory'], ['vocabulário']);
  });
  toast('Baralho de exemplo criado', 'success');
}

export function SettingsPage() {
  const col = useCollection();
  const s = col.settings;
  const set = <K extends keyof S>(k: K, v: S[K]) => mutate((c) => { c.settings[k] = v; });
  return (
    <div className="page narrow">
      <h1>Configurações</h1>
      <section className="box">
        <h2>Aparência</h2>
        <label className="field">Tema
          <select value={s.theme} onChange={(e) => set('theme', e.target.value as S['theme'])}>
            <option value="auto">Automático (sistema)</option>
            <option value="light">Claro</option>
            <option value="dark">Escuro</option>
          </select>
        </label>
      </section>
      <section className="box">
        <h2>Estudo</h2>
        <label className="field">O próximo dia começa às (hora)
          <input type="number" min={0} max={23} value={s.dayStartHour} onChange={(e) => set('dayStartHour', Math.min(23, Math.max(0, +e.target.value)))} />
        </label>
        <label className="field">Aprender adiantado (minutos)
          <input type="number" min={0} max={120} value={s.learnAheadMinutes} onChange={(e) => set('learnAheadMinutes', Math.max(0, +e.target.value))} />
        </label>
        <label className="field">Ordem de novos × revisões
          <select value={s.newReviewMix} onChange={(e) => set('newReviewMix', e.target.value as S['newReviewMix'])}>
            <option value="mix">Intercalar</option>
            <option value="newFirst">Novos primeiro</option>
            <option value="reviewFirst">Revisões primeiro</option>
          </select>
        </label>
      </section>
      <section className="box">
        <h2>Coleção</h2>
        <div className="row-gap">
          <button onClick={() => go('notetypes')}>Gerenciar tipos de nota</button>
          <button onClick={createSampleDeck}>Criar baralho de exemplo</button>
          <button className="danger" onClick={async () => {
            if (!(await confirmBox('Apagar tudo', 'Apagar TODA a coleção (baralhos, notas, cartões e histórico)? Faça um backup antes.'))) return;
            if (!(await confirmBox('Tem certeza?', 'Esta ação não pode ser desfeita.'))) return;
            replaceCollection(emptyCollection());
            toast('Coleção apagada');
          }}>Apagar coleção</button>
        </div>
      </section>
      <section className="box">
        <h2>Atalhos de teclado (estudo)</h2>
        <table className="small-table">
          <tbody>
            {[
              ['Espaço / Enter', 'Mostrar resposta; depois, responder "Bom"'],
              ['1 2 3 4', 'Errei, Difícil, Bom, Fácil'],
              ['E', 'Editar nota'],
              ['Ctrl+Z ou Z', 'Desfazer'],
              ['-  /  =', 'Enterrar cartão / nota'],
              ['@  /  !', 'Suspender cartão / nota'],
              ['Ctrl+1…7', 'Bandeira'],
              ['R', 'Repetir áudio'],
              ['Ctrl+Enter (editor)', 'Adicionar / salvar'],
              ['Ctrl+Shift+C (editor)', 'Criar omissão (cloze)'],
            ].map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}
          </tbody>
        </table>
      </section>
    </div>
  );
}
