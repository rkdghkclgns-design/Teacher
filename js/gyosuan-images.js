// gyosuan-images.js - 교수안을 만들 때 슬라이드 이미지를 함께 만든다
// 고르기·생성·재사용은 kbuilder/auto-images.js(develocket-slide @3a7303f)를 그대로 쓴다.
// 다만 [이미지:id] 표시는 IndexedDB에만 있어 내보내기에 남지 않으므로, 끝나면 그 갈래 교수안의 images(mod.gyosuan · mod.gyosuanAdv)와 local: 참조로 옮긴다.

const GYOSUAN_IMAGE_TAG = /\[이미지:([^\]\s]+)\]/g;
const LESSON_IMAGE_TEXT_LINES = 5; // 이미지 아래에서 내용 비교에 쓸 줄 수
let _gyosuanImageSkip = false;
let _gyosuanImageSignal = null; // 교수안 이미지 단계 동안만 쓰는 중지 신호. 작업 밖의 슬라이드 칸 그림 만들기(image-slot)는 끊지 않는다

// auto-images.js가 찾는 AI 연결. 키는 교안 도우미가 관리한다 (스튜디오 쪽은 studio.js)
function bindGyosuanImageAi() {
    const K = window.KBuilder;
    if (K.genImage) return;
    K.genImage = async prompt => {
        const url = await generateImageAPI(prompt, { signal: _gyosuanImageSignal }); // 중지하면 그리던 그림도 끊는다
        if (!url) throw new Error('이미지를 만들지 못했습니다.');
        return url;
    };
    K.AI = { hasKey: () => !!apiKey || textModelHasKey() || (isHiggsfieldModel(IMAGE_MODEL) && typeof higgsfieldReady === 'function' && higgsfieldReady()) };
    K.ai = {
        genImage: K.genImage,
        available: role => (role === 'image' ? K.AI.hasKey() : textModelHasKey()),
        call: async (prompt, opts = {}) => {
            const images = (opts.images || []).map(image => ({ inlineData: { mimeType: image.mime, data: image.data } }));
            // 장면 글로 바꾸기·그림 속 글자 확인(auto-images.js)은 짧은 호출이고 실패해도 대신할 값이 있어 tries만큼만 보낸다
            const data = await callGemini(TEXT_MODEL, { contents: [{ role: 'user', parts: [{ text: String(prompt) }, ...images] }], taskRole: opts.role, signal: _gyosuanImageSignal, attempts: opts.tries || undefined, timing: 'short' });
            return extractText(data);
        }
    };
}

