// game-image-tags.js - 도구의 '예시 게임 그림 넣기': 이미 만든 탭에서 예로 든 실제 게임을 AI가 한 번 찾고 그 단락 뒤에 게임 그림 자리를 넣는다
// 바뀐 곳을 AI 수정 미리보기(previewAiChange)로 보인 뒤 반영하면 그림은 game-images.js가 위키백과에서 찾아 채운다(api.js processImageTags).
// 구절은 글자 그대로 찾고(정규식을 만들지 않는다) 코드 블록·표·제목·이미 그림이 있는 게임은 건너뛴다. 테스트: tests/game-images.test.js

const GAME_LIST_MAX = 12; // 예시 게임 그림 넣기가 한 번에 넣는 게임 수
const GAME_QUOTE_MAX = 300;
const GAME_LESSON_CHARS = 150000; // AI에 보내는 탭 글(코드 블록·그림 줄은 뺀다)
const GAME_KEYWORD_ATTR = /data-keyword="([^"]*)"/g; // 그림 칸·못 찾은 자리의 검색어(이스케이프된 글)
const GAME_SKIP_REASONS = { exists: '이미 그림이 있음', quote: '글 단락에서 문장을 찾지 못함', section: '그림을 넣지 않는 섹션' };

const GAME_TAG_TEXT = {
    notTab: '예시 게임 그림은 보고 있는 교안 탭에 넣습니다. 교안 탭을 연 뒤 다시 눌러 주세요.',
    bankTab: '학습이해도·심화이해도에는 그림을 넣지 않습니다. 기본학습·기본실습·심화학습·심화실습 탭에서 눌러 주세요.',
    emptyTab: '이 탭은 아직 비어 있습니다. 먼저 탭을 만든 뒤 눌러 주세요.',
    noKey: '글 모델 키가 없어 교안에서 예시 게임을 찾을 수 없습니다. 오른쪽 위 ⚙ 설정에서 키를 넣어 주세요.',
    asking: '교안에서 예시로 든 실제 게임을 찾는 중입니다.',
    askFailed: '교안에서 예시 게임을 찾지 못했습니다.',
    stopped: '예시 게임 그림 넣기를 멈췄습니다. 교안은 바꾸지 않았습니다.',
    moved: '기다리는 동안 다른 차시나 탭으로 옮겨 예시 게임 그림 자리를 넣지 않았습니다. 그 탭에서 다시 눌러 주세요.',
    changed: '찾는 동안 탭 내용이 바뀌어 넣지 않았습니다. 다시 눌러 주세요.',
    none: '이 탭에서 예시로 든 실제 게임을 찾지 못했습니다.',
    notApplied: '예시 게임 그림 자리를 넣지 않았습니다.'
};

const gameTagText = title => `<!-- [IMG: "${GAME_TAG_PREFIX} ${gameTagTitle(title)}"] -->`;
const gameUnescape = text => String(text ?? '').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// 줄마다 종류: 'code'(코드 블록) · 'table'(표) · 'heading'(제목) · 'media'(그림·주석 줄) · 'blank' · 'text'(글)
function gameLineKinds(lines) {
    let fence = null;
    let table = false;
    return lines.map(line => {
        const next = pictureFenceAfter(fence, line);
        const coded = !!fence || !!next;
        fence = next;
        if (coded) return 'code';
        const text = line.trim();
        const lower = text.toLowerCase();
        if (table) {
            if (lower.includes('</table')) table = false;
            return 'table';
        }
        if (lower.startsWith('<table')) { // 줄 첫머리의 HTML 표만 표로 본다(글 속 `<table>` 설명은 글이다)
            table = !lower.includes('</table');
            return 'table';
        }
        if (!text) return 'blank';
        if (text.startsWith('|')) return 'table';
        if (/^#{1,6}\s/.test(text)) return 'heading';
        if (text.startsWith('<!--') || text.startsWith('<div class="image-') || text.startsWith('<img') || text.startsWith('![')) return 'media';
        return 'text';
    });
}

// 글 안 위치가 몇째 줄인지(줄 시작 위치 목록에서 찾는다)
function gameLineAt(starts, offset) {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (starts[mid] <= offset) low = mid;
        else high = mid - 1;
    }
    return low;
}

