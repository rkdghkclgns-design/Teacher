// image-batch.js - 도구의 '빈 그림 모두 만들기': 그림 자리만 있고 그림이 아직 없는 자리를 한 번에 채운다. 범위는 보고 있는 탭 하나('이 탭')와 차시의 모든 탭('이 차시')
// 빈 자리: 화면에 보이는 그림 자리 표시(<!-- [IMG: "검색어"] -->, 코드 블록 밖)와 예전에 그림을 못 만든 자리('이미지 영역' 칸). '일괄 이미지 찾기'가 건너뛰는 정리·요약 섹션의 자리도 센다.
//  이미 그림이 있는 자리, 코드 예제 속 모양, local: 자리, 문제은행 탭(학습이해도·심화이해도)은 세지도 채우지도 않는다.
// 시작 전에 자리 수(차시는 탭마다)와 비용·시간을 보이고 묻는다(cost-estimate.js confirmWithEstimate). 확인하면 진행 막대(lesson-pipeline.js runLessonJob)에서 자리를 하나씩,
//  눌러 그림 만들기(image-slot-place.js)와 같은 길(api.js processImageTags: 그 자리 주변 글 읽기 → 검색어 정하기 → 그림 검색 → AI 그림)로 채운다.
// 그림 하나를 만들 때마다 그 탭을 다시 읽어(원문 칸·단락 편집 상자에서 고치던 글을 먼저 넣고) 그 자리에만 넣고 저장한다. 그사이 지워지거나 바뀐 자리는 건너뛴다.
//  탭마다 처음 넣기 직전의 글을 작업 기록에 한 번 남긴다('그림 만들기 전'). 못 만든 자리는 그대로 두고 다음 자리로 가며, 끝에 넣은 수·못 만든 수·건너뛴 수와 까닭을 알린다.
// 기대는 것: image-slot-place.js(shownImageSlotTags·slotOccurrences·slotWorkText), api.js(processImageTags·lessonPictureParts·shownPlaceholderBlocks·lessonStillLive),
//  lesson-review.js(storedTabMarkdown·reviewHistory), tabs.js(saveOpenEditsFor·setTabMarkdown), state.js(archiveContent·saveState). 테스트: tests/batch-images.test.js

const BATCH_LABEL = '빈 그림 모두 만들기';
const BATCH_REASON = '그림 만들기 전'; // 작업 기록에 보이는 까닭(눌러 그림 만들기와 같다)
const BATCH_BOX_KEYWORD = /data-keyword="([^"]*)"/; // 그림을 못 만든 자리의 '다시 검색' 단추에 적힌 검색어
const BATCH_BOX_TEXT = /<span>([\s\S]*?)<\/span>/; // 그 칸에 적힌 글(이미지 영역: …)
const BATCH_RETRY_NOTE = /^🖼️ 이미지 \d+\/\d+:\s*(.+)$/; // 그림 모델을 다시 부르기 전의 안내(api.js processImageTags)

const BATCH_TEXT = {
    busy: '진행 중인 생성이 끝난 뒤 다시 시도해주세요.',
    notTab: "'이 탭'은 보고 있는 교안 탭의 빈 그림 자리를 채웁니다. 교안 탭을 연 뒤 다시 눌러 주세요.",
    bankTab: '학습이해도·심화이해도에는 그림을 넣지 않습니다. 기본학습·기본실습·심화학습·심화실습 탭에서 눌러 주세요.',
    noneTab: '이 탭에는 그림이 없는 그림 자리가 없습니다.',
    noneLesson: '이 차시에는 그림이 없는 그림 자리가 없습니다.',
    noTextKey: '글 모델 키가 없어 그 자리 주변 글을 읽고 그림을 만들 수 없습니다. 오른쪽 위 ⚙ 설정에서 키를 넣어 주세요.',
    noImageKey: "그림을 그리거나 찾을 키가 없어 그림을 만들 수 없습니다. 오른쪽 위 ⚙ 설정에서 Gemini 키를 넣거나 이미지 생성 모델을 'SVG 삽화'로 골라 주세요.",
    changed: '묻는 동안 이 차시를 지우거나 옮겼거나, 백업·PC 폴더를 불러와 내용이 바뀌어 그림을 만들지 않았습니다.',
    lessonGone: `${BATCH_LABEL}를 멈췄습니다. 그사이 이 차시를 지우거나 옮겼거나, 백업·PC 폴더를 불러와 내용이 바뀌었습니다.`,
    retry: `그 자리를 누르거나 '${BATCH_LABEL}'를 다시 누르면 다시 만듭니다.`
};

