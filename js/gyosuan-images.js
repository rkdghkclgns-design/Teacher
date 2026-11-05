// gyosuan-images.js - 교수안을 만들 때 슬라이드 이미지를 함께 만든다
// 고르기·생성·재사용은 kbuilder/auto-images.js(develocket-slide @3a7303f)를 그대로 쓴다.
// 다만 [이미지:id] 표시는 IndexedDB에만 있어 내보내기에 남지 않으므로, 끝나면 mod.gyosuan.images와 local: 참조로 옮긴다.

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

function lessonImageCandidates(mod) {
    const lines = collectLessonSource(mod).flatMap(part => String(part.text).split('\n'));
    return Object.entries(mod.images || {}).flatMap(([id, url]) => {
        if (!window.KBuilder.isRasterImage(url)) return [];
        const at = lines.findIndex(line => line.includes(`local:${id}`));
        return at === -1 ? [] : [{ id, url, ...lessonImageContext(lines, at) }];
    });
}

/* ---------- 결과 옮기기 ---------- */
// [이미지:id]를 local: 참조로 바꾸고, 내보낼 수 없는 이미지는 표시를 지운다
function localizeImageTags(md, url) {
    return String(md || '').replace(GYOSUAN_IMAGE_TAG, (match, id) => (window.KBuilder.isRasterImage(url(id)) ? `![](local:${id})` : ''));
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

// texts = { docMd, deckMd } → 이미지가 들어간 { docMd, deckMd, images, note }. 실패해도 글은 살린다
window.attachGyosuanImages = async function (mod, texts) {
    const K = window.KBuilder;
    const A = K.autoImages;
    if (!A?.count() || !texts.deckMd) return texts;
    bindGyosuanImageAi();
    await A.ready;
    const lessonImages = lessonImageCandidates(mod);
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
            docMd: localizeImageTags(tagged.docMd, A.url),
            deckMd: localizeImageTags(tagged.deckMd, A.url),
            images: taggedImages([tagged.docMd, tagged.deckMd], A.url),
            note: A.summary(result)
        };
    } catch (err) {
        console.error('[교수안] 이미지 생성 실패:', err);
        return { ...texts, note: '이미지를 만들지 못해 글만 저장했습니다.' };
    } finally {
        _gyosuanImageSignal = null;
        skip?.remove();
    }
};