// 구절이 든 글 덩어리(이어진 글 줄)의 마지막 줄. 구절은 글자 그대로 찾고(정규식을 만들지 않는다) 코드 블록·표·제목·그림 줄 안은 건너뛴다. 없으면 -1
function gameQuoteBlockEnd(source, quote, kinds, starts) {
    if (!quote) return -1;
    for (let at = source.indexOf(quote); at !== -1; at = source.indexOf(quote, at + 1)) {
        const line = gameLineAt(starts, at);
        if (kinds[line] !== 'text' || gameLineAt(starts, at + quote.length - 1) !== line) continue;
        let end = line;
        while (end + 1 < kinds.length && kinds[end + 1] === 'text') end += 1;
        return end;
    }
    return -1;
}

// 그 줄이 든 섹션이 그림을 넣지 않는 곳인지: 첫 제목 앞(교안 맨 위), 학습 목표·개요·학습 정보·요약 같은 글 위주 섹션(api.js IMAGE_SKIP_SECTIONS)
function gameSectionSkipped(lines, kinds, end) {
    for (let i = end; i >= 0; i--) {
        if (kinds[i] === 'heading') return IMAGE_SKIP_SECTIONS.test(lines[i]);
    }
    return true;
}

// 탭에 이미 있는 예시 게임(태그·그림 칸·못 찾은 자리). 코드 블록 안은 보지 않는다
function existingGameKeys(md) {
    const text = stashCodeFences(String(md ?? '')).text;
    const keywords = [...[...text.matchAll(IMAGE_TAG_RE)].map(match => match[1]), ...[...text.matchAll(GAME_KEYWORD_ATTR)].map(match => gameUnescape(match[1]))];
    return new Set(keywords.map(gameImageTitle).filter(Boolean).map(gameTitleKey));
}

// 정한 줄 뒤에 태그 줄을 넣는다(앞뒤 빈 줄). 윈도 줄바꿈(\r\n) 글은 넣는 줄도 같게 맞춘다
function gameTaggedText(lines, inserts) {
    return lines.flatMap((line, index) => {
        const tags = inserts.get(index);
        if (!tags) return [line];
        const cr = line.endsWith('\r') ? '\r' : '';
        const gap = index + 1 < lines.length && lines[index + 1].trim() ? [cr] : [];
        return [line, ...tags.flatMap(tag => [cr, `${tag}${cr}`]), ...gap];
    }).join('\n');
}

// 게임마다 인용 구절이 든 단락 바로 뒤에 예시 게임 그림 자리를 넣은 글. { text, added: [게임], skipped: [{ title, reason }] }
// reason: 'exists'(그 게임의 태그·그림이 이미 있다) · 'quote'(구절을 글 단락에서 찾지 못했다: 없거나 코드 블록·표·제목 안에만 있다) · 'section'(그림을 넣지 않는 섹션)
function planGameTags(md, games) {
    const source = String(md ?? '');
    const lines = source.split('\n');
    const kinds = gameLineKinds(lines);
    const starts = [];
    lines.reduce((at, line, index) => {
        starts[index] = at;
        return at + line.length + 1;
    }, 0);
    const have = existingGameKeys(source);
    const placed = [];
    const skipped = [];
    (Array.isArray(games) ? games : []).forEach(game => {
        const key = gameTitleKey(game.title);
        const end = have.has(key) ? -2 : gameQuoteBlockEnd(source, game.quote, kinds, starts);
        const reason = end === -2 ? 'exists' : end < 0 ? 'quote' : gameSectionSkipped(lines, kinds, end) ? 'section' : '';
        if (reason) return skipped.push({ title: game.title, reason });
        have.add(key);
        placed.push({ game, end, tag: gameTagText(game.title) });
    });
    const build = list => gameTaggedText(lines, list.reduce((map, item) => map.set(item.end, [...(map.get(item.end) || []), item.tag]), new Map()));
    let text = placed.length ? build(placed) : source;
    // 넣은 자리가 그림 채우기에서 빠지는 곳이면(글 위주 섹션 판정이 다를 때) 빼고 다시 만든다
    const pending = new Set(pendingImageTags(text, 'all').filter(tag => tag.game).map(tag => gameTitleKey(tag.game)));
    const kept = placed.filter(item => pending.has(gameTitleKey(item.game.title)));
    if (kept.length < placed.length) {
        placed.filter(item => !kept.includes(item)).forEach(item => skipped.push({ title: item.game.title, reason: 'section' }));
        text = kept.length ? build(kept) : source;
    }
    return { text, added: kept.map(item => item.game), skipped };
}