/* ---------- 빈 자리 세기 ---------- */
// 코드 블록(``` 펜스) 줄을 같은 길이의 빈칸으로 덮은 글. 위치가 원문과 같다(image-slot-place.js slotTagsOutsideCode와 같은 방법)
function batchProse(text) {
    let fence = 0;
    return text.split('\n').map(line => {
        const coded = fence > 0;
        fence = fenceStateAfter(fence, line);
        return coded || fence > 0 ? ' '.repeat(line.length) : line;
    }).join('\n');
}

// escapeHtml(ui.js)이 바꾼 글자를 되돌린다(그림을 못 만든 자리에 적힌 검색어)
const batchPlain = text => String(text ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&amp;/g, '&');

// 그림을 못 만든 자리(api.js imagePlaceholderHtml)의 검색어: '다시 검색' 단추의 data-keyword, 없으면 칸에 적힌 글(눌러 그림 만들기 clickedImageSlot과 같은 순서)
function batchBoxKeyword(raw) {
    const fromButton = batchPlain((raw.match(BATCH_BOX_KEYWORD) || [])[1]).trim();
    return fromButton || batchPlain((raw.match(BATCH_BOX_TEXT) || [])[1]).replace(/^이미지 (?:영역|확보 실패):\s*/, '').trim();
}

// 그 검색어로 그림 자리 표시를 만들 수 있는지(slotWorkText가 못 만든 자리를 그 검색어의 표시로 바꿔 넘긴다)
function batchKeywordUsable(keyword) {
    const clean = imageSlotKeyword(keyword);
    return usableImageTag({ keyword: clean, game: gameImageTitle(clean) });
}

// 이 글에서 아직 그림이 없는 자리(원문 순서). { kind: 'tag'(그림 자리 표시) | 'placeholder'(그림을 못 만든 자리), start, raw, keyword, game }
// 화면에 보이는 자리만 센다(shownImageSlotTags·shownPlaceholderBlocks: 눌러 그림 만들기가 칸을 다는 자리와 같다. 첫머리 정리가 숨기는 자리는 그림을 만들어도 보이지 않는다).
// 코드 블록 안의 모양은 코드 예제라 뺀다
function emptyPictureSlots(source) {
    const text = String(source ?? '');
    if (!text) return [];
    const tags = shownImageSlotTags(text).filter(tag => usableImageTag(tag))
        .map(tag => ({ kind: 'tag', start: tag.start, raw: tag.raw, keyword: tag.keyword, game: tag.game }));
    const prose = batchProse(text);
    const boxes = shownPlaceholderBlocks(text)
        .filter(block => prose.slice(block.start, block.start + block.raw.length) === block.raw)
        .map(block => ({ kind: 'placeholder', start: block.start, raw: block.raw, keyword: batchBoxKeyword(block.raw) }))
        .filter(slot => batchKeywordUsable(slot.keyword))
        .map(slot => ({ ...slot, game: gameImageTitle(imageSlotKeyword(slot.keyword)) }));
    return [...tags, ...boxes].sort((a, b) => a.start - b.start);
}

// 자리마다 같은 글자의 자리 가운데 뒤에서 몇째인지(fromEnd)와 그 수(count)를 적어 둔다.
// 앞 자리부터 채우므로 앞 자리에 그림이 들어가도 뒤에서 센 차례는 그대로다(위치가 밀려도 다음 자리를 다시 찾는다)
function withBatchPlace(text, slot) {
    const starts = slotOccurrences(text, slot.raw);
    return { ...slot, count: starts.length, fromEnd: starts.length - 1 - starts.indexOf(slot.start) };
}

// 지금 글에서 그 자리를 다시 찾는다. 같은 글자의 자리 수가 그대로면 뒤에서 센 차례로, 하나만 남았으면 그 자리.
// 찾은 곳이 지금도 빈 자리일 때만 돌려준다(지워졌거나, 그림이 들어갔거나, 코드 블록 안으로 들어갔으면 null)
function findBatchSlot(text, slot) {
    const starts = slotOccurrences(text, slot.raw);
    const at = starts.length === slot.count ? starts[starts.length - 1 - slot.fromEnd] : starts.length === 1 ? starts[0] : undefined;
    if (at === undefined) return null;
    return emptyPictureSlots(text).find(item => item.start === at && item.raw === slot.raw) || null;
}

