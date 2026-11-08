// gyosuan-regen.js - 교수안 재생성: 교안이 바뀐 갈래 알리기, 바뀐 탭·섹션 요약, 비용·시간을 보이고 다시 만들기, 이전 교수안으로 되돌리기
// 교수안을 만들 때 그 갈래 원고의 지문(sourceMap)과 바꾸기 전 교수안 한 칸(previous)을 함께 둔다(gyosuan.js nextGyosuan이 gyosuanRegenFields를 부른다).
// sourceMap: { 탭 id: { key: 그 탭 원고 해시, sections: [[섹션 제목, 섹션 해시], ...] } }. 섹션은 교수안이 쓰는 글(코드 블록·그림·주석을 뺀 글과 시간, gyosuan.js lessonPartUnits)로 센다.
// previous: 바꾸기 전 교수안 그대로(그 안의 previous는 빼고, 그 교수안이 가리키는 차시 그림 사본을 images에 더하고, 바꾼 때 replacedAt). 되돌리면 지금 교수안과 자리를 바꾼다.
// 다시 만들기는 만들기와 같은 길(gyosuan.js generateGyosuan: 진행 문구·중지 단추, 교수안과 편성안을 함께)을 쓴다. 테스트: tests/gyosuan-regen.test.js

const GYOSUAN_CHANGE_NAMES = 3;  // 바뀐 섹션 이름은 이만큼만 적고 나머지는 '외 n개'
const GYOSUAN_CHANGE_TITLE = 20; // 섹션 이름은 이 글자 수까지

/* ---------- 원고 지문과 바꾸기 전 교수안 ---------- */
// parts: 그 갈래 원고(collectLessonSource). 학습 탭과 실습 탭은 practice로 가른다(탭 글이 없는 옛 본문은 학습 탭 자리)
function gyosuanSourceMap(parts, trackId = 'basic') {
    const track = lessonTrack(trackId);
    return Object.fromEntries(parts.map(part => [part.practice ? track.practice : track.learn, {
        key: hashSource([part]),
        sections: lessonPartUnits(part).map(unit => [unit.title, hashSource([{ text: `${unit.minutes}\n${unit.text.trim()}` }])])
    }]));
}

// 글에 'local:키'가 그 키 그대로 있는가(local:img_1은 local:img_10이 아니다)
function textUsesLocalImage(text, id) {
    const ref = `local:${id}`;
    for (let at = text.indexOf(ref); at !== -1; at = text.indexOf(ref, at + 1)) if (!/[\w-]/.test(text.charAt(at + ref.length))) return true;
    return false;
}