// AI 답의 게임 목록을 검사한다: { games: [{ title, quote }] }. 모양이 아니면 오류. 쓸 수 없는 항목은 빼고 같은 게임은 한 번만, 12개까지
function parseExampleGames(parsed) {
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.games) ? parsed.games : null;
    if (!list) throw new Error('AI 답에 게임 목록이 없습니다. 다시 해 보세요.');
    const seen = new Set();
    return list.reduce((games, item) => {
        if (games.length >= GAME_LIST_MAX || !item || typeof item !== 'object') return games;
        const title = typeof item.title === 'string' ? gameTagTitle(item.title) : '';
        const quote = typeof item.quote === 'string' ? item.quote.trim() : '';
        const key = gameTitleKey(title);
        if (!key || seen.has(key) || quote.length < 2 || quote.length > GAME_QUOTE_MAX || /[\r\n]/.test(quote)) return games;
        seen.add(key);
        return [...games, { title, quote }];
    }, []);
}

// AI에 보낼 탭 글: 코드 블록과 그림·주석 줄은 뺀다(구절은 남은 글 줄에서 그대로 옮긴다)
function gameLessonText(md) {
    const lines = String(md ?? '').split('\n');
    const kinds = gameLineKinds(lines);
    return lines.filter((line, index) => kinds[index] !== 'code' && kinds[index] !== 'media').join('\n').replace(/\n{3,}/g, '\n\n').slice(0, GAME_LESSON_CHARS);
}

const GAME_LIST_SYSTEM = '당신은 교안에서 예시로 든 실제 게임을 찾아 지정된 JSON만 출력하는 보조 AI입니다.';

function buildExampleGamePrompt(mod, tabLabel, md) {
    return [
        '아래 교안 탭에서 예시로 든 실제 게임을 찾아 JSON으로만 답합니다.',
        '- 이미 출시된 실제 게임만 고릅니다. 교안이 지어낸 가상의 게임, 게임 장르·용어(RPG, 퍼즐 게임 등), 회사·게임기·게임 엔진·캐릭터 이름은 넣지 않습니다.',
        `- 교안 글에 이름이 나온 게임만, 같은 게임은 한 번만, 많아도 ${GAME_LIST_MAX}개까지 씁니다. 없으면 빈 목록을 냅니다.`,
        '- title: 그 게임의 공식 영어 제목입니다. 영어 위키백과 문서 제목을 알면 그대로 씁니다(예: "The Legend of Zelda: Breath of the Wild").',
        '- quote: 교안에서 그 게임 이름이 나온 문장의 일부를 한 글자도 바꾸지 않고 그대로 옮긴 짧은 구절입니다(한 줄 안, 80자 이내). 굵게(**) 같은 마크다운 기호도 교안에 쓰인 그대로 둡니다. 제목 줄·표 안의 글은 고르지 않습니다.',
        `[차시] ${mod?.title || ''}`,
        `[탭] ${tabLabel}`,
        `[교안]\n${gameLessonText(md)}`,
        '',
        '{"games": [{"title": "Tetris", "quote": "테트리스는 떨어지는 블록을"}]}'
    ].join('\n');
}

// AI 호출 한 번으로 탭이 예로 든 게임 목록을 받는다(검사한 목록). 중지하면 AbortError
async function requestExampleGames(mod, tabId, md, signal) {
    const label = (LESSON_TABS.find(tab => tab.id === tabId) || {}).label || '교안';
    const data = await callGemini(TEXT_MODEL, {
        taskRole: 'fast',
        contents: [{ role: 'user', parts: [{ text: buildExampleGamePrompt(mod, label, md) }] }],
        systemInstruction: { parts: [{ text: GAME_LIST_SYSTEM }] },
        generationConfig: { responseMimeType: 'application/json' },
        signal
    });
    const parsed = safeJSONParse(extractText(data));
    if (!parsed || typeof parsed !== 'object') throw new Error('AI 답을 읽지 못했습니다. 다시 해 보세요.');
    return parseExampleGames(parsed);
}