// 채울 계획. tabId를 주면 그 탭만, 없으면 그림을 넣는 모든 탭(api.js lessonPictureParts: 문제은행 탭은 없다). 자리가 없는 탭은 뺀다.
// { tabs: [{ id, label, slots }], total, games(예시 게임 그림 자리), retries(예전에 그림을 못 만든 자리) }
function emptyPicturePlan(mod, tabId = null) {
    const tabs = lessonPictureParts(mod).filter(part => !tabId || part.id === tabId).map(part => {
        saveOpenEditsFor(mod, part.id); // 원문 칸에서 고치던 글을 먼저 넣고 센다(tabs.js)
        const text = storedTabMarkdown(mod, part.id);
        return { id: part.id, label: part.label, slots: emptyPictureSlots(text).map(slot => withBatchPlace(text, slot)) };
    }).filter(tab => tab.slots.length);
    const slots = tabs.flatMap(tab => tab.slots);
    return { tabs, total: slots.length, games: slots.filter(slot => slot.game).length, retries: slots.filter(slot => slot.kind === 'placeholder').length };
}

/* ---------- 시작 전 ---------- */
// 다른 생성이 돌고 있는가: 진행 막대의 작업·교수안·로딩 화면(course-flow.js generationBusy), 차시 일괄 생성·기존 내용 보강, 분량 채우기.
// 다른 파일의 표시는 그 파일이 없어도(테스트 등) 멈추지 않게 typeof로 읽는다
function batchBusy() {
    return !!window.isLessonPipelineRunning?.()
        || (typeof generationBusy === 'function' && !!generationBusy())
        || (typeof _lessonRun !== 'undefined' && !!_lessonRun)
        || (typeof _backfillRun !== 'undefined' && !!_backfillRun)
        || !!window.isVolumeFilling?.();
}

// AI 그림을 만들 길이 없으면 그 까닭. 글 모델 키(그 자리 주변 글을 읽고 검색어·그림 요청을 정한다)와,
// 그림을 그리거나 찾을 곳(Gemini 키의 그림 모델·Higgsfield·글 모델이 그리는 SVG 삽화·그림 검색 키)이 있어야 한다
function batchKeyProblem() {
    if (typeof textModelHasKey === 'function' && !textModelHasKey()) return BATCH_TEXT.noTextKey;
    const svg = typeof usesSvgIllustration === 'function' && usesSvgIllustration();
    const higgsfield = typeof isHiggsfieldModel === 'function' && isHiggsfieldModel(IMAGE_MODEL) && typeof higgsfieldReady === 'function' && higgsfieldReady();
    return svg || higgsfield || apiKey || imageSearchReady() ? '' : BATCH_TEXT.noImageKey;
}

// 탭 글이 하나도 없는 차시(최종 평가·옛 차시)는 본문 하나다(api.js lessonTextParts)
const batchTabless = mod => !LESSON_TABS.some(tab => mod?.tabContents?.[tab.id]);

// 묻는 창의 글: 어디에서 몇 개를(차시 범위는 탭마다) 어떻게 채우는지
function batchConfirmText(mod, plan, whole) {
    const count = `그림이 없는 그림 자리 ${plan.total}개${plan.retries ? `(예전에 그림을 못 만든 자리 ${plan.retries}개 포함)` : ''}`;
    const where = batchTabless(mod) ? '본문에서' : whole ? `이 차시의 탭 ${plan.tabs.length}개에서` : `«${plan.tabs[0].label}» 탭에서`;
    const perTab = whole && !batchTabless(mod) ? `\n${plan.tabs.map(tab => `${tab.label} ${tab.slots.length}개`).join(' · ')}` : '';
    return `${where} ${count}를 하나씩, 그 자리 주변 글을 읽고 검색이나 AI로 만들어 채웁니다. 이미 그림이 있는 자리는 건드리지 않습니다.${perTab}\n`
        + '바꾸기 전 글은 탭마다 작업 기록에 남기고, 오른쪽 아래 막대에서 언제든 멈출 수 있습니다.';
}

/* ---------- 채우기 ---------- */
const batchStopped = job => !!job.run?.stopped || !!window.isTabGenerationStopped?.();

