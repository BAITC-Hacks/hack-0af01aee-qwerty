import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, Asterisk, BookOpen, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, FileText, GraduationCap, Layers3, Lightbulb, ListChecks, LoaderCircle, Plus, RotateCcw, ShieldCheck, Sparkles, Target, X } from 'lucide-react';
import type { GenerationResponse, StudyMaterials } from '../shared/types';
import { DEMO_LECTURE } from './demo';
import { freshProgress, generateMaterials, loadSession, STORAGE_KEY } from './lib';
import type { Progress } from './lib';

type Tab = 'summary' | 'points' | 'quiz' | 'cards';
const NAV = [
  { id: 'summary' as const, label: 'Конспект', Icon: BookOpen, description: 'Вся суть, без лишнего', color: 'purple' },
  { id: 'points' as const, label: 'Тезисы', Icon: Target, description: 'То, что важно запомнить', color: 'peach' },
  { id: 'quiz' as const, label: 'Тест', Icon: ListChecks, description: 'Проверьте свои знания', color: 'green' },
  { id: 'cards' as const, label: 'Карточки', Icon: Layers3, description: 'Повторяйте и закрепляйте', color: 'blue' },
];

function Source({ quote }: { quote: string }) {
  return <details className="source"><summary><ShieldCheck size={14} /> Источник в лекции <ChevronDown size={13} /></summary><div className="source-content"><span>ФРАГМЕНТ ИСХОДНОЙ ЛЕКЦИИ</span><blockquote>{quote}</blockquote><small><Check size={12} /> Цитата найдена в тексте лекции</small></div></details>;
}