function gamePlanNote(plan) {
    const skipped = plan.skipped.map(item => `${item.title}(${GAME_SKIP_REASONS[item.reason] || '건너뜀'})`).join(', ');
    return [
        `예시 게임 ${plan.added.length}개의 그림 자리(<!-- [IMG: "game: …"] --> 줄)를 그 게임이 나온 단락 바로 뒤에 넣습니다. 반영하면 위키백과에서 그 게임 그림을 찾아 넣고 출처를 적습니다(못 찾으면 검색 키가 있을 때 웹 검색으로 찾습니다).`,
        skipped ? `넣지 않는 게임: ${skipped}` : ''
    ].filter(Boolean).join(' ');
}

function gameNothingText(games, plan) {
    if (!games.length) return GAME_TAG_TEXT.none;
    const list = plan.skipped.map(item => `${item.title}(${GAME_SKIP_REASONS[item.reason] || '건너뜀'})`).join(', ');
    return `찾은 예시 게임 ${games.length}개는 넣을 자리가 없어 그대로 두었습니다: ${list}`;
}

// 끝 알림: 넣은 장수, 인터넷에서 못 찾은 곳, 남긴 곳
function gameFillSummary(stats, count) {
    const made = stats.made || 0;
    const missed = stats.failed || 0;
    const left = Math.max(0, count - made - missed - (stats.gone || 0));
    return [
        made ? `예시 게임 그림 ${made}장을 인터넷에서 찾아 넣고 출처를 적었습니다.` : '넣은 예시 게임 그림은 없습니다.',
        missed ? `${missed}곳은 인터넷에서 그 게임 그림을 찾지 못해 그림 자리로 남겼습니다. 그 자리의 '다시 검색'으로 다시 해 보세요.` : '',
        left ? `${left}곳은 그대로 남겨 두었습니다. 도구의 '일괄 이미지 찾기'를 누르면 이어서 찾습니다.` : ''
    ].filter(Boolean).join(' ');
}

// 반영한 탭의 게임 그림 자리를 채운다(위키백과). 차시가 없어지면 넣지 않는다. 다른 탭으로 옮겨도 그 탭 글에 넣고, 보고 있을 때만 다시 그린다
async function fillGameTags(subj, mod, tabId) {
    const snapshot = storedTabMarkdown(mod, tabId);
    const count = pendingImageTags(snapshot, 'all').filter(tag => tag.game).length;
    const stats = { made: 0, failed: 0 };
    const processed = await processImageTags(mod, snapshot, {
        amount: 'all', inject: false, quiet: true, stats, gamesOnly: true, onStatus: window.setPipelineStatus,
        isStopped: () => !!window.isTabGenerationStopped?.() || !lessonStillLive(subj, mod),
        latest: () => latestTabMarkdown(mod, tabId, snapshot)
    });
    if (!lessonStillLive(subj, mod)) return window.notifyLessonJobDone(GAME_TEXT.gone, 'warning');
    setTabMarkdown(mod, tabId, processed);
    const saved = (await saveState()) !== false;
    if (isShowingLessonTab(subj, mod, tabId)) renderEditor(mod);
    const text = gameFillSummary(stats, count);
    if (!saved) return window.notifyLessonJobDone(`${text} ${SAVE_AGAIN_HINT}`, 'error');
    window.notifyLessonJobDone(text, stats.failed || stats.made < count ? 'warning' : 'success');
}