// 멈춘 까닭을 적는다('gone': 차시가 사라졌다). 하던 자리는 하지 않은 자리로 남긴다
function batchHalt(job, why) {
    job.halt = why;
    return 'left';
}

// 진행 막대의 둘째 줄: '탭 이름 · 3/12 · 하는 일'. 남은 시간은 지금까지 끝낸 자리의 평균으로 잰다
function batchStatus(job, tab, slot, note = '') {
    const head = `${tab.label} · ${job.finished + 1}/${job.total}`;
    if (note) return `${head} · ${note}`;
    const left = job.finished
        ? `남은 시간 약 ${Math.max(1, Math.round((Date.now() - job.startedAt) / job.finished * (job.total - job.finished) / 60000))}분`
        : '남은 시간 계산 중';
    return `${head} · ${slot.game ? '인터넷에서 찾는 중' : '그림 만드는 중'} · ${left}`;
}

// 그 탭에서 고치던 글을 먼저 그 탭에 넣는다: 열어 둔 원문 칸(tabs.js saveOpenEditsFor)과, 보고 있는 탭이면 두 번 눌러 연 단락 편집 상자(paragraph-edit.js).
// 단락 편집 상자는 포커스를 잃을 때 저장하므로 그 신호를 보낸다(넣지 않고 그림을 넣으면 그 편집은 '탭 내용이 바뀌어' 버려진다)
function saveBatchOpenEdits(job, tabId) {
    saveOpenEditsFor(job.mod, tabId);
    if (!isShowingLessonTab(job.subj, job.mod, tabId)) return;
    const input = document.querySelector('#render-view .para-edit textarea');
    if (input && typeof Event === 'function') input.dispatchEvent(new Event('blur'));
}

// 보고 있는 탭이면 다시 그린다. 그림이 들어올 때마다 읽던 자리가 맨 위로 올라가지 않게 굴린 위치를 지킨다(format-toolbar.js writeLessonTab과 같다)
function redrawBatchTab(mod) {
    const area = document.getElementById('editor-content-area');
    const scrollTop = area ? area.scrollTop : 0;
    renderEditor(mod);
    if (area) area.scrollTop = scrollTop;
}

// 그림을 넣은 글(next)을 그 탭에 쓴다. base: 방금 다시 읽은 탭 글(이 글에 그림을 넣었다).
// 이 탭에 처음 쓸 때 넣기 직전의 글(base)을 작업 기록에 한 번 남긴다. 다시 읽기부터 쓰고 다시 그리기까지 기다림 없이 한 걸음에 해, 그 사이에 고친 글이 끼어들 틈이 없다
async function writeBatchPicture(job, tab, base, next) {
    const { subj, mod } = job;
    if (storedTabMarkdown(mod, tab.id) !== base) return 'gone'; // 방금 읽은 글이라 같아야 한다. 그래도 달라졌으면 고친 글을 덮지 않는다
    const first = !job.archived.has(tab.id);
    const title = mod.tabContents ? `${mod.title} · ${reviewTabLabel(tab.id)}` : mod.title; // 탭이 없는 본문은 제목에 탭 이름을 붙이지 않는다(lesson-review.js commitTabChange)
    const archiving = first ? archiveContent({ title, content: base, images: mod.images, tabId: tab.id, lesson: mod }, BATCH_REASON) : null;
    job.archived.add(tab.id);
    setTabMarkdown(mod, tab.id, next);
    if (first) mod.history = reviewHistory(mod, `${BATCH_LABEL} (${tab.label})`);
    if (isShowingLessonTab(subj, mod, tab.id)) redrawBatchTab(mod);
    if (archiving) await archiving;
    if ((await saveState()) === false) job.halt = 'save'; // 저장하지 못하면 그림을 더 부르지 않는다(알림은 saveState가 띄운다)
    return 'made';
}