// 바꾸기 전 교수안 한 칸. 차시 그림은 다른 곳에서 안 쓰면 지워질 수 있어 그 교수안이 가리키는 그림을 사본으로 담는다. 글이 없으면 undefined
function gyosuanPreviousCopy(mod, gyosuan) {
    if (!gyosuan || typeof gyosuan !== 'object' || !(gyosuan.docMd || gyosuan.deckMd)) return undefined;
    const { previous: _older, ...rest } = gyosuan;
    const own = rest.images && typeof rest.images === 'object' ? rest.images : {};
    const texts = [rest.docMd, rest.deckMd].filter(text => typeof text === 'string');
    const lessonImages = Object.entries(mod?.images && typeof mod.images === 'object' ? mod.images : {})
        .filter(([id, data]) => !Object.prototype.hasOwnProperty.call(own, id) && /^data:image\//.test(String(data)) && texts.some(text => textUsesLocalImage(text, id)));
    return { ...rest, images: { ...Object.fromEntries(lessonImages), ...own }, replacedAt: new Date().toISOString() };
}

// nextGyosuan이 새 교수안에 더하는 칸: 원고 지문(편성안만 다시 만들면 예전 지문 그대로)과 바꾸기 전 교수안
function gyosuanRegenFields(mod, base, parts, keepDoc, trackId = 'basic') {
    const sourceMap = keepDoc ? base?.sourceMap : gyosuanSourceMap(parts, trackId);
    const previous = gyosuanPreviousCopy(mod, base);
    return { ...(sourceMap ? { sourceMap } : {}), ...(previous ? { previous } : {}) };
}

/* ---------- 교안이 바뀌었는가, 무엇이 바뀌었는가 ---------- */
// 교수안을 만든 뒤 그 갈래의 학습·실습 탭이 바뀌었는가. 불러온 교수안(원고 표시 없음)과 예전 방식 기본학습 교수안은 견줄 원고가 없어 바뀌었다고 하지 않는다
function isGyosuanStale(mod, trackId = 'basic') {
    const track = lessonTrack(trackId);
    const gyosuan = gyosuanOf(mod, track.id);
    if (!gyosuan?.sourceKey || !(gyosuan.docMd || gyosuan.deckMd)) return false;
    if (track.id === LESSON_TRACKS[0].id && isLegacyGyosuan(mod)) return false;
    return gyosuan.sourceKey !== hashSource(collectLessonSource(mod, track.id));
}

const gyosuanTabLabel = id => LESSON_TABS.find(tab => tab.id === id)?.label || id;
const shortSectionTitle = title => (title.length > GYOSUAN_CHANGE_TITLE ? `${title.slice(0, GYOSUAN_CHANGE_TITLE)}…` : title || '(제목 없음)');
const changeNames = titles => titles.slice(0, GYOSUAN_CHANGE_NAMES).map(title => `'${shortSectionTitle(title)}'`).join(', ')
    + (titles.length > GYOSUAN_CHANGE_NAMES ? ` 외 ${titles.length - GYOSUAN_CHANGE_NAMES}개` : '');

// 저장해 둔 지문의 그 탭. 남이 준 저장본에서 왔을 수 있어 모양이 맞을 때만 읽는다(모르는 키나 객체 속성은 읽지 않는다)
function storedSourceEntry(map, tabId) {
    if (!map || typeof map !== 'object' || !Object.prototype.hasOwnProperty.call(map, tabId)) return null;
    const entry = map[tabId];
    if (!entry || typeof entry.key !== 'string' || !Array.isArray(entry.sections)) return null;
    return { key: entry.key, sections: entry.sections.filter(pair => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string') };
}

// 같은 제목이 여럿이면 차례로 견준다(두 번째 '실습'은 두 번째 '실습'과)
function sectionKeys(sections) {
    const seen = new Map();
    return sections.map(([title, hash]) => {
        const n = (seen.get(title) || 0) + 1;
        seen.set(title, n);
        return { key: JSON.stringify([title, n]), title, hash };
    });
}

// 탭 하나의 바뀐 내용 한 줄. 바뀐 것이 없으면 ''
function tabChangeLine(tabId, before, after) {
    if (!before && !after) return '';
    const label = `${gyosuanTabLabel(tabId)} 탭`;
    if (!before) return `${label}: 새 글`;
    if (!after) return `${label}: 비움`;
    if (before.key === after.key) return '';
    const old = sectionKeys(before.sections);
    const now = sectionKeys(after.sections);
    const oldBy = new Map(old.map(item => [item.key, item]));
    const nowKeys = new Set(now.map(item => item.key));
    const groups = [
        ['바뀐 섹션', now.filter(item => oldBy.has(item.key) && oldBy.get(item.key).hash !== item.hash)],
        ['새 섹션', now.filter(item => !oldBy.has(item.key))],
        ['빠진 섹션', old.filter(item => !nowKeys.has(item.key))]
    ].filter(([, items]) => items.length).map(([name, items]) => `${name} ${changeNames(items.map(item => item.title))}`);
    if (groups.length) return `${label}: ${groups.join(' · ')}`;
    const reordered = old.map(item => item.key).join('\n') !== now.map(item => item.key).join('\n');
    return `${label}: ${reordered ? '섹션 순서 바뀜' : '교수안에 쓰지 않는 부분(코드 블록·그림·첫 제목 앞 글 등)만 바뀜'}`;
}

// 교수안을 만든 뒤 그 갈래에서 바뀐 것(줄마다 하나, 짧게)
function gyosuanChangeLines(mod, trackId = 'basic') {
    const track = lessonTrack(trackId);
    const gyosuan = gyosuanOf(mod, track.id);
    const tabs = trackTabsLabel(track);
    if (!gyosuan?.docMd && !gyosuan?.deckMd) return ['아직 만든 교수안이 없습니다.'];
    if (!gyosuan.sourceKey) return ['불러온 교수안이라 견줄 교안 기록이 없습니다.'];
    if (track.id === LESSON_TRACKS[0].id && isLegacyGyosuan(mod)) return [`예전 방식으로 기본·심화를 함께 담은 교수안입니다. 이번에는 ${tabs} 탭만으로 만듭니다.`];
    if (!isGyosuanStale(mod, track.id)) return ['교수안을 만든 뒤 바뀐 교안이 없습니다.'];
    if (!gyosuan.sourceMap || typeof gyosuan.sourceMap !== 'object') return [`${tabs} 탭 글이 바뀌었습니다. 어느 섹션이 바뀌었는지는 이 교수안에 기록이 없어 알 수 없습니다.`];
    const now = gyosuanSourceMap(collectLessonSource(mod, track.id), track.id);
    const lines = [track.learn, track.practice].map(id => tabChangeLine(id, storedSourceEntry(gyosuan.sourceMap, id), now[id] || null)).filter(Boolean);
    return lines.length ? lines : [`${tabs} 탭 글이 바뀌었습니다.`];
}

/* ---------- 재생성 ---------- */
// 한 창에 바뀐 내용, 되돌릴 수 있다는 안내, 비용·시간 미리 보기(cost-estimate.js)를 보인다. 그 파일이 없으면(테스트) 앱의 확인 창만 쓴다
function confirmGyosuanRegen(mod, track) {
    const message = [
        `${track.label} 교수안을 다시 생성합니다.`, '', '[바뀐 내용]', ...gyosuanChangeLines(mod, track.id).map(line => `- ${line}`), '',
        "직접 수정한 교수안과 슬라이드 편집 내용은 새 교수안으로 바뀝니다. 지금 교수안은 '이전 교수안으로' 단추로 되돌릴 수 있습니다."
    ].join('\n');
    const opts = { title: `${track.label} 교수안 다시 생성`, okLabel: '다시 생성' };
    if (typeof confirmWithEstimate === 'function' && typeof lessonWork === 'function') return confirmWithEstimate(message, lessonWork({ gyosuan: 1, ncs: false }), opts);
    return confirmAsync(message, { ...opts, tone: 'danger' });
}

// 교수안 화면의 재생성 단추. 그 갈래의 학습·실습 탭이 비었으면 묻지 않고 알린다
window.regenerateGyosuan = async function (moduleId, trackId = 'basic') {
    const mod = getEditingModule(moduleId);
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');
    const track = lessonTrack(trackId);
    if (!collectLessonSource(mod, track.id).length) return window.showAlert(`${trackTabsLabel(track)} 탭에 교안 내용이 없습니다. 먼저 그 탭을 생성해주세요.`);
    await window.saveGyosuanRaw?.(); // 원문 칸에 넣지 않은 글도 이전 교수안에 남긴다
    const ok = await confirmGyosuanRegen(mod, track);
    if (!ok || gyosuanTargetMoved(moduleId, mod)) return;
    return window.generateGyosuan(moduleId, { track: track.id });
};

/* ---------- 이전 교수안으로 ---------- */
// 이전 교수안 칸. 남이 준 저장본에서 왔을 수 있어 교수안과 같은 규칙으로 고쳐 읽는다(data-safety.js safeGyosuan). 글이 없으면 null
function previousGyosuanOf(gyosuan) {
    const prev = gyosuan?.previous;
    if (!prev || typeof prev !== 'object' || Array.isArray(prev)) return null;
    const safe = typeof safeGyosuan === 'function' ? safeGyosuan(prev) : prev;
    const hasText = field => typeof safe?.[field] === 'string' && !!safe[field];
    return hasText('docMd') || hasText('deckMd') ? safe : null;
}

// 되돌린 교수안: 이전 교수안에 지금 교수안을 이전 칸으로 넣는다. 덱 번호는 두 덱보다 크게 해 어느 쪽을 연 스튜디오의 늦은 저장도 받지 않는다
function restoredGyosuan(mod, current, prev) {
    const { previous: _older, replacedAt: _at, ...back } = prev;
    const kept = gyosuanPreviousCopy(mod, current);
    const deckRev = Math.max(Number(current.deckRev) || 0, Number(back.deckRev) || 0) + 1;
    return { ...back, deckRev, updatedAt: new Date().toISOString(), ...(kept ? { previous: kept } : {}) };
}

window.restorePreviousGyosuan = async function (moduleId, trackId = currentGyosuanTrack()) {
    await window.saveGyosuanRaw?.(); // 원문 칸에 넣지 않은 글도 이전 교수안 칸으로 옮긴다
    const mod = getEditingModule(moduleId);
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');
    if (_gyosuanRunning) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    const track = lessonTrack(trackId);
    const current = mod[track.field];
    const prev = previousGyosuanOf(current);
    if (!prev) return window.showAlert(`되돌릴 이전 ${track.label} 교수안이 없습니다.`);
    const when = typeof localTimeText === 'function' ? localTimeText(prev.replacedAt) : '';
    const ok = await confirmAsync(`${track.label} 교수안을 ${when ? `${when}에 ` : ''}바꾸기 전 교수안으로 되돌립니다. 지금 교수안은 이전 교수안 자리에 남아 다시 되돌릴 수 있습니다.`,
        { title: `${track.label} 이전 교수안으로`, okLabel: '되돌리기' });
    if (!ok || gyosuanTargetMoved(moduleId, mod)) return;
    if (!(await allowGyosuanOverwrite(mod))) return;
    // 묻는 동안 그 교수안을 다시 만들었거나 고쳤으면 되돌리지 않는다(새로 바뀐 교수안을 잃지 않게)
    if (mod[track.field] !== current) return window.showToast?.('묻는 동안 교수안이 바뀌어 되돌리지 않았습니다. 다시 시도해 주세요.', 'warning');
    mod[track.field] = restoredGyosuan(mod, current, prev);
    Object.assign(mod, withHistoryNote(mod, `${track.label} 이전 교수안으로 되돌림`));
    _gyosuanEditing = null;
    clearGyosuanForeignChange(mod);
    await saveGyosuan(mod);
    refreshGyosuanViews(mod); // 지금 연 차시일 때만 다시 그린다(gyosuan-io.js)
    window.showToast?.(`${track.label} 교수안을 이전 교수안으로 되돌렸습니다. 한 번 더 누르면 방금 교수안으로 돌아갑니다.`, 'success');
};

/* ---------- 교수안 화면 단추(gyosuan-view.js gyosuanToolbarHtml) ---------- */
// 안내 바로 옆의 재생성 단추. 교안이 바뀌었으면(예전 방식 교수안 포함) 채운 '재생성', 그대로면 바뀐 것이 없어도 새로 만든다는 뜻으로 '그래도 재생성'.
// 견줄 교안 기록이 없는 불러온 교수안은 바뀌었는지 모르므로 채우지 않은 '재생성'
function gyosuanRegenButtonHtml(mod, trackId = 'basic') {
    const track = lessonTrack(trackId);
    const changed = isGyosuanStale(mod, track.id) || (track.id === LESSON_TRACKS[0].id && isLegacyGyosuan(mod));
    const unknown = !changed && !gyosuanOf(mod, track.id)?.sourceKey;
    const tip = changed ? `바뀐 교안으로 ${track.label} 교수안과 슬라이드 편성안을 다시 만듭니다`
        : unknown ? `불러온 교수안이라 견줄 교안 기록이 없습니다. 지금 ${trackTabsLabel(track)} 탭으로 ${track.label} 교수안과 슬라이드 편성안을 다시 만듭니다`
            : `교안은 그대로지만 ${track.label} 교수안과 슬라이드 편성안을 새로 만듭니다`;
    return `<button onclick="regenerateGyosuan('${mod.id}', '${track.id}')" class="gyosuan-tool${changed ? ' is-stale' : ''}" title="${escapeHtml(tip)}"><i class="ph-bold ph-arrow-clockwise"></i> ${changed || unknown ? '재생성' : '그래도 재생성'}</button>`;
}

// 바꾸기 전 교수안이 있으면 '이전 교수안으로' 단추
function gyosuanRestoreButtonHtml(mod, trackId = 'basic') {
    const track = lessonTrack(trackId);
    const prev = previousGyosuanOf(gyosuanOf(mod, track.id));
    if (!prev) return '';
    const when = typeof localTimeText === 'function' ? localTimeText(prev.replacedAt) : '';
    const tip = `바꾸기 전 교수안으로 되돌립니다${when ? `(${when}에 바꿈)` : ''}. 지금 교수안은 이전 교수안 자리에 남습니다.`;
    return `<button onclick="restorePreviousGyosuan('${mod.id}', '${track.id}')" class="gyosuan-tool" title="${escapeHtml(tip)}"><i class="ph-bold ph-clock-counter-clockwise"></i> 이전 교수안으로</button>`;
}