// 진행 막대 안의 일: 게임 목록 받기 → 자리 정하기 → 미리 보기 → 반영 → 그림 채우기. 기다린 뒤마다 같은 차시·탭을 보고 있는지 다시 본다
async function runGamePictureJob(run, { subj, mod, tabId, before }) {
    const still = () => lessonStillLive(subj, mod) && isViewingTab(mod, tabId);
    window.setPipelineStatus(GAME_TAG_TEXT.asking);
    let games;
    try {
        games = await requestExampleGames(mod, tabId, before, window.aiStopSignal?.() || null);
    } catch (err) {
        if (err?.name === 'AbortError' || run.stopped) return window.notifyLessonJobDone(GAME_TAG_TEXT.stopped, 'warning');
        console.error('[예시 게임 그림] 게임 목록을 받지 못했습니다:', err);
        return window.showAlert(`${GAME_TAG_TEXT.askFailed}\n${err?.message || ''}`.trim());
    }
    if (run.stopped) return window.notifyLessonJobDone(GAME_TAG_TEXT.stopped, 'warning');
    if (!still()) return window.notifyLessonJobDone(GAME_TAG_TEXT.moved, 'warning');
    saveOpenEditsFor(mod, tabId);
    if (storedTabMarkdown(mod, tabId) !== before) return window.showAlert(GAME_TAG_TEXT.changed);
    const plan = planGameTags(before, games);
    if (!plan.added.length) return window.notifyLessonJobDone(gameNothingText(games, plan), 'info');
    window.setPipelineStatus('바뀐 섹션을 골라 반영해 주세요.');
    const approved = await previewAiChange(before, plan.text, { title: '예시 게임 그림 자리 미리보기', tabId, note: gamePlanNote(plan), cancelLabel: '반영하지 않기' });
    const keys = new Set(plan.added.map(game => gameTitleKey(game.title)));
    const chosen = approved === null ? 0 : pendingImageTags(approved, 'all').filter(tag => tag.game && keys.has(gameTitleKey(tag.game))).length;
    if (!chosen) return window.notifyLessonJobDone(GAME_TAG_TEXT.notApplied, 'info');
    if (!still()) return window.notifyLessonJobDone(GAME_TAG_TEXT.moved, 'warning');
    saveOpenEditsFor(mod, tabId); // 그사이 원문 칸에서 고친 글이 있으면 먼저 넣어 아래에서 바뀐 것으로 본다
    const label = (LESSON_TABS.find(tab => tab.id === tabId) || {}).label || '이 탭';
    if (!(await commitTabChange(mod, tabId, before, approved, `예시 게임 그림 자리 ${chosen}개 넣기 (${label})`))) return; // 바뀌었으면 commitTabChange가 알린다
    if (!lessonStillLive(subj, mod)) return window.notifyLessonJobDone(GAME_TEXT.gone, 'warning');
    await fillGameTags(subj, mod, tabId);
}

// 도구의 '예시 게임 그림 넣기': 보고 있는 탭에서 예로 든 실제 게임을 AI가 한 번 찾고(최대 12개) 그 단락 뒤에 게임 그림 자리를 넣는다.
// 바뀐 곳을 미리 보인 뒤 반영하면 위키백과에서 그림을 찾아 채운다. 화면을 막지 않고 오른쪽 아래 막대에서 멈출 수 있다
window.insertGamePictures = async function (moduleId) {
    const mod = getEditingModule(moduleId);
    const tabId = typeof currentLessonTab !== 'undefined' ? currentLessonTab : 'basicLearn';
    if (!mod) return;
    if (isQuestionBankTab(tabId)) return window.showAlert(GAME_TAG_TEXT.bankTab); // 문제은행 탭에는 그림 자리를 넣지 않는다(컨벤션)
    if (window.isLessonPipelineRunning?.()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    if (!isViewingTab(mod, tabId)) return window.showAlert(GAME_TAG_TEXT.notTab);
    saveOpenEditsFor(mod, tabId); // 원문 칸에서 고치던 글을 먼저 넣는다
    const before = storedTabMarkdown(mod, tabId);
    if (!String(before).trim()) return window.showAlert(GAME_TAG_TEXT.emptyTab);
    if (typeof textModelHasKey === 'function' && !textModelHasKey()) return window.showAlert(GAME_TAG_TEXT.noKey);
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    await window.runLessonJob(mod.id, { label: '예시 게임 그림 넣기', current: tabId, alerts: true }, async run => {
        try {
            await runGamePictureJob(run, { subj, mod, tabId, before });
        } catch (err) {
            console.error('[예시 게임 그림] 넣지 못했습니다:', err);
            window.showAlert(`예시 게임 그림을 넣지 못했습니다.\n${err?.message || ''}`.trim());
        }
    });
};

if (typeof window !== 'undefined') {
    Object.assign(window, { planGameTags, parseExampleGames, buildExampleGamePrompt, gameLessonText, gameFillSummary });
}
