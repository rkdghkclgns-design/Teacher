// gyosuan-io.js - 완성 MD 변환, 내보낸 HTML 불러오기, 참고 이미지, 출력 형식 샘플
// develocket-slide(assets/main.js·ref-images.js @3a7303f)의 동작을 차시 단위 저장에 맞춰 옮겼다.

const GYOSUAN_MD_ACCEPT = '.md,.markdown,.txt';

function pickGyosuanFiles(accept, multiple = false) {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.multiple = multiple;
        input.onchange = () => resolve(Array.from(input.files || []));
        input.oncancel = () => resolve([]);
        input.click();
    });
}

// 파일을 조각으로 읽는다(크기 상한 없음, import-stream.js). 큰 파일은 읽는 동안 화면 왼쪽 아래에 읽은 MB를 보인다
async function readGyosuanSkeleton(file) {
    const progress = showReadProgress(file);
    try {
        return await readFileSkeleton(file, { onProgress: progress.update });
    } finally {
        progress.close();
    }
}

const gyosuanTooBig = name => new Error(`${name}: 파일이 너무 커서 이 브라우저에서 한 번에 다룰 수 없습니다.`);

// MD 글 전체. 떼어 둔 그림(data URL)은 글에 되돌린다(완성 MD 변환이 그림을 그림 목록으로 옮긴다, adoptInlineImages)
async function readGyosuanFile(file) {
    const read = await readGyosuanSkeleton(file);
    try {
        return read.restore(read.text);
    } catch (err) {
        throw isBackupTooBig(err) ? gyosuanTooBig(file.name) : err;
    }
}

// 그림을 떼어 둔 글로 내보낸 슬라이드 HTML을 읽고, 슬라이드 HTML과 내장 원본(교수안·편성안·참고 이미지)에 그림을 되돌린다.
// 수백 MB 파일도 DOMParser가 그림까지 여러 번 다시 읽지 않는다
function readExportedGyosuanHtml(read) {
    const K = window.KBuilder;
    const imported = K.readExportedHtml(read.text);
    if (!read.count) return imported;
    const sourceText = imported.source ? new DOMParser().parseFromString(read.text, 'text/html').getElementById('kb-source')?.textContent : null;
    return { ...imported, html: read.restore(imported.html), source: sourceText == null ? imported.source : K.readEmbeddedSource(read.restore(sourceText)) };
}

/* ---------- 이미지 ---------- */
// MD에 박힌 data URL은 레지스트리로 옮겨 MD를 읽기 쉽게 둔다. 내보낼 수 없는 형식(SVG 등)은 설명만 남긴다
function adoptInlineImages(md, images = {}) {
    const found = {};
    const text = String(md || '').replace(/!\[([^\]]*)\]\((data:image\/[^)\s]+)\)/g, (match, alt, url) => {
        if (!window.KBuilder.isRasterImage(url)) return alt;
        const id = `img_${hashSource([{ text: url }])}`;
        found[id] = url;
        return `![${alt}](local:${id})`;
    });
    return { md: text, images: { ...images, ...found } };
}

