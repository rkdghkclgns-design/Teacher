// gyosuan-videos.js - 학습 탭의 영상을 슬라이드 편성안에 인용하고, 슬라이드가 그 영상을 찾게 한다
// 갈래(기본학습·심화학습)의 학습·실습 탭에 놓인 영상: 판서 영상을 붙인 그림(whiteboard-video.js), 도구로 넣은 동영상(파일·YouTube·Vimeo·mp4 주소, lesson-insert-tools.js),
// 움직이는 GIF(image-motion.js). 편성안에는 그 영상이 놓인 절(전개 N)의 슬라이드에 '- 영상: [제목](가리키는 값)' 줄로 적는다.
// 가리키는 값: 판서 영상 wb:그림 키 · 넣은 파일 local:vid_키 · 움직이는 GIF gif:그림 키 · 주소 영상은 그 주소(YouTube·Vimeo는 삽입 주소). 영상 값 자체는 편성안에 넣지 않는다.
// 슬라이드(js/kbuilder)는 그릴 때 getSlideStudioVideo(어떤 영상인가)·getSlideStudioVideoBlob(파일)으로 그 차시에서 찾는다. 주소는 교안이 허용하는 곳만 받는다(lesson-sanitize.js parseLessonVideoUrl).
// 편성안을 만들 때 인용하고(gyosuan.js runGyosuanGeneration), 그때 본 영상을 citedVideos에 적어 둔다. 화면 편집본이 없는 덱은 열 때 그 뒤에 넣은 영상만 더해 넘긴다
// (예전에 만든 덱은 적어 둔 것이 없어 지금 있는 영상을 모두 더한다. 저장한 편성안은 바꾸지 않는다). 강사가 편성안에서 지운 영상 줄은 되살리지 않는다.
// 기대는 것: gyosuan.js(원고·절 나누기), gyosuan-deck-tidy.js(편성안 덩어리), lesson-sanitize.js(주소·동영상 키). 테스트: tests/slide-fit-video.test.js

const DECK_VIDEO_TITLE_CHARS = 80;
const DECK_VIDEO_FIELD = /^(?:[-*]\s+)?(?:동영상|영상)\s*[:：]/;
const DECK_KEY_FIELD = /^(?:[-*]\s+)?핵심\s*메시지\s*[:：]/;
const DECK_MAPS_FIELD = /^(?:[-*]\s+)?대응\s*교수안\s*[:：]\s*/;
const DECK_GIF_VALUE = /^data:image\/gif;base64,[A-Za-z0-9+/=]+$/;
const DECK_PICTURE_VALUE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const VIDEO_LINK_TEXT = { youtube: 'YouTube에서 보기', vimeo: 'Vimeo에서 보기', file: '동영상 파일 주소' };
// 슬라이드에 넣는 바깥 주소 영상(.mp4·.webm 주소)은 https만. 교안은 http 주소도 받지만, 남이 준 덱을 열 때 내부망 주소로 요청이 나가지 않게 슬라이드에는 넣지 않는다(js/kbuilder/deck-runtime.js도 막는다)
const slideFileVideo = parsed => parsed?.kind === 'file' && /^https:\/\//.test(parsed.src);