// 자리 하나를 채운다. 'made' | 'failed'(못 만들었다. 자리는 그대로) | 'gone'(그사이 지워지거나 바뀐 자리) | 'blocked'(그림 모델을 더 쓸 수 없다) | 'left'(멈춰서 하지 않았다)
async function fillBatchSlot(job, tab, slot) {
    const { subj, mod } = job;
    if (!lessonStillLive(subj, mod)) return batchHalt(job, 'gone');
    window.updateLessonJob({ current: tab.id, done: job.finished, status: batchStatus(job, tab, slot) });
    // AI를 부르는 자리 사이에는 쉰다(분당 호출 한도, api.js IMAGE_TAG_GAP_MS). 예시 게임 그림과, 그림 모델이 막혀 부르지 않을 자리 앞에서는 쉬지 않는다
    const callsAi = !slot.game && !(imageGenerationBlocked() && !imageSearchReady());
    if (callsAi && job.calledAi) await waitMs(IMAGE_TAG_GAP_MS, window.aiStopSignal?.() || null).catch(() => {}); // 중지하면 다 기다리지 않는다
    if (batchStopped(job)) return 'left';
    if (!lessonStillLive(subj, mod)) return batchHalt(job, 'gone');
    saveOpenEditsFor(mod, tab.id);
    const snapshot = storedTabMarkdown(mod, tab.id);
    const found = findBatchSlot(snapshot, slot);
    if (!found) return 'gone';
    if (callsAi) job.calledAi = true;
    const stats = { made: 0, failed: 0 };
    let base = snapshot;
    let work = slotWorkText(snapshot, found, found.start); // 이 자리만 그림 자리 표시로 두고 다른 표시는 잠시 가린다(image-slot-place.js)
    const processed = await processImageTags(mod, work.text, {
        tags: [work.tag], amount: 'all', inject: false, quiet: true, stats,
        onStatus: text => window.setPipelineStatus(batchStatus(job, tab, slot, (String(text).match(BATCH_RETRY_NOTE) || [])[1])),
        isStopped: () => batchStopped(job) || !lessonStillLive(subj, mod),
        latest: () => { // 그림을 다 만든 때: 고치던 글을 먼저 넣고 탭을 다시 읽어 그 자리를 다시 찾는다. 못 찾으면 그림을 넣지 않는다
            saveBatchOpenEdits(job, tab.id);
            base = storedTabMarkdown(mod, tab.id);
            const now = findBatchSlot(base, slot);
            work = slotWorkText(base, now || slot, now ? now.start : -1);
            return work.text;
        }
    });
    if (!lessonStillLive(subj, mod)) return batchHalt(job, 'gone');
    if (stats.made) return writeBatchPicture(job, tab, base, work.restore(processed));
    if (stats.failed) {
        job.stats.gameFailed += stats.gameFailed || 0;
        return 'failed';
    }
    if (stats.gone) return 'gone';
    return batchStopped(job) ? 'left' : 'blocked';
}

// 탭마다 자리를 원문 순서로 하나씩 채운다. 못 만든 자리는 두고 다음 자리로 간다. 중지·차시 사라짐·저장 실패면 거기서 멈춘다
async function runPictureBatch(job) {
    for (const tab of job.tabs) {
        let pending = tab.slots;
        while (pending.length && !job.halt && !batchStopped(job)) {
            const [slot, ...rest] = pending;
            const outcome = await fillBatchSlot(job, tab, slot);
            if (outcome === 'left') return;
            job.stats[outcome] += 1;
            job.finished += 1;
            // 그림을 넣은 자리와 글자가 같은 뒤 자리는 같은 글자의 자리 수가 하나 줄었다(뒤에서 센 차례는 그대로다)
            pending = outcome === 'made' ? rest.map(item => (item.raw === slot.raw ? { ...item, count: item.count - 1 } : item)) : rest;
        }
        if (job.halt || batchStopped(job)) return;
    }
}

/* ---------- 끝 알림 ---------- */
// 넣은 수, 못 만든 수와 다시 만드는 법, 건너뛴 수와 까닭, 아직 하지 않은 수. total: 시작할 때 센 자리 수
function batchSummary(stats, total) {
    const { made = 0, failed = 0, gameFailed = 0, gone = 0, blocked = 0 } = stats;
    const left = Math.max(0, total - made - failed - gone - blocked);
    const onlyGames = failed > 0 && gameFailed >= failed; // 못 찾은 것이 예시 게임 그림뿐이면 그림 모델 설정을 보라고 하지 않는다
    const failText = `${failed}곳은 ${onlyGames ? '인터넷에서 그 게임 그림을 찾지 못해' : '그림을 만들지 못해'} 그림 자리로 남겨 두었습니다.`;
    const check = !made && !onlyGames ? '설정의 이미지 생성 모델과 키를 확인한 뒤 ' : '';
    const text = [
        made ? `그림 ${made}장을 넣었습니다.` : '넣은 그림은 없습니다.',
        failed ? `${failText} ${check}${BATCH_TEXT.retry}` : '',
        gone ? `${gone}곳은 만드는 동안 그 자리가 지워지거나 바뀌어 건너뛰었습니다.` : '',
        blocked ? `${blocked}곳은 그림 모델을 더 쓸 수 없어 건너뛰었습니다.` : '',
        left ? `${left}곳은 아직 만들지 않았습니다.` : ''
    ].filter(Boolean).join(' ');
    const kind = failed && !made ? (onlyGames ? 'warning' : 'error') : failed || gone || blocked || left ? 'warning' : 'success';
    return { text, kind };
}

