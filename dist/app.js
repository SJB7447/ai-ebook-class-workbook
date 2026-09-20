(() => {
  const STORAGE_KEY = 'ai-ebook-class-workbook-v1';
  const defaults = {
    fields: { mood: '따뜻하고 친근한, 크림색과 오렌지, 손그림 느낌' },
    checks: {},
    completedSteps: [],
    currentStep: 1,
    classCompleted: false,
    timer: { running: false, remaining: 7200, updatedAt: null }
  };
  let state = loadState();
  let toastTimer;
  let clockTimer;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const field = (name) => (state.fields[name] || '').trim();

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return {
        ...structuredClone(defaults),
        ...saved,
        fields: { ...defaults.fields, ...(saved?.fields || {}) },
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
  }

  function fallback(value, text) { return value || `[${text}]`; }

  function updatePrompts() {
    const topic = fallback(field('topic'), '전자책 주제');
    const reader = fallback(field('reader'), '읽을 사람');
    const benefit = fallback(field('benefit'), '독자가 얻게 될 것');
    const title = fallback(field('title'), '책 제목');
    const mood = fallback(field('mood'), '원하는 분위기');
    const scene = fallback(field('scene'), `${topic}을 실천하는 자연스러운 장면`);

    $('#planPrompt').textContent = `당신은 초보자를 돕는 실용 전자책 편집자입니다.\n\n주제: ${topic}\n독자: ${reader}\n독자가 얻게 될 것: ${benefit}\n\n아래 순서로 20쪽 미니 전자책의 설계도만 만들어 주세요.\n1. 이해하기 쉬운 제목 후보 3개와 부제 후보 3개\n2. 프롤로그 핵심 내용\n3. 4개의 PART 제목\n4. 각 PART마다 실용적인 소주제 4개(총 16개)\n5. 마지막 실천 체크리스트 5개\n\n아직 본문은 쓰지 말고, 초보자가 바로 따라 할 구체적인 주제로 구성해 주세요.`;

    $('#manuscriptPrompt').textContent = `방금 설계한 「${title}」 중 PART 1의 4개 주제를 전자책 원고로 작성해 주세요.\n\n각 페이지 형식:\n- 짧고 분명한 소제목\n- 공감되는 도입 2문장\n- 핵심 설명과 바로 해볼 방법\n- 마지막에 ‘오늘의 실천 팁’ 1개\n\n페이지당 250~350자, 쉬운 말과 짧은 문장으로 써 주세요. 페이지 사이는 --- 로 구분해 주세요.`;

    $('#coverImagePrompt').textContent = `${topic}을 주제로 한 세로형 전자책 표지 배경 이미지. ${mood}. ${reader}이 편안하게 느낄 수 있는 단순하고 선명한 구성. 위쪽과 중앙에 제목을 넣을 넓은 여백. 고품질, 세로 3:4 비율. 이미지 안에 글자, 문자, 로고, 워터마크는 넣지 말 것.`;

    $('#illustrationPrompt').textContent = `${scene}. ${mood}. 실용 전자책 본문에 어울리는 자연스럽고 단정한 삽화, 한눈에 이해되는 단순한 구도, 가로 4:3 비율, 고품질. 이미지 안에 글자, 문자, 로고, 워터마크는 넣지 말 것.`;
  }

  function updatePreview() {
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
    const text = field('manuscript');
    if (!text) return [];
    const split = text.split(/\n\s*---+\s*\n/g).map(x => x.trim()).filter(Boolean);
    if (split.length > 1) return split;
    const headingSplit = text.split(/(?=\n(?:#{1,3}\s+|(?:페이지|PAGE)\s*\d+))/gi).map(x => x.trim()).filter(Boolean);
    return headingSplit.length > 1 ? headingSplit : [text];
  }

  function transferBlocks() {
    const intro = field('outline');
    const pages = getPages();
    const blocks = [
      { no: '01', title: '표지', text: [field('title'), field('subtitle'), field('coverAuthor') || field('author')].filter(Boolean).join('\n') },
      { no: '02—03', title: '프롤로그 · 목차', text: intro }
    ];
    pages.forEach((text, index) => blocks.push({ no: String(index + 4).padStart(2, '0'), title: firstLine(text) || `본문 ${index + 1}`, text }));
    blocks.push({ no: '마지막', title: '마무리 · 저자', text: `${field('benefit')}\n\n저자: ${field('author')}`.trim() });
    return blocks;
  }

  function firstLine(text) {
    return (text.split('\n').find(line => line.trim()) || '').replace(/^#+\s*/, '').slice(0, 55);
  }

  function renderTransfer() {
    const root = $('#transferList');
    root.replaceChildren();
    const pages = getPages();
    $('#pageCount').textContent = `본문 ${pages.length}개 감지 · 총 ${pages.length + 3}개 블록`;
    const blocks = transferBlocks().filter(block => block.text);
    if (!blocks.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-transfer';
      empty.textContent = '1단계에서 원고를 붙여넣으면 이곳에 자동으로 정리됩니다.';
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
      cafe: { author: '김지혜', topic: '작은 카페에서 단골을 만드는 방법', reader: '카페를 처음 운영하는 사장님', benefit: '바로 실천할 수 있는 단골 관리 방법 16가지', title: '오늘부터 단골 카페', subtitle: '작은 가게에서 바로 쓰는 고객관리 16가지', coverAuthor: '김지혜 지음', coverLine: '손님이 다시 오게 만드는 작은 습관', scene: '햇살이 들어오는 작은 동네 카페에서 단골손님을 반갑게 맞는 사장님', filename: '오늘부터_단골카페_김지혜' },
      career: { author: '박성호', topic: '50대 신중년의 재취업 준비', reader: '경력은 많지만 다시 시작이 막막한 50대 구직자', benefit: '나의 경력을 강점으로 바꾸는 재취업 준비 순서', title: '다시, 일할 시간', subtitle: '신중년을 위한 재취업 준비 노트', coverAuthor: '박성호 지음', coverLine: '경력은 끝이 아니라 새로운 출발점입니다', scene: '밝은 책상에서 노트북과 이력서를 정리하는 50대 한국인 구직자', filename: '다시_일할시간_박성호' },
      home: { author: '이수민', topic: '냉장고 정리로 한 달 식비 줄이기', reader: '장본 식재료를 자주 버리는 1인 가구와 주부', benefit: '재료를 남김없이 쓰는 정리와 식단 습관', title: '냉장고가 가벼워졌다', subtitle: '버리는 식재료 없이 식비를 줄이는 16가지 습관', coverAuthor: '이수민 지음', coverLine: '정리 한 번으로 장보기와 식사가 쉬워집니다', scene: '종류별로 깔끔하게 정리된 밝은 가정집 냉장고와 식재료 바구니', filename: '냉장고가_가벼워졌다_이수민' }
    };
    Object.assign(state.fields, samples[type] || samples.cafe);
    hydrateInputs(); updateAll(); saveState();
    showToast('예시를 채웠습니다. 내 내용으로 바꿔보세요.');
  }

  function compileWorkbookText() {
    const blocks = transferBlocks().filter(x => x.text).map(x => `[${x.no}] ${x.title}\n${x.text}`).join('\n\n--------------------------------\n\n');
    return `AI 전자책 디자인·출판 클래스 — 실습 결과\n\n책 제목: ${field('title')}\n부제: ${field('subtitle')}\n저자: ${field('author')}\n독자: ${field('reader')}\n핵심 효과: ${field('benefit')}\n표지 분위기: ${field('mood')}\n이미지 메모: ${field('imageNotes')}\n\n================================\n\n${blocks}`;
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

  function updateAll() { updatePrompts(); updatePreview(); renderTransfer(); updateProgress(); }

  $$('[data-field]').forEach(el => el.addEventListener('input', () => {
    state.fields[el.dataset.field] = el.value;
    if (el.dataset.field === 'author' && !field('coverAuthor')) {
      state.fields.coverAuthor = el.value ? `${el.value} 지음` : '';
      $('[data-field="coverAuthor"]').value = state.fields.coverAuthor;
    }
    updateAll(); saveState();
  }));

  $$('[data-check]').forEach(el => el.addEventListener('change', () => {
    state.checks[el.dataset.check] = el.checked;
    saveState(); updateProgress();
  }));

  $$('.step-link').forEach(link => link.addEventListener('click', () => goToStep(link.dataset.step)));
  $$('.example-chip').forEach(button => button.addEventListener('click', () => fillSample(button.dataset.example)));
  $$('.mood-card').forEach(button => button.addEventListener('click', () => {
    state.fields.mood = button.dataset.mood;
    $('[data-field="mood"]').value = button.dataset.mood;
    $$('.mood-card').forEach(card => card.classList.toggle('selected', card === button));
    updateAll(); saveState();
  }));
  $$('.copy-button').forEach(button => button.addEventListener('click', () => copyText($(`#${button.dataset.copy}`).textContent)));

  $('#copyAllButton').addEventListener('click', () => copyText(compileWorkbookText()));
  $('#prevButton').addEventListener('click', () => goToStep(state.currentStep - 1));
  $('#nextButton').addEventListener('click', () => {
    if (!state.completedSteps.includes(state.currentStep)) state.completedSteps.push(state.currentStep);
    updateProgress(); saveState();
    if (state.currentStep < 5) goToStep(state.currentStep + 1);
    else showToast('최종 점검 내용을 저장했습니다.');
  });
  $('#sampleButton').addEventListener('click', () => fillSample('cafe'));
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
