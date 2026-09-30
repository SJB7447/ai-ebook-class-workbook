(() => {
  const STORAGE_KEY = 'ai-ebook-class-workbook-v1';
  const defaults = {
    fields: { mood: '따뜻하고 친근한, 크림색과 오렌지, 손그림 느낌' },
    genre: 'practical',
    part: 1,
    checks: {},
    completedSteps: [],
    currentStep: 1,
    classCompleted: false,
    timer: { running: false, remaining: 7200, updatedAt: null }
  };
  const genreNames = { practical: '실용서', fiction: '소설', essay: '에세이' };
  let state = loadState();
  let toastTimer;
  let clockTimer;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const field = (name) => (state.fields[name] || '').trim();
  const genreHints = {
    practical: { guide: '실용서: ‘누가, 어떤 문제를, 어떤 방법으로 해결하는가?’를 한 문장으로 적어보세요.', benefit: '독자가 얻게 될 것', benefitPlaceholder: '예: 바로 실천할 단골 관리 방법', final: '체크리스트·마무리' },
    fiction: { guide: '소설: ‘어디서, 누가, 어떤 갈등을 겪고 무엇을 선택하는가?’를 적어보세요.', benefit: '독자가 따라갈 갈등·질문', benefitPlaceholder: '예: 두 사람이 오래 숨긴 비밀을 밝힐지', final: '결말·작가의 말' },
    essay: { guide: '에세이: ‘어떤 실제 장면에서 무엇을 떠올리고 어떤 의미를 찾는가?’를 적어보세요.', benefit: '독자에게 남길 감정·생각', benefitPlaceholder: '예: 익숙한 공간과 이별하며 배운 관계의 의미', final: '맺음말·저자 소개' }
  };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      const fields = { ...defaults.fields, ...(saved?.fields || {}) };
      // Earlier versions used one textarea for all four PARTs. Preserve that text.
      if (fields.manuscript && ![1, 2, 3, 4].some(part => fields[`manuscriptPart${part}`])) {
        fields.manuscriptPart1 = fields.manuscript;
      }
      if (fields.imageNotes && !fields.coverImageNotes && !fields.illustrationNotes) {
        fields.coverImageNotes = fields.imageNotes;
      }
      return {
        ...structuredClone(defaults),
        ...saved,
        genre: genreNames[saved?.genre] ? saved.genre : 'practical',
        part: [1, 2, 3, 4].includes(Number(saved?.part)) ? Number(saved.part) : 1,
        fields,
        checks: { ...(saved?.checks || {}) },
        timer: { ...defaults.timer, ...(saved?.timer || {}) }
      };
    } catch { return structuredClone(defaults); }
  }

  function saveState(showStatus = true) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (showStatus) {
      const status = $('#saveStatus');
      status.innerHTML = '<span></span> 저장 중…';
      setTimeout(() => { status.innerHTML = '<span></span> 자동 저장됨'; }, 350);
    }
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1700);
  }

  function hydrateInputs() {
    $$('[data-field]').forEach(el => { el.value = state.fields[el.dataset.field] || ''; });
    $$('[data-check]').forEach(el => { el.checked = Boolean(state.checks[el.dataset.check]); });
    const selectedMood = field('mood');
    $$('.mood-card').forEach(card => card.classList.toggle('selected', card.dataset.mood === selectedMood));
    $$('.genre-card').forEach(card => {
      const selected = card.dataset.genre === state.genre;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-checked', String(selected));
    });
    updatePartResultUI();
  }

  function updatePartResultUI() {
    $$('.part-button').forEach(button => {
      const part = Number(button.dataset.part);
      button.classList.toggle('selected', part === state.part);
      button.classList.toggle('has-answer', Boolean(field(`manuscriptPart${part}`)));
      button.setAttribute('aria-pressed', String(part === state.part));
    });
    $('#partResultLabel').textContent = `PART ${state.part}`;
    $('[data-part-result]').value = state.fields[`manuscriptPart${state.part}`] || '';
    $('#partSaveHint').textContent = field(`manuscriptPart${state.part}`)
      ? `PART ${state.part} 답변이 이 브라우저에 저장되었습니다. 다른 PART를 눌러도 유지됩니다.`
      : `PART ${state.part} 답변은 비어 있습니다.`;
  }

  function fallback(value, text) { return value || `[${text}]`; }

  function updatePrompts() {
    const topic = fallback(field('topic'), '전자책 주제');
    const reader = fallback(field('reader'), '읽을 사람');
    const benefit = fallback(field('benefit'), genreHints[state.genre].benefit);
    const title = fallback(field('title'), '책 제목');
    const mood = fallback(field('mood'), '원하는 분위기');
    const scene = fallback(field('scene'), state.genre === 'fiction' ? `${topic}의 중요한 장면` : state.genre === 'essay' ? `${topic}과 연결되는 실제 기억의 장면` : `${topic}을 실천하는 자연스러운 장면`);
    const genre = genreNames[state.genre];
    const outlineInstruction = {
      practical: '각 PART에 독자가 바로 해볼 수 있는 소주제 4개를 배치하고, 마지막 쪽에는 실천 체크리스트를 제안해 주세요.',
      fiction: '각 PART에 장면 4개를 배치하고, 인물의 목표·갈등·선택·결말이 이어지게 해 주세요. 마지막 쪽은 결말과 작가의 말에 활용합니다.',
      essay: '각 PART에 실제 장면이나 기억 4개를 배치하고, 장면에서 생각의 변화가 자연스럽게 드러나게 해 주세요. 마지막 쪽은 맺음말과 저자 소개에 활용합니다.'
    }[state.genre];
    const pageInstruction = {
      practical: '각 쪽은 소제목, 공감되는 도입, 핵심 설명, 바로 해볼 방법, 마지막 실천 팁으로 구성해 주세요.',
      fiction: '각 쪽은 소제목, 장면의 장소와 인물, 새로 생기는 사건, 인물의 반응, 다음 장면으로 이어지는 변화로 구성해 주세요. 설명보다 행동과 대화를 살려 주세요.',
      essay: '각 쪽은 소제목, 실제 있었던 장면, 그때의 감각이나 생각, 지금 돌아본 의미로 구성해 주세요. 겪지 않은 일을 사실처럼 만들어내지 말고 필요한 정보는 질문해 주세요.'
    }[state.genre];
    const outline = field('outline');
    const outlineContext = outline ? `\n\n확정한 목차:\n${outline}` : '\n\n앞서 만든 목차가 없다면 PART 제목과 소주제를 먼저 간단히 정해 주세요.';

    $('#planPrompt').textContent = `당신은 초보자를 돕는 ${genre} 전자책 편집자입니다.\n\n책 종류: ${genre}\n주제: ${topic}\n읽을 사람: ${reader}\n${genreHints[state.genre].benefit}: ${benefit}\n\n20쪽 안팎의 작은 전자책 설계도만 만들어 주세요.\n1. 제목 후보 3개와 부제 후보 3개\n2. 프롤로그의 핵심 내용\n3. 네 개의 PART 제목과 각 PART의 소주제 4개\n4. 마지막 쪽에 넣을 내용\n\n${outlineInstruction}\n비슷한 내용은 합치고 범위가 넓은 곳은 짚어 주세요. 아직 본문은 쓰지 마세요.`;

    $('#manuscriptPrompt').textContent = `당신은 ${genre} 전자책 편집자입니다. 「${title}」의 PART ${state.part}에 들어갈 원고 4쪽을 작성해 주세요.\n주제: ${topic}\n읽을 사람: ${reader}\n${genreHints[state.genre].benefit}: ${benefit}${outlineContext}\n\n${pageInstruction}\n쪽마다 약 250~350자 초안으로 쓰고, 각 쪽 사이는 --- 한 줄로 구분해 주세요. 반복되는 문장은 줄이고, 확인되지 않은 사실이나 나의 경험을 지어내지 마세요.`;

    const visualSubject = state.genre === 'practical' ? `${topic}을 떠올리게 하는 물건이나 공간` : state.genre === 'fiction' ? `${topic}의 핵심 장소나 상징적인 장면` : `${topic}과 연결되는 실제 공간이나 사물`;
    $('#coverImagePrompt').textContent = `${genre} 「${title}」의 세로형 전자책 표지 배경. ${visualSubject}. ${mood}. ${reader}이 책의 분위기를 짐작할 수 있는 단순하고 선명한 구도. 제목을 Canva에서 넣을 수 있도록 넓은 여백 확보. 고품질, 세로 3:4 비율. 이미지 안에 글자, 문자, 로고, 워터마크는 넣지 말 것.`;

    $('#illustrationPrompt').textContent = `${scene}. ${mood}. ${genre} 본문에 어울리는 삽화, 한눈에 알아볼 수 있는 구도, 가로 4:3 비율, 고품질. 이미지 안에 글자, 문자, 로고, 워터마크는 넣지 말 것.`;
  }

  function updateGenre() {
    const info = genreHints[state.genre];
    $('#genreGuide').textContent = info.guide;
    $('#benefitLabel').firstChild.textContent = `${info.benefit} `;
    $('[data-field="benefit"]').placeholder = info.benefitPlaceholder;
    $('#finalPageLabel').textContent = info.final;
  }

  function updatePreview() {
    $('#previewGenre').textContent = { practical: 'PRACTICAL GUIDE', fiction: 'SHORT FICTION', essay: 'PERSONAL ESSAY' }[state.genre];
    $('#previewTitle').textContent = field('title') || '나의 전자책 제목';
    $('#previewSubtitle').textContent = field('subtitle') || '부제와 독자가 얻을 이익';
    $('#previewAuthor').textContent = field('coverAuthor') || field('author') || '저자명';
    $('#finishTitle').textContent = field('title') || '나의 첫 전자책';

    const mood = field('mood');
    const preview = $('#bookPreview');
    if (mood.includes('전문')) preview.style.background = '#9cc8e7';
    else if (mood.includes('활기')) preview.style.background = '#c6dc6b';
    else preview.style.background = '#f4a963';
  }

  function getPages() {
    return [1, 2, 3, 4].flatMap(part => {
      const text = field(`manuscriptPart${part}`);
      if (!text) return [];
      const split = text.split(/\n\s*---+\s*\n/g).map(x => x.trim()).filter(Boolean);
      const headingSplit = split.length > 1 ? split : text.split(/(?=\n(?:#{1,3}\s+|(?:페이지|PAGE)\s*\d+))/gi).map(x => x.trim()).filter(Boolean);
      const sections = headingSplit.length > 1 ? headingSplit : [text];
      return sections.map((section, index) => ({
        part,
        no: index < 4 ? String(4 + (part - 1) * 4 + index).padStart(2, '0') : '추가',
        text: section
      }));
    });
  }

  function transferBlocks() {
    const pages = getPages();
    const blocks = [
      { no: '01', title: '표지', text: [field('title'), field('subtitle'), field('coverLine'), field('coverAuthor') || field('author')].filter(Boolean).join('\n') },
      { no: '02', title: '프롤로그', text: field('prologue') },
      { no: '03', title: '목차', text: field('outline') }
    ];
    pages.forEach(page => blocks.push({ no: page.no, title: `PART ${page.part} · ${firstLine(page.text) || '본문'}`, text: page.text }));
    if (field('ending')) blocks.push({ no: '20', title: genreHints[state.genre].final, text: field('ending') });
    return blocks;
  }

  function firstLine(text) {
    return (text.split('\n').find(line => line.trim()) || '').replace(/^#+\s*/, '').slice(0, 55);
  }

  function renderTransfer() {
    const root = $('#transferList');
    root.replaceChildren();
    const pages = getPages();
    const savedParts = [1, 2, 3, 4].filter(part => field(`manuscriptPart${part}`)).length;
    $('#pageCount').textContent = `본문 ${pages.length}쪽 감지 · PART ${savedParts}/4 저장 · 20쪽은 예시 구성`;
    const blocks = transferBlocks().filter(block => block.text);
    if (!blocks.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-transfer';
      empty.textContent = '1단계에서 확정한 프롤로그·목차와 PART별 답변을 입력하면 여기에 정리됩니다.';
      root.append(empty);
      return;
    }
    blocks.forEach(block => {
      const item = document.createElement('div');
      item.className = 'transfer-item';
      const no = document.createElement('b'); no.textContent = block.no;
      const content = document.createElement('div');
      const h = document.createElement('h4'); h.textContent = block.title;
      const p = document.createElement('p'); p.textContent = block.text;
      content.append(h, p);
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '이 블록 복사';
      button.addEventListener('click', () => copyText(`${block.title}\n\n${block.text}`));
      item.append(no, content, button);
      root.append(item);
    });
  }

  function progressValue() {
    const stepProgress = state.completedSteps.length * 20;
    if (state.classCompleted) return 100;
    return Math.min(95, stepProgress);
  }

  function updateProgress() {
    const value = progressValue();
    $('#progressPercent').textContent = `${value}%`;
    $('#progressBar').style.width = `${value}%`;
    $$('.step-link').forEach(link => link.classList.toggle('done', state.completedSteps.includes(Number(link.dataset.step))));
    $('#completionCard').classList.toggle('completed', state.classCompleted);
    $('#completeButton').textContent = state.classCompleted ? '완료되었습니다 ✓' : '수업 완료하기';
  }

  function goToStep(step) {
    state.currentStep = Math.max(1, Math.min(5, Number(step)));
    $$('.step-panel').forEach(panel => panel.classList.toggle('active', Number(panel.dataset.panel) === state.currentStep));
    $$('.step-link').forEach(link => link.classList.toggle('active', Number(link.dataset.step) === state.currentStep));
    $$('#stepDots span').forEach((dot, index) => dot.classList.toggle('active', index + 1 === state.currentStep));
    $('#prevButton').disabled = state.currentStep === 1;
    $('#nextButton').textContent = state.currentStep === 5 ? '최종 점검 완료' : '저장하고 다음 단계';
    saveState(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const temp = document.createElement('textarea');
      temp.value = text; temp.style.position = 'fixed'; temp.style.opacity = '0';
      document.body.append(temp); temp.select(); document.execCommand('copy'); temp.remove();
    }
    showToast('복사했습니다. AI 또는 Canva에 붙여넣으세요.');
  }

  function fillSample(type = 'cafe') {
    const samples = {
      cafe: { genre: 'practical', author: '김지혜', topic: '작은 카페에서 단골을 만드는 방법', reader: '카페를 처음 운영하는 사장님', benefit: '바로 실천할 수 있는 단골 관리 방법 16가지', title: '오늘부터 단골 카페', subtitle: '작은 가게에서 바로 쓰는 고객관리 16가지', coverAuthor: '김지혜 지음', coverLine: '손님이 다시 오게 만드는 작은 습관', scene: '햇살이 들어오는 작은 동네 카페에서 단골손님을 반갑게 맞는 사장님', filename: '오늘부터_단골카페_김지혜' },
      career: { genre: 'practical', author: '박성호', topic: '50대 신중년의 재취업 준비', reader: '경력은 많지만 다시 시작이 막막한 50대 구직자', benefit: '나의 경력을 강점으로 바꾸는 재취업 준비 순서', title: '다시, 일할 시간', subtitle: '신중년을 위한 재취업 준비 노트', coverAuthor: '박성호 지음', coverLine: '경력은 끝이 아니라 새로운 출발점입니다', scene: '밝은 책상에서 노트북과 이력서를 정리하는 50대 한국인 구직자', filename: '다시_일할시간_박성호' },
      home: { genre: 'practical', author: '이수민', topic: '냉장고 정리로 한 달 식비 줄이기', reader: '장본 식재료를 자주 버리는 1인 가구와 주부', benefit: '재료를 남김없이 쓰는 정리와 식단 습관', title: '냉장고가 가벼워졌다', subtitle: '버리는 식재료 없이 식비를 줄이는 16가지 습관', coverAuthor: '이수민 지음', coverLine: '정리 한 번으로 장보기와 식사가 쉬워집니다', scene: '종류별로 깔끔하게 정리된 밝은 가정집 냉장고와 식재료 바구니', filename: '냉장고가_가벼워졌다_이수민' },
      fiction: { genre: 'fiction', author: '한지우', topic: '막차가 끊긴 해안역에서 재회한 두 사람이 오래 숨긴 비밀을 밝힐지 결정하는 이야기', reader: '짧지만 여운이 남는 관계 이야기를 좋아하는 독자', benefit: '두 사람이 과거의 비밀을 밝히고 다시 서로를 믿을 수 있을지', title: '마지막 열차가 떠난 뒤', subtitle: '해안역에서 다시 만난 두 사람의 밤', coverAuthor: '한지우 지음', coverLine: '끝난 줄 알았던 이야기가 다시 시작된다', scene: '늦은 밤 불이 켜진 작은 해안역 플랫폼에 마주 선 두 사람의 뒷모습', filename: '마지막_열차가_떠난_뒤_한지우' },
      essay: { genre: 'essay', author: '윤서연', topic: '작은 카페의 마지막 영업일에 떠올린 다섯 장면과 일의 의미', reader: '일과 공간을 정리하며 새로운 시작을 준비하는 사람', benefit: '익숙한 공간과 이별하며 발견한 관계와 일의 의미', title: '마지막 잔을 내린 날', subtitle: '작은 카페에서 배운 일과 이별', coverAuthor: '윤서연 지음', coverLine: '문을 닫는 날에야 보인 것들', scene: '해 질 무렵 문을 닫기 전 작은 카페의 빈 의자와 반쯤 남은 커피잔', filename: '마지막_잔을_내린_날_윤서연' }
    };
    const sample = samples[type] || samples.cafe;
    if (['topic', 'title', 'reader'].some(key => field(key)) && !window.confirm('예시를 적용하면 현재 책 정보가 바뀝니다. 목차와 원고는 지워지지 않습니다. 계속할까요?')) return;
    state.genre = sample.genre;
    const { genre, ...fields } = sample;
    Object.assign(state.fields, fields);
    hydrateInputs(); updateAll(); saveState();
    showToast('예시를 채웠습니다. 이름·주제·독자를 내 내용으로 바꿔보세요.');
  }

  function compileWorkbookText() {
    const answers = [
      ['AI 책 설계 답변 원본', field('planResponse')],
      ...[1, 2, 3, 4].map(part => [`PART ${part} 답변`, field(`manuscriptPart${part}`)]),
      ['표지 이미지 결과 메모', field('coverImageNotes')],
      ['삽화 이미지 결과 메모', field('illustrationNotes')]
    ].filter(([, value]) => value).map(([label, value]) => `[${label}]\n${value}`).join('\n\n--------------------------------\n\n');
    return `AI 전자책 디자인·출판 클래스 — 실습 작업노트\n\n책 종류: ${genreNames[state.genre]}\n책 제목: ${field('title')}\n부제: ${field('subtitle')}\n저자: ${field('author')}\n독자: ${field('reader')}\n${genreHints[state.genre].benefit}: ${field('benefit')}\n표지 분위기: ${field('mood')}\n\n======= Canva로 옮길 최종 내용 =======\n\n${compileCanvaText()}\n\n======= AI 답변 및 작업 메모 =======\n\n${answers}`;
  }

  function compileCanvaText() {
    return transferBlocks().filter(block => block.text)
      .map(block => `[${block.no}] ${block.title}\n${block.text}`)
      .join('\n\n--------------------------------\n\n');
  }

  function downloadWorkbook() {
    const blob = new Blob([compileWorkbookText()], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    const safeName = (field('filename') || field('title') || '나의_전자책').replace(/[\\/:*?"<>|.]+/g, '_');
    link.href = URL.createObjectURL(blob); link.download = `${safeName}_작업노트.txt`;
    link.click(); URL.revokeObjectURL(link.href);
    showToast('워크북 작업 내용을 저장했습니다.');
  }

  function updateClock() {
    if (state.timer.running && state.timer.updatedAt) {
      const elapsed = Math.floor((Date.now() - state.timer.updatedAt) / 1000);
      if (elapsed > 0) {
        state.timer.remaining = Math.max(0, state.timer.remaining - elapsed);
        state.timer.updatedAt = Date.now();
        if (state.timer.remaining === 0) state.timer.running = false;
      }
    }
    const mins = Math.floor(state.timer.remaining / 60).toString().padStart(2, '0');
    const secs = (state.timer.remaining % 60).toString().padStart(2, '0');
    $('#clockDisplay').textContent = `${mins}:${secs}`;
    $('#clockButton').textContent = state.timer.running ? '잠시 멈춤' : (state.timer.remaining < 7200 ? '계속하기' : '타이머 시작');
    if (state.timer.running) saveState(false);
  }

  function updateAll() { updateGenre(); updatePrompts(); updatePreview(); updatePartResultUI(); renderTransfer(); updateProgress(); }

  $$('[data-field]').forEach(el => el.addEventListener('input', () => {
    state.fields[el.dataset.field] = el.value;
    if (el.dataset.field === 'author' && !field('coverAuthor')) {
      state.fields.coverAuthor = el.value ? `${el.value} 지음` : '';
      $('[data-field="coverAuthor"]').value = state.fields.coverAuthor;
    }
    updateAll(); saveState();
  }));

  $('[data-part-result]').addEventListener('input', event => {
    state.fields[`manuscriptPart${state.part}`] = event.target.value;
    $('#partSaveHint').textContent = event.target.value.trim()
      ? `PART ${state.part} 답변이 이 브라우저에 저장되었습니다. 다른 PART를 눌러도 유지됩니다.`
      : `PART ${state.part} 답변은 비어 있습니다.`;
    $(`.part-button[data-part="${state.part}"]`).classList.toggle('has-answer', Boolean(event.target.value.trim()));
    renderTransfer(); saveState();
  });

  $$('[data-check]').forEach(el => el.addEventListener('change', () => {
    state.checks[el.dataset.check] = el.checked;
    saveState(); updateProgress();
  }));

  $$('.step-link').forEach(link => link.addEventListener('click', () => goToStep(link.dataset.step)));
  $$('.example-chip').forEach(button => button.addEventListener('click', () => fillSample(button.dataset.example)));
  $$('.genre-card').forEach(button => button.addEventListener('click', () => {
    state.genre = button.dataset.genre;
    hydrateInputs(); updateAll(); saveState();
  }));
  $$('.part-button').forEach(button => button.addEventListener('click', () => {
    state.part = Number(button.dataset.part);
    hydrateInputs(); updatePrompts(); saveState();
  }));
  $$('.mood-card').forEach(button => button.addEventListener('click', () => {
    state.fields.mood = button.dataset.mood;
    $('[data-field="mood"]').value = button.dataset.mood;
    $$('.mood-card').forEach(card => card.classList.toggle('selected', card === button));
    updateAll(); saveState();
  }));
  $$('.copy-button').forEach(button => button.addEventListener('click', () => copyText($(`#${button.dataset.copy}`).textContent)));

  $('#copyAllButton').addEventListener('click', () => {
    const content = compileCanvaText();
    if (!content) { showToast('먼저 표지·원고 내용을 입력해 주세요.'); return; }
    copyText(content);
  });
  $('#prevButton').addEventListener('click', () => goToStep(state.currentStep - 1));
  $('#nextButton').addEventListener('click', () => {
    if (!state.completedSteps.includes(state.currentStep)) state.completedSteps.push(state.currentStep);
    updateProgress(); saveState();
    if (state.currentStep < 5) goToStep(state.currentStep + 1);
    else showToast('최종 점검 내용을 저장했습니다.');
  });
  $('#sampleButton').addEventListener('click', () => fillSample('cafe'));
  function openFormDialog(frameSelector, dialogSelector) {
    const frame = $(frameSelector);
    if (!frame.src || frame.src === 'about:blank') frame.src = frame.dataset.src;
    $(dialogSelector).showModal();
  }
  $('#openFeedbackButton').addEventListener('click', () => openFormDialog('#feedbackFrame', '#feedbackDialog'));
  $('#closeFeedbackButton').addEventListener('click', () => $('#feedbackDialog').close());
  $('#openClassInquiryButton').addEventListener('click', () => openFormDialog('#classInquiryFrame', '#classInquiryDialog'));
  $('#closeClassInquiryButton').addEventListener('click', () => $('#classInquiryDialog').close());
  $('#resetButton').addEventListener('click', () => $('#resetDialog').showModal());
  $('#cancelReset').addEventListener('click', () => $('#resetDialog').close());
  $('#confirmReset').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY); state = structuredClone(defaults);
    $('#resetDialog').close(); hydrateInputs(); updateAll(); goToStep(1); updateClock(); showToast('새 워크북으로 시작합니다.');
  });
  $('#downloadButton').addEventListener('click', downloadWorkbook);
  $('#printButton').addEventListener('click', () => window.print());
  $('#completeButton').addEventListener('click', () => {
    const allFinal = ['final1','final2','final3','final4','final5'].every(key => state.checks[key]);
    if (!allFinal) { showToast('최종 점검 5가지를 먼저 확인해 주세요.'); return; }
    state.classCompleted = true;
    if (!state.completedSteps.includes(5)) state.completedSteps.push(5);
    updateProgress(); saveState(); showToast('축하합니다! 첫 전자책 실습을 완료했습니다.');
  });
  $('#clockButton').addEventListener('click', () => {
    state.timer.running = !state.timer.running;
    state.timer.updatedAt = state.timer.running ? Date.now() : null;
    saveState(false); updateClock();
  });

  hydrateInputs(); updateAll(); goToStep(state.currentStep); updateClock();
  clockTimer = setInterval(updateClock, 1000);
})();
