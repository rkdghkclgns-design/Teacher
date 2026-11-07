// output-import.js - 내보낸 교안 파일(HTML·MD)을 다시 불러와 고칠 수 있는 차시로 되살린다
// HTML 내보내기에는 원본(탭 글, 화면에 없는 그림. 교수안 HTML이면 교수안·편성안과 그 그림도)을 <script type="application/json" id="teacher-source">로 담는다.
// 화면에 보이는 그림은 <img data-teacher-image="키" data-teacher-lesson="차시 번호">로 표시하고 원본에는 null로만 적는다(그림을 두 번 담지 않는다, version 2).
// 진짜 그림(data:image)만 담는다. 찾지 못한 그림 자리(teacher-image:…)·빈 값은 담지 않아, 다시 불러오면 빈 그림 자리로 센다.
// MD 내보내기에는 차시·탭 표시(<!-- teacher-lesson / teacher-tab -->)를 넣는다(lesson-export.js, ui.js, gyosuan-view.js).
// 불러오는 파일은 남이 준 것일 수 있어 글은 문자열만, 그림 키는 [\w-]만, 그림은 data:image만 받고 id는 새로 준다. 테스트: tests/output-import.test.js
// 파일은 크기와 상관없이 조각으로 읽고 data URL을 따로 떼어 둔 글로 원본을 찾는다(import-stream.js). 숨은 원본이 없는 예전 HTML은 화면 글을 마크다운으로 바꾼다(output-old-html.js).
// 판서 영상(<video data-wb-video>)은 표지 그림 자리에 다시 붙인다(넣을 때 영상 파일을 whiteboard-video.js와 같은 자리에 저장한다).