function App() {
  const [saved] = useState(loadSession);
  const [result, setResult] = useState<GenerationResponse | null>(saved?.result ?? null);
  const [lecture, setLecture] = useState(saved?.lecture ?? '');
  const [progress, setProgress] = useState<Progress>(saved?.progress ?? freshProgress());
  const [tab, setTab] = useState<Tab>('summary');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [health, setHealth] = useState<'checking' | 'ready' | 'unconfigured' | 'offline'>('checking');
  const [help, setHelp] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const request = useRef<AbortController | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal }).then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((data) => setHealth(data.configured ? 'ready' : 'unconfigured')).catch(() => { if (!controller.signal.aborted) setHealth('offline'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!result) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, result, lecture, progress })); setStorageError(false); } catch { setStorageError(true); }
  }, [result, lecture, progress]);
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (help) helpDialog.current?.showModal(); else helpDialog.current?.close(); }, [help]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    const text = lecture.trim();
    if (!text) { setError('Добавьте текст лекции, чтобы начать.'); textarea.current?.focus(); return; }
    if (text.length < 200) { setError('Текст слишком короткий. Добавьте более полный фрагмент лекции — от 200 символов.'); textarea.current?.focus(); return; }
    if (text.length > 30000) { setError('Лекция слишком большая. Оставьте до 30 000 символов.'); return; }
    setError(''); setLoading(true);
    const controller = new AbortController(); request.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 100000);
    try {
      const data = await generateMaterials(text, controller.signal);
      if (controller.signal.aborted) return;
      setLecture(text); setResult(data); setProgress(freshProgress()); setTab('summary'); setHealth('ready');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) {
      if (controller.signal.aborted && !timedOut) return;
      setError(timedOut ? 'Обработка заняла слишком много времени. Попробуйте ещё раз или сократите лекцию.' : cause instanceof Error ? cause.message : 'Не удалось обработать лекцию. Попробуйте ещё раз.');
    } finally { window.clearTimeout(timer); if (request.current === controller) { setLoading(false); request.current = null; } }
  }
  function reset() {
    request.current?.abort(); request.current = null;
    setResult(null); setLecture(''); setProgress(freshProgress()); setLoading(false); setError(''); setTab('summary');
    try { localStorage.removeItem(STORAGE_KEY); } catch { setStorageError(true); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => textarea.current?.focus(), 50);
  }
  const m = result?.materials;
  const score = m?.quiz.filter((q) => progress.answers[q.id] === q.correctAnswer).length ?? 0;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={(e) => e.preventDefault()} aria-label="StudyAI"><span className="brand-symbol"><Asterisk size={29} strokeWidth={2.7} /></span><span>Study<span className="brand-ai">AI</span></span></a>
      <span className="sidebar-caption">ПРОСТРАНСТВО ДЛЯ ЗНАНИЙ</span>
      <button className={`new-lecture ${!m ? 'selected' : ''}`} onClick={reset}><Plus size={18} /> Новая лекция <span>+</span></button>
      <div className="nav-heading">УЧЕБНЫЕ МАТЕРИАЛЫ</div>
      <nav aria-label="Учебные материалы">{NAV.map(({ id, label, Icon }) => <button key={id} disabled={!m} onClick={() => setTab(id)} className={`sidebar-link ${m && tab === id ? 'active' : ''}`}><Icon size={19} />{label}{m && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="learning-note"><span className="little-spark"><Sparkles size={18} /></span><h3>Учиться можно легче</h3><p>Сосредоточьтесь на понимании. Рутину оставьте StudyAI.</p><button onClick={() => setHelp(true)}>Как это работает <ArrowUpRight /></button></div><div className="workspace-person"><span className="avatar"><GraduationCap size={20} /></span><div><strong>Моё пространство</strong><span>Всё для вашего прогресса</span></div><span className="online-dot" /></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumbs"><span className="mobile-brand"><Asterisk size={23} /> StudyAI</span><span className="desktop-crumb">Моё пространство</span><ChevronRight size={14} /><strong>{m ? 'Учебные материалы' : 'Новая лекция'}</strong></div><div className="topbar-right"><span className="hack-badge"><span /> HackAlem AI</span><button className="icon-button" aria-label="Как это работает" onClick={() => setHelp(true)}><CircleHelp size={19} /></button></div></header>
      <main>
        {!m ? <>
          <section className="hero"><div className="eyebrow"><span><Sparkles size={14} /></span> ВАШ ЛИЧНЫЙ AI-ПОМОЩНИК В УЧЁБЕ</div><h1>Понимать больше.<br /><span>Учиться проще.</span><span className="heading-spark">✳</span></h1><p>Превратите лекцию в понятный конспект, тест и карточки.<br className="desktop-break" /> Меньше времени на подготовку — больше на понимание.</p></section>
          <div className="journey" aria-label="Как начать"><div className="current"><span>1</span> Добавьте лекцию</div><i /><div><span>2</span> Получите материалы</div><i /><div><span>3</span> Закрепите знания</div></div>
          <div className="input-grid">
            <section className="lecture-panel">
              <div className="panel-title"><div><span className="panel-icon"><FileText size={20} /></span><div><h2>Ваша лекция</h2><p>Хорошие знания начинаются с одного текста</p></div></div><span className="text-tag">ТЕКСТ</span></div>
              <form onSubmit={handleSubmit}>
                <div className="editor-wrap"><label className="sr-only" htmlFor="lecture">Текст лекции</label><textarea ref={textarea} id="lecture" placeholder={'Вставьте текст лекции сюда…\n\nЭто могут быть записи с пары, глава из учебника или материал, который хочется наконец понять.'} value={lecture} disabled={loading} maxLength={30001} aria-invalid={!!error} aria-describedby={error ? 'form-error lecture-count' : 'lecture-count'} onChange={(e) => { setLecture(e.target.value); setError(''); }} /><div className="editor-bottom"><span><span className="input-dot" /> Только текст, только суть</span><span id="lecture-count" className={lecture.length > 30000 ? 'count-error' : ''}>{lecture.length.toLocaleString('ru-RU')} / 30 000</span></div></div>
                {error && <div className="form-error" id="form-error" role="alert"><CircleHelp size={17} /><span>{error}</span></div>}
                {loading ? <div className="processing" role="status" aria-live="polite"><div className="processing-top"><span className="processing-icon"><LoaderCircle className="spin" size={23} /></span><div><strong>{elapsed < 35 ? 'Превращаем лекцию в знания…' : 'Проверяем и собираем материалы…'}</strong><p>Анализ текста, подготовка материалов и проверка источников.</p></div><span className="elapsed">{elapsed} с</span></div><div className="indeterminate"><span /></div><div className="processing-foot"><small>Один запрос может занять до 90 секунд.</small><button type="button" onClick={() => { request.current?.abort(); setLoading(false); }}>Отменить</button></div></div> : <div className="form-actions"><button className="example-button" type="button" onClick={() => { setLecture(DEMO_LECTURE); setError(''); textarea.current?.focus(); }}><Sparkles size={16} /> Попробовать пример</button><button className="primary-button" type="submit"><Sparkles size={17} /> Создать материалы <ArrowRight size={17} /></button></div>}
              </form>
              <div className="input-note"><ShieldCheck size={14} /><span>Материалы по вашему тексту, с проверяемыми цитатами</span></div>
            </section>
            <aside className="outcome-panel"><div className="outcome-heading"><span className="section-kicker">ОДНА ЛЕКЦИЯ — ЧЕТЫРЕ ИНСТРУМЕНТА</span><h2>Всё, чтобы разобраться</h2></div><div className="outcome-list">{NAV.map(({ id, label, description, Icon, color }) => <div className="outcome" key={id}><span className={`tool-icon ${color}`}><Icon size={21} /></span><div><h3>{label === 'Тест' ? 'Интерактивный тест' : label}</h3><p>{description}</p></div><Check size={15} className="outcome-check" /></div>)}</div><div className="trust-card"><div><span className="trust-icon"><ShieldCheck size={22} /></span><span className="trust-tag">НАША СУПЕРСИЛА</span></div><h3>Знания с опорой на источник</h3><p>У каждого материала есть цитата из лекции. Откройте источник и убедитесь сами.</p><div className="source-preview"><ShieldCheck size={13} /> Источник в лекции <ChevronDown size={12} /></div></div></aside>
          </div>
          <section className="bottom-note"><span className="note-icon"><Lightbulb size={20} /></span><div><h3>От «я это читал» к «я это знаю»</h3><p>Читайте конспект, проверяйте себя в тесте и возвращайтесь к сложному в карточках.</p></div><span className="handwritten">маленькими шагами <ArrowRight size={18} /></span></section>
          {health !== 'ready' && health !== 'checking' && <p className="connection-note" role="status"><span className="status-dot" />{health === 'unconfigured' ? 'AI ещё не подключён. Для генерации добавьте OPENAI_API_KEY в серверный .env и перезапустите backend.' : 'Backend пока недоступен. Запустите приложение командой npm run dev.'}</p>}
        </> : <>
          <div className="results-heading"><div><div className="eyebrow"><CheckCheck size={16} /> ВАШИ МАТЕРИАЛЫ ГОТОВЫ</div><h1>{m.lectureTitle}</h1><div className="result-meta"><span><FileText size={14} /> {lecture.length.toLocaleString('ru-RU')} символов</span><span><Clock3 size={14} /> ~{Math.max(1, Math.ceil(m.summary.sections.map((s) => s.content).join(' ').split(/\s+/).length / 180))} мин на конспект</span><span className="verified"><ShieldCheck size={14} /> Цитаты проверены</span></div></div><button className="secondary-button" onClick={reset}><Plus size={17} /> Обработать другую лекцию</button></div>
          <nav className="material-tabs" aria-label="Раздел материалов">{NAV.map(({ id, label, Icon }) => <button key={id} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={18} />{label}<span>{id === 'summary' ? m.summary.sections.length : id === 'points' ? m.keyPoints.length : id === 'quiz' ? m.quiz.length : m.flashcards.length}</span></button>)}</nav>
          <div className="study-layout"><div className="study-content" key={tab}>
            {tab === 'summary' && <Summary materials={m} read={progress.summaryRead} onRead={() => setProgress((p) => ({ ...p, summaryRead: !p.summaryRead }))} onNext={() => setTab('quiz')} />}
            {tab === 'points' && <section className="material-section"><SectionTitle icon={<Target size={22} />} title="Самое важное" subtitle="Ключевые мысли, к которым стоит возвращаться" /><div className="key-points">{m.keyPoints.map((p, i) => <article className="key-point" key={i}><span>{String(i + 1).padStart(2, '0')}</span><div><p>{p.point}</p><Source quote={p.sourceQuote} /></div></article>)}</div><button className="secondary-button" onClick={() => setTab('quiz')}>Проверить себя <ArrowRight size={16} /></button></section>}
            {tab === 'quiz' && <Quiz materials={m} progress={progress} setProgress={setProgress} onCards={() => setTab('cards')} />}
            {tab === 'cards' && <Flashcards materials={m} progress={progress} setProgress={setProgress} />}
          </div><aside className="study-aside"><div className="progress-card"><span className="section-kicker">ШАГ ЗА ШАГОМ</span><h3>Ваш прогресс</h3><ProgressRow checked label="Материалы готовы" /><ProgressRow checked={progress.summaryRead} label="Конспект изучен" /><ProgressRow checked={progress.submitted} label={progress.submitted ? `Тест: ${score} / ${m.quiz.length} · ${Math.round(score / m.quiz.length * 100)}%` : 'Проверьте себя в тесте'} /><ProgressRow checked={progress.seen.length === m.flashcards.length} label={`Карточки: ${progress.seen.length} / ${m.flashcards.length}`} /><div className="progress-bar"><span style={{ width: `${(1 + Number(progress.summaryRead) + Number(progress.submitted) + progress.seen.length / m.flashcards.length) * 25}%` }} /></div><p>{storageError ? 'Сохранение недоступно. Прогресс останется до закрытия страницы.' : 'Прогресс сохраняется в этом браузере.'}</p></div><div className="grounding-note"><ShieldCheck size={24} /><h3>Можно проверить</h3><p>Сервер нашёл все {result.grounding.checkedQuotes} цитат в тексте лекции. Откройте источник, чтобы проверить смысл.</p></div><details className="original-lecture"><summary><FileText size={16} /> Исходная лекция <ChevronDown size={14} /></summary><p>{lecture}</p></details></aside></div>
        </>}
        <footer><span>StudyAI <span className="footer-dot">·</span> Сделано для тех, кто учится</span><span><ShieldCheck size={13} /> В основе — ваша лекция</span></footer>
      </main>
    </div>
    <dialog ref={helpDialog} className="help-dialog" onCancel={() => setHelp(false)} onClick={(event) => { if (event.target === event.currentTarget) setHelp(false); }}><button className="dialog-close icon-button" aria-label="Закрыть" onClick={() => setHelp(false)}><X size={20} /></button><span className="tool-icon purple"><Sparkles size={24} /></span><h2>Из лекции — в знания</h2><p className="dialog-intro">Три простых шага к осмысленной подготовке.</p><ol><li><strong>Добавьте текст</strong><p>Вставьте от 200 до 30 000 символов или попробуйте пример.</p></li><li><strong>Изучите материалы</strong><p>AI создаст конспект, тезисы, тест и карточки. Утверждения сопровождаются цитатами из лекции.</p></li><li><strong>Проверьте и закрепите</strong><p>Пройдите тест, разберите ошибки и повторите сложное на карточках.</p></li></ol><div className="dialog-privacy"><ShieldCheck size={18} /><p>При генерации текст передаётся OpenAI. Последняя лекция и прогресс хранятся в этом браузере. «Новая лекция» очищает сохранённую сессию.</p></div><button className="primary-button" onClick={() => setHelp(false)}>Понятно, начнём <ArrowRight size={16} /></button></dialog>
  </div>;
}

function ArrowUpRight() { return <ArrowRight size={14} style={{ transform: 'rotate(-35deg)' }} />; }
function SectionTitle({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) { return <div className="section-title"><span className="tool-icon purple">{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>; }
function ProgressRow({ checked, label }: { checked: boolean; label: string }) { return <div className={`progress-row ${checked ? 'done' : ''}`}><span>{checked ? <Check size={12} /> : <span />}</span>{label}</div>; }

function Summary({ materials: m, read, onRead, onNext }: { materials: StudyMaterials; read: boolean; onRead: () => void; onNext: () => void }) {
  return <section className="material-section"><SectionTitle icon={<BookOpen size={22} />} title="Разобраться в главном" subtitle="Структурированный конспект вашей лекции" /><div className="overview-card"><span className="section-kicker"><Sparkles size={13} /> ЕСЛИ КОРОТКО</span><p>{m.summary.overview.text}</p><Source quote={m.summary.overview.sourceQuote} /></div>{m.summary.sections.map((section, i) => <article className="summary-section" key={i}><div className="summary-section-heading"><span>{String(i + 1).padStart(2, '0')}</span><h3>{section.title}</h3></div><p>{section.content}</p><div className="concepts">{section.concepts.map((concept, j) => <span key={j}>{concept}</span>)}</div><Source quote={section.sourceQuote} /></article>)}{m.summary.definitions.length > 0 && <div className="definitions"><h3><Lightbulb size={19} /> Важные определения</h3>{m.summary.definitions.map((d, i) => <div key={i}><p><strong>{d.term}</strong> — {d.definition}</p><Source quote={d.sourceQuote} /></div>)}</div>}<div className="conclusion"><h3>Что стоит запомнить</h3><p>{m.summary.conclusion.text}</p><Source quote={m.summary.conclusion.sourceQuote} /></div><div className="summary-actions"><button className={`secondary-button ${read ? 'read-button' : ''}`} onClick={onRead}><Check size={16} />{read ? 'Конспект изучен' : 'Отметить как изученный'}</button><button className="primary-button" onClick={onNext}>Перейти к тесту <ArrowRight size={16} /></button></div></section>;
}

type StudyProps = { materials: StudyMaterials; progress: Progress; setProgress: React.Dispatch<React.SetStateAction<Progress>> };
function Quiz({ materials: m, progress: p, setProgress, onCards }: StudyProps & { onCards: () => void }) {
  const [notice, setNotice] = useState('');
  const score = m.quiz.filter((q) => p.answers[q.id] === q.correctAnswer).length;
  const answered = m.quiz.filter((q) => p.answers[q.id] !== undefined).length;
  const percentage = Math.round(score / m.quiz.length * 100);
  function finish(event: FormEvent) { event.preventDefault(); if (answered < m.quiz.length) { setNotice(`Ответьте на все вопросы. Осталось: ${m.quiz.length - answered}.`); return; } setNotice(''); setProgress((prev) => ({ ...prev, submitted: true })); window.scrollTo({ top: 150, behavior: 'smooth' }); }
  return <section className="material-section"><SectionTitle icon={<ListChecks size={22} />} title={p.submitted ? 'Ваш результат' : 'Проверим, что запомнилось?'} subtitle={p.submitted ? 'Разберите ответы и вернитесь к сложным темам' : 'Один правильный ответ в каждом вопросе. Без подсказок до финиша.'} />{p.submitted ? <div className="quiz-result" role="status"><div className="score-circle" style={{ '--score': `${percentage}%` } as React.CSSProperties}><strong>{percentage}<small>%</small></strong></div><div><span className="section-kicker">ТЕСТ ЗАВЕРШЁН</span><h3>{score} / {m.quiz.length} правильных ответов</h3><p>{percentage === 100 ? 'Всё верно! Закрепите знания с карточками.' : 'Ошибки — подсказка, что стоит повторить.'}</p><button className="text-button" onClick={onCards}>Повторить с карточками <ArrowRight size={15} /></button></div></div> : <div className="quiz-status"><span>Ответов: <strong>{answered} / {m.quiz.length}</strong></span><div className="progress-bar"><span style={{ width: `${answered / m.quiz.length * 100}%` }} /></div></div>}<form onSubmit={finish}>{m.quiz.map((q, i) => <fieldset className="quiz-question" key={q.id}><legend><span>ВОПРОС {i + 1}</span><h3>{q.question}</h3></legend><div className="quiz-options">{q.options.map((option, n) => { const selected = p.answers[q.id] === n; const correct = p.submitted && q.correctAnswer === n; const incorrect = p.submitted && selected && !correct; return <label key={n} className={`quiz-option ${selected ? 'chosen' : ''} ${correct ? 'correct' : ''} ${incorrect ? 'incorrect' : ''} ${p.submitted ? 'is-submitted' : ''}`}><input type="radio" name={q.id} value={n} checked={selected} disabled={p.submitted} onChange={() => { setNotice(''); setProgress((prev) => ({ ...prev, answers: { ...prev.answers, [q.id]: n } })); }} /><span className="option-letter">{String.fromCharCode(65 + n)}</span><span>{option}</span>{correct ? <Check size={17} /> : incorrect ? <X size={17} /> : selected ? <span className="selected-radio" /> : null}{p.submitted && (correct || incorrect) && <span className="sr-only">{correct ? 'Правильный ответ' : 'Ваш ответ неверный'}</span>}</label>; })}</div>{p.submitted && <div className={`answer-explanation ${p.answers[q.id] === q.correctAnswer ? 'right' : 'wrong'}`}><strong>{p.answers[q.id] === q.correctAnswer ? 'Верно' : 'Есть что повторить'}</strong><p>{q.explanation}</p><Source quote={q.sourceQuote} /></div>}</fieldset>)}{notice && <p className="form-error" role="alert">{notice}</p>}<div className="quiz-actions">{p.submitted ? <button className="secondary-button" type="button" onClick={() => { setProgress((prev) => ({ ...prev, answers: {}, submitted: false })); setNotice(''); window.scrollTo({ top: 150, behavior: 'smooth' }); }}><RotateCcw size={16} /> Пройти ещё раз</button> : <><span>Ваши ответы сохраняются автоматически</span><button className="primary-button" type="submit">Завершить тест <ArrowRight size={16} /></button></>}</div></form></section>;
}

function Flashcards({ materials: m, progress: p, setProgress }: StudyProps) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [onlyDifficult, setOnlyDifficult] = useState(false);
  const cards = onlyDifficult ? m.flashcards.filter((c) => p.difficult.includes(c.id)) : m.flashcards;
  const safeIndex = Math.min(index, Math.max(cards.length - 1, 0));
  const card = cards[safeIndex];
  function move(delta: number) { setIndex((safeIndex + delta + cards.length) % cards.length); setFlipped(false); }
  function flip() { setFlipped((v) => !v); if (card && !p.seen.includes(card.id)) setProgress((prev) => ({ ...prev, seen: [...prev.seen, card.id] })); }
  function mark(difficult: boolean) { if (!card) return; setProgress((prev) => ({ ...prev, seen: [...new Set([...prev.seen, card.id])], difficult: difficult ? [...new Set([...prev.difficult, card.id])] : prev.difficult.filter((id) => id !== card.id) })); if (onlyDifficult && !difficult) { setIndex(0); setFlipped(false); } else move(1); }
  return <section className="material-section flashcard-section"><SectionTitle icon={<Layers3 size={22} />} title="Повторить. Вспомнить. Запомнить." subtitle="Сначала попробуйте ответить, затем переверните карточку" /><div className="card-toolbar"><span><Layers3 size={15} /> Просмотрено {p.seen.length} из {m.flashcards.length}</span><button className={onlyDifficult ? 'filter-button active' : 'filter-button'} onClick={() => { setOnlyDifficult((v) => !v); setIndex(0); setFlipped(false); }}>{onlyDifficult ? 'Показать все' : `Сложные (${p.difficult.length})`}</button></div>{card ? <><div className="flashcard-stage"><button className={`flashcard ${flipped ? 'flipped' : ''}`} onClick={flip} aria-label={flipped ? 'Показать вопрос' : 'Перевернуть карточку'}><span className="flashcard-face front" aria-hidden={flipped}><span className="flashcard-kicker">ВОПРОС <span>{String(safeIndex + 1).padStart(2, '0')}</span></span><span className="flashcard-text">{card.front}</span><span className="flip-hint"><RotateCcw size={15} /> Нажмите, чтобы увидеть ответ</span><Asterisk className="card-decoration" size={130} strokeWidth={0.8} /></span><span className="flashcard-face back" aria-hidden={!flipped}><span className="flashcard-kicker">ОТВЕТ <CheckCheck size={18} /></span><span className="flashcard-text">{card.back}</span><span className="flip-hint"><RotateCcw size={15} /> Вернуться к вопросу</span></span></button></div><div className="card-navigation"><button className="secondary-button" disabled={cards.length < 2} onClick={() => move(-1)} aria-label="Предыдущая карточка"><ArrowLeft size={17} /><span>Предыдущая</span></button><span>{safeIndex + 1} <span>/ {cards.length}</span></span><button className="secondary-button" disabled={cards.length < 2} onClick={() => move(1)} aria-label="Следующая карточка"><span>Следующая</span><ArrowRight size={17} /></button></div>{flipped && <div className="card-review"><Source key={card.id} quote={card.sourceQuote} /><div><button className="secondary-button" onClick={() => mark(true)}><RotateCcw size={16} /> Ещё повторить</button><button className="primary-button" onClick={() => mark(false)}><Check size={16} /> Знаю</button></div></div>}<p className="card-tip"><Lightbulb size={15} /> Сначала вспомните ответ сами — так повторение полезнее.</p></> : <div className="empty-cards"><CheckCheck size={35} /><h3>Сложных карточек пока нет</h3><p>Отмечайте «Ещё повторить» после просмотра ответа.</p><button className="secondary-button" onClick={() => setOnlyDifficult(false)}>Ко всем карточкам <ArrowRight size={16} /></button></div>}</section>;
}

export default App;