/* ---------- 교안 이미지 재사용 ---------- */
// 교안 본문에서 이미지가 놓인 자리의 소제목과 이어지는 글을 읽어 슬라이드와 내용을 비교할 재료로 쓴다
function lessonImageContext(lines, at) {
    const heading = lines.slice(0, at).reverse().find(line => /^#{1,6}\s/.test(line)) || '';
    const alt = (lines[at].match(/\balt="([^"]*)"/) || lines[at].match(/!\[([^\]]*)\]/) || [])[1] || '';
    const near = lines.slice(at + 1, at + 1 + LESSON_IMAGE_TEXT_LINES).filter(line => line.trim() && !/^\s*</.test(line));
    return { title: alt || heading.replace(/^#+\s*/, ''), text: [heading.replace(/^#+\s*/, ''), ...near].join(' ') };
}

// 그 줄에서 그 그림 키(local:키)가 놓인 자리. local:b 뒤에 키 글자가 더 이어지면(local:both) 다른 그림이다. 없으면 -1
function lessonImageRefAt(line, id) {
    const ref = `local:${id}`;
    for (let at = line.indexOf(ref); at !== -1; at = line.indexOf(ref, at + 1)) if (!/[\w-]/.test(line.charAt(at + ref.length))) return at;
    return -1;
}

const lessonLineUsesImage = (line, id) => lessonImageRefAt(line, id) !== -1;

// 그 그림 칸의 출처 설명(예시 게임 그림의 '게임 · 출처: 위키백과 · 라이선스', game-images.js). 출처 페이지를 달았거나 '출처:'가 든 설명만, 아니면 ''.
// 그림 키 뒤의 첫 설명을 다음 그림 칸 앞까지만 찾는다. 설명은 이스케이프한 글이라 꺾쇠가 없다
function lessonImageCredit(line, id) {
    const at = lessonImageRefAt(line, id);
    if (at === -1) return '';
    const rest = line.slice(at);
    const next = rest.indexOf('<div class="image-wrapper"');
    const match = (next === -1 ? rest : rest.slice(0, next)).match(/<div class="image-caption"([^>]*)>([^<]*)<\/div>/);
    if (!match) return '';
    const text = match[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    return text && (/\sdata-source-url="https?:\/\//i.test(match[1]) || /출처\s*:/.test(text)) ? text : '';
}

// 그 갈래의 학습·실습 탭에 놓인 그림만 고른다(다른 갈래의 그림을 이 갈래 슬라이드에 넣지 않게). credit: 그 그림의 출처 설명(없으면 '')
function lessonImageCandidates(mod, trackId = 'basic') {
    const lines = collectLessonSource(mod, trackId).flatMap(part => String(part.text).split('\n'));
    return Object.entries(mod.images || {}).flatMap(([id, url]) => {
        if (!window.KBuilder.isRasterImage(url)) return [];
        const at = lines.findIndex(line => lessonLineUsesImage(line, id));
        return at === -1 ? [] : [{ id, url, ...lessonImageContext(lines, at), credit: lessonImageCredit(lines[at], id) }];
    });
}

/* ---------- 결과 옮기기 ---------- */
const GYOSUAN_IMAGE_LINE = /^([ \t]*)\[이미지:([^\]\s]+)\][ \t]*$/gm; // 한 줄을 차지한 표시(교수안 본문의 단계 제목 아래)

// [이미지:id]를 local: 참조로 바꾸고, 내보낼 수 없는 이미지는 표시를 지운다. credits: 출처를 적어야 하는 그림(예시 게임 그림)의 설명 { id → 글 }.
// 그 그림은 교수안 본문이면 그림 아래 줄에, 편성안의 '이미지/시각' 줄 끝이면 그 줄 끝에 출처를 붙인다(교수안·편성안·내려받기에 출처가 남는다).
// 교수안 화면(kbuilder parser.js inline)은 굵게·코드·링크만 읽으므로 설명은 꾸밈 없이 글자 그대로 붙인다
function localizeImageTags(md, url, credits = new Map()) {
    const credit = id => (credits.has(id) && credits.get(id) ? String(credits.get(id)).replace(/\s+/g, ' ').trim() : '');
    return String(md || '')
        .replace(GYOSUAN_IMAGE_LINE, (match, indent, id) => {
            if (!window.KBuilder.isRasterImage(url(id))) return '';
            return `${indent}![](local:${id})${credit(id) ? `\n\n${indent}${credit(id)}` : ''}`;
        })
        .replace(GYOSUAN_IMAGE_TAG, (match, id) => {
            if (!window.KBuilder.isRasterImage(url(id))) return '';
            return `![](local:${id})${credit(id) ? ` (${credit(id)})` : ''}`;
        });
}

function taggedImages(texts, url) {
    const ids = [...new Set(texts.flatMap(text => [...String(text || '').matchAll(GYOSUAN_IMAGE_TAG)].map(match => match[1])))];
    return Object.fromEntries(ids.map(id => [id, url(id)]).filter(([, value]) => window.KBuilder.isRasterImage(value)));
}

/* ---------- 건너뛰기 버튼 ---------- */
function showGyosuanImageSkip() {
    _gyosuanImageSkip = false;
    const loading = document.getElementById('editor-loading');
    if (!loading) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gyosuan-tool';
    button.textContent = '이미지 건너뛰기';
    button.onclick = () => {
        _gyosuanImageSkip = true;
        button.disabled = true;
        button.textContent = '이번 이미지까지만 넣습니다';
    };
    loading.appendChild(button);
    return button;
}

// 만든 이미지도 참고 이미지 목록에 넣어 다른 슬라이드 칸에서 고를 수 있게 한다
function collectGeneratedRefs(mod) {
    const K = window.KBuilder;
    K.refImages = [...(mod.refImages || [])];
    K.refImagesAddUrl = (url, name) => { K.refImages = [...K.refImages, { name, url }]; };
}

// 끝 안내(kbuilder/auto-images.js summary). '이미지 건너뛰기'를 눌러 새 그림을 하나도 시작하지 않았으면(실패도 없다) 만들지 못했다고 하지 않는다
function gyosuanImageNote(A, result, skipped) {
    if (!skipped || result.made || result.failed || !result.total) return A.summary(result);
    const reused = result.reused ? ` 교안 본문 이미지 ${result.reused}장을 내용이 같은 슬라이드에 넣었습니다.` : '';
    return `🖼 이미지 건너뛰기를 눌러 새 슬라이드 이미지는 만들지 않았습니다.${reused}`;
}

// texts = { docMd, deckMd } → 이미지가 들어간 { docMd, deckMd, images, note }. 실패해도 글은 살린다. trackId: 교수안을 만드는 갈래
window.attachGyosuanImages = async function (mod, texts, trackId = 'basic') {
    const K = window.KBuilder;
    const A = K.autoImages;
    if (!A?.count() || !texts.deckMd) return texts;
    bindGyosuanImageAi();
    await A.ready;
    const lessonImages = lessonImageCandidates(mod, trackId);
    const credits = new Map(lessonImages.filter(image => image.credit).map(image => [image.id, image.credit])); // 슬라이드에 쓰면 출처를 함께 적을 그림
    A.adopt(lessonImages);
    collectGeneratedRefs(mod);
    const skip = showGyosuanImageSkip();
    _gyosuanImageSignal = window.aiStopSignal?.() || null;
    try {
        const part = { title: mod.title, docMd: texts.docMd, deckMd: texts.deckMd, images: lessonImages };
        // 건너뛰기·중지를 누르거나 이번 작업에서 그림 모델이 모두 막히면 새 그림을 더 시작하지 않는다
        const result = await A.run([part], (done, total, label) => setGyosuanProgress(label), () => _gyosuanImageSkip || !!window.isTabGenerationStopped?.() || !!window.imageGenerationBlocked?.());
        // 그림 모델이 막혀 못 만든 슬라이드 그림은 교안에 자리가 남지 않으므로 그 수를 작업 끝 안내에 넣는다(api.js imageRunNote)
        if (window.imageGenerationBlocked?.()) window.noteSlideImagesLeft?.(Math.max(0, (result.total || 0) - (result.made || 0)));
        const [tagged] = result.parts;
        mod.refImages = K.normalizeRefImages(K.refImages);
        return {
            docMd: localizeImageTags(tagged.docMd, A.url, credits),
            deckMd: localizeImageTags(tagged.deckMd, A.url, credits),
            images: taggedImages([tagged.docMd, tagged.deckMd], A.url),
            note: gyosuanImageNote(A, result, _gyosuanImageSkip)
        };
    } catch (err) {
        console.error('[교수안] 이미지 생성 실패:', err);
        return { ...texts, note: '이미지를 만들지 못해 글만 저장했습니다.' };
    } finally {
        _gyosuanImageSignal = null;
        skip?.remove();
    }
};