/* ---------- 완성 MD 변환 ---------- */
// 간이 교수안(gyosuan-brief.js)은 '## 시간이 되면 권장' 절이나 파일 이름(…_간이교수안.md)으로 가른다
function gyosuanFileKind(name, text) {
    if (/^##\s*진행\s*$/m.test(text)) return 'docMd';
    if (/^(?:###\s*슬라이드|##\s*슬라이드\s*편성)/m.test(text)) return 'deckMd';
    if (/^##\s*시간이 되면 권장\s*$/m.test(text) || /간이\s*교수안/.test(name)) return 'briefMd';
    if (/편성안/.test(name)) return 'deckMd';
    return /교수안/.test(name) ? 'docMd' : null;
}

// 간이 교수안: 올렸으면 그것, 다른 교수안만 올렸으면 옛 교수안의 간이 교수안이라 뺀다(undefined), 아니면 지금 것
function convertedBrief(base, sorted) {
    if (sorted.briefMd !== undefined) return sorted.briefMd;
    return sorted.docMd !== undefined && sorted.docMd !== base?.docMd ? undefined : base?.briefMd;
}

// files = [{ name, text }] → { docMd?, deckMd?, briefMd? } 또는 { error }
function sortGyosuanFiles(files) {
    const sorted = {};
    for (const file of files) {
        const text = String(file.text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
        const kind = gyosuanFileKind(file.name, text);
        if (!kind) return { error: `${file.name}: 교수안이나 슬라이드 편성안으로 읽지 못했습니다. 교수안은 "## 진행", 편성안은 "### 슬라이드 1 - 제목" 형식이어야 합니다.` };
        if (sorted[kind]) return { error: '같은 종류의 파일을 두 개 골랐습니다. 교수안과 슬라이드 편성안을 하나씩 골라 주세요.' };
        sorted[kind] = text;
    }
    return sorted;
}

// 올리지 않은 쪽은 지금 내용을 유지한다. AI 없이 만들어 교안과 비교할 기준이 없으므로 sourceKey는 비운다
function convertedGyosuan(base, sorted) {
    const doc = adoptInlineImages(sorted.docMd ?? base?.docMd ?? '', base?.images);
    const deck = adoptInlineImages(sorted.deckMd ?? base?.deckMd ?? '', doc.images);
    const { briefMd: _oldBrief, ...rest } = base || {};
    const briefMd = convertedBrief(base, sorted);
    return {
        ...rest,
        ...(typeof briefMd === 'string' && briefMd ? { briefMd } : {}),
        docMd: doc.md,
        deckMd: deck.md,
        images: usedGyosuanImages({ docMd: doc.md, deckMd: deck.md, images: deck.images }),
        ...(sorted.deckMd !== undefined ? freshDeckState(base) : {}),
        sourceKey: sorted.docMd !== undefined ? null : base?.sourceKey ?? null,
        updatedAt: new Date().toISOString()
    };
}

function refreshGyosuanViews(mod) {
    if (String(currentEditingModuleId) !== String(mod.id)) return;
    if (!document.getElementById('gyosuan-view')) return renderEditor(mod); // 교안이 없던 차시
    syncSlidePanel(mod);
    renderGyosuanView(mod);
}

// trackId: 넣을 갈래(basic | adv). 화면에서 고른 갈래를 넘긴다. 예전에 받은 교수안·편성안 파일도 고른 갈래에 넣는다
window.importGyosuanMdFiles = async function (moduleId, trackId = currentGyosuanTrack()) {
    const track = lessonTrack(trackId);
    const files = await pickGyosuanFiles(GYOSUAN_MD_ACCEPT, true);
    const mod = getEditingModule(moduleId);
    if (!mod || !files.length) return;
    try {
        const texts = await Promise.all(files.map(readGyosuanFile));
        const sorted = sortGyosuanFiles(files.map((file, index) => ({ name: file.name, text: texts[index] })));
        if (sorted.error) return window.showAlert(sorted.error);
        if (sorted.briefMd !== undefined && sorted.docMd === undefined && !mod[track.field]?.docMd) return window.showAlert(`간이 교수안은 교수안과 함께 고르거나 ${track.label} 교수안이 있는 차시에 불러와 주세요.`);
        const replacing = mod[track.field]?.docMd || gyosuanHasDeck(mod, track.id);
        if (replacing) {
            const ok = await confirmAsync(`올린 파일로 이 차시의 ${track.label} 교수안·편성안을 바꿉니다. 편성안을 바꾸면 슬라이드 화면 편집 내용도 사라집니다. 계속할까요?`, { title: `${track.label} 교수안 바꾸기`, okLabel: '바꾸기', tone: 'danger' });
            if (!ok) return;
            if (gyosuanTargetMoved(moduleId, mod)) return;
        }
        mod[track.field] = convertedGyosuan(mod[track.field], sorted);
        await saveGyosuan(mod);
        refreshGyosuanViews(mod);
        window.showToast?.(`완성 MD로 ${track.label} 교수안과 슬라이드를 만들었습니다.`, 'success');
    } catch (err) {
        console.error('[교수안] MD 변환 실패:', err);
        window.showAlert('MD를 불러오지 못했습니다: ' + (err?.message || err));
    }
};

/* ---------- 내보낸 HTML 불러오기 ---------- */
// 파일에 내장된 소스가 어느 덱인지 알려 준다. 소스가 없는 파일은 지금 연 덱으로 받는다
function importTarget(imported, session, sessionCount) {
    const target = imported.source ? imported.source.session : session;
    if (target === null || target < sessionCount) return { session: target };
    return { error: `이 파일은 ${target + 1}차시 슬라이드입니다. 이 수업은 ${sessionCount}차시까지 있어 넣을 수 없습니다.` };
}

function importedGyosuan(base, imported, session) {
    const updatedAt = new Date().toISOString();
    if (session !== null) return { ...base, sessionDecks: { ...base?.sessionDecks, [session]: imported.html }, updatedAt };
    const source = imported.source;
    const doc = adoptInlineImages(source?.doc || base?.docMd || '', base?.images);
    const deck = adoptInlineImages(source?.deck || base?.deckMd || '', doc.images);
    // 파일의 다른 교수안으로 바꾸면 옛 교수안의 간이 교수안은 뺀다(교수안 화면의 '간이 교수안 만들기'로 다시 만든다)
    const { briefMd: _oldBrief, ...rest } = base || {};
    return {
        ...(source?.doc && source.doc !== base?.docMd ? rest : base),
        docMd: doc.md,
        deckMd: deck.md,
        images: usedGyosuanImages({ docMd: doc.md, deckMd: deck.md, images: deck.images }),
        ...freshDeckState(base),
        deckHtml: imported.html,
        sourceKey: source?.doc ? null : base?.sourceKey ?? null,
        updatedAt
    };
}

function rememberImportedTheme(theme) {
    try {
        localStorage.setItem('kb-theme', theme);
    } catch (e) {
        console.warn('슬라이드 테마를 저장하지 못했습니다.', e);
    }
}

// 스튜디오와 강사뷰가 함께 쓴다. session: 지금 연 차시 덱 번호, 없으면 null
// moduleKey: 스튜디오 주소의 module 값(gyosuan.js studioModuleKey. 심화학습은 '차시 id~adv'). 그 갈래의 교수안에 넣는다
// read: 조각으로 읽은 파일(importGyosuanHtmlFile). 있으면 그림을 떼어 둔 글로 읽는다(readExportedGyosuanHtml)
window.importGyosuanHtml = async function (moduleKey, text, session = null, read = null) {
    const { moduleId, track: trackId } = parseStudioModuleKey(moduleKey);
    const track = lessonTrack(trackId);
    const mod = getEditingModule(moduleId);
    if (!mod) return { ok: false, error: '교안을 먼저 선택해주세요.' };
    let imported;
    try {
        imported = read ? readExportedGyosuanHtml(read) : window.KBuilder.readExportedHtml(text);
    } catch (err) {
        // 슬라이드 HTML이 아닌 파일처럼 일부러 받지 않는 파일이다(까닭은 창에 보인다)
        console.warn('[슬라이드] 불러올 수 없는 HTML입니다:', err?.message || err);
        return { ok: false, error: isBackupTooBig(err) ? gyosuanTooBig('HTML').message : err?.message || 'HTML을 불러오지 못했습니다.' };
    }
    try {
        const target = importTarget(imported, session, mod[track.field]?.docMd ? gyosuanSessionList(mod, track.id).length : 0);
        if (target.error) return { ok: false, error: target.error };
        if (gyosuanHasDeck(mod, track.id)) {
            // 스튜디오 창(z 9000) 위에 뜬다. 취소하거나 묻는 동안 차시가 바뀌면 아무것도 바꾸지 않는다
            const ok = await confirmAsync(`불러온 파일로 이 ${track.label} 슬라이드를 바꿉니다. 지금 슬라이드 내용은 사라집니다. 계속할까요?`, { title: `${track.label} 슬라이드 바꾸기`, okLabel: '바꾸기', tone: 'danger' });
            if (!ok || gyosuanTargetMoved(moduleId, mod)) return { ok: false };
        }
        mod[track.field] = importedGyosuan(mod[track.field], imported, target.session);
        if (imported.source?.refs.length) mod.refImages = imported.source.refs;
        rememberImportedTheme(imported.theme);
        await saveGyosuan(mod);
        refreshGyosuanViews(mod);
        return { ok: true };
    } catch (err) {
        console.error('[슬라이드] HTML 불러오기 실패:', err);
        return { ok: false, error: err?.message || 'HTML을 불러오지 못했습니다.' };
    }
};

// trackId: 넣을 갈래. 화면에서 고른 갈래를 넘긴다
window.importGyosuanHtmlFile = async function (moduleId, trackId = currentGyosuanTrack()) {
    const track = lessonTrack(trackId).id;
    const [file] = await pickGyosuanFiles('.html,.htm');
    if (!file) return;
    try {
        const read = await readGyosuanSkeleton(file);
        const result = await window.importGyosuanHtml(studioModuleKey(moduleId, track), read.text, null, read);
        if (result.error) return window.showAlert(result.error);
        if (result.ok) window.openSlideStudio(moduleId, track);
    } catch (err) {
        console.error('[슬라이드] HTML 읽기 실패:', err);
        window.showAlert('HTML을 불러오지 못했습니다: ' + (err?.message || err));
    }
};

/* ---------- 참고 이미지 ---------- */
function gyosuanRefTrayHtml(mod) {
    const refs = mod.refImages || [];
    const thumbs = refs.map((ref, index) => `
        <div class="ref-thumb" title="${escapeHtml(ref.name)}">
            <img src="${escapeHtml(ref.url)}" alt="${escapeHtml(ref.name)}">
            <button class="ref-rm" type="button" title="제거" onclick="removeGyosuanRef('${mod.id}', ${index})">×</button>
        </div>`).join('');
    return `
        <div class="ref-tray">
            <div class="ref-tray-head">📎 참고 이미지
                <span class="ref-tray-sub">슬라이드 이미지 칸에서 골라 쓰고, 교수안 끝에 함께 실립니다 (최대 ${window.KBuilder.REF_IMAGE_MAX}장)</span>
            </div>
            <div class="ref-tray-grid">${thumbs}
                <button class="ref-add" type="button" onclick="addGyosuanRefs('${mod.id}')">＋ 이미지 추가</button>
            </div>
        </div>`;
}

async function saveGyosuanRefs(mod, refs) {
    mod.refImages = window.KBuilder.normalizeRefImages(refs);
    await saveGyosuan(mod);
    refreshGyosuanViews(mod);
}

window.addGyosuanRefs = async function (moduleId) {
    const files = await pickGyosuanFiles('image/*', true);
    const mod = getEditingModule(moduleId);
    if (!mod || !files.length) return;
    const K = window.KBuilder;
    const room = K.REF_IMAGE_MAX - (mod.refImages || []).length;
    const urls = await Promise.all(files.slice(0, Math.max(0, room)).map(file => K.refDownscale(file).catch(err => {
        console.warn('[참고 이미지] 읽기 실패:', file.name, err);
        return '';
    })));
    const added = files.slice(0, urls.length).map((file, index) => ({ name: file.name, url: urls[index] })).filter(ref => K.isRasterImage(ref.url));
    await saveGyosuanRefs(mod, [...(mod.refImages || []), ...added]);
    if (added.length < files.length) window.showToast?.(`${files.length - added.length}개는 넣지 못했습니다. PNG·JPG·WEBP·GIF만 넣을 수 있고 최대 ${K.REF_IMAGE_MAX}장입니다.`, 'warning');
};

window.removeGyosuanRef = function (moduleId, index) {
    const mod = getEditingModule(moduleId);
    if (mod) return saveGyosuanRefs(mod, (mod.refImages || []).filter((ref, position) => position !== index));
};

/* ---------- 출력 형식 샘플 ---------- */
function gyosuanSampleDocHtml() {
    const mount = document.createElement('div');
    window.KBuilder.buildDoc(window.KBuilder.parseDoc(window.KBuilder.samples.doc), mount);
    return mount.innerHTML;
}

window.downloadGyosuanSample = function (kind) {
    downloadMd(window.KBuilder.samples[kind], kind === 'deck' ? '슬라이드 편성안_샘플' : '교수안_샘플');
};

window.getSlideStudioSample = function () {
    return { deckMd: window.KBuilder.samples.deck, deckHtml: null, title: '샘플', subject: '', sessions: [], session: null, rev: 0, refs: [] };
};

window.openGyosuanSampleDeck = function () {
    showSlideStudioOverlay('sample=1');
};