// 끝 알림 [글, 종류]. 차시가 사라졌으면 넣은 수를 말하지 않는다(그 그림은 지금 데이터에 없다)
function batchDoneNotice(job) {
    if (job.halt === 'gone') return [BATCH_TEXT.lessonGone, 'warning'];
    const summary = batchSummary(job.stats, job.total);
    if (job.halt === 'save') return [`저장하지 못해 ${BATCH_LABEL}를 멈췄습니다. ${summary.text} 마지막에 넣은 그림은 아직 저장되지 않았습니다. ${SAVE_AGAIN_HINT}`, 'error'];
    if (batchStopped(job)) return [`${BATCH_LABEL}를 멈췄습니다. ${summary.text} 다시 누르면 남은 자리부터 이어서 만듭니다.`, 'warning'];
    return [`${BATCH_LABEL}를 마쳤습니다. ${summary.text}`, summary.kind];
}

/* ---------- 도구 단추 ---------- */
// scope: 'tab'(보고 있는 탭) | 'lesson'(이 차시의 모든 탭). 빈 자리를 세어 없으면 알리고, 있으면 자리 수·비용·시간을 보이고 물은 뒤 진행 막대에서 채운다
window.fillEmptyPictures = async function (scope = 'tab') {
    const mod = getEditingModule();
    if (!mod) return;
    if (batchBusy()) return window.showAlert(BATCH_TEXT.busy);
    const whole = scope === 'lesson';
    const tabId = typeof currentLessonTab !== 'undefined' ? currentLessonTab : 'basicLearn';
    if (!whole && !isViewingTab(mod, tabId)) return window.showAlert(BATCH_TEXT.notTab);
    if (!whole && mod.tabContents && isQuestionBankTab(tabId)) return window.showAlert(BATCH_TEXT.bankTab); // 문제은행 탭에는 그림을 넣지 않는다(컨벤션)
    const plan = emptyPicturePlan(mod, whole ? null : tabId);
    if (!plan.total) return window.showToast?.(whole ? BATCH_TEXT.noneLesson : BATCH_TEXT.noneTab, 'info');
    const problem = plan.total > plan.games ? batchKeyProblem() : ''; // 예시 게임 그림만 남았으면 AI 없이 인터넷에서 찾는다
    if (problem) return window.showAlert(problem);
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    const work = { images: plan.total - plan.games, gameImages: plan.games }; // 예시 게임 그림은 AI 호출로 세지 않는다
    if (!(await confirmWithEstimate(batchConfirmText(mod, plan, whole), work, { title: BATCH_LABEL, okLabel: '만들기 시작', exactImages: true }))) return;
    if (!lessonStillLive(subj, mod)) return window.showToast?.(BATCH_TEXT.changed, 'warning');
    if (batchBusy()) return window.showAlert(BATCH_TEXT.busy); // 묻는 사이 시작된 생성
    const job = {
        subj, mod, run: null, tabs: plan.tabs, total: plan.total, finished: 0, startedAt: Date.now(),
        stats: { made: 0, failed: 0, gameFailed: 0, gone: 0, blocked: 0 }, archived: new Set(), halt: '', calledAi: false
    };
    await window.runLessonJob(mod.id, { label: BATCH_LABEL, current: plan.tabs[0].id, total: plan.total, alerts: true }, async run => {
        job.run = run;
        try {
            await runPictureBatch(job);
            window.notifyLessonJobDone(...batchDoneNotice(job));
        } catch (err) {
            console.error(`[${BATCH_LABEL}] 멈췄습니다:`, err);
            window.showAlert(`그림을 만드는 중 오류가 나 멈췄습니다. 앞에서 넣은 그림은 저장했습니다.\n${err?.message || ''}`.trim());
        }
    });
};

if (typeof window !== 'undefined') Object.assign(window, { emptyPictureSlots, emptyPicturePlan, batchSummary });