const OUTPUT_FORMAT = 'teacher-lesson-export';
const OUTPUT_VERSION = 2; // 1: 그림을 모두 원본에 담음(af5287a). 2: 화면에 보인 그림은 원본에 null로 적고 그 <img>에서 읽는다
const OUTPUT_BIG_FILE = 80 * 1024 * 1024; // 예전에 받지 않던 크기. 이보다 큰 파일도 조각으로 읽고, 확인 창에 큰 파일이라고 알린다
// 숨은 원본의 여는 태그와 닫는 태그. 정규식 대신 글자로 찾는다(닫지 않은 여는 태그가 아주 많은 파일에서도 한 번만 훑는다). 원본 JSON 안의 '<'는 이스케이프해 담는다(lessonSourceScript)
const OUTPUT_SOURCE_OPEN = '<script type="application/json" id="teacher-source">';
const OUTPUT_SOURCE_CLOSE = '</script>';
const OUTPUT_TAB_RE = /<!--\s*teacher-tab:\s*([A-Za-z]+)\s*-->/g; // /g라서 .test()에 쓰지 않는다(lastIndex가 움직인다)
const OUTPUT_TAB_MARK = /<!--\s*teacher-tab:/; // 탭 표시가 있는지만 볼 때
const OUTPUT_LESSON_RE = /<!--\s*teacher-lesson:\s*title=([^\s]*)\s*-->/;
const OUTPUT_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const OUTPUT_VIDEO_RE = /^data:video\/(mp4|webm|ogg);base64,[A-Za-z0-9+/=]+$/; // 판서 영상(whiteboard-video.js whiteboardHtmlForExport가 파일 안에 넣는다)
const OUTPUT_VIDEO_EXT = { mp4: 'mp4', webm: 'webm', ogg: 'ogv' };
const OUTPUT_VIDEO_TITLE = 200; // whiteboard-video.js WB_LABEL_MAX와 같은 길이
const OUTPUT_PICTURE_RE = /^data:image\//; // 담을 그림인지(진짜 그림). data-safety.js보다 먼저 실리므로 따로 둔다
const OUTPUT_IMAGE_KEY_RE = /^[\w-]{1,80}$/; // lesson-export.js EXPORT_IMAGE_KEY_RE, data-safety.js SAFE_IMAGE_KEY와 같은 규칙
const OUTPUT_IMG_ATTR_RE = /\s([^\s=>"'\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
const OUTPUT_NUMBER_HEAD = /^\d+[_.\s-]*/; // ZIP 파일 이름·머리의 01_ 같은 번호
const OUTPUT_HTML_NAME = /\.html?$/i;
const OUTPUT_MD_NAME = /\.(md|markdown|txt)$/i;
const OUTPUT_GYOSUAN_NAME = /(교수안|편성안)(_묶음)?$/; // 07_교수안·09_심화교수안(예전 ZIP은 06_교수안), 08_슬라이드편성안, …_교수안, …_심화교수안, …_차시별편성안, …_교수안_편성안_묶음
const OUTPUT_GYOSUAN_TEXT = /^##\s*진행\s*$|^(?:###\s*슬라이드|##\s*슬라이드\s*편성)/m; // gyosuan-io.js gyosuanFileKind와 같은 표시
const OUTPUT_TAB_SEPARATOR = '\n\n---\n\n';
const OUTPUT_CONFIRM_LESSONS = 5; // 확인 창에 제목을 보일 차시 수(나머지는 '외 N개')
const OUTPUT_CONFIRM_TITLE = 40; // 확인 창에 보일 제목 글자 수
const OUTPUT_CONFIRM_FAILED = 3; // 확인 창·알림에 까닭을 보일 건너뛴 파일 수
const OUTPUT_DEDUPE_SCAN = 20; // 탭 글이 같은 차시끼리 견줄 때 앞에서부터 살피는 수(남이 만든 파일에 같은 차시가 아주 많아도 멈추지 않게)
const OUTPUT_FILE_LESSONS = 2000; // 한 파일에서 받는 차시 수. 남이 만든 아주 긴 목록으로 확인 창 앞에서 멈추지 않게 한다(교과 HTML 하나에는 넉넉하다)
const OUTPUT_IMPORT_LESSONS = OUTPUT_FILE_LESSONS; // 한 번에 불러오는 차시 수(고른 파일을 모두 합쳐). 넘으면 아무것도 넣지 않고 나눠 불러오라고 알린다
const OUTPUT_NOTE_KEYS = ['old', 'diagrams', 'videosLost', 'unlabeled', 'unknownTabs', 'oversized']; // 확인 창이 세는 것(output-old-html.js)
// 교수안을 담는 차시 칸(갈래마다 하나). data.js LESSON_TRACKS의 id·field와 같다(이 파일의 테스트는 data.js 없이 돈다).
// 예전 교수안 HTML은 gyosuan 칸에만 담겨 기본학습 교수안으로 되살아난다
const OUTPUT_GYOSUAN_FIELDS = [{ track: 'basic', field: 'gyosuan', label: '기본학습 교수안' }, { track: 'adv', field: 'gyosuanAdv', label: '심화학습 교수안' }];
const outputIsMap = value => !!value && typeof value === 'object' && !Array.isArray(value);
const outputGyosuanSlots = lesson => OUTPUT_GYOSUAN_FIELDS.filter(slot => outputIsMap(lesson?.[slot.field]));

const outputText = value => (typeof value === 'string' ? value : '');

/* ---------- 내보낼 때: 원본 담기 ---------- */
// 저장된 원문 그대로(첫머리 정리 전). tabIds를 주면 그 탭만. 탭이 비고 옛 단일 본문만 있으면 기본학습으로 본다
function lessonSourceTabs(mod, tabIds = null) {
    const tabs = mod?.tabContents || {};
    const legacy = !!mod?.content && !LESSON_TABS.some(tab => tabs[tab.id]);
    return Object.fromEntries(LESSON_TABS
        .filter(tab => !tabIds || tabIds.includes(tab.id))
        .map(tab => [tab.id, tabs[tab.id] || (legacy && tab.id === 'basicLearn' ? mod.content : '')])
        .filter(([, md]) => md && String(md).trim()));
}

// 담은 탭이 쓰는 그림만 고른다(파일이 커지지 않게). 진짜 그림만: 찾지 못한 그림 자리(teacher-image:…)·빈 값은 담지 않는다
// (화면·내보내기도 그런 값은 빈 그림으로 그린다. 다시 불러오면 그 자리는 빈 그림으로 센다)
function usedLessonImages(images, texts) {
    const all = texts.join('\n');
    return Object.fromEntries(Object.entries(images || {}).filter(([id, data]) => typeof data === 'string' && OUTPUT_PICTURE_RE.test(data) && all.includes(`local:${id}`)));
}

// 화면에 보인 그림(shown: Map 키 → 그림)은 원본에 null로만 적는다. 다시 불러올 때 그 <img>에서 읽는다
// 같은 키라도 화면 그림과 다르면(교수안 쪽 그림 등) 원본에 그대로 담는다
function outputSourceImages(images, shown) {
    return Object.fromEntries(Object.entries(images).map(([key, data]) => [key, shown && shown.get(key) === data ? null : data]));
}

// 읽기용 원본에는 화면에서 늘 숨기는 예전 강사 안내(instructor-callout, data.js stripInstructorCallouts)를 넣지 않는다
function outputReaderTabs(tabs) {
    if (typeof stripInstructorCallouts !== 'function') return tabs;
    return Object.fromEntries(Object.entries(tabs)
        .filter(([, md]) => typeof md === 'string')
        .map(([id, md]) => [id, stripInstructorCallouts(md)])
        .filter(([, md]) => md.trim()));
}

// withGyosuan: 교수안·편성안과 그 그림까지 담는다(교수안 화면의 HTML만). 메뉴의 차시·교과 HTML과 ZIP의 교안.html(읽기용)에는 담지 않는다
// track: 담을 교수안의 갈래(basic | adv). 기본학습은 gyosuan, 심화학습은 gyosuanAdv 칸에 담아 다시 불러오면 같은 갈래로 들어간다
// shown: 차시 순서대로 Map(그림 키 → 화면에 보인 그림). lesson-export.js markShownImages가 채운다
// mods는 화면(내보낸 본문)을 그린 바로 그 차시 객체여야 한다. 그리지 않은 그림은 원본에 그림 그대로 담기기 때문이다
function lessonSourcePayload(mods, { tabIds = null, withGyosuan = false, track = 'basic', shown = [] } = {}) {
    const slot = OUTPUT_GYOSUAN_FIELDS.find(item => item.track === track) || OUTPUT_GYOSUAN_FIELDS[0];
    return {
        format: OUTPUT_FORMAT,
        version: OUTPUT_VERSION,
        exportedAt: new Date().toISOString(),
        lessons: mods.map((mod, index) => {
            const tabs = lessonSourceTabs(mod, tabIds);
            const tabContents = withGyosuan ? tabs : outputReaderTabs(tabs);
            const source = withGyosuan && outputIsMap(mod[slot.field]) ? mod[slot.field] : null;
            const docMd = source?.docMd || '';
            const deckMd = docMd ? source.deckMd || '' : '';
            const gyosuan = docMd ? { docMd, deckMd, images: outputSourceImages(usedLessonImages(source.images, [docMd, deckMd]), shown[index]) } : null;
            return {
                title: mod.title || '',
                description: mod.description || '',
                hours: mod.hours,
                tabContents,
                images: outputSourceImages(usedLessonImages(mod.images, [...Object.values(tabContents), docMd, deckMd]), shown[index]),
                gyosuan: slot.field === 'gyosuan' ? gyosuan : null,
                ...(slot.field !== 'gyosuan' && gyosuan ? { [slot.field]: gyosuan } : {})
            };
        })
    };
}

// HTML 안에 원본을 담는 태그. JSON 속 '<'를 \u003c로 바꿔 </script>로 태그가 끊기지 않게 한다
function lessonSourceScript(payload) {
    return `<script type="application/json" id="teacher-source">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`;
}

// MD 내보내기: 차시 표시와 탭마다 표시를 넣는다. 제목은 주석이 끊기지 않게 인코딩한다
function lessonMarkdownExport(mod, tabs) {
    const head = `<!-- teacher-lesson: title=${encodeURIComponent(mod.title || '')} -->\n`;
    const body = tabs.map(tab => `<!-- teacher-tab: ${tab.id} -->\n${tabs.length > 1 ? `# [${tab.label}]\n\n` : ''}${tab.md}`).join(OUTPUT_TAB_SEPARATOR);
    return head + body;
}

/* ---------- 불러올 때: 원본 읽기 ---------- */
// <img …> 태그 하나의 속성(큰따옴표·작은따옴표·따옴표 없는 값). 같은 이름이 또 있으면 처음 것만 본다(브라우저와 같다)
function outputImgAttributes(tag) {
    const attrs = new Map();
    for (const [, name, double, single, bare] of tag.matchAll(OUTPUT_IMG_ATTR_RE)) {
        const key = name.toLowerCase();
        if (!attrs.has(key)) attrs.set(key, double ?? single ?? bare ?? '');
    }
    return attrs;
}

// 여는 태그(img, video …)마다 속성 Map. 따옴표 안의 >에서 끊기지 않고, 닫히지 않은 태그를 만나면 거기서 멈춘다(한 번만 훑는다).
// from·to: 이 글자 범위에서 시작하는 태그만. DOMParser가 없을 때(node 테스트) 쓴다
function outputTags(html, name, from = 0, to = html.length) {
    const found = [];
    const start = new RegExp(`<${name}\\b`, 'gi');
    start.lastIndex = from;
    for (let match = start.exec(html); match && match.index < to; match = start.exec(html)) {
        let end = match.index + match[0].length;
        let quote = '';
        for (; end < html.length; end++) {
            const ch = html[end];
            if (quote) {
                if (ch === quote) quote = '';
            } else if (ch === '"' || ch === "'") {
                quote = ch;
            } else if (ch === '>') {
                break;
            }
        }
        if (end >= html.length) break;
        found.push(outputImgAttributes(html.slice(match.index, end + 1)));
        start.lastIndex = end + 1;
    }
    return found;
}

// 파일 HTML을 한 번만 파싱한다(스크립트가 돌지 않고 그림도 내려받지 않는다). DOMParser가 없으면 null
function outputDomOnce(html) {
    let doc;
    return () => {
        if (doc === undefined) doc = typeof DOMParser === 'function' ? new DOMParser().parseFromString(html, 'text/html') : null;
        return doc;
    };
}

// 화면 그림 가운데 다시 불러오기 표시가 있는 것: Map('차시 번호/키' → 그림). 검사를 통과한 것만, 같은 자리는 처음 것만 쓴다
// read: 조각으로 읽은 파일(떼어 둔 data URL을 되돌린다, import-stream.js). dom: outputDomOnce
function readShownImages(html, read = streamPlain(html), dom = outputDomOnce(html)) {
    const found = new Map();
    const add = (lesson, key, src) => {
        const data = read.dataOf(src);
        if (!/^\d{1,4}$/.test(String(lesson)) || !OUTPUT_IMAGE_KEY_RE.test(String(key)) || typeof data !== 'string' || !OUTPUT_IMAGE_RE.test(data)) return;
        const at = `${Number(lesson)}/${key}`;
        if (!found.has(at)) found.set(at, data);
    };
    const doc = dom();
    if (doc) {
        Array.from(doc.querySelectorAll('img[data-teacher-image]')).forEach(img => add(img.getAttribute('data-teacher-lesson') ?? '0', img.getAttribute('data-teacher-image'), img.getAttribute('src')));
        return found;
    }
    outputTags(html, 'img').forEach(attrs => {
        if (attrs.has('data-teacher-image')) add(attrs.get('data-teacher-lesson') ?? '0', attrs.get('data-teacher-image'), attrs.get('src'));
    });
    return found;
}

// 판서 영상 [{ src, poster, title, key }]. 영상·표지 그림은 data URL로 되돌린 값. key: 내보낼 때 적은 그림 키(data-wb-image, 예전 파일에는 없다)
function outputVideosOf(html, read, dom) {
    if (!html.includes('<video')) return [];
    const doc = dom();
    const tags = doc
        ? Array.from(doc.querySelectorAll('video[data-wb-video]'), video => ({ src: video.getAttribute('src'), poster: video.getAttribute('poster'), label: video.getAttribute('aria-label'), key: video.getAttribute('data-wb-image') }))
        : outputTags(html, 'video').filter(attrs => attrs.has('data-wb-video')).map(attrs => ({ src: attrs.get('src'), poster: attrs.get('poster'), label: attrs.get('aria-label'), key: attrs.get('data-wb-image') }));
    return tags.map(tag => ({
        src: read.dataOf(tag.src || ''),
        poster: read.dataOf(tag.poster || ''),
        title: String(tag.label || '').replace(/^판서 영상:\s*/, '').trim().slice(0, OUTPUT_VIDEO_TITLE),
        key: OUTPUT_IMAGE_KEY_RE.test(String(tag.key || '')) ? String(tag.key) : ''
    }));
}

// 원본을 담은 HTML의 판서 영상을 그 표지 그림과 같은 그림 키에 붙인다(내보낼 때 표지 <img>는 빠지고 그림은 원본에 남는다).
// 내보낼 때 적은 그림 키가 있으면 그 자리에(같은 그림을 가진 다른 키가 아니라), 없으면(예전 파일) 아직 영상이 없는 첫 자리에 붙인다.
// 같은 그림을 두 곳에 써서 같은 영상이 두 번 들어 있으면 한 번만 붙인다(잃은 것으로 세지 않는다).
// 맞는 그림 키를 찾지 못한 영상은 첫 차시의 importNotes.videosLost로 센다. 표지 그림 → [차시, 키]를 한 번만 만들어 영상마다 모든 차시를 다시 훑지 않는다
function withOutputVideos(lessons, html, read, dom) {
    const videos = outputVideosOf(html, read, dom);
    if (!videos.length) return lessons;
    const placed = lessons.map(lesson => (lesson && typeof lesson === 'object' ? { ...lesson, videos: [] } : lesson));
    const byPoster = new Map();
    placed.forEach(lesson => {
        if (!lesson?.videos || !lesson.images || typeof lesson.images !== 'object') return;
        Object.entries(lesson.images).forEach(([key, data]) => {
            if (typeof data !== 'string') return;
            if (!byPoster.has(data)) byPoster.set(data, []);
            byPoster.get(data).push({ lesson, key });
        });
    });
    const taken = owner => owner.lesson.videos.some(item => item.key === owner.key);
    let lost = 0;
    videos.forEach(video => {
        const owners = OUTPUT_VIDEO_RE.test(video.src) && OUTPUT_IMAGE_RE.test(video.poster) ? byPoster.get(video.poster) || [] : [];
        const marked = video.key ? owners.find(owner => owner.key === video.key) : null;
        const candidates = marked ? [marked] : owners;
        if (candidates.some(owner => owner.lesson.videos.some(item => item.key === owner.key && item.data === video.src))) return; // 같은 영상을 이미 붙였다
        const owner = candidates.find(item => !taken(item));
        if (!owner) {
            lost += 1;
            return;
        }
        owner.lesson.videos.push({ key: owner.key, data: video.src, title: video.title });
    });
    const first = placed.findIndex(lesson => lesson && typeof lesson === 'object');
    if (lost && first >= 0) placed[first] = { ...placed[first], importNotes: { ...placed[first].importNotes, videosLost: lost } };
    return placed;
}

// 원본 JSON의 글·그림 값 속 표시를 원래 data URL로 되돌린다. 원본에 적힌 영상·확인 창 칸은 받지 않는다(화면에서 읽는다)
function outputRestoredLesson(lesson, read) {
    const { videos, importNotes, ...rest } = lesson;
    if (!read.count) return rest;
    const text = value => (typeof value === 'string' ? read.restore(value) : value);
    const values = map => (map && typeof map === 'object' && !Array.isArray(map) ? Object.fromEntries(Object.entries(map).map(([key, value]) => [key, text(value)])) : map);
    // 두 갈래의 교수안(기본학습 gyosuan · 심화학습 gyosuanAdv)을 같은 방법으로 되돌린다
    const plans = Object.fromEntries(outputGyosuanSlots(rest).map(({ field }) => [field, { ...rest[field], docMd: text(rest[field].docMd), deckMd: text(rest[field].deckMd), images: values(rest[field].images) }]));
    return { ...rest, title: text(rest.title), description: text(rest.description), tabContents: values(rest.tabContents), images: values(rest.images), ...plans };
}

const outputHasShownImage = images => !!images && typeof images === 'object' && Object.values(images).some(data => data === null);
// 차시 그림이나 어느 갈래의 교수안 그림에 화면에서 읽을 그림(null)이 있는가
const outputLessonHasShown = lesson => outputHasShownImage(lesson.images) || outputGyosuanSlots(lesson).some(({ field }) => outputHasShownImage(lesson[field].images));

// 원본에 null로 적힌 그림을 화면의 <img>에서 채운다. 못 찾으면 뺀다(그 자리는 빈 그림으로 남고 확인 창이 센다)
function fillShownImages(images, index, shown) {
    if (!images || typeof images !== 'object') return {};
    return Object.fromEntries(Object.entries(images)
        .map(([key, data]) => [key, data === null ? shown.get(`${index}/${key}`) : data])
        .filter(([, data]) => data !== undefined));
}

// 숨은 원본(JSON 글). 첫 여는 태그 뒤 첫 닫는 태그까지. 없거나 닫히지 않았으면 null
function outputSourceText(html) {
    const at = html.indexOf(OUTPUT_SOURCE_OPEN);
    if (at < 0) return null;
    const from = at + OUTPUT_SOURCE_OPEN.length;
    const end = html.indexOf(OUTPUT_SOURCE_CLOSE, from);
    return end < 0 ? null : html.slice(from, end);
}

// read: 조각으로 읽은 파일(import-stream.js). 글로 받으면 떼어 둔 것이 없는 것으로 본다
function parseOutputHtml(text, read = streamPlain(text)) {
    const html = String(text || '');
    const source = outputSourceText(html);
    if (source === null) return null;
    let data;
    try {
        data = JSON.parse(source);
    } catch (err) {
        console.warn('[불러오기] HTML 안의 원본을 읽지 못했습니다:', err.message);
        return null;
    }
    if (!data || data.format !== OUTPUT_FORMAT || !Array.isArray(data.lessons)) return null;
    // 차시가 상한보다 많은 파일은 그림·영상을 맞춰 보기 전에 그대로 돌려준다(readOutputText가 까닭을 알린다). 남이 만든 아주 긴 목록에서 멈추지 않게
    if (data.lessons.length > OUTPUT_FILE_LESSONS) return data.lessons;
    const isObject = value => !!value && typeof value === 'object';
    const dom = outputDomOnce(html);
    const lessons = data.lessons.map(lesson => (isObject(lesson) ? outputRestoredLesson(lesson, read) : lesson));
    // 예전(version 1) 파일처럼 그림이 모두 원본에 들어 있으면 화면 그림은 읽지 않는다. 교수안 그림이 원본에 없던 version 1 교수안 HTML은 화면 교수안에서 되찾는다
    if (!lessons.some(lesson => isObject(lesson) && outputLessonHasShown(lesson))) {
        const filled = data.version === 1 && lessons.length === 1 ? [withOldGyosuanImages(lessons[0], html, read, dom)] : lessons;
        return withOutputVideos(filled, html, read, dom);
    }
    const shown = readShownImages(html, read, dom);
    const filled = lessons.map((lesson, index) => {
        if (!isObject(lesson)) return lesson;
        const plans = Object.fromEntries(outputGyosuanSlots(lesson).map(({ field }) => [field, { ...lesson[field], images: fillShownImages(lesson[field].images, index, shown) }]));
        return { ...lesson, images: fillShownImages(lesson.images, index, shown), ...plans };
    });
    return withOutputVideos(filled, html, read, dom);
}

// 탭 id·이름. 앞 번호(ZIP의 01_기본학습)와 띄어쓰기는 보지 않는다
const tabIdOf = name => {
    const key = String(name || '').trim().replace(OUTPUT_NUMBER_HEAD, '');
    return LESSON_TABS.find(tab => tab.id === key || tab.label === key || tab.label.replace(/\s/g, '') === key.replace(/\s/g, ''))?.id || null;
};

// 탭 하나의 글에서 내보낼 때 붙인 머리(# [그 탭 이름])와 다음 탭 앞의 구분선만 뗀다.
// 글 첫 줄이 다른 '# [..]' 제목이거나 마지막 탭이 구분선으로 끝나면 교안 내용이므로 둔다
// headOf: 머리를 뗄 탭 id(머리를 붙이지 않은 한 탭 내보내기면 비움)
function cleanTabPart(text, { headOf = null, isLast = true } = {}) {
    let part = String(text);
    const head = part.match(/^\s*# \[([^\]\n]+)\][ \t]*(\n|$)/);
    if (headOf && head && tabIdOf(head[1]) === headOf) part = part.slice(head[0].length);
    if (!isLast) part = part.replace(/\n+---\s*$/, '');
    return part.trim();
}

// 파일 이름에서 확장자와 내려받을 때 붙은 번호(' (1)')를 뗀다
const outputFileBase = fileName => String(fileName || '').replace(OUTPUT_MD_NAME, '').replace(/\s*\(\d+\)$/, '').trim();

// ZIP의 탭 MD(01_기본학습.md…)면 그 탭 id. 차시·탭 표시가 있는 MD(이 앱의 MD 내보내기)는 표시를 따른다
function outputTabFileOf(text, fileName) {
    const src = String(text || '');
    if (OUTPUT_LESSON_RE.test(src) || OUTPUT_TAB_MARK.test(src)) return null;
    return tabIdOf(outputFileBase(fileName));
}

// MD의 차시 표시(<!-- teacher-lesson: title=… -->)에 적힌 제목. 표시가 없거나 읽지 못하면 ''
function outputMarkTitle(text) {
    const mark = String(text || '').match(OUTPUT_LESSON_RE);
    if (!mark) return '';
    try { return decodeURIComponent(mark[1]); } catch (err) { return ''; }
}

// MD 한 파일 → 차시 하나. 표시가 있으면 탭별로, ZIP의 탭 MD(02_기본실습.md)면 글 전체를 그 탭으로,
// 예전 내보내기면 '# [탭]' 머리(ZIP _전체.md의 # [01_기본학습] 포함)로, 그 밖이면 전체를 기본학습으로
function parseOutputMarkdown(text, fileName = '') {
    const src = String(text || '').replace(/\r\n/g, '\n');
    const title = outputMarkTitle(src);
    const body = src.replace(OUTPUT_LESSON_RE, '');
    const tabContents = {};
    const marks = [...body.matchAll(OUTPUT_TAB_RE)];
    const fileTab = marks.length ? null : outputTabFileOf(src, fileName);
    if (marks.length) {
        marks.forEach((mark, i) => {
            const id = tabIdOf(mark[1]);
            const end = i + 1 < marks.length ? marks[i + 1].index : body.length;
            const part = cleanTabPart(body.slice(mark.index + mark[0].length, end), { headOf: marks.length > 1 ? id : null, isLast: i === marks.length - 1 });
            if (id && part) tabContents[id] = part;
        });
    } else if (fileTab) {
        if (body.trim()) tabContents[fileTab] = body.trim(); // 글 속 '# [..]' 줄로 나누지 않는다(교안 내용일 수 있다)
    } else {
        const heads = [...body.matchAll(/^# \[([^\]\n]+)\]\s*$/gm)].filter(head => tabIdOf(head[1]));
        if (heads.length) {
            heads.forEach((head, i) => {
                const end = i + 1 < heads.length ? heads[i + 1].index : body.length;
                const id = tabIdOf(head[1]);
                const part = cleanTabPart(body.slice(head.index, end), { headOf: id, isLast: i === heads.length - 1 });
                if (part) tabContents[id] = part;
            });
        } else if (body.trim()) {
            tabContents.basicLearn = body.trim();
        }
    }
    // ZIP의 탭 MD는 차시 이름을 모른다(제목은 '불러온 차시'가 된다). _전체.md는 앞 번호와 _전체를 뗀다
    const fallbackTitle = fileTab ? '' : outputFileBase(fileName).replace(OUTPUT_NUMBER_HEAD, '').replace(/_전체$/, '').trim();
    return [{ title: title || fallbackTitle, tabContents, images: {} }];
}

// 교수안·편성안 MD(ZIP의 07_교수안.md·08_슬라이드편성안.md·09_심화교수안.md 등과 예전 ZIP의 06_교수안.md, 교수안 화면에서 받은 …_교수안.md 등)는 교안 차시로 넣지 않는다
// 이름과 내용이 함께 맞을 때만 본다. 차시·탭 표시가 있는 MD(이 앱의 교안 MD)는 제목에 '교수안'이 있어도 교안이다
function isGyosuanMdFile(text, fileName) {
    const src = String(text || '').replace(/\r\n/g, '\n');
    if (OUTPUT_LESSON_RE.test(src) || OUTPUT_TAB_MARK.test(src)) return false;
    return OUTPUT_GYOSUAN_NAME.test(outputFileBase(fileName)) && OUTPUT_GYOSUAN_TEXT.test(src);
}

// ZIP의 탭 MD를 한 번에 고르면 한 차시로 묶는다. 같은 탭 파일이 둘 이상이면 묶지 않는다
// items: [{ raw, from, tabFile, file }]. tabFile은 MD를 읽을 때만 붙인다(HTML 원본 글로는 흉내 낼 수 없다). 묶은 차시는 첫 탭 파일 자리에 둔다
function mergeTabFiles(items) {
    const tabItems = items.filter(item => item.from === 'md' && item.tabFile);
    const ids = tabItems.map(item => item.tabFile);
    if (tabItems.length < 2 || new Set(ids).size !== ids.length) return items;
    const merged = { raw: { title: '', tabContents: Object.assign({}, ...tabItems.map(item => item.raw.tabContents)), images: {} }, from: 'md', file: tabItems[0].file };
    return items.flatMap(item => (item === tabItems[0] ? [merged] : tabItems.includes(item) ? [] : [item]));
}

/* ---------- 검사: 남이 준 파일일 수 있다 ---------- */
// 그림 키는 [\w-]만, 그림은 data:image만
const outputValidImages = raw => Object.fromEntries(Object.entries(raw && typeof raw === 'object' ? raw : {})
    .filter(([key, data]) => OUTPUT_IMAGE_KEY_RE.test(key) && typeof data === 'string' && OUTPUT_IMAGE_RE.test(data)));

// 판서 영상: 그림이 있는 그림 키마다 하나, 영상은 data:video만, 제목은 글자만
function outputValidVideos(list, images) {
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
        .filter(video => video && typeof video === 'object' && OUTPUT_IMAGE_KEY_RE.test(String(video.key)) && typeof images[video.key] === 'string'
            && typeof video.data === 'string' && OUTPUT_VIDEO_RE.test(video.data) && !seen.has(String(video.key)) && seen.add(String(video.key)))
        .map(video => ({ key: String(video.key), data: video.data, title: outputText(video.title).slice(0, OUTPUT_VIDEO_TITLE) }));
}

// 확인 창이 세는 수(예전 형식, 그림으로 넣은 다이어그램 등). 0보다 큰 정수만
function outputImportNotes(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const notes = Object.fromEntries(OUTPUT_NOTE_KEYS.map(key => [key, Math.floor(Number(raw[key]) || 0)]).filter(([, count]) => count > 0));
    return Object.keys(notes).length ? notes : null;
}

// 받은 교수안 하나(글은 문자열만, 그림은 검사를 지난 것만). 교수안 문서가 없으면 null
function outputValidGyosuan(raw) {
    const docMd = outputText(raw?.docMd);
    return docMd ? { docMd, deckMd: outputText(raw.deckMd), images: outputValidImages(raw.images), updatedAt: new Date().toISOString() } : null;
}

function normalizeImportedLesson(raw, id) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const tabs = source.tabContents && typeof source.tabContents === 'object' ? source.tabContents : {};
    const tabContents = Object.fromEntries(LESSON_TABS.map(tab => [tab.id, outputText(tabs[tab.id]) || null]));
    const images = outputValidImages(source.images);
    // 갈래마다 교수안(기본학습 gyosuan · 심화학습 gyosuanAdv). 예전 파일은 gyosuan 칸뿐이라 기본학습 교수안이 된다
    const plans = Object.fromEntries(OUTPUT_GYOSUAN_FIELDS.map(({ field }) => [field, outputValidGyosuan(outputIsMap(source[field]) ? source[field] : null)]).filter(([, plan]) => plan));
    const content = LESSON_TABS.map(tab => tabContents[tab.id] || '').filter(Boolean).join(OUTPUT_TAB_SEPARATOR);
    const hours = Number(source.hours);
    const videos = outputValidVideos(source.videos, images);
    const notes = outputImportNotes(source.importNotes);
    return {
        id,
        title: outputText(source.title).trim().slice(0, 300) || '불러온 차시',
        description: outputText(source.description).slice(0, 4000),
        ...(Number.isFinite(hours) && hours > 0 ? { hours } : {}),
        status: content ? 'done' : 'waiting',
        content: content || null,
        tabContents,
        images,
        ...plans,
        uploadedMdName: null,
        uploadedMdContent: null,
        // 넣기 전에 떼는 칸: 저장할 판서 영상(importOutputFiles가 영상 파일로 저장한다)과 확인 창에 셀 것
        ...(videos.length ? { videos } : {}),
        ...(notes ? { importNotes: notes } : {})
    };
}

/* ---------- 확인 창: 무엇이 들어오는지 ---------- */
// 같은 차시인지 볼 탭 글. 줄바꿈 모양·앞뒤 빈칸·예전 강사 안내(ZIP의 탭 MD에는 남아 있다)는 보지 않는다. 글이 하나도 없으면 ''
const outputTabsKey = lesson => {
    const texts = LESSON_TABS.map(tab => {
        const text = String(lesson.tabContents[tab.id] || '').replace(/\r\n/g, '\n');
        return (typeof stripInstructorCallouts === 'function' ? stripInstructorCallouts(text) : text).trim();
    });
    return texts.some(Boolean) ? texts.join('\u0000') : '';
};
const outputImageKeys = lesson => Object.keys(Object.assign({ ...lesson.images }, ...outputGyosuanSlots(lesson).map(({ field }) => lesson[field].images || {})));
// 겹친 차시 가운데 남길 쪽: 교수안(어느 갈래든)이 있는 쪽, 다음은 HTML(제목·설명·그림이 있다), 다음은 그림이 많은 쪽
const outputKeepRank = item => (outputGyosuanSlots(item.lesson).length ? 2e6 : 0) + (item.from === 'html' ? 1e6 : 0) + outputImageKeys(item.lesson).length;
// 제목이 어디서 왔는지(readOutputText): 2 = 파일 안에 적힌 제목(HTML 원본, MD 차시 표시), 1 = 파일 이름에서 딴 제목, 0 = 없음('불러온 차시')
const outputTitleRank = item => item.titleRank || 0;
// 둘 다 가진 키의 그림은 같아야 한다(한쪽에서 다시 그린 그림이면 다른 차시로 본다)
const outputSameImages = (a, b) => Object.keys(a || {}).every(key => !Object.prototype.hasOwnProperty.call(b || {}, key) || a[key] === b[key]);

// 하나를 빼도 잃는 것이 없을 때만 같은 차시로 본다: 다른 파일에서 왔고, 둘 다 담은 것은 모두 같다(탭 글은 이미 같다)
// 제목은 둘 다 파일 안에 적힌 것일 때만 견준다(ZIP의 _전체.md처럼 파일 이름에서 딴 제목은 차시 이름과 다르다). 설명·시간은 HTML에만 담긴다
function outputSameLesson(entry, item) {
    const a = entry.item.lesson;
    const b = item.lesson;
    if (entry.files.has(item.file)) return false;
    if (outputTitleRank(entry.item) === 2 && outputTitleRank(item) === 2 && a.title !== b.title) return false;
    if (entry.item.from === 'html' && item.from === 'html' && (a.description !== b.description || a.hours !== b.hours)) return false;
    // 같은 갈래의 교수안이 둘 다 있으면 글이 같아야 한다(갈래가 다른 교수안은 서로 견주지 않는다)
    if (OUTPUT_GYOSUAN_FIELDS.some(({ field }) => a[field] && b[field] && (a[field].docMd !== b[field].docMd || a[field].deckMd !== b[field].deckMd))) return false;
    return outputSameImages(a.images, b.images) && OUTPUT_GYOSUAN_FIELDS.every(({ field }) => outputSameImages(a[field]?.images, b[field]?.images));
}

// 버리는 쪽에만 있는 것(그림, 교수안 그림, 더 확실한 제목)을 남기는 쪽에 더한 새 항목. 받은 항목·차시 객체는 바꾸지 않는다
function outputAbsorbLesson(keep, drop) {
    const lesson = keep.lesson;
    const other = drop.lesson;
    const title = outputTitleRank(drop) > outputTitleRank(keep) ? { title: other.title } : {};
    // 갈래마다: 둘 다 있으면 버리는 쪽의 그림만 더하고, 버리는 쪽에만 있는 갈래의 교수안은 그대로 옮긴다
    const plans = Object.fromEntries(OUTPUT_GYOSUAN_FIELDS.flatMap(({ field }) => {
        if (lesson[field] && other[field]) return [[field, { ...lesson[field], images: { ...other[field].images, ...lesson[field].images } }]];
        return !lesson[field] && other[field] ? [[field, other[field]]] : [];
    }));
    const kept = lesson.videos || [];
    const videos = [...kept, ...(other.videos || []).filter(video => !kept.some(item => item.key === video.key))];
    return {
        ...keep,
        titleRank: Math.max(outputTitleRank(keep), outputTitleRank(drop)),
        lesson: { ...lesson, ...title, images: { ...other.images, ...lesson.images }, ...plans, ...(videos.length ? { videos } : {}) }
    };
}

// 다른 파일에서 온 같은 차시는 한 번만 넣는다(ZIP 차시 폴더의 파일을 모두 골랐을 때, 차시 HTML과 교수안 HTML을 함께 골랐을 때 등)
// 같은 차시인지는 outputSameLesson. 교수안·제목·설명·시간·같은 키의 그림 가운데 하나라도 서로 다르면 둘 다 넣는다
// 한 파일 안에서 겹친 차시는 일부러 둔 것일 수 있어 그대로 둔다(이미 그 파일의 차시를 품은 항목에는 다시 품지 않는다). 글도 교수안도 없는 차시는 견주지 않는다
// 탭 글이 같은 것끼리만 견준다(차시가 많아도 느려지지 않게)
// items: [{ lesson, from, file(고른 파일 순서), titleRank }] → { kept, dropped }
function dedupeImported(items) {
    const kept = [];
    const byKey = new Map(); // 탭 글 → 그 글인 kept 자리들
    items.forEach(item => {
        const key = outputTabsKey(item.lesson);
        const comparable = Boolean(key || outputGyosuanSlots(item.lesson).length); // 글도 교수안도 없는 차시는 견주지 않는다(제목만 다른 빈 차시가 하나로 접히지 않게)
        if (comparable && !byKey.has(key)) byKey.set(key, []);
        const places = comparable ? byKey.get(key) : [];
        const at = places.slice(0, OUTPUT_DEDUPE_SCAN).find(place => outputSameLesson(kept[place], item));
        if (at === undefined) {
            places.push(kept.length);
            kept.push({ item, files: new Set([item.file]) });
            return;
        }
        const entry = kept[at];
        const files = new Set([...entry.files, item.file]);
        kept[at] = outputKeepRank(item) > outputKeepRank(entry.item)
            ? { item: outputAbsorbLesson(item, entry.item), files }
            : { item: outputAbsorbLesson(entry.item, item), files };
    });
    return { kept: kept.map(entry => entry.item), dropped: items.length - kept.length };
}

// 글에는 있는데 파일에 그림이 없는 자리(local:키) 수
function missingImageCount(lesson) {
    const have = new Set(outputImageKeys(lesson));
    const texts = [...Object.values(lesson.tabContents || {}), ...outputGyosuanSlots(lesson).flatMap(({ field }) => [lesson[field].docMd, lesson[field].deckMd])].filter(Boolean).join('\n');
    return new Set([...texts.matchAll(/local:([\w-]+)/g)].map(match => match[1]).filter(key => !have.has(key))).size;
}

const outputCount = n => Number(n).toLocaleString('ko-KR');
// 확인 창에 넣는 제목: 한 줄로 모으고 길면 줄인다(받은 파일의 제목이 줄을 바꿔 확인 창에 없는 줄을 꾸미지 못하게. data-safety.js importTitleText와 같은 규칙)
const outputShortTitle = title => {
    const chars = Array.from(String(title).replace(/\s+/g, ' ').trim());
    return chars.length > OUTPUT_CONFIRM_TITLE ? `${chars.slice(0, OUTPUT_CONFIRM_TITLE).join('')}…` : chars.join('');
};
// 건너뛴 파일: 앞 몇 개만 까닭과 함께, 나머지는 '외 N개'
const outputFailedLines = failed => [...failed.slice(0, OUTPUT_CONFIRM_FAILED).map(line => `· ${line}`),
    ...(failed.length > OUTPUT_CONFIRM_FAILED ? [`· 외 ${failed.length - OUTPUT_CONFIRM_FAILED}개`] : [])];

// 차시 한 줄: 제목, 다음 줄에 탭별 글자 수·그림 장수·판서 영상·교수안
function outputLessonLine(lesson) {
    const tabs = LESSON_TABS.filter(tab => lesson.tabContents[tab.id]).map(tab => `${tab.label} ${outputCount(lesson.tabContents[tab.id].length)}자`);
    const images = outputImageKeys(lesson).length;
    const videos = (lesson.videos || []).length;
    const parts = [...tabs, ...(images ? [`그림 ${images}장`] : []), ...(videos ? [`판서 영상 ${videos}개`] : []), ...outputGyosuanSlots(lesson).map(slot => slot.label)];
    return `· ${outputShortTitle(lesson.title)}\n   ${parts.join(' · ') || '글 없음'}`;
}

// 차시마다 센 것(importNotes)의 합
const outputNoteSum = (lessons, key) => lessons.reduce((sum, lesson) => sum + (lesson.importNotes?.[key] || 0), 0);
const outputMb = bytes => outputCount(Math.round(Number(bytes) / (1024 * 1024)));

// 예전 형식 HTML(숨은 원본 없음)·판서 영상·다이어그램·너무 큰 그림처럼 무엇이 돌아오고 무엇이 돌아오지 않는지
function outputRestoreNotes(lessons) {
    const oldCount = lessons.filter(lesson => lesson.importNotes?.old).length;
    const videos = lessons.reduce((sum, lesson) => sum + (lesson.videos || []).length, 0);
    const lost = outputNoteSum(lessons, 'videosLost');
    const diagrams = outputNoteSum(lessons, 'diagrams');
    const unlabeled = outputNoteSum(lessons, 'unlabeled');
    const unknownTabs = outputNoteSum(lessons, 'unknownTabs');
    const oversized = outputNoteSum(lessons, 'oversized');
    return [
        oldCount && `· 숨은 원본이 없는 예전 HTML(차시 ${oldCount}개)은 화면에 보이는 글을 교안 글로 바꿔 되살립니다. 표·색 글씨·그림 칸처럼 마크다운으로 같게 그릴 수 없는 부분은 HTML 그대로 넣습니다. 차시 설명·시간은 파일에 없어 비워 둡니다.`,
        unlabeled && `· 탭 이름이 없는 글 ${unlabeled}곳은 기본학습 탭(차 있으면 다음 빈 탭)에 넣습니다.`,
        unknownTabs && `· 이름을 모르는 탭 ${unknownTabs}개는 빈 탭에 넣습니다.`,
        diagrams && `· 다이어그램 ${diagrams}개는 파일에 원본 코드가 없어 그림으로 넣습니다. 고치려면 다이어그램을 다시 만들어야 합니다.`,
        videos && `· 판서 영상 ${videos}개는 그 그림 자리에 되살립니다.`,
        lost && `· 판서 영상 ${lost}개는 영상이나 표지 그림이 파일에 없어 되살리지 못합니다(표지 그림이 있으면 그림으로 남습니다).`,
        oversized && `· 너무 큰 그림·영상 ${oversized}개(하나에 ${outputMb(STREAM_DATA_MAX)}MB 넘음)는 넣지 않습니다.`
    ].filter(Boolean);
}

// 불러오기 확인 창 글. items: [{ lesson(검사를 거친 차시), from: 'html' | 'md' }], failed: ['파일 이름: 까닭'], bigFile: 가장 큰 큰 파일의 바이트(없으면 0)
// 넣은 뒤 작업이 아주 커져도 브라우저에 저장한다(state.js writeBrowserState가 JSON 파일로 저장한다)
function describeOutputImport(items, { fileCount, where, dropped = 0, failed = [], bigFile = 0 }) {
    const lessons = items.map(item => item.lesson);
    const list = lessons.slice(0, OUTPUT_CONFIRM_LESSONS).map(outputLessonLine);
    if (lessons.length > OUTPUT_CONFIRM_LESSONS) list.push(`· 외 차시 ${outputCount(lessons.length - OUTPUT_CONFIRM_LESSONS)}개`);
    const missing = from => items.filter(item => item.from === from).reduce((sum, item) => sum + missingImageCount(item.lesson), 0);
    const mdMissing = missing('md');
    const htmlMissing = missing('html');
    const notes = [
        bigFile && `· 큰 파일(${outputMb(bigFile)}MB)도 조각으로 나눠 읽었습니다. 넣은 뒤 저장하는 데 시간이 조금 걸릴 수 있습니다.`,
        items.some(item => item.from === 'html' && !item.lesson.importNotes?.old) && '· HTML은 파일 안에 숨겨 둔 원본(내보낼 때의 글)으로 되살립니다. 다른 프로그램에서 HTML을 고쳤다면 고친 글은 들어오지 않습니다.',
        ...outputRestoreNotes(lessons),
        items.some(item => item.from === 'md') && `· MD 파일에는 그림이 담기지 않습니다.${mdMissing ? ` 그림 자리 ${mdMissing}곳은 빈칸이 됩니다. 그림까지 옮기려면 HTML이나 백업 ZIP을 쓰세요.` : ''}`,
        htmlMissing && `· 그림 ${htmlMissing}곳은 파일에서 찾지 못해 빈칸이 됩니다.`,
        !lessons.some(lesson => outputGyosuanSlots(lesson).length) && '· 교수안은 들어 있지 않습니다. 교수안까지 되살리려면 교수안 화면의 HTML 버튼으로 받은 파일을 고르세요. 기본학습·심화학습 교수안은 갈래마다 따로 받습니다.',
        "· 되살리는 것은 파일에 담긴 차시 제목·설명·시간, 탭 글, 그림, 판서 영상, 교수안뿐입니다. 차시 정보의 나머지 칸, 섹션 고정, 수동 검수 기록, 슬라이드 화면 편집, 참고 이미지, 삽화 목록, NCS 같은 것은 돌아오지 않습니다. 모두 되살리려면 '백업 ZIP으로 되살리기'를 쓰세요.",
        dropped && `· 여러 파일에 같은 차시가 있어 겹친 ${dropped}개는 빼고 한 번만 넣습니다.`
    ].filter(Boolean);
    const skipped = failed.length ? ['', `건너뛰는 파일 ${failed.length}개`, ...outputFailedLines(failed)] : [];
    return [`파일 ${fileCount}개에서 차시 ${outputCount(lessons.length)}개를 찾았습니다.`, `${where} 새 차시로 넣습니다. 지금 있는 차시는 그대로 둡니다.`,
        '', ...list, '', ...notes, ...skipped].join('\n');
}

/* ---------- 화면: 내보내기·백업 → 내보낸 교안 다시 불러오기 ---------- */
const onEditorScreen = () => /^#editor/.test(location.hash) && !!globalState.subjects.find(s => s.id === currentSubjectId);
// 저장된 작업을 읽지 못한 동안 고르면 보이는 말(불러온 차시를 저장할 수 없다. 백업 ZIP 되살리기와 같은 규칙)
const OUTPUT_UNREAD_TEXT = '저장된 작업을 읽지 못한 동안에는 내보낸 교안을 불러오지 않습니다(불러온 차시를 저장할 수 없습니다).\n'
    + "먼저 막는 창에서 다시 읽거나 백업 ZIP·저장해 둔 폴더로 되살린 뒤 불러오세요. 없으면 '새로 시작'을 누른 뒤 불러오세요.";

// 편집 중인 교과가 있으면 거기에, 아니면 새 교과를 만들어 넣는다
function outputImportTarget() {
    if (onEditorScreen()) return { subject: globalState.subjects.find(s => s.id === currentSubjectId), isNew: false };
    const stamp = new Date().toLocaleDateString();
    const subject = sanitizeState({ subjects: [{ id: generateUniqueId('subject_'), title: `불러온 교안 (${stamp})`, description: '내보낸 교안 파일에서 되살린 교과입니다.', lessons: [] }] }).subjects[0];
    return { subject, isNew: true };
}

// 원본을 읽지 못한 HTML의 까닭과 쓸 메뉴(이 앱이 원본 없이 내보낸 교안 HTML은 화면 글로 되살리므로 여기 오지 않는다)
function outputHtmlMissingReason(text) {
    if (/id=["']kb-source["']/.test(text)) return "슬라이드 HTML입니다. 그 차시의 교수안 화면에서 '내보낸 HTML 불러오기'로 넣으세요";
    if (text.includes('id="teacher-source"')) return '파일 안의 원본이 잘렸거나 깨져 읽지 못했습니다. 이 앱에서 다시 내보내 주세요';
    return "되살릴 원본이 없는 HTML입니다(다른 프로그램의 파일이거나 예전 교수안 HTML). 백업 ZIP에서 꺼낸 파일이면 그 ZIP을 '백업 ZIP으로 되살리기'로 여세요";
}

// 고른 파일을 읽기 전에 거른다. 문제가 있으면 까닭(글)을, 없으면 null. 크기는 보지 않는다(조각으로 읽는다, import-stream.js)
function outputFileProblem(file) {
    const name = String(file?.name || '');
    if (/\.zip$/i.test(name)) return "ZIP 파일은 '백업 ZIP으로 되살리기'로 여세요";
    if (!OUTPUT_HTML_NAME.test(name) && !OUTPUT_MD_NAME.test(name)) return 'HTML이나 MD 파일만 불러올 수 있습니다';
    return null;
}

// MD 결과의 글 속 표시를 원래 data URL로 되돌린다(MD의 그림은 글에 그대로 둔다)
function outputRestoredMarkdown(raw, read) {
    if (!read.count) return raw;
    return { ...raw, title: read.restore(raw.title), tabContents: Object.fromEntries(Object.entries(raw.tabContents).map(([id, md]) => [id, read.restore(md)])) };
}

// 파일 글 → [{ raw, from, tabFile, titleRank }]. 되살릴 수 없으면 까닭을 담아 던진다
// titleRank(겹친 차시를 견줄 때 쓴다): 2 = 파일 안에 적힌 제목(HTML 원본, MD 차시 표시), 1 = 파일 이름에서 딴 제목, 0 = 없음
// read: 조각으로 읽은 파일(import-stream.js). 글로 받으면 떼어 둔 것이 없는 것으로 본다
function readOutputText(name, text, read = streamPlain(text)) {
    if (OUTPUT_HTML_NAME.test(name)) {
        const lessons = parseOutputHtml(text, read);
        if (!lessons) throw new Error(outputHtmlMissingReason(String(text || '')));
        if (!lessons.length) throw new Error('들어 있는 차시가 없습니다');
        if (lessons.length > OUTPUT_FILE_LESSONS) throw new Error(`차시가 너무 많은 파일입니다(${outputCount(OUTPUT_FILE_LESSONS)}개 넘음). '백업 ZIP으로 되살리기'를 쓰세요`);
        return lessons.map(raw => ({ raw, from: 'html', titleRank: outputText(raw?.title).trim() ? 2 : 0 }));
    }
    if (isGyosuanMdFile(text, name)) {
        throw new Error(/_묶음$/.test(outputFileBase(name))
            ? "여러 차시의 교수안을 모은 읽기용 MD라 되살릴 수 없습니다. 모두 되살리려면 '백업 ZIP으로 되살리기'를 쓰세요"
            : "교수안·편성안 MD입니다. 그 차시의 교수안 화면에서 '완성 MD 불러오기'로 넣으세요");
    }
    const lessons = parseOutputMarkdown(text, name).map(raw => outputRestoredMarkdown(raw, read));
    if (lessons.every(raw => !Object.keys(raw.tabContents).length)) throw new Error('불러올 교안 글이 없습니다');
    const tabFile = outputTabFileOf(text, name);
    const marked = !!outputMarkTitle(text).trim();
    return lessons.map(raw => ({ raw, from: 'md', tabFile, titleRank: marked ? 2 : raw.title.trim() ? 1 : 0 }));
}

// 파일 하나를 조각으로 읽는다(크기 상한 없음). 숨은 원본이 없는 이 앱의 예전 교안 HTML은 화면 글을 마크다운으로 바꾼다(output-old-html.js)
// progress: showReadProgress(import-stream.js). 너무 커서 넣지 못한 그림·영상 수는 그 파일의 첫 차시에 적는다
async function readOutputFile(file, progress = null) {
    const problem = outputFileProblem(file);
    if (problem) throw new Error(problem);
    const read = await readFileSkeleton(file, { onProgress: progress?.update });
    const old = OUTPUT_HTML_NAME.test(file.name) && !read.text.includes(OUTPUT_SOURCE_OPEN) && isOldOutputHtml(read.text);
    const items = old ? await readOldOutputHtml(file.name, read, progress) : readOutputText(file.name, read.text, read);
    if (!read.oversized || !items.length || !items[0].raw || typeof items[0].raw !== 'object') return items;
    const [first, ...rest] = items;
    return [{ ...first, raw: { ...first.raw, importNotes: { ...first.raw.importNotes, oversized: read.oversized } } }, ...rest];
}

// 고른 파일을 차례로 읽는다 → { found, failed, bigFile, overCap }. 차시가 모두 합쳐 상한을 넘으면 더 읽지 않고 overCap에 그 파일 이름을 담는다
// (그때는 아무것도 넣지 않는다. 일부만 들어가 차시 순서가 비거나 ZIP의 탭 MD가 갈리지 않게)
async function readOutputFiles(files) {
    const found = [];
    const failed = [];
    let bigFile = 0;
    for (const [index, file] of files.entries()) {
        const progress = showReadProgress(file);
        try {
            const items = await readOutputFile(file, progress);
            if (found.length + items.length > OUTPUT_IMPORT_LESSONS) return { found, failed, bigFile, overCap: file.name };
            found.push(...items.map(item => ({ ...item, file: index })));
            if (file.size > OUTPUT_BIG_FILE) bigFile = Math.max(bigFile, file.size);
        } catch (err) {
            console.warn('[불러오기] 건너뛴 파일:', file.name, err); // 일부러 건너뛰는 파일이다. 까닭은 확인 창·알림에 보인다
            failed.push(`${file.name}: ${err.message}`);
        } finally {
            progress.close();
        }
    }
    return { found, failed, bigFile, overCap: '' };
}

// 판서 영상을 whiteboard-video.js와 같은 모양으로 넣는다: 영상 파일은 DBManager의 WB_VIDEO_KEY(새 영상 id), 차시에는 whiteboardVideos[그림 키].
// 영상 id는 새로 만든다(이 브라우저의 다른 차시 영상 파일을 덮지 않게). 넣기 전에 뗄 칸(videos, importNotes)은 차시에 남기지 않는다
async function storeOutputVideos(lessons) {
    const stored = [];
    let failed = 0;
    const placed = [];
    for (const lesson of lessons) {
        const { videos = [], importNotes, ...rest } = lesson;
        const whiteboardVideos = {};
        for (const video of videos) {
            const id = newWhiteboardRequestId();
            try {
                await DBManager.setItem(WB_VIDEO_KEY(id), dataUrlBlob(video.data));
                stored.push(id);
                const type = video.data.slice('data:video/'.length, video.data.indexOf(';'));
                whiteboardVideos[video.key] = { id, title: video.title || rest.title, ext: OUTPUT_VIDEO_EXT[type] || 'mp4', at: Date.now() };
            } catch (err) {
                console.warn('[불러오기] 판서 영상을 저장하지 못했습니다:', err);
                failed += 1;
            }
        }
        placed.push(Object.keys(whiteboardVideos).length ? { ...rest, whiteboardVideos } : rest);
    }
    return { lessons: placed, stored, failed };
}

window.importOutputFiles = async function (event) {
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = ''; // 같은 파일을 다시 고를 수 있게
    if (!files.length) return;
    if (typeof isStateLoadFailed === 'function' && isStateLoadFailed()) return window.showAlert(OUTPUT_UNREAD_TEXT);
    const { found, failed, bigFile, overCap } = await readOutputFiles(files);
    if (overCap) {
        return window.showAlert(`고른 파일의 차시가 모두 합쳐 ${outputCount(OUTPUT_IMPORT_LESSONS)}개를 넘습니다('${overCap}'에서 넘음). 아무것도 넣지 않았습니다. 파일을 나눠 불러오세요.`);
    }
    // ZIP의 탭 MD는 한 차시로 묶고, 검사한 뒤 다른 파일에서 온 같은 차시는 한 번만 넣는다
    const prepared = mergeTabFiles(found)
        .filter(item => item.raw && typeof item.raw === 'object')
        .map(item => ({ from: item.from, file: item.file, titleRank: item.titleRank, lesson: normalizeImportedLesson(item.raw, 0) }));
    const { kept, dropped } = dedupeImported(prepared);
    if (!kept.length) return window.showAlert(['불러올 교안을 찾지 못했습니다.', ...outputFailedLines(failed)].join('\n'));
    const { subject, isNew } = outputImportTarget();
    const where = isNew ? `새 교과 '${subject.title}'를 만들어` : `'${subject.title}' 교과에`;
    const ok = await confirmAsync(describeOutputImport(kept, { fileCount: files.length, where, dropped, failed, bigFile }), { okLabel: '불러오기', tone: 'primary', title: '내보낸 교안 다시 불러오기' });
    if (!ok) return;
    window.saveRawContent?.(); // 고치던 원문을 먼저 저장한다
    const existing = isNew ? [] : (subject.id === currentSubjectId ? courseData : subject.lessons || []);
    const ids = renumberLessons(kept.map(() => ({})), existing.map(lesson => lesson.id)).map(lesson => lesson.id);
    const { lessons, stored, failed: lostVideos } = await storeOutputVideos(kept.map((item, i) => ({ ...item.lesson, id: ids[i] })));
    const before = { subjects: globalState.subjects, courseData, lessons: subject.lessons };
    if (isNew) {
        globalState.subjects = [...globalState.subjects, { ...subject, lessons }];
    } else if (subject.id === currentSubjectId) {
        courseData = [...courseData, ...lessons];
    } else {
        subject.lessons = [...existing, ...lessons];
    }
    // 브라우저에 저장하지 못하면 넣기 전으로 돌리고 방금 저장한 영상 파일도 지운다. 이어진 PC 폴더에는 브라우저에 저장한 뒤에만 쓴다(백업 ZIP 되살리기와 같은 규칙)
    const saved = (await saveState({ folder: false })) !== false;
    if (!saved) {
        globalState.subjects = before.subjects;
        courseData = before.courseData;
        subject.lessons = before.lessons;
        await Promise.all(stored.map(id => DBManager.deleteItem(WB_VIDEO_KEY(id)).catch(err => console.warn('[불러오기] 영상 파일을 지우지 못했습니다:', err))));
        const resaved = (await saveState()) !== false;
        if (!isNew) renderSidebar();
        return window.showAlert('불러온 차시를 브라우저에 저장하지 못해 넣지 않았습니다. 화면은 불러오기 전으로 돌려 두었습니다.\n'
            + '브라우저 저장 공간이 모자라거나 이 사이트의 저장을 막았을 수 있습니다. 확인한 뒤 다시 불러와 주세요.'
            + (resaved ? '' : '\n불러오기 전 작업도 다시 저장하지 못했습니다. 브라우저 저장 공간을 확인한 뒤 Ctrl+S로 다시 저장해 주세요.'));
    }
    if (typeof projectFolderHandle !== 'undefined' && projectFolderHandle) syncToLinkedFolder().catch(err => console.warn('폴더 동기화 경고:', err.message));
    // 건너뛴 파일과 까닭은 확인 창에서 이미 보였다
    window.showToast?.(`차시 ${lessons.length}개를 불러왔습니다. 바로 고칠 수 있습니다.`, 'success');
    if (lostVideos) window.showAlert(`판서 영상 ${lostVideos}개는 이 브라우저에 저장하지 못해 넣지 않았습니다. 그 자리는 표지 그림으로 보입니다.`);
    if (isNew) location.hash = `#editor/${subject.id}/${lessons[0].id}`;
    else {
        renderSidebar();
        viewModule(lessons[0].id);
    }
};

if (typeof window !== 'undefined') {
    Object.assign(window, {
        lessonSourcePayload, lessonSourceScript, lessonMarkdownExport, parseOutputHtml, parseOutputMarkdown, normalizeImportedLesson, lessonSourceTabs,
        readShownImages, mergeTabFiles, dedupeImported, describeOutputImport, missingImageCount, outputFileProblem, readOutputText, isGyosuanMdFile,
        readOutputFile, readOutputFiles, storeOutputVideos, outputTags
    });
}