const ownValue = (map, key) => (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined);
const decodeVideoText = text => String(text ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&amp;/g, '&');
// 편성안에 적을 제목: 태그·대괄호·줄바꿈을 빼고 줄인다(양식 '[제목](값)'이 깨지지 않게)
const cleanVideoTitle = text => decodeVideoText(String(text ?? '').replace(/<[^>]*>/g, ' ')).replace(/[[\]\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, DECK_VIDEO_TITLE_CHARS);
const videoTagAttr = (tag, name) => {
    const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
    return match ? decodeVideoText(match[1] ?? match[2]) : '';
};
// 글이 그 키(local:키)를 가리키는지. local:img_1 뒤에 키 글자가 더 이어지면(local:img_10) 다른 그림이다
function deckTextUsesKey(text, key) {
    const ref = `local:${key}`;
    for (let at = text.indexOf(ref); at !== -1; at = text.indexOf(ref, at + 1)) if (!/[\w-]/.test(text.charAt(at + ref.length))) return true;
    return false;
}

/* ---------- 갈래의 영상 모으기 ---------- */
// 주소 영상의 제목: 파일 이름(없으면 '동영상')
function videoFileTitle(url) {
    try {
        return cleanVideoTitle(decodeURIComponent(new URL(url).pathname.split('/').pop() || '')) || '동영상';
    } catch (err) {
        return '동영상';
    }
}

// 한 줄에 놓인 영상을 놓인 차례로: { ref, title }. 넣은 동영상 블록은 한 줄 HTML이다(lesson-insert-tools.js lessonVideoSnippet)
function lessonLineVideos(mod, line) {
    const found = [];
    const caption = at => cleanVideoTitle((/<p class="lesson-video-caption">\s*동영상:\s*([\s\S]*?)<\/p>/.exec(line.slice(at)) || [])[1] || '');
    for (const match of line.matchAll(/<video\b[^>]*>/gi)) {
        if (/\sdata-wb-video\b/i.test(match[0])) continue; // 판서 영상 재생기(내보낸 글)는 그림 쪽에서 센다
        const src = videoTagAttr(match[0], 'src');
        const own = videoTagAttr(match[0], 'data-video-id');
        const key = LESSON_VIDEO_KEY_RE.test(own) ? own : (/^local:(vid_[a-z0-9]{6,40})$/.exec(src.trim()) || [])[1];
        if (key) {
            if (isLessonVideoData(ownValue(mod.lessonVideos, key))) found.push({ at: match.index, ref: `local:${key}`, title: caption(match.index) || '동영상' });
            continue;
        }
        const parsed = parseLessonVideoUrl(src);
        if (slideFileVideo(parsed)) found.push({ at: match.index, ref: parsed.src, title: videoFileTitle(parsed.src) });
    }
    for (const match of line.matchAll(/<iframe\b[^>]*>/gi)) {
        const embed = lessonEmbedFrameSrc(videoTagAttr(match[0], 'src')); // 허용한 삽입 주소만, 정해 둔 모양으로
        if (embed) found.push({ at: match.index, ref: embed, title: embed.includes('vimeo.com') ? 'Vimeo 영상' : 'YouTube 영상' });
    }
    for (const match of line.matchAll(/local:([\w-]{1,80})(?![\w-])/g)) {
        const id = match[1];
        if (/^vid_/.test(id)) continue;
        const alt = cleanVideoTitle((/\balt="([^"]*)"/.exec(line.slice(match.index)) || /!\[([^\]]*)\]\(\s*$/.exec(line.slice(0, match.index)) || [])[1] || '');
        const board = ownValue(mod.whiteboardVideos, id);
        if (board && typeof board === 'object' && board.id != null && board.id !== '') {
            found.push({ at: match.index, ref: `wb:${id}`, title: cleanVideoTitle(board.title) || alt || '판서 영상' });
        } else if (typeof imageMotionState === 'function' && imageMotionState(mod, id) === 'valid') {
            found.push({ at: match.index, ref: `gif:${id}`, title: cleanVideoTitle(ownValue(mod.imageMotions, id)?.summary) || alt || '움직이는 그림' });
        }
    }
    return found.sort((a, b) => a.at - b.at).map(({ ref, title }) => ({ ref, title }));
}

// 그 갈래의 학습·실습 탭에 놓인 영상 → [{ ref, title, section(놓인 절 제목), group(그 절이 든 전개 제목), number(전개 번호, 맞는 전개가 없으면 0) }]
// 절은 교수안을 만들 때와 같은 규칙으로 가른다(#·## 제목, gyosuan.js lessonPartUnits). 코드 블록·인라인 코드 속 예제는 영상이 아니다. 같은 영상은 처음 한 번만
function lessonTrackVideos(mod, trackId = 'basic') {
    if (!mod) return [];
    const parts = collectLessonSource(mod, trackId);
    const sections = limitSections(splitLessonSections(parts).sections);
    const sectionAt = title => sections.findIndex(section => section.title === title || String(section.text || '').includes(`### ${title}\n`));
    const seen = new Set();
    const videos = [];
    parts.forEach(part => {
        let fence = '';
        let section = '';
        String(part.text).replace(/\r\n/g, '\n').split('\n').forEach(raw => {
            const mark = (/^\s*(```|~~~)/.exec(raw) || [])[1];
            if (mark) { // 코드 블록 안은 보지 않는다
                if (!fence) fence = mark;
                else if (mark === fence) fence = '';
                return;
            }
            if (fence) return;
            const heading = /^#{1,2}\s/.test(raw) ? cleanGyosuanSource(raw).match(/^(#{1,2})\s+(.+?)\s*$/) : null;
            if (heading) { section = cleanSectionTitle(heading[2]); return; }
            if (!raw.includes('local:') && !/<(?:video|iframe)\b/i.test(raw)) return;
            lessonLineVideos(mod, raw.replace(/``[^`]*``|`[^`]*`/g, ' ')).forEach(video => {
                if (seen.has(video.ref)) return;
                seen.add(video.ref);
                const at = section ? sectionAt(section) : -1;
                videos.push({ ...video, section, group: at === -1 ? '' : sections[at].title, number: at + 1 });
            });
        });
    });
    return videos;
}

/* ---------- 편성안에 인용하기 ---------- */
const deckSlideField = (slide, field) => slide.body.find(line => deckIndent(line) === 0 && field.test(line.trim()));
const deckSlideMaps = slide => (deckSlideField(slide, DECK_MAPS_FIELD) || '').trim().replace(DECK_MAPS_FIELD, '').trim();
const deckSlideTitle = slide => slide.header.replace(/^###\s*/, '').replace(/^슬라이드\s*[\d-]*\s*[-–—:]?\s*/, '').trim();
const isClosingDeckSlide = slide => /^(마무리|정리)$/.test(deckSlideTitle(slide)) || deckSlideMaps(slide) === '정리';

// 편성안이 그 영상을 이미 보이는가: 영상 줄로 인용했거나, 움직이는 GIF의 그림을 그림 칸에 쓰고 있다
function deckShowsVideo(text, ref) {
    if (text.includes(`](${ref})`)) return true;
    const gif = /^gif:([\w-]+)$/.exec(ref);
    return !!gif && deckTextUsesKey(text, gif[1]);
}

// 목차 슬라이드의 '번호. 제목' → Map(번호 → 제목). 목차가 없으면 빈 Map
function deckTocTitles(blocks) {
    const toc = blocks.find(block => block.header && deckSlideTitle(block) === '목차');
    const titles = new Map();
    (toc ? toc.body : []).forEach(line => {
        const item = /^\s+[-*]\s+(\d+)[.)]\s+(.+?)\s*$/.exec(line);
        if (item) titles.set(Number(item[1]), item[2]);
    });
    return titles;
}

// 영상이 든 전개의 번호를 그 편성안에서 다시 확인한다. 교안을 고친 뒤 여는 예전 편성안은 번호가 밀렸을 수 있어 목차의 제목으로 맞춘다(없으면 0)
function deckVideoNumber(toc, video) {
    if (!toc.size || !video.number) return video.number || 0;
    const names = [video.group, video.section].filter(Boolean);
    if (names.includes(toc.get(video.number))) return video.number;
    return [...toc].find(([, title]) => names.includes(title))?.[0] || 0;
}

// 영상 줄을 그 슬라이드의 핵심 메시지 줄 앞(없으면 글 끝)에 넣는다
function addDeckVideoLine(slide, line) {
    let at = slide.body.findIndex(item => deckIndent(item) === 0 && DECK_KEY_FIELD.test(item.trim()));
    if (at === -1) {
        at = slide.body.length;
        while (at > 0 && !slide.body[at - 1].trim()) at--;
    }
    slide.body.splice(at, 0, line);
}

// videos([{ ref, title, number }])를 편성안에 인용한다 → { deckMd, added(새로 넣은 값) }. 이미 보이는 영상은 넣지 않는다(다시 해도 같다).
// 그 전개(대응 교수안: 전개 N)의 슬라이드 가운데 영상이 없는 첫 슬라이드에 줄을 달고, 모두 영상이 있으면 그 전개의 끝 슬라이드 뒤에 영상 슬라이드를 넣는다.
// 맞는 전개가 없으면 마무리 슬라이드 앞(없으면 맨 끝)에 영상 슬라이드를 넣는다. 번호를 1부터 차례로 매긴 편성안이면 다시 매긴다
function citeDeckVideos(deckMd, videos) {
    const text = String(deckMd ?? '');
    const list = (Array.isArray(videos) ? videos : []).filter(video => video && typeof video.ref === 'string' && window.KBuilder.parseVideoField(video.ref));
    const blocks = deckBlocks(text.replace(/\r\n/g, '\n').split('\n')).map(block => (block.header ? { header: block.header, body: [...block.body] } : block));
    const slides = () => blocks.filter(block => block.header);
    const added = [];
    if (!slides().length) return { deckMd: text, added };
    const numbered = slides().every(({ header }, i) => Number(header.match(SLIDE_NUMBER)?.[2]) === i + 1);
    const nextNumber = () => Math.max(0, ...slides().map(({ header }) => Number(header.match(SLIDE_NUMBER)?.[2]) || 0)) + 1;
    const videoSlide = (title, line, maps) => ({ header: `### 슬라이드 ${nextNumber()} - 영상: ${title}`, body: [...(maps ? [`- 대응 교수안: ${maps}`] : []), line, ''] });
    const insertAfter = (slide, block) => {
        if (slide.body.length && slide.body[slide.body.length - 1].trim()) slide.body.push('');
        blocks.splice(blocks.indexOf(slide) + 1, 0, block);
    };
    list.forEach(video => {
        if (added.includes(video.ref) || deckShowsVideo(text, video.ref)) return;
        const title = cleanVideoTitle(video.title) || '영상';
        const line = `- 영상: [${title}](${video.ref})`;
        const own = video.number > 0 ? slides().filter(slide => deckSlideMaps(slide).replace(/\s+/g, '') === `전개${video.number}`) : [];
        const free = own.find(slide => !deckSlideField(slide, DECK_VIDEO_FIELD));
        const all = slides();
        const last = all[all.length - 1];
        if (free) addDeckVideoLine(free, line);
        else if (own.length) insertAfter(own[own.length - 1], videoSlide(title, line, `전개 ${video.number}`));
        else if (isClosingDeckSlide(last) && all.length > 1) insertAfter(all[all.length - 2], videoSlide(title, line, ''));
        else insertAfter(last, videoSlide(title, line, ''));
        added.push(video.ref);
    });
    if (!added.length) return { deckMd: text, added };
    if (numbered) slides().forEach((slide, i) => { slide.header = slide.header.replace(SLIDE_NUMBER, `$1${i + 1}`); });
    const lines = blocks.flatMap(block => (block.header ? [block.header, ...block.body] : [block.raw]));
    return { deckMd: lines.join(text.includes('\r\n') ? '\r\n' : '\n'), added };
}

// 그 갈래 탭의 영상을 편성안에 인용한다 → { deckMd, refs(지금 그 갈래에 있는 영상 전부), added }. skip: 앞서 편성안을 만들 때 이미 본 영상(다시 넣지 않는다)
function citeLessonVideos(deckMd, mod, trackId = 'basic', skip = []) {
    const videos = lessonTrackVideos(mod, trackId);
    const known = new Set(Array.isArray(skip) ? skip : []);
    const blocks = deckBlocks(String(deckMd ?? '').replace(/\r\n/g, '\n').split('\n'));
    const toc = deckTocTitles(blocks);
    const out = citeDeckVideos(deckMd, videos.filter(video => !known.has(video.ref)).map(video => ({ ...video, number: deckVideoNumber(toc, video) })));
    return { deckMd: out.deckMd, refs: videos.map(video => video.ref), added: out.added };
}

// 영상 인용은 덧붙이는 일이다. 차시 글이 이상해 영상을 모으다 멈춰도 편성안 만들기·슬라이드 열기는 영상 없이 이어 간다(까닭은 콘솔에 남긴다)
function videoCiteFailed(err) {
    console.warn('[슬라이드 영상] 학습 탭의 영상을 편성안에 인용하지 못해 영상 없이 이어 갑니다:', err?.message || err);
}

// 만든 편성안(draft.deckMd)에 그 갈래의 영상을 인용하고 그때 본 영상을 적어 둔다. 영상이 없으면 받은 값 그대로
function withLessonVideos(draft, mod, trackId = 'basic') {
    try {
        const cited = citeLessonVideos(draft.deckMd, mod, trackId);
        return cited.refs.length ? { ...draft, deckMd: cited.deckMd, citedVideos: cited.refs } : draft;
    } catch (err) {
        videoCiteFailed(err);
        return draft;
    }
}

// 스튜디오에 넘길 때: 편성안을 만든 뒤에 넣은 영상까지 인용한 편성안을 든 차시(사본)를 준다. 더할 영상이 없으면 받은 차시 그대로. 저장한 편성안은 바꾸지 않는다
function lateVideoLesson(mod, trackId = 'basic') {
    const field = lessonTrack(trackId).field;
    const gyosuan = mod?.[field];
    if (!gyosuan || typeof gyosuan.deckMd !== 'string' || !gyosuan.deckMd) return mod;
    const known = Array.isArray(gyosuan.citedVideos) ? gyosuan.citedVideos.filter(ref => typeof ref === 'string') : [];
    try {
        const cited = citeLessonVideos(gyosuan.deckMd, mod, trackId, known);
        return cited.added.length ? { ...mod, [field]: { ...gyosuan, deckMd: cited.deckMd } } : mod;
    } catch (err) {
        videoCiteFailed(err);
        return mod;
    }
}

// 스튜디오가 묻는다: 이 덱(전체 덱, session을 주면 그 교시 덱)이 보여야 하는 영상 [{ ref, title }]. 영상 값은 없다. moduleKey: studioModuleKey(심화학습은 '~adv')
// 편성안을 만든 뒤에 넣은 영상까지 인용한 편성안에서 읽는다. 스튜디오는 화면 편집본에 아직 보인 적 없는 영상만 영상 슬라이드로 더한다(js/kbuilder/deck-runtime.js deckVideo.offer)
window.getSlideStudioVideos = function (moduleKey, session = null) {
    const { moduleId, track } = parseStudioModuleKey(moduleKey);
    const mod = typeof getEditingModule === 'function' ? getEditingModule(moduleId) : null;
    if (!gyosuanOf(mod, track)?.deckMd) return [];
    try {
        const cited = lateVideoLesson(mod, track);
        const whole = !(gyosuanOf(mod, track).docMd ? gyosuanSessionList(mod, track) : []).some(item => item.index === session);
        const md = whole ? gyosuanOf(cited, track).deckMd : gyosuanSessionDeckMd(cited, session, track);
        return window.KBuilder.parseDeck(String(md || '')).slides.flatMap(slide => (slide.videos || []).map(({ ref, title }) => ({ ref, title })));
    } catch (err) {
        videoCiteFailed(err);
        return [];
    }
};

/* ---------- 슬라이드가 영상을 찾는 길 ---------- */
// 가리키는 값 → 그 차시의 영상. 넣은 파일 { kind: 'local', type, data } · 판서 영상 { kind: 'wb', id, title, poster } · 움직이는 GIF { kind: 'gif', src }
// · 주소 영상 { kind: 'youtube' | 'vimeo', embed, link } | { kind: 'file', src, link }. 그 차시에 없거나 허용하지 않는 주소면 null
function resolveLessonVideo(mod, ref) {
    const value = typeof ref === 'string' ? ref.trim() : '';
    if (!mod || !value) return null;
    const local = /^local:(vid_[a-z0-9]{6,40})$/.exec(value);
    if (local) {
        const data = ownValue(mod.lessonVideos, local[1]);
        return isLessonVideoData(data) ? { kind: 'local', type: data.slice(5, data.indexOf(';')), data } : null;
    }
    const board = /^wb:([\w-]{1,80})$/.exec(value);
    if (board) {
        const video = ownValue(mod.whiteboardVideos, board[1]);
        if (!video || typeof video !== 'object' || video.id == null || video.id === '') return null;
        const poster = ownValue(mod.images, board[1]);
        return { kind: 'wb', id: String(video.id), title: cleanVideoTitle(video.title), ...(DECK_PICTURE_VALUE.test(String(poster || '')) ? { poster } : {}) };
    }
    const gif = /^gif:([\w-]{1,80})$/.exec(value);
    if (gif) {
        const src = ownValue(mod.images, gif[1]);
        return typeof src === 'string' && DECK_GIF_VALUE.test(src) ? { kind: 'gif', src } : null;
    }
    const parsed = parseLessonVideoUrl(value); // http(s) 주소만, YouTube·Vimeo·mp4·webm만. 파일 주소는 https만(slideFileVideo)
    if (!parsed || (parsed.kind === 'file' && !slideFileVideo(parsed))) return null;
    const link = { link: parsed.link, linkText: VIDEO_LINK_TEXT[parsed.kind] };
    return parsed.kind === 'file' ? { kind: 'file', src: parsed.src, ...link } : { kind: parsed.kind, embed: parsed.src, ...link };
}

const slideStudioLesson = moduleKey => (typeof getEditingModule === 'function' ? getEditingModule(parseStudioModuleKey(moduleKey).moduleId) || null : null);

// 스튜디오가 묻는다: 이 값은 어떤 영상인가. 영상 값(파일)은 주지 않는다 → { kind, … } 또는 null. moduleKey: studioModuleKey(심화학습은 '~adv')
window.getSlideStudioVideo = function (moduleKey, ref) {
    const found = resolveLessonVideo(slideStudioLesson(moduleKey), ref);
    if (!found) return null;
    const { data, id, ...info } = found;
    if (info.kind === 'wb' && !info.title) delete info.title;
    return info;
};

// 스튜디오가 묻는다: 그 영상의 파일(Blob). 넣은 파일은 차시의 값에서, 판서 영상은 이 브라우저의 저장소(wbvideo:…)에서. 파일이 없거나 주소 영상·GIF면 null
window.getSlideStudioVideoBlob = async function (moduleKey, ref) {
    const found = resolveLessonVideo(slideStudioLesson(moduleKey), ref);
    try {
        if (found?.kind === 'local') return typeof dataUrlBlob === 'function' ? dataUrlBlob(found.data) : null;
        if (found?.kind !== 'wb' || typeof DBManager === 'undefined') return null;
        const blob = await DBManager.getItem(typeof WB_VIDEO_KEY === 'function' ? WB_VIDEO_KEY(found.id) : `wbvideo:${found.id}`);
        return typeof Blob !== 'undefined' && blob instanceof Blob ? blob : null;
    } catch (err) {
        console.warn('[슬라이드 영상] 영상 파일을 읽지 못했습니다:', err?.message || err);
        return null;
    }
};

if (typeof window !== 'undefined') Object.assign(window, { lessonTrackVideos, citeDeckVideos, citeLessonVideos, resolveLessonVideo });
