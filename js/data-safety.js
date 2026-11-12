// data-safety.js - 작업을 잃지 않게: 확인 창(비동기), 복원되는 백업, 불러오기 전 자동 백업, 교과 휴지통, 히스토리 되돌리기, 마지막 전체 백업 시각, PC 폴더 열기 문구
// 계산만 하는 함수(교과 합치기 계획, 백업 나이, 되돌릴 곳)는 DOM 없이 돌고 tests/data-safety.test.js가 확인한다.

const BACKUP_FORMAT = 'teacher-backup';
const BACKUP_TIME_KEY = 'teacher:last-full-backup-at'; // 그림을 담은 과정 전체 백업만 센다. 교과 백업도 세던 예전 값(teacher:last-backup-at)은 시각으로 쓰지 않는다
const OLD_BACKUP_TIME_KEY = 'teacher:last-backup-at'; // 예전 값이 남았는지만 본다(업데이트 전에 받은 백업은 세지 않는다고 알린다)
const BACKUP_STALE_DAYS = 7;
const SUBJECT_TRASH_LIMIT = 30;

/* ---------- 계산 ---------- */
// 지금 상태의 사본. 지금 연 교과의 차시는 courseData가 최신이다. API 키와 휴지통은 넣지 않는다
function stateSnapshot(state, openSubjectId, openLessons) {
    const subjects = (state.subjects || []).map(subject => (
        String(subject.id) === String(openSubjectId) && Array.isArray(openLessons) ? { ...subject, lessons: openLessons } : subject
    ));
    return { ...state, subjects, apiKey: undefined, lessonTrash: undefined, subjectTrash: undefined };
}

// save_data.yaml 내용. scope 'full'은 지금 작업 전체를 바꾸고, 'subjects'는 고른 교과만 합친다.
// extra: 자동 백업에 함께 넣는 히스토리·휴지통 { history, trash }
function backupMeta(scope, context, now = new Date(), extra = {}) {
    return {
        format: BACKUP_FORMAT,
        scope,
        project: context.courseTitle || '',
        timestamp: now.toISOString(),
        subject_count: (context.subjects || []).length,
        context,
        ...extra
    };
}

// 두 목록을 합친다. 같은 항목(키가 같음)은 한 번만
function mergeUnique(first, second, keyOf) {
    const seen = new Map();
    [...(first || []), ...(second || [])].forEach(item => {
        const key = keyOf(item);
        if (!seen.has(key)) seen.set(key, item);
    });
    return [...seen.values()];
}

const trashKey = entry => `${entry.at}|${stateText((entry.lesson || entry.subject || {}).id)}`; // id가 객체여도 멈추지 않는다

// 백업 파일의 히스토리·휴지통을 지금 것과 합친다(불러와도 기록을 잃지 않게)
// 휴지통 항목은 모양과 지운 날짜(at)를 확인한다. 안의 교과·차시는 되살릴 때 sanitizeState를 거친다(restoreSubject, restoreLesson)
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const validTrash = (list, key, now = Date.now()) => (Array.isArray(list) ? list : [])
    .filter(entry => isObject(entry) && isObject(entry[key]))
    .map(entry => cleanTrashEntry(entry, key, now));

// 휴지통 한 칸의 겉모양을 맞춘다: 지운 날짜는 ISO로, 이름은 글로, 교과의 차시 목록은 배열로(휴지통 창이 그대로 보이고 센다.
// 남이 준 백업의 { length: '<img …>' } 같은 값이 화면에 들어가지 않게). 고칠 것이 없으면 같은 객체
function cleanTrashEntry(entry, key, now) {
    const timed = withTrashTime(entry, now);
    const inner = timed[key];
    const title = inner.title === undefined || typeof inner.title === 'string' ? inner.title : stateText(inner.title);
    const lessons = key === 'subject' && inner.lessons != null && !Array.isArray(inner.lessons) ? [] : inner.lessons;
    if (title === inner.title && lessons === inner.lessons) return timed;
    return { ...timed, [key]: { ...inner, title, ...(key === 'subject' ? { lessons } : {}) } };
}
// 작업 기록 id는 남긴 시각(ms)이다. 0 이상의 안전한 정수이거나 숫자만 든 글자일 때만 받는다(화면은 Number(id)로 찾는다). 아니면 null
const historyIdOf = item => {
    const id = typeof item?.id === 'string' && /^\d{1,15}$/.test(item.id) ? Number(item.id) : item?.id;
    return Number.isSafeInteger(id) && id >= 0 ? id : null;
};
// 다른 곳(백업 파일·PC 폴더)에서 온 기록: 칸마다 id·글·그림·탭 글을 검사하고(cleanHistoryItem) 쓸 수 없는 id의 기록은 뺀다. 고칠 것이 없는 칸은 같은 객체
const validHistory = list => (Array.isArray(list) ? list : []).map(cleanHistoryItem).filter(Boolean);

// now: 미래 시각 id를 가르는 기준(테스트에서 고정한다). historyDropped: 칸이 모자라 남기지 못한 기록 수(마침 알림에 쓴다)
function mergeBackupExtras(meta, current, now = Date.now()) {
    const history = mergeHistory(current.history, meta.history, now);
    return {
        history: history.list,
        historyDropped: { droppedIncoming: history.droppedIncoming, droppedCurrent: history.droppedCurrent },
        lessonTrash: mergeUnique(current.lessonTrash, validTrash(meta.trash?.lessonTrash, 'lesson'), trashKey),
        subjectTrash: mergeUnique(current.subjectTrash, validTrash(meta.trash?.subjectTrash, 'subject'), trashKey)
    };
}

// 휴지통에서 되살리는 교과·차시도 불러온 상태처럼 검사한다(남이 준 백업의 휴지통에서 올 수 있다)
function cleanTrashSubject(subject) {
    if (typeof sanitizeState !== 'function') return subject;
    return sanitizeState({ subjects: [JSON.parse(JSON.stringify(subject))] }).subjects[0];
}

function cleanTrashLesson(lesson) {
    if (typeof sanitizeState !== 'function') return lesson;
    return sanitizeState({ subjects: [{ id: 'trash', lessons: [JSON.parse(JSON.stringify(lesson))] }] }).subjects[0].lessons[0];
}

function planSubjectImport(current, incoming) {
    const mine = new Map((current || []).map(subject => [String(subject.id), subject]));
    const replaced = (incoming || []).filter(subject => mine.has(String(subject.id)));
    return {
        replaced,
        added: (incoming || []).filter(subject => !mine.has(String(subject.id))),
        // 바뀌는 내 교과의 지금 이름(확인 창에 양쪽 이름을 보인다)
        currentTitles: Object.fromEntries(replaced.map(subject => [String(subject.id), mine.get(String(subject.id)).title]))
    };
}

// 같은 id 교과는 그 자리에서 바꾸고 새 교과는 뒤에 붙인다. 다른 교과는 그대로 둔다
function mergeSubjects(current, incoming) {
    const byId = new Map((incoming || []).map(subject => [String(subject.id), subject]));
    const known = new Set((current || []).map(subject => String(subject.id)));
    return [
        ...(current || []).map(subject => byId.get(String(subject.id)) || subject),
        ...(incoming || []).filter(subject => !known.has(String(subject.id)))
    ];
}

// 확인 창에 넣는 교과 이름: 한 줄로 모으고 너무 길면 줄인다(남이 준 파일의 이름이 줄을 바꿔 확인 창에 없는 줄을 꾸미지 못하게)
const IMPORT_TITLE_MAX = 60;
function importTitleText(title) {
    const text = String(title ?? '').replace(/\s+/g, ' ').trim() || '제목 없음';
    return text.length > IMPORT_TITLE_MAX ? `${text.slice(0, IMPORT_TITLE_MAX)}…` : text;
}

// opts.noImages: 그림을 뺀 파일('빼기'), opts.lostImages: 빈칸이 될 바뀌는 교과의 지금 그림 수.
// 바뀌는 교과는 내 교과 이름과 파일의 이름을 함께 보인다(교과는 id로 같은지 가린다. 예시 교과 subject_1은 누구나 같다)
function describeSubjectImport(plan, { noImages = false, lostImages = 0 } = {}) {
    const currentTitles = plan.currentTitles || {};
    const lines = [
        ...plan.replaced.map(subject => {
            const mine = currentTitles[String(subject.id)] ?? subject.title;
            const renamed = mine !== subject.title ? '이름이 달라도 같은 교과로 보고 바꿉니다. ' : '';
            return `· 바꿈: 내 '${importTitleText(mine)}' → 파일의 '${importTitleText(subject.title)}' (${renamed}내 교과는 휴지통으로 갑니다)`;
        }),
        ...plan.added.map(subject => `· 추가: 파일의 '${importTitleText(subject.title)}' (새 교과로 넣습니다)`)
    ];
    const trashNote = plan.replaced.length ? '\n휴지통으로 간 교과는 교과 목록 아래 휴지통에서 30일 동안 되살릴 수 있습니다.' : '';
    const imageNote = noImages ? noImagesImportNote('subjects', lostImages) : '';
    return `교과 ${plan.replaced.length + plan.added.length}개를 불러옵니다.\n${lines.join('\n')}\n\n다른 교과는 그대로 둡니다. 불러오기 전에 지금 상태를 백업 파일로 내려받습니다.${trashNote}${imageNote}`;
}

// 머리줄의 마지막 백업 시각. 그림을 담은 과정 전체 백업만 센다(BACKUP_TIME_KEY)
function backupAgeLabel(iso, now = Date.now()) {
    const at = Date.parse(iso || '');
    if (!Number.isFinite(at)) return { text: '전체 백업 기록 없음', stale: true, none: true }; // 이 브라우저에 남은 기록이 없다(업데이트 전에 받은 백업은 세지 않는다)
    const minutes = Math.max(0, Math.floor((now - at) / 60000));
    const days = Math.floor(minutes / 1440);
    const text = minutes < 1 ? '방금 전체 백업'
        : minutes < 60 ? `${minutes}분 전 전체 백업`
            : minutes < 1440 ? `${Math.floor(minutes / 60)}시간 전 전체 백업`
                : `${days}일 전 전체 백업`;
    return { text, stale: days >= BACKUP_STALE_DAYS };
}

/* ---------- 작업 기록 한 칸: 담을 그림, 탭 하나 기록, 크기, 저장해 둔 기록 정리 ---------- */
// 탭 하나만 남긴 기록은 tabId에 그 탭 id를 적는다. 남이 준 파일의 값('constructor' 같은)으로 객체 속성을 읽지 않게 탭 id 목록과 비교만 한다
const HISTORY_TAB_IDS = ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment', 'advAssessment'];
// 교수안을 담는 차시 칸(기본학습·심화학습). data.js LESSON_TRACKS의 field를 따르고, 그 파일 없이 돌 때(테스트)는 이 두 칸이다
const GYOSUAN_FIELD_NAMES = ['gyosuan', 'gyosuanAdv'];
const gyosuanFields = () => (typeof LESSON_TRACKS !== 'undefined' && Array.isArray(LESSON_TRACKS) ? LESSON_TRACKS.map(track => track.field) : GYOSUAN_FIELD_NAMES);
const historyTabIds = () => (typeof LESSON_TABS !== 'undefined' && Array.isArray(LESSON_TABS) ? LESSON_TABS.map(tab => tab.id) : HISTORY_TAB_IDS);
const historyPart = item => (isObject(item) && typeof item.tabId === 'string' && historyTabIds().includes(item.tabId) ? item.tabId : null);
const historyPartName = part => (typeof LESSON_TABS !== 'undefined' && Array.isArray(LESSON_TABS) ? LESSON_TABS.find(tab => tab.id === part)?.label : '') || part;

// 그 글이 쓰는 그림(local:그림id)만 고른다. 기록 한 칸이 차시 그림을 통째로 복사하지 않게 한다.
// 값은 글자이기만 하면 그대로 담는다(data:image가 아닌 그림 참조 teacher-image:…도). 그림 키로 정규식을 만들지 않는다(이상한 그림 키로 멈추지 않게).
// 글은 한 번만 훑는다. 키마다 글 전체를 찾으면 남이 준 백업의 아주 많은 키와 긴 글로 앱 열기(tidyStoredHistory)가 멈춘다.
// local: 바로 뒤의 id 글자(영문·숫자·_·-) 줄을 모아, 그 키로 시작하는 줄이 있으면 남긴다. 글에 'local:키'가 있는지 본 것과 같다
// (img_1은 local:img_10만 있어도 남는다. 넉넉하게 남기는 쪽). 앱이 만드는 키(img_…)는 모두 id 글자다. 다른 글자가 든 키는 이렇게 가를 수 없어 늘 남긴다
const LOCAL_IMAGE_REF = 'local:';
const isImageIdCode = code => (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 45;

function isImageIdKey(id) {
    if (!id) return false;
    for (let i = 0; i < id.length; i++) if (!isImageIdCode(id.charCodeAt(i))) return false;
    return true;
}

// 글의 local: 뒤 id 글자 줄을 한 번씩, 정렬해서 돌려준다. ':'는 id 글자가 아니어서 줄끼리 겹치지 않는다(글을 한 번만 훑는다)
function localImageRuns(text) {
    const runs = new Set();
    const from = LOCAL_IMAGE_REF.length;
    for (let at = text.indexOf(LOCAL_IMAGE_REF); at !== -1; at = text.indexOf(LOCAL_IMAGE_REF, at + from)) {
        let end = at + from;
        while (end < text.length && isImageIdCode(text.charCodeAt(end))) end += 1;
        if (end > at + from) runs.add(text.slice(at + from, end));
    }
    return [...runs].sort();
}

// 정렬한 줄 가운데 id로 시작하는 줄이 있는지. id 이상인 첫 줄이 id로 시작하는지만 보면 된다(이진 탐색)
function anyRunStartsWith(sortedRuns, id) {
    let lo = 0;
    let hi = sortedRuns.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedRuns[mid] < id) lo = mid + 1;
        else hi = mid;
    }
    return lo < sortedRuns.length && sortedRuns[lo].startsWith(id);
}

const referencedImages = (text, images) => {
    const entries = Object.entries(isObject(images) ? images : {}).filter(([, data]) => typeof data === 'string');
    if (!entries.length) return {};
    const runs = localImageRuns(typeof text === 'string' ? text : '');
    return Object.fromEntries(entries.filter(([id]) => !isImageIdKey(id) || anyRunStartsWith(runs, id)));
};

// 차시(또는 남기려는 글)에서 그림을 쓸 수 있는 글: 합친 글, 모든 탭, 두 갈래(기본학습·심화학습)의 교수안·편성안(교수안 원문에 붙여 넣은 그림과 교안에서 가져다 쓴 그림은 차시 그림에 들어 있다)
const historyText = mod => [mod.content, ...Object.values(isObject(mod.tabContents) ? mod.tabContents : {}), ...gyosuanFields().flatMap(field => [mod[field]?.docMd, mod[field]?.deckMd])]
    .filter(text => typeof text === 'string').join('\n');

// 되돌리거나 새 차시로 되살릴 때 차시에 넣는 그림(기록의 그림이 차시에 들어가는 길은 이것 하나다).
// 기록은 남이 준 파일에서 왔을 수 있어 차시 그림과 같은 규칙으로 바른 키와 그림 값(data:image…;base64, 찾지 못한 그림 자리 teacher-image:…)만 받는다(고칠 수 있는 그림 값은 고쳐서)
const historyImages = entry => Object.fromEntries(Object.entries(isObject(entry.images) ? entry.images : {})
    .map(([id, data]) => [id, repairImageValue(data)])
    .filter(([id, data]) => isSafeImageKey(id) && isSafeImageValue(data)));

// 진짜 그림(data:image)인지. 아니면 찾지 못한 그림 자리(teacher-image 참조)나 빈 값이다(화면에는 빈 그림으로 보인다)
const isPictureData = data => typeof data === 'string' && data.startsWith('data:image/');

// 기록에 함께 담을 움직이는 GIF 기록(image-motion.js)과 그 원래 그림: 기록이 담은 그림(images)의 GIF 그림 키에 딸린 것만.
// 원래 그림은 글이 가리키지 않아 referencedImages가 담지 않으므로 따로 담는다(되돌리거나 새 차시로 되살려도 '원래 그림으로'가 되게). 담을 것이 없으면 null
function historyMotionParts(records, images, allImages) {
    if (!isObject(records) || !isObject(images) || !isObject(allImages)) return null;
    const imageMotions = {};
    const stills = {};
    for (const [key, item] of Object.entries(records)) {
        if (!Object.prototype.hasOwnProperty.call(images, key) || !isObject(item) || typeof item.still !== 'string') continue;
        if (typeof allImages[item.still] !== 'string') continue;
        imageMotions[key] = { ...item, ...(Array.isArray(item.patterns) ? { patterns: [...item.patterns] } : {}) };
        stills[item.still] = allImages[item.still];
    }
    return Object.keys(imageMotions).length ? { imageMotions, stills } : null;
}

// 되돌리는 쪽 밖에서 쓰는 그림 키. 되돌리는 쪽은 탭 하나 기록(part)이면 그 탭, 차시 기록이면 모든 탭과 합친 글이다.
// 밖: 다른 탭 글, 교수안·편성안·슬라이드 화면 편집본, 삽화·판서 영상이 가리키는 키(tabs.js unusedLessonImageIds와 같은 곳). 글은 local: 뒤 id 그대로 견준다(img_10은 img_1이 아니다).
// 합친 글(content)은 탭이 있으면 탭을 이은 글이라 밖으로 세지 않는다. 탭이 모두 빈 옛 본문은 다른 탭을 되돌리면 기본학습으로 옮겨지므로 밖이다
function historyOutsideImageKeys(lesson, part) {
    const tabs = isObject(lesson.tabContents) ? lesson.tabContents : null;
    const legacy = !!tabs && !historyTabIds().some(id => tabs[id]);
    const gyosuanTexts = gyosuanFields().flatMap(field => {
        const gyosuan = isObject(lesson[field]) ? lesson[field] : {};
        return [gyosuan.docMd, gyosuan.deckMd, gyosuan.deckHtml, ...(isObject(gyosuan.sessionDecks) ? Object.values(gyosuan.sessionDecks) : [])];
    });
    const texts = [
        ...(part && tabs ? Object.keys(tabs).filter(id => id !== part).map(id => tabs[id]) : []),
        ...(part && legacy && part !== 'basicLearn' ? [lesson.content] : []),
        ...gyosuanTexts
    ].filter(text => typeof text === 'string' && text.includes(LOCAL_IMAGE_REF));
    const pinned = [...(Array.isArray(lesson.illustrations) ? lesson.illustrations.map(item => item?.imgId) : []), ...(isObject(lesson.whiteboardVideos) ? Object.keys(lesson.whiteboardVideos) : [])];
    return new Set([...texts.flatMap(localImageRuns), ...pinned.filter(id => id != null && id !== '').map(String)]);
}

// 기록이 담은 움직이는 GIF 기록 가운데 그 GIF가 함께 돌아가지 않는 기록(그 GIF 자리는 지금 그림으로 두거나 기록이 틀림)의 원래 그림 키.
// 원래 그림은 글이 가리키지 않는 사본이라(image-motion.js) 기록 없이 들어가면 같은 값의 그림 키를 가로챈다(판서 영상·GIF 버튼이 사본 키를 잡는다).
// 기록 글이나 지금 차시 글이 가리키는 키는 그림으로 쓰는 키라 넣는다. images: 돌려놓으려는 기록의 그림
function historyIdleStills(lesson, entry, images) {
    if (!isObject(entry.imageMotions)) return new Set();
    const back = safeImageMotions(entry.imageMotions, { ...(isObject(lesson.images) ? lesson.images : {}), ...images });
    const coming = new Set(Object.entries(back).filter(([key]) => Object.prototype.hasOwnProperty.call(images, key)).map(([, item]) => item.still));
    const used = referencedImages(`${historyText(entry)}\n${historyText(lesson)}`, images);
    return new Set(Object.values(entry.imageMotions)
        .map(item => (isObject(item) && typeof item.still === 'string' ? item.still : ''))
        .filter(still => still && !coming.has(still) && !Object.prototype.hasOwnProperty.call(used, still)));
}

// 그 차시에 돌려놓을 기록의 그림(images)과, 기록에 진짜 그림이 있지만 넣지 않고 지금 그림으로 두는 키(kept).
// 기록 쪽 값이 찾지 못한 그림 자리·빈 값이면 차시의 진짜 그림을 덮지 않는다(다른 탭이 그 그림을 쓰고 있을 수 있고, 탭 하나 기록의 '되돌리기 전' 기록에는 그 탭 글이 쓰는 그림만 남는다).
// 차시 쪽이 그림 자리면 기록의 그림으로 채운다. 그 키에 지금 다른 진짜 그림이 있고(다시 찾기·삽화 다시 그리기는 같은 키에 새 그림을 넣는다) 되돌리는 쪽 밖에서도 그 키를 쓰면
// 기록의 그림을 넣지 않는다(다른 탭·교수안의 새 그림이 옛 그림으로 바뀌지 않게. 기록의 그림은 작업 기록에 그대로 남는다). part를 주지 않으면 그 기록의 탭(historyPart).
// 움직이는 GIF의 원래 그림은 그 GIF 기록이 함께 돌아갈 때만 넣는다(historyIdleStills)
function historyImagePlan(lesson, entry, part = historyPart(entry)) {
    const current = isObject(lesson.images) ? lesson.images : {};
    const pairs = Object.entries(historyImages(entry));
    const differs = ([id, data]) => isPictureData(data) && isPictureData(current[id]) && current[id] !== data;
    const outside = pairs.some(differs) ? historyOutsideImageKeys(lesson, part) : new Set();
    const kept = pairs.filter(pair => differs(pair) && outside.has(pair[0])).map(([id]) => id);
    const planned = Object.fromEntries(pairs.filter(([id, data]) => (isPictureData(data) ? !kept.includes(id) : !isPictureData(current[id]))));
    const idle = historyIdleStills(lesson, entry, planned);
    const images = idle.size ? Object.fromEntries(Object.entries(planned).filter(([id]) => !idle.has(id))) : planned;
    return { images, kept };
}

function historyImagesFor(lesson, entry, part) {
    return historyImagePlan(lesson, entry, part).images;
}

// 되돌린 뒤 알림에 붙이는 말: 밖에서도 써서 지금 그림으로 둔 그림 수
const historyKeptImagesNote = count => (count > 0 ? ` 다른 탭·교수안 등에서도 쓰는 그림 ${count}장은 지금 그림 그대로 두었습니다.` : '');

// 그 차시(또는 최종 평가) 객체가 든 교과 id. 지금 연 교과는 openLessons(courseData)가 최신이다. 못 찾으면 null
function lessonOwnerId(lesson, subjects, openSubjectId, openLessons) {
    if (!isObject(lesson)) return null;
    const owner = (Array.isArray(subjects) ? subjects : []).find(subject => {
        if (!isObject(subject)) return false;
        const lessons = String(subject.id) === String(openSubjectId) && Array.isArray(openLessons) ? openLessons : subject.lessons;
        return subject.mainQuest === lesson || (Array.isArray(lessons) && lessons.includes(lesson));
    });
    return owner ? owner.id : null;
}

// 기록 id는 남긴 시각(ms)이다. 같은 순간에 여러 번 남겨도(차시 일괄 삭제 등) 겹치지 않게 지금 기록에 없는 다음 수를 쓴다
function freshHistoryIds(count, history, now = Date.now()) {
    const taken = new Set((Array.isArray(history) ? history : []).map(historyIdOf));
    const ids = [];
    for (let next = now; ids.length < count; next += 1) if (!taken.has(next)) ids.push(next);
    return ids;
}

// 기록 크기를 글자 수로 어림한다(그림 글자 하나가 1바이트). 기록 전체를 글 하나로 만들지 않아 큰 기록에서도 창이 바로 열린다
const HISTORY_SIZE_DEPTH = 6;
function historyTextSize(value, depth = 0) {
    if (typeof value === 'string') return value.length;
    if (!value || typeof value !== 'object' || depth > HISTORY_SIZE_DEPTH) return 0;
    let sum = 0;
    for (const key of Object.keys(value)) sum += key.length + historyTextSize(value[key], depth + 1);
    return sum;
}
const historySizeBytes = list => (Array.isArray(list) ? list : []).reduce((sum, item) => sum + historyTextSize(item), 0);

// 예전 기록 줄이기: 탭 내용이 없는 기록(탭 하나 기록·옛 단일 본문)은 그 글이 쓰는 그림과 그 GIF 그림의 원래 그림만 남긴다.
// 차시 전체 기록(tabContents)은 교수안에 붙여 넣은 그림이 섞여 있을 수 있어 그대로 둔다. 바뀐 것이 없으면 같은 객체를 돌려준다
function slimHistoryEntry(entry) {
    if (isObject(entry.tabContents) || !isObject(entry.images)) return entry;
    const used = referencedImages(stateText(entry.content), entry.images);
    const motion = historyMotionParts(entry.imageMotions, used, entry.images);
    const images = motion ? { ...used, ...motion.stills } : used;
    if (Object.keys(images).length === Object.keys(entry.images).length) return entry;
    const { imageMotions, ...rest } = entry;
    return { ...rest, images, ...(motion ? { imageMotions: motion.imageMotions } : {}) };
}

// 저장해 둔 기록을 열 때 한 번. 객체가 아닌 칸은 뺀다(목록을 그리지 못한다). 이 브라우저의 기록이라 id 모양 때문에 지우지는 않는다(mergeHistory와 같다).
// id는 0 이상의 정수로 맞춘다(숫자만 든 글자는 숫자로). 같은 id가 또 나오면(같은 순간에 남긴 기록) 아래쪽 빈 수로, 쓸 수 없는 id(소수·객체 등)는 0부터 빈 수로 나눈다
// (freeHistoryId. 목록에서 줄마다 따로 고르고 지우고 되돌릴 수 있게). id를 고친 뒤 백업·폴더에서 온 기록과 같은 칸 검사(cleanHistoryItem)를 거친다
// (같은 기록이면 합칠 때 같은 기록으로 알아보게, historyRecordKey). 바른 id는 바꾸지 않고, 바꿀 것이 없는 기록은 같은 객체를 돌려준다
function tidyStoredHistory(list) {
    const items = (Array.isArray(list) ? list : []).filter(isObject);
    const ids = items.map(historyIdOf);
    const taken = new Set(ids.filter(id => id !== null));
    const seen = new Set();
    return items.map((item, index) => {
        const valid = ids[index];
        const id = valid !== null && !seen.has(valid) ? valid : freeHistoryId(valid ?? 0, taken);
        seen.add(id);
        const numbered = id === item.id ? item : { ...item, id };
        return slimHistoryEntry(cleanHistoryItem(numbered)); // id가 이미 바르므로 칸 검사가 기록을 빼지 않는다
    });
}

// 작업 기록 한 칸. 차시 id·교과 id·모든 탭(탭 하나 기록이면 그 탭 id)·이유를 함께 남겨 그 차시로 되돌릴 수 있게 한다.
// mod: 차시(또는 최종 평가) 객체, 또는 탭 하나만 남길 때 { title, content, images, tabId, lesson }. lesson은 그 차시 객체이고 기록에는 id만 남는다.
// 그림은 그 글이 쓰는 것만 담는다(값이 글자라 원본 차시와 이어지지 않는다). 탭 하나 기록은 교과 id를 알 때만 차시 id를 남긴다(엉뚱한 차시를 고치지 않게).
// 담은 그림이 움직이는 GIF면 그 기록(imageMotions)과 원래 그림도 담는다(historyMotionParts)
function historyEntry(mod, { id, date, reason, subjectId } = {}) {
    const part = isObject(mod.lesson) ? historyPart(mod) : null;
    const lessonId = part ? (subjectId != null ? mod.lesson.id : null) : mod.id;
    const text = historyText(mod);
    const images = referencedImages(text, mod.images);
    const motion = historyMotionParts(isObject(mod.imageMotions) ? mod.imageMotions : mod.lesson?.imageMotions, images, mod.images);
    // 직접 넣은 동영상(lessonVideos)도 그 글이 가리키는 것만 담는다. 탭 하나 기록은 차시(lesson)의 동영상에서 고른다
    const videos = referencedVideos(text, isObject(mod.lessonVideos) ? mod.lessonVideos : mod.lesson?.lessonVideos);
    return {
        id,
        title: mod.title,
        content: mod.content,
        images: motion ? { ...images, ...motion.stills } : images,
        ...(Object.keys(videos).length ? { lessonVideos: videos } : {}),
        date,
        ...(lessonId != null ? { lessonId } : {}),
        ...(subjectId != null ? { subjectId } : {}),
        ...(part ? { tabId: part } : {}),
        ...(!part && mod.tabContents ? { tabContents: { ...mod.tabContents } } : {}),
        ...(reason ? { reason } : {}),
        ...(motion ? { imageMotions: motion.imageMotions } : {})
    };
}

// 되돌릴 곳
// - 탭 하나 기록: 그 기록을 남긴 교과에서만 그 차시(최종 평가는 교과의 mainQuest)를 찾는다. 교과가 다르면 같은 id여도 다른 차시다
// - 모든 탭이 남은 차시 기록: 그 차시가 아직 있으면 그 차시(남긴 교과를 먼저 본다. 예전 기록은 교과 id가 틀렸을 수 있어 다른 교과도 찾는다)
// - 그 밖에는 새 차시. 남이 준 파일의 기록일 수 있어 id는 stateText로 바꿔 비교한다(객체 값으로 멈추지 않게)
function historyRestoreTarget(entry, subjects) {
    const part = historyPart(entry);
    const lessonKey = stateText(entry.lessonId);
    const subjectKey = stateText(entry.subjectId);
    const list = Array.isArray(subjects) ? subjects : [];
    if (part) {
        const subject = lessonKey && subjectKey ? list.find(item => String(item.id) === subjectKey) : null;
        const lesson = !subject ? null : lessonKey === 'mainQuest' ? subject.mainQuest : (subject.lessons || []).find(item => String(item?.id) === lessonKey);
        return isObject(lesson) ? { mode: 'replace', subject, lesson, part } : { mode: 'new', part };
    }
    if (isObject(entry.tabContents) && lessonKey) {
        // 기록을 남긴 교과를 먼저 본다(복원한 교과 사본에 같은 차시 id가 있어도 엉뚱한 쪽을 고치지 않게)
        const ordered = [...list].sort((a, b) => Number(String(b.id) === subjectKey) - Number(String(a.id) === subjectKey));
        for (const subject of ordered) {
            const lesson = (subject.lessons || []).find(item => String(item?.id) === lessonKey);
            if (lesson) return { mode: 'replace', subject, lesson, part: null };
        }
    }
    return { mode: 'new', part: null };
}

// 새 차시로 되살린다. 탭 하나 기록은 그 탭에, 모든 탭 기록은 탭 그대로, 탭 구분이 없는 기록(예전 기록 등)은 기본학습 칸에 넣는다.
// 기록이 담은 움직이는 GIF 기록은 그 GIF와 원래 그림이 함께 들어갈 때만 넣는다
function lessonFromHistory(entry, newId) {
    const part = historyPart(entry);
    const content = stateText(entry.content);
    const tabs = part ? { [part]: content } : isObject(entry.tabContents) ? entry.tabContents : { basicLearn: content };
    const images = historyImages(entry);
    const imageMotions = isObject(entry.imageMotions) ? safeImageMotions(entry.imageMotions, images) : {};
    const videos = historyVideos(entry);
    return {
        id: newId,
        title: `${stateText(entry.title) || '되살린 교안'} (되살림)`,
        description: '',
        status: 'done',
        content,
        images,
        ...(Object.keys(videos).length ? { lessonVideos: videos } : {}),
        tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null, advAssessment: null, ...tabs },
        uploadedMdName: null,
        uploadedMdContent: null,
        ...(Object.keys(imageMotions).length ? { imageMotions } : {})
    };
}

// 그 탭의 지금 글. 탭이 없는 최종 평가·옛 차시는 본문이 곧 그 탭이고, 옛 단일 본문은 기본학습이다(setTabMarkdown과 같은 규칙)
function historyPartText(lesson, part) {
    if (!lesson.tabContents) return stateText(lesson.content);
    const tabs = lesson.tabContents;
    if (tabs[part]) return stateText(tabs[part]);
    return part === 'basicLearn' && !historyTabIds().some(id => tabs[id]) ? stateText(lesson.content) : '';
}

// 되돌리기 전에 남길 지금 내용. 탭 하나 기록이면 그 탭 글만, 차시 기록이면 차시 전체.
// 탭이 없는 최종 평가(·옛 차시)는 그 글이 본문 전체라 제목에 탭 이름을 붙이지 않는다
function historyCurrentItem(lesson, part) {
    if (!part) return lesson;
    const title = lesson.tabContents ? `${lesson.title} · ${historyPartName(part)}` : lesson.title;
    return { title, content: historyPartText(lesson, part), images: lesson.images, tabId: part, lesson };
}

// 이 기록을 그 탭에 돌려놓아도 바뀌는 것이 없는지: 탭 글이 같고, 넣을 그림도 차시에 이미 같은 값으로 있다
// (글은 같아도 차시가 잃은 그림·찾지 못한 그림 자리를 기록이 갖고 있으면 되돌려야 그림이 돌아온다. 밖에서도 써서 넣지 않는 그림은 견주지 않는다)
function historyMatchesNow(lesson, entry, part) {
    if (historyPartText(lesson, part) !== stateText(entry.content)) return false;
    const current = isObject(lesson.images) ? lesson.images : {};
    if (!Object.entries(historyImagesFor(lesson, entry, part)).every(([id, data]) => current[id] === data)) return false;
    return Object.keys(historyVideosFor(lesson, entry)).length === 0; // 차시가 잃은 동영상을 기록이 갖고 있으면 되돌려야 돌아온다
}

// 기록이 담은 동영상(남이 준 파일일 수 있어 차시와 같은 규칙으로 고른다)
const historyVideos = entry => safeVideoMap(entry.lessonVideos);

// 되돌릴 때 차시에 넣을 기록의 동영상: 차시에 그 키의 진짜 동영상이 없을 때만(동영상 키는 넣을 때마다 새로 만들어 같은 키면 같은 파일이다. 지금 동영상을 덮지 않는다)
function historyVideosFor(lesson, entry) {
    const current = isObject(lesson.lessonVideos) ? lesson.lessonVideos : {};
    return Object.fromEntries(Object.entries(historyVideos(entry)).filter(([key, data]) => !SAFE_VIDEO_DATA.test(String(current[key] ?? '')) && current[key] !== data));
}

// 기록 한 칸을 그 차시에 돌려놓는다(화면이 같은 차시 객체를 쓰므로 그 자리에서 바꾼다). 탭 하나 기록은 그 탭만 고칠 때와 같은 setTabMarkdown으로,
// 차시 기록은 모든 탭을 모두 바꾼다. 그림은 더하거나 바꾸기만 하고 지우지 않는다. 찾지 못한 그림 자리가 차시의 진짜 그림을 덮지 않고,
// 되돌리는 쪽 밖에서도 쓰는 키의 새 그림도 덮지 않는다(historyImagePlan. 글을 바꾸기 전 차시로 가린다)
function applyHistoryEntry(lesson, entry) {
    const part = historyPart(entry);
    const restored = historyImagesFor(lesson, entry, part);
    lesson.images = { ...(lesson.images || {}), ...restored };
    const videos = historyVideosFor(lesson, entry);
    if (Object.keys(videos).length) lesson.lessonVideos = { ...(isObject(lesson.lessonVideos) ? lesson.lessonVideos : {}), ...videos };
    // 기록이 담은 움직이는 GIF 기록은 그 GIF가 실제로 돌아간 그림 자리에만 넣는다(지금 그림을 그대로 둔 자리는 지금 기록을 둔다)
    const motions = isObject(entry.imageMotions) ? safeImageMotions(entry.imageMotions, lesson.images) : {};
    const back = Object.entries(motions).filter(([key]) => Object.prototype.hasOwnProperty.call(restored, key) && lesson.images[key] === restored[key]);
    if (back.length) lesson.imageMotions = { ...(isObject(lesson.imageMotions) ? lesson.imageMotions : {}), ...Object.fromEntries(back) };
    if (part) {
        setTabMarkdown(lesson, part, stateText(entry.content));
    } else {
        lesson.tabContents = { ...entry.tabContents };
        lesson.content = stateText(entry.content);
    }
    lesson.status = 'done';
    return lesson;
}

// 되돌리기 확인 창의 글·버튼 이름·끝난 뒤 알림. target은 historyRestoreTarget 결과, openSubject는 지금 연 교과(없으면 null)
function historyRestoreMessage(entry, target, openSubject) {
    const date = stateText(entry.date);
    const part = target.part || null;
    const phrase = part ? `${historyPartName(part)} 탭` : '';
    if (target.mode !== 'replace') {
        const where = `'${openSubject?.title || '지금 교과'}'`;
        // 남긴 교과에서만 찾는다(교과 간 이동·휴지통 되살리기로 그 차시가 다른 교과에 있거나 id가 바뀌었을 수 있어 '없다'고 하지 않는다)
        const text = part
            ? `이 기록(${date})을 남긴 교과에서 그 차시를 찾지 못했습니다.\n${where}에 새 차시로 되살려 ${phrase}에 넣습니다.`
            : `이 기록(${date})을 ${where}에 새 차시로 되살립니다.${isObject(entry.tabContents) ? '' : '\n이 기록에는 탭 구분이 없어 기본학습 칸에 들어갑니다.'}`;
        return { text, okLabel: '새 차시로 되살리기', done: `'${stateText(entry.title) || '되살린 교안'} (되살림)' 차시로 되살렸습니다.` };
    }
    const lesson = target.lesson;
    const other = target.subject && String(target.subject.id) !== String(openSubject?.id ?? '') ? `(${target.subject.title} 교과)` : '';
    const name = `${lesson.id === 'mainQuest' ? `'${lesson.title}'` : `'${lesson.title}' 차시`}${other}`;
    if (!part) {
        return { text: `${name}를 이 기록(${date})으로 되돌립니다.\n지금 내용은 작업 기록에 먼저 남겨 다시 되돌릴 수 있습니다.`, okLabel: '되돌리기', done: `'${lesson.title}'을(를) 되돌렸습니다.` };
    }
    const keep = historyPartText(lesson, part) !== '';
    if (!lesson.tabContents) {
        // 탭이 없는 최종 평가(·옛 차시)는 본문을 통째로 바꾼다(setTabMarkdown). 기록의 탭 id는 그때 열려 있던 탭일 뿐이라 탭 이름을 말하지 않는다
        const text = `${name}의 내용을 이 기록(${date})으로 되돌립니다.${keep ? '\n지금 내용은 작업 기록에 먼저 남겨 다시 되돌릴 수 있습니다.' : ''}`;
        return { text, okLabel: '되돌리기', done: `${name}의 내용을 되돌렸습니다.` };
    }
    const lines = [
        `${name}의 ${phrase}을 이 기록(${date})으로 되돌립니다.`,
        '다른 탭은 그대로 둡니다.',
        keep ? `지금 ${phrase}은 작업 기록에 먼저 남겨 다시 되돌릴 수 있습니다.` : ''
    ];
    return { text: lines.filter(Boolean).join('\n'), okLabel: '되돌리기', done: `${name}의 ${phrase}을 되돌렸습니다.` };
}

// 목록 한 줄의 꼬리말(어떤 기록인지)·버튼 이름·풍선 도움말.
// 탭 하나 기록이어도 되돌릴 곳이 탭이 없는 최종 평가(·옛 차시)면 본문을 통째로 바꾸므로 탭 이름을 말하지 않는다
function historyRowLabels(entry, target) {
    const part = historyPart(entry);
    const phrase = part ? `${historyPartName(part)} 탭` : '';
    const button = target.mode === 'replace' ? '되돌리기' : '새 차시로 되살리기';
    const lesson = target.mode === 'replace' && isObject(target.lesson) ? target.lesson : null;
    if (part && lesson && !lesson.tabContents) {
        const quest = lesson.id === 'mainQuest';
        return { kind: quest ? '최종 평가' : '', button, tip: quest ? '최종 평가를 이 기록으로 되돌립니다' : '그 차시를 이 기록으로 되돌립니다' };
    }
    const tip = target.mode !== 'replace' ? '이 기록을 지금 연 교과에 새 차시로 되살립니다'
        : part ? `그 차시의 ${phrase}만 이 기록으로 되돌립니다` : '그 차시를 이 기록으로 되돌립니다';
    return { kind: part ? phrase : isObject(entry.tabContents) ? '전체 탭' : '', button, tip };
}

/* ---------- 확인 창 ---------- */
// showConfirm을 기다릴 수 있게 감싼다. 취소하면 false
function confirmAsync(message, opts = {}) {
    return new Promise(resolve => window.showConfirm(message, () => resolve(true), { ...opts, onCancel: () => resolve(false) }));
}

/* ---------- 백업 ---------- */
const backupStamp = (date = new Date()) => {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
};

const currentSnapshot = () => stateSnapshot(globalState, currentSubjectId, courseData);

// 고른 교과만 담은 복원용 데이터(위쪽 ZIP에 넣는다). 불러오면 그 교과만 바뀐다
function subjectsBackupMeta(subjectIds) {
    const ids = new Set(subjectIds.map(String));
    const snapshot = currentSnapshot();
    return backupMeta('subjects', { courseTitle: snapshot.courseTitle, subjects: snapshot.subjects.filter(subject => ids.has(String(subject.id))) });
}

/* ---------- 백업에 그림 담는 방식 (내보내기·백업 메뉴에서 고른다) ---------- */
// inline: save_data.yaml 안에 그대로(예전과 같음, 파일 하나로 끝). 크기 한도에 걸리면 저절로 separate로 바꾼다
// separate: '그림' 폴더의 파일로 떼고 같은 그림은 한 번만(작업 기록·휴지통의 사본까지 한 장으로). 가볍고 큰 과정도 된다
// none('빼기'): 기억하지 않는다. 메뉴를 연 채 바로 받는 백업 ZIP 하나의 save_data.yaml에서만 그림을 뺀다(읽기용 교안.html·그림 파일에서는 빼지 않는다).
//   PC 폴더 자동 저장과 불러오기 전 백업에는 쓰지 않는다. 되살리면 그림 자리가 빈다(과정 전체 백업은 첨부파일의 그림이 열린 교과에 돌아올 수 있다).
//   뺀 그림은 다시 채워지지 않는다(일괄 이미지 찾기는 아직 채우지 않은 그림 태그만 채운다)
const BACKUP_IMAGE_KEY = 'teacher:backup-images';
const BACKUP_IMAGE_MODES = ['inline', 'separate', 'none'];
const BACKUP_IMAGE_LABEL = { inline: '함께', separate: '따로·가볍게', none: '빼기' };
const BACKUP_NO_IMAGES_TAG = '_그림없음'; // 그림을 뺀 백업 파일 이름 끝
const BACKUP_IMAGE_REF = 'teacher-image:';
const BACKUP_IMAGE_DIR = '그림';
// 차시에 직접 넣은 동영상(lessonVideos, lesson-insert-tools.js)도 그림과 같은 길로 담는다: '따로·가볍게'면 '그림' 폴더의 .mp4·.webm 파일. '빼기'는 그림만 뺀다(동영상은 그대로 담는다)
const BACKUP_DATA_URL = /^data:(image\/[\w.+-]+|video\/(?:mp4|webm));base64,([A-Za-z0-9+/=]+)$/;
const BACKUP_IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const BACKUP_IMAGE_MIN = 64; // 이보다 짧은 글은 그림으로 보지 않는다
// '그림' 파일을 찾지 못한 그림은 이 참조를 그대로 둔다(빈 글로 바꾸지 않는다). 화면과 내보내기에서는 빈 그림으로 보이고
// (lesson-sanitize.js가 모르는 주소를 지운다), 다음 저장도 참조를 그대로 써서 그림 파일을 채운 뒤 다시 열면 돌아온다
const BACKUP_IMAGE_REF_RE = /^teacher-image:[0-9a-f]{17,24}$/;
const isBackupImageRef = value => typeof value === 'string' && BACKUP_IMAGE_REF_RE.test(value);

let backupImagesDropOnce = false; // '빼기'를 골라 두었다(메뉴를 연 채 바로 받는 백업 하나. 기억하지 않는다)
let backupInlineTooBig = false; // 이 창에서 '함께'가 크기 한도에 걸려 '따로·가볍게'로 바꿨다(저장소에 적지 못해도 따로 담는다)

// 이 브라우저에 기억한 방식: 'inline' | 'separate'. 예전에 기억한 '빼기'는 그림을 지키는 '따로·가볍게'로 읽는다
function storedBackupImageMode() {
    if (backupInlineTooBig) return 'separate';
    try {
        const mode = localStorage.getItem(BACKUP_IMAGE_KEY);
        return mode === 'separate' || mode === 'none' ? 'separate' : 'inline';
    } catch (err) {
        return 'inline';
    }
}

// 메뉴에 눌려 보이는 방식. '빼기'는 골라 둔 동안만
function backupImageMode() {
    return backupImagesDropOnce ? 'none' : storedBackupImageMode();
}

// 백업 ZIP 하나를 만들기 시작할 때 한 번 부른다. 골라 둔 '빼기'는 이 파일에만 쓰고 바로 푼다
function takeBackupImageMode() {
    const mode = backupImageMode();
    if (mode === 'none') clearBackupImagesDrop();
    return mode;
}

// PC 폴더 자동 저장에 쓸 방식. '빼기'는 받지 않는다
function folderImageMode() {
    return storedBackupImageMode();
}

// 골라 둔 '빼기'를 푼다(그 백업을 만들기 시작했거나 메뉴 밖을 눌렀을 때)
function clearBackupImagesDrop() {
    if (!backupImagesDropOnce) return;
    backupImagesDropOnce = false;
    renderBackupImageMode();
}

function setBackupImageMode(mode) {
    if (!BACKUP_IMAGE_MODES.includes(mode)) return;
    if (mode === 'none') {
        backupImagesDropOnce = true;
        renderBackupImageMode();
        window.showToast?.(`빼기는 이 메뉴에서 바로 받는 백업 하나에만 씁니다. 받거나 메뉴를 닫으면 '${BACKUP_IMAGE_LABEL[storedBackupImageMode()]}'로 돌아갑니다.`, 'info');
        return;
    }
    backupImagesDropOnce = false;
    backupInlineTooBig = false; // 직접 고르면 그 방식을 따른다
    try {
        localStorage.setItem(BACKUP_IMAGE_KEY, mode);
    } catch (err) {
        console.warn('[백업] 그림 담는 방식을 저장하지 못했습니다:', err.message);
    }
    renderBackupImageMode();
}

function renderBackupImageMode() {
    const mode = backupImageMode();
    document.querySelectorAll?.('[data-backup-images]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.backupImages === mode)));
}

// '함께'로는 한 파일에 담지 못할 만큼 그림이 많으면 '따로·가볍게'로 바꿔 기억한다(따로 담기에 성공한 뒤에만 부른다). 이번에 바꿨으면 true
function switchBackupImagesToSeparate() {
    if (storedBackupImageMode() === 'separate') return false;
    backupInlineTooBig = true;
    try {
        localStorage.setItem(BACKUP_IMAGE_KEY, 'separate');
    } catch (err) {
        console.warn('[백업] 그림 담는 방식을 저장하지 못했습니다:', err.message);
    }
    renderBackupImageMode();
    return true;
}

// 그림·동영상이 많아 글자 수·메모리 한도에 걸린 오류인지(V8: 'Invalid string length', 'Array buffer allocation failed' 등). 너무 깊은 구조(call stack)는 크기 문제가 아니다
function isBackupTooBig(err) {
    const message = String(err?.message || '');
    if (/call stack/i.test(message)) return false;
    return err instanceof RangeError || /Invalid string length|allocation failed|Invalid (typed )?array length/i.test(message);
}

// 일부러 멈춘 불러오기(백업이 아닌 ZIP, 되살릴 교과 없음 등). 까닭은 알림으로 보이므로 콘솔에는 경고로만 남긴다(logImportFailure)
function importStop(message) {
    return Object.assign(new Error(message), { expected: true });
}

// 불러오기 실패를 콘솔에 남긴다. 일부러 멈춘 것·권한 거절·크기 한도는 경고로(까닭만), 그 밖(코드 오류 등)은 오류로(스택까지)
function logImportFailure(label, err) {
    if (err?.expected || err?.name === 'NotAllowedError' || isBackupTooBig(err)) console.warn(label, err?.message ?? err);
    else console.error(label, err);
}

// 백업 ZIP 파일 이름. 그림을 뺀 파일은 끝에 _그림없음을 붙인다(받은 사람도, 나중의 나도 알아보게)
const backupFileName = (base, mode) => `${base}${mode === 'none' ? BACKUP_NO_IMAGES_TAG : ''}.zip`;

// 크기 한도 안내. '함께'가 걸리면 저절로 '따로·가볍게'로 다시 만들므로, 여기까지 오면 따로(또는 빼기)로도 담지 못한 것이다(그림 담기는 바꾸지 않았다)
const BACKUP_TOO_BIG_TEXT = {
    full: '그림·동영상이 많아 과정 전체 백업 파일을 만들지 못했습니다(브라우저가 한 번에 다룰 수 있는 크기를 넘었습니다). 개요 화면 교과 목록에서 교과를 하나씩 체크해 교과 백업 ZIP으로 나눠 받아 주세요.',
    subjects: '그림·동영상이 많아 교과 백업 ZIP을 만들지 못했습니다(브라우저가 한 번에 다룰 수 있는 크기를 넘었습니다). 개요 화면 교과 목록에서 교과를 하나씩 체크해 나눠 받거나, 다른 브라우저 탭을 닫고 다시 해 보세요.',
    folder: '그림·동영상이 많아 PC 폴더에 저장하지 못했습니다(브라우저가 한 번에 다룰 수 있는 크기를 넘었습니다). 브라우저에는 저장됐습니다. 개요 화면 교과 목록에서 교과를 하나씩 체크해 교과 백업 ZIP으로 나눠 받아 두세요.',
    openFile: "이 백업 파일이 너무 커서 이 브라우저에서 열지 못했습니다(브라우저가 한 번에 다룰 수 있는 크기를 넘었습니다). 이 파일을 만든 브라우저에서 내보내기·백업 → 그림 담기를 '따로·가볍게'로 골라 다시 받거나, 개요 화면 교과 목록에서 교과를 하나씩 체크해 교과 백업 ZIP으로 나눠 받아 하나씩 되살려 주세요.",
    openFolder: "이 폴더의 저장본이 너무 커서 열지 못했습니다(브라우저가 한 번에 다룰 수 있는 크기를 넘었습니다). 이 폴더에 저장하던 브라우저에서 내보내기·백업 → 그림 담기를 '따로·가볍게'로 고르면 다음 저장부터 폴더가 가벼워져 열 수 있습니다."
};

// '함께'로 담지 못해 '따로·가볍게'로 다시 만들었을 때 알리는 말. folderToo는 PC 폴더가 이어져 있을 때 받은 쪽 알림에 덧붙인다
const BACKUP_FALLBACK_TEXT = {
    download: "그림·동영상이 많아 '함께'로는 한 파일에 담지 못해 '따로·가볍게'로 받았습니다. 그림(직접 넣은 동영상 포함)은 ZIP 안 '그림' 폴더에 들어 있고, 되살리면 그림과 동영상도 돌아옵니다.\n앞으로도 따로 담도록 내보내기·백업 → 그림 담기를 '따로·가볍게'로 바꿨습니다.",
    folderToo: "\nPC 폴더 자동 저장도 다음 저장부터 따로 담습니다. 폴더를 옮기거나 복사할 때는 안의 '그림' 폴더도 함께 옮기세요.",
    folder: "그림·동영상이 많아 PC 폴더에 '함께'로는 저장하지 못해 '따로·가볍게'로 저장했습니다. 그림(직접 넣은 동영상 포함)은 그 폴더 안 '그림' 폴더에 따로 저장됩니다. 폴더를 옮기거나 복사할 때는 '그림' 폴더도 함께 옮기세요.\n앞으로 받는 백업도 따로 담도록 내보내기·백업 → 그림 담기를 '따로·가볍게'로 바꿨습니다."
};

// 같은 그림은 같은 이름이 되게 내용으로 이름을 짓는다(32비트 해시 둘 + 길이)
function backupImageKey(text) {
    let a = 0x811c9dc5;
    let b = 0x01234567;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        a = Math.imul(a ^ code, 0x01000193);
        b = Math.imul(b ^ code, 0x0100019d);
    }
    const hex = n => (n >>> 0).toString(16).padStart(8, '0');
    return `${hex(a)}${hex(b)}${text.length.toString(16)}`;
}

// 떼어 담는 값(그림·동영상)인지. isBackupImage는 그림만(그림 수 세기와 '빼기'가 쓴다)
const isBackupMedia = text => typeof text === 'string' && text.length >= BACKUP_IMAGE_MIN && BACKUP_DATA_URL.test(text);
const isBackupImage = text => isBackupMedia(text) && text.startsWith('data:image/');

// '그림/' 안에서 백업이 쓴 그림·동영상 파일만 고른다(backupImageKey 이름 + 확장자). '그림'이라는 교과 폴더의 MD 등은 건너뛴다
const BACKUP_IMAGE_NAME = /^[0-9a-f]{17,24}\.(png|jpg|gif|webp|avif|svg|mp4|webm)$/; // BACKUP_IMAGE_EXT의 확장자와 함께 고친다(빠지면 그 형식의 파일을 건너뛰어 빈 그림·동영상이 된다)
const isBackupImageName = name => BACKUP_IMAGE_NAME.test(String(name));

// base64 글자 수로 그 파일의 바이트 수를 센다(디코딩하지 않고)
function base64ByteLength(base64) {
    const text = String(base64);
    const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
    return Math.floor(text.length * 3 / 4) - padding;
}

// 그림 글 하나의 백업 이름표: 이름(내용 해시)·'그림' 파일 이름·바이트 수. 그림이 아니면 null
function backupImageInfo(text) {
    if (!isBackupMedia(text)) return null;
    const key = backupImageKey(text);
    const file = backupImageFile(key, text);
    return file ? { key, name: file.name, bytes: base64ByteLength(file.base64) } : null;
}

// 백업 내용에서 그림(data:image 글자 값)을 떼어 낸다. 글 속에 섞인 그림은 건드리지 않는다. 'none'이면 그 항목을 뺀다.
// memo: 지난번에 계산한 이름표(Map 글 → 이름표). 있으면 같은 그림을 다시 해시하지 않는다. 돌려주는 memo에는 이번에 본 그림만 든다
function detachBackupImages(value, mode, memo = null) {
    const files = {};
    const seen = new Map();
    const DROP = Symbol('drop');
    const infoOf = text => {
        if (!seen.has(text)) seen.set(text, memo && memo.has(text) ? memo.get(text) : backupImageInfo(text));
        return seen.get(text);
    };
    const walk = node => {
        if (typeof node === 'string' && node.length >= BACKUP_IMAGE_MIN && (node.startsWith('data:image/') || node.startsWith('data:video/'))) {
            if (mode === 'none') return isBackupImage(node) ? DROP : node; // '빼기'는 그림만 뺀다. 동영상은 저장 정보에 그대로 둔다(말없이 사라지지 않게)
            const info = infoOf(node);
            if (!info) return node;
            files[info.key] = node;
            return BACKUP_IMAGE_REF + info.key;
        }
        if (Array.isArray(node)) return node.map(walk).filter(item => item !== DROP);
        if (node && typeof node === 'object') {
            return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]).filter(([, item]) => item !== DROP));
        }
        return node;
    };
    return { value: walk(value), files, memo: seen };
}

// 떼어 둔 그림을 제자리에 돌려놓는다. 찾지 못한 그림은 참조를 그대로 둔다(빈 글로 지우면 다음 저장에서 폴더의 연결까지 사라진다).
// 모양이 맞는 참조만 바꾼다('teacher-image:'로 시작하는 보통 글은 그대로)
function attachBackupImages(value, files) {
    const walk = node => {
        if (typeof node === 'string') return isBackupImageRef(node) ? (files[node.slice(BACKUP_IMAGE_REF.length)] || node) : node;
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]));
        return node;
    };
    return walk(value);
}

// 저장 내용이 가리키는 그림 이름(참조의 키)을 한 번씩 모은다. 모양이 맞는 참조만 센다
function backupImageRefs(value) {
    const keys = new Set();
    const walk = node => {
        if (isBackupImageRef(node)) keys.add(node.slice(BACKUP_IMAGE_REF.length));
        else if (Array.isArray(node)) node.forEach(walk);
        else if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(value);
    return keys;
}

// '그림' 폴더의 파일 이름 목록 → 그림 이름(키)별 파일 이름. 백업이 쓴 그림 이름이 아니면 건너뛰고, 같은 키가 둘이면 앞의 것
function backupImageFileNames(names) {
    const byKey = new Map();
    for (const name of names) {
        if (!isBackupImageName(name)) continue;
        const key = String(name).replace(/\.[^.]+$/, '');
        if (!byKey.has(key)) byKey.set(key, String(name));
    }
    return byKey;
}

// 그림(data:image 글자 값) 수. 같은 그림은 한 번만 센다(떼어 내는 기준과 같다. 글 속에 섞인 그림은 세지 않는다)
function countBackupImages(value) {
    const seen = new Set();
    const walk = node => {
        if (isBackupImage(node)) seen.add(node);
        else if (Array.isArray(node)) node.forEach(walk);
        else if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(value);
    return seen.size;
}

// 지금 작업(교과·설정)의 그림 수. 작업 기록·휴지통은 불러와도 남으므로 세지 않는다
const currentImageCount = () => countBackupImages(currentSnapshot());

// 그림을 뺀 백업('빼기')을 불러오기 전 확인 창 끝에 덧붙이는 말. kind: 'full' | 'subjects' | 'folder', lost: 빈칸이 될 지금 그림 수
// 빠진 것은 되살리기용 정보(save_data.yaml)의 그림뿐이다. 읽기용 교안.html·그림 파일(과정 전체 백업은 첨부파일)에는 그림이 있으므로 '파일에 그림이 없다'고 하지 않는다.
// 교과 백업은 읽기용 그림으로 되살리지 않는다. 과정 전체 백업은 첨부파일의 그림이 열린 교과의 차시에 돌아올 수 있어 '될 수 있습니다'로 말한다
function noImagesImportNote(kind, lost = 0) {
    const head = kind === 'folder'
        ? "이 폴더는 그림 담기 '빼기'로 저장되어 되살리기용 정보에는 그림이 담기지 않았습니다."
        : "이 파일은 그림 담기 '빼기'로 받은 백업이라 되살리기용 정보에는 그림이 담기지 않았습니다.";
    const readable = kind === 'subjects' ? ' 파일 안 읽기용 교안.html·그림 파일의 그림은 되살리지 않습니다.' : '';
    const count = Number(lost) || 0;
    if (count <= 0) return `\n\n${head}${readable} 불러온 교안의 그림 자리는 빈칸으로 보일 수 있습니다.`;
    const body = {
        full: ` 되살리면 지금 그림 ${count}장이 빈칸이 될 수 있습니다. 지금 그림은 불러오기 전에 받는 백업 파일에 남습니다.`,
        subjects: ` 불러오면 바뀌는 교과의 지금 그림 ${count}장이 빈칸이 됩니다. 지금 그림은 교과 휴지통과 불러오기 전에 받는 백업 파일에 남습니다.`,
        folder: ` 열면 지금 그림 ${count}장이 빈칸이 됩니다. 지금 그림은 불러오기 전에 받는 백업 파일에 남습니다.`
    };
    return `\n\n${head}${readable}${body[kind] || body.full}`;
}

// 그림 파일 이름·내용(base64)과 그 반대
function backupImageFile(key, dataUrl) {
    const match = String(dataUrl).match(BACKUP_DATA_URL);
    return match ? { name: `${key}.${BACKUP_IMAGE_EXT[match[1]] || 'png'}`, base64: match[2] } : null;
}

function backupImageFromFile(name, base64) {
    const ext = String(name).split('.').pop().toLowerCase();
    const mime = Object.keys(BACKUP_IMAGE_EXT).find(type => BACKUP_IMAGE_EXT[type] === ext) || 'image/png';
    return { key: String(name).replace(/\.[^.]+$/, ''), dataUrl: `data:${mime};base64,${base64}` };
}

// 확장자가 없는 형식은 .png로 쓴다(backupImageFile). 그 가운데 'image/png'와 이름 길이가 같은 형식은 키로 가린다
const BACKUP_IMAGE_PNG_ALIKE = ['image/jpg', 'image/bmp'];
// 확장자를 정하기 전(예전 백업·폴더)에 .png로 쓴 형식. 키로 가려 원래 글 그대로 돌려준다
const BACKUP_IMAGE_OLD_PNG = ['image/avif'];
// 키로 가리지 못하는(이름을 모르는) 형식 이름의 길이. 'image/png'(9자)보다 길다
const BACKUP_IMAGE_TYPE_LENGTH = { min: 10, max: 32 };

// '그림' 폴더에서 읽은 그림 파일(base64) 하나를 그림 글로 되돌린다. 내용이 이름(키: 원래 글의 해시 + 글 길이)과 맞을 때만 돌려주고 아니면 null.
// 복사가 끊겨 짧아졌거나 크기는 그대로인데 뒤가 빈 파일을 그림으로 받으면, 다음 저장이 망가진 그림을 새 이름으로 써서 폴더 저장본이 원래 그림을 더는 가리키지 않는다.
// .png 파일은 확장자가 없는 형식이거나 예전에 .png로 쓴 avif일 수도 있어 image/jpg·image/bmp·image/avif로도 키를 맞춰 보고(맞으면 원래 글 그대로),
// 그래도 맞지 않으면 원래 글 길이와의 차이가 형식 이름 길이로 맞을 때만 image/png로 받는다(heic 등). 원래 글에 '=' 채움이 없었을 수도 있어 그것도 맞춰 본다.
// ZIP 되살리기(state.js importProjectZip)와 PC 폴더 열기가 함께 쓴다
function backupImageFromKeyedFile(key, name, base64) {
    const text = String(base64);
    const { dataUrl } = backupImageFromFile(name, text);
    const type = dataUrl.slice('data:'.length, dataUrl.indexOf(';'));
    const asPng = type === 'image/png';
    const bodies = [...new Set([text, text.replace(/=+$/, '')])];
    for (const candidateType of asPng ? [type, ...BACKUP_IMAGE_PNG_ALIKE, ...BACKUP_IMAGE_OLD_PNG] : [type]) {
        for (const body of bodies) {
            const candidate = `data:${candidateType};base64,${body}`;
            if (backupImageKey(candidate) === key) return candidate;
        }
    }
    const typeLength = parseInt(String(key).slice(16), 16) - 'data:;base64,'.length - text.length;
    return asPng && typeLength >= BACKUP_IMAGE_TYPE_LENGTH.min && typeLength <= BACKUP_IMAGE_TYPE_LENGTH.max ? dataUrl : null;
}

// 백업 ZIP(또는 그 안의 폴더)에 save_data.yaml을 쓴다. 방식에 따라 그림은 안에 두거나, '그림/' 파일로 떼거나, 뺀다.
// 방식을 주지 않으면 기억한 방식('빼기'는 아님). 같은 이름으로 다시 쓰면 앞의 save_data.yaml을 덮어쓴다(JSZip)
function writeBackupData(folder, meta, mode = storedBackupImageMode()) {
    if (mode === 'inline') return folder.file('save_data.yaml', JSON.stringify(meta, null, 2));
    const { value, files } = detachBackupImages(meta, mode);
    folder.file('save_data.yaml', JSON.stringify({ ...value, imageMode: mode }, null, 2));
    if (mode !== 'separate') return null;
    const dir = folder.folder(BACKUP_IMAGE_DIR);
    Object.entries(files).forEach(([key, dataUrl]) => {
        const file = backupImageFile(key, dataUrl);
        if (file) dir.file(file.name, file.base64, { base64: true });
    });
    return null;
}

// write(mode)로 써 본다. '함께'가 크기 한도에 걸리면 '따로·가볍게'로 다시 쓰고, 그게 되면 기억한 방식도 '따로·가볍게'로 바꾼다(백업 ZIP·PC 폴더 저장이 같이 쓴다).
// 따로 쓰기도 실패하면 기억한 방식은 그대로 두고 그 오류를 던진다(알리지 않은 채 PC 폴더가 '그림' 폴더 방식으로 바뀌지 않게)
// 돌려줌: { mode: 실제로 쓴 방식, fellBack: 따로 담아 다시 썼는지, switched: 이번에 기억한 방식을 바꿨는지 }
async function withSeparateFallback(mode, write) {
    if (mode !== 'inline') {
        await write(mode);
        return { mode, fellBack: false, switched: false };
    }
    try {
        await write('inline');
        return { mode: 'inline', fellBack: false, switched: false };
    } catch (err) {
        if (!isBackupTooBig(err)) throw err;
        console.warn('[백업] 그림·동영상이 많아 따로 담아 다시 만듭니다:', err.message);
        await write('separate');
        const switched = switchBackupImagesToSeparate();
        return { mode: 'separate', fellBack: true, switched };
    }
}

// 되살리기용 save_data.yaml을 넣고 ZIP을 만든다(folder: zip 자신이나 그 안의 폴더). 다시 만들 때는 같은 이름의 save_data.yaml을 덮어쓴다
async function buildBackupZip(zip, folder, meta, mode) {
    let blob = null;
    const result = await withSeparateFallback(mode, async used => {
        writeBackupData(folder, meta, used);
        blob = await zip.generateAsync({ type: 'blob' });
    });
    return { ...result, blob };
}

// '함께'로 담지 못해 '따로·가볍게'로 다시 만들었을 때 알린다(kind: 'download' | 'folder'). 받은 쪽은 PC 폴더가 이어져 있으면 그 말도 덧붙인다
function notifyBackupFallback(kind) {
    const folderOn = kind !== 'folder' && typeof projectFolderHandle !== 'undefined' && !!projectFolderHandle;
    window.showAlert?.((kind === 'folder' ? BACKUP_FALLBACK_TEXT.folder : BACKUP_FALLBACK_TEXT.download) + (folderOn ? BACKUP_FALLBACK_TEXT.folderToo : ''));
}

// 백업 ZIP을 받은 뒤 한 번에 정리한다: 백업 시각 기록(그림을 뺀 파일은 세지 않음)과 알림 하나
// countsAsBackup: false면 시각을 남기지 않는다(교과 백업을 백업으로 세지 않을 때)
function finishBackupDownload(result, { successText = '', countsAsBackup = true } = {}) {
    if (result.mode === 'none') {
        window.showToast?.(`그림을 뺀 백업을 받았습니다(파일 이름 끝 ${BACKUP_NO_IMAGES_TAG}). 위쪽 전체 백업 시각에는 세지 않습니다.`, 'warning');
        return;
    }
    if (countsAsBackup) recordBackupTime();
    if (result.fellBack) return notifyBackupFallback('download');
    if (successText) window.showToast?.(successText, 'success');
}

// 지금 작업 전체를 되살릴 수 있는 백업 파일을 내려받는다(불러오기·폴더 열기 직전).
// 되살릴 때 쓸 파일이므로 고른 방식과 상관없이 늘 '따로·가볍게'로 담는다(그림을 지키고, 큰 과정도 글자 수 한도에 걸리지 않게)
async function downloadSafetyBackup(label) {
    const zip = new JSZip();
    const extra = { history: contentHistory, trash: { lessonTrash: globalState.lessonTrash || [], subjectTrash: globalState.subjectTrash || [] } };
    writeBackupData(zip, backupMeta('full', currentSnapshot(), new Date(), extra), 'separate');
    const blob = await zip.generateAsync({ type: 'blob' });
    // 기본 저장 폴더(save-folder.js)를 골랐으면 그 폴더에 저장하고 끝날 때까지 기다린다(받지 못하면 던져 묻는 길로 간다)
    const zipName = `교안백업_${backupStamp()}_${label}.zip`;
    if (typeof saveFileToFolder === 'function') await saveFileToFolder(blob, zipName);
    else saveAs(blob, zipName);
    recordBackupTime();
}

// 안전 백업 이름표마다, 받지 못했을 때 보일 제목과 말
const SAFETY_BACKUP_ACTIONS = {
    '불러오기전': { title: '불러오기 전 백업 실패', go: '불러오면' },
    '폴더연결전': { title: '폴더 열기 전 백업 실패', go: '폴더를 열면' }
};

// 불러오기 직전의 안전 백업. 받지 못하면 까닭을 알리고 백업 없이 계속할지 묻는다. 계속하면 true, 멈추면 false
async function safetyBackupOrAsk(label) {
    // 백업을 다 만든 뒤에는 권한 창을 띄우지 못하므로 먼저 기본 저장 폴더(save-folder.js)의 쓰기 권한을 받아 둔다
    if (typeof prepareSaveFolder === 'function') await prepareSaveFolder();
    window.showToast?.('바꾸기 전에 지금 상태를 백업 파일로 만드는 중입니다.', 'info');
    try {
        await downloadSafetyBackup(label);
        return true;
    } catch (err) {
        console.error('[백업] 지금 상태를 백업 파일로 받지 못했습니다:', err);
        const action = SAFETY_BACKUP_ACTIONS[label] || { title: '백업 실패', go: '계속하면' };
        const reason = isBackupTooBig(err) ? '그림·동영상이 많아 브라우저가 한 번에 다룰 수 있는 크기를 넘었습니다' : (err?.message || '알 수 없는 오류');
        return confirmAsync(
            `지금 상태를 백업 파일로 받지 못했습니다(${reason}).\n이대로 ${action.go} 지금 작업으로 되돌릴 백업 파일이 없습니다.\n\n멈추고, 개요 화면 교과 목록에서 교과를 하나씩 체크해 교과 백업 ZIP을 먼저 받아 두기를 권합니다.`,
            { okLabel: '백업 없이 계속', tone: 'danger', title: action.title }
        );
    }
}

function readBackupTime() {
    try { return localStorage.getItem(BACKUP_TIME_KEY); } catch (err) { return null; }
}

function recordBackupTime() {
    try { localStorage.setItem(BACKUP_TIME_KEY, new Date().toISOString()); } catch (err) { console.warn('[백업] 시각을 저장하지 못했습니다:', err.message); }
    renderBackupIndicator();
}

// 예전 백업 시각이 이 브라우저에 남았는지(업데이트 전에 백업을 받은 적이 있다)
function hasOldBackupTime() {
    try { return !!localStorage.getItem(OLD_BACKUP_TIME_KEY); } catch (err) { return false; }
}

function renderBackupIndicator() {
    const el = document.getElementById('last-backup-indicator');
    if (!el) return;
    const age = backupAgeLabel(readBackupTime());
    el.textContent = age.text;
    el.classList.toggle('text-amber-300', age.stale);
    el.classList.toggle('text-white/60', !age.stale);
    const head = age.none
        ? `이 브라우저에는 그림까지 담은 과정 전체 백업을 받은 기록이 없습니다${hasOldBackupTime() ? '(이번 업데이트 전에 받은 백업은 세지 않습니다)' : ''}. 한 번 받아 두세요. `
        : `${age.stale ? '과정 전체 백업을 오래 받지 않았습니다. ' : ''}그림까지 담은 과정 전체 백업을 마지막으로 받은 때입니다(교과 백업은 세지 않습니다). `;
    el.title = `${head}작업은 이 브라우저에만 저장됩니다. 누르면 과정 전체 백업 ZIP을 받습니다.`;
}

/* ---------- PC 폴더 열기: 폴더의 그림 담기, 저장본 사본 이름, 확인 창·알림 글 (tests/data-safety.test.js) ---------- */
// 폴더 저장본이 그림을 담은 방식. 이 폴더에 이어 저장할 때 따른다. '빼기'로 저장된 예전 폴더는 앞으로 그림을 빼지 않게 '따로'로 담는다
function folderImageModeOf(saved) {
    return saved?.imageMode === 'separate' || saved?.imageMode === 'none' ? 'separate' : 'inline';
}

// 저장본 사본 이름. 같은 분에 두 번 남겨도 앞 사본을 덮지 않게 두 번째부터 _2, _3을 붙인다
function folderCopyName(stamp, n = 1) {
    return `save_data_이전_${stamp}${n > 1 ? `_${n}` : ''}.yaml`;
}

// '저장해 둔 폴더 열기' 확인 창. total: 저장본이 가리키는 그림 수, missing: 찾지 못했거나 읽지 못했거나 내용이 이름과 맞지 않는(망가진) 수,
// imageNote: 그림을 빼고 저장된 폴더 안내(noImagesImportNote, '\n\n'으로 시작), unread: 브라우저 저장본을 읽지 못한 상태에서 여는지(바꿀 지금 작업이 없어 백업 파일을 받지 않는다)
function folderOpenPrompt({ folderName, subjectCount, incomingCount, unread = false, total = 0, missing = 0, imageNote = '' }) {
    const head = unread
        ? `읽지 못한 브라우저 저장본 대신 '${folderName}' 폴더의 작업(교과 ${incomingCount}개)으로 엽니다.\n읽지 못한 저장본은 이 폴더 내용으로 바뀝니다.`
        : `'${folderName}' 폴더의 작업(교과 ${incomingCount}개)으로 지금 브라우저의 모든 작업(교과 ${subjectCount}개)을 바꿉니다.\n바꾸기 전에 지금 상태를 백업 파일로 내려받습니다.`;
    const lost = missing > 0
        ? `\n\n그림 ${total}장 중 ${missing}장을 이 폴더의 '그림' 폴더에서 찾지 못했습니다(파일이 없거나 읽히지 않거나 망가짐, 작업 기록·휴지통의 그림도 셈). 그대로 열면 그 그림은 빈칸으로 보입니다.\n`
            + "'그림' 폴더까지 다 옮겼는지(복사가 중간에 끊기지 않았는지), OneDrive 같은 곳에서 파일을 모두 내려받았는지 확인해 주세요. 그림 파일을 채운 뒤 이 폴더를 다시 열면 그림이 돌아옵니다."
        : '';
    const okLabel = missing <= 0 ? (unread ? '이 폴더로 되살리기' : '백업 받고 바꾸기') : missing >= total ? '그림 없이 열기' : '빠진 채로 열기';
    return { message: head + imageNote + lost, okLabel };
}

// 폴더를 연 뒤 알림. synced: 첫 폴더 저장이 됐는지, browserSaved: 연 작업을 브라우저에 저장했는지(못 했으면 새로고침 뒤 이 폴더에 이어지지 않는다),
// unread: 브라우저 저장본을 읽지 못한 상태에서 열었는지(브라우저에 저장하지 못했으면 새로고침 뒤 열기 전 작업이 아니라 읽지 못한 창이 다시 뜰 수 있다),
// missing: 찾지 못한 그림 수(확인 창과 같은 수. 작업 기록·휴지통의 그림도 센다), mode: 그림 담기를 바꿨으면 새 방식, wasNone: 폴더가 '빼기'로 저장돼 있었는지
function folderOpenedMessage({ folderName, synced = true, browserSaved = true, unread = false, keptName = '', missing = 0, mode = '', wasNone = false }) {
    const label = BACKUP_IMAGE_LABEL[mode] || '';
    const modeLine = !label ? ''
        : wasNone ? `이 폴더는 그림을 빼고 저장되어 있었습니다. 앞으로는 그림도 담도록 그림 담기를 '${label}'로 바꿨습니다(백업 ZIP에도 같이 쓰입니다).`
            : `그림 담기를 이 폴더에 맞춰 '${label}'로 바꿨습니다(백업 ZIP에도 같이 쓰입니다. 내보내기·백업 → 그림 담기에서 바꿀 수 있습니다).`;
    const opened = `'${folderName}' 폴더의 작업을 열었습니다.`;
    const unsaved = unread
        ? "브라우저에는 이 작업을 저장하지 못했습니다. 새로고침하거나 창을 다시 열면 이 폴더에 자동으로 이어지지 않고 '저장된 작업을 읽지 못했습니다' 창이 다시 뜰 수 있으니, 그때는 그 창의 '저장해 둔 폴더 열기'로 이 폴더를 다시 여세요."
        : "브라우저에는 이 작업을 저장하지 못했습니다. 새로고침하거나 창을 다시 열면 이 폴더에 자동으로 이어지지 않고 열기 전 작업이 보일 수 있으니, 그때는 '저장해 둔 폴더 열기'로 이 폴더를 다시 여세요.";
    return [
        synced ? `${opened} 이제 바뀐 내용은 이 폴더에 자동으로 저장합니다.`
            : browserSaved ? `${opened} 다만 이 폴더에 저장하지 못했습니다. 바뀐 내용은 브라우저에는 저장됩니다(화면 위 알림을 보세요).`
                : `${opened} 다만 이 폴더에 저장하지 못했습니다(화면 위 알림을 보세요).`,
        browserSaved ? '' : unsaved,
        keptName ? `열기 전 폴더의 저장본은 ${keptName}으로 남겨 두었습니다.` : '',
        missing > 0 ? `그림 ${missing}장(작업 기록·휴지통의 그림도 셈)은 찾지 못해 빈칸으로 남았습니다. 그림 파일을 '그림' 폴더에 넣은 뒤 '저장해 둔 폴더 열기'로 이 폴더를 다시 열면 돌아옵니다.` : '',
        modeLine
    ].filter(Boolean).join('\n');
}

// 폴더의 저장본을 풀지 못했거나 모양이 틀렸을 때 알림(교과가 없는 저장본과 다르게 알린다). fileName: 'save_data.yaml' | 'save_data.json'.
// save_data.yaml이면 폴더를 열 때 남겨 둔 사본(save_data_이전_날짜.yaml)으로 열 수 있다고 알린다(예전 save_data.json만 있는 폴더는 사본을 만들지 않는다)
function folderSaveUnreadableText(fileName) {
    const copyHint = fileName === 'save_data.yaml'
        ? '\n폴더에 save_data_이전_날짜.yaml 사본이 있으면, 망가진 save_data.yaml은 다른 이름으로 바꿔 두고 그 사본의 이름을 save_data.yaml로 바꾼 뒤 다시 열어 보세요.'
        : '';
    return `이 폴더의 저장본(${fileName})을 읽을 수 없습니다. 망가졌거나 이 앱의 저장본이 아닐 수 있습니다. 지금 작업은 바뀌지 않았습니다.${copyHint}`;
}

/* ---------- 교과 휴지통 ---------- */
function liveSubjectTrash() {
    const live = typeof liveLessonTrash === 'function' ? liveLessonTrash(globalState.subjectTrash) : (globalState.subjectTrash || []);
    globalState.subjectTrash = live;
    return live;
}

const deepCopy = value => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

// 교과 휴지통이 넘쳐 완전히 지운 교과 수를 알리는 말. 한 번에 많이 넣어 방금 넣은 교과도 빠지면 그 수를 함께 말한다
const subjectTrashCapText = (count, fresh = 0) => `휴지통에는 지운 교과를 ${SUBJECT_TRASH_LIMIT}개까지 둡니다. 넘친 ${count}개${fresh ? `(방금 넣은 교과 ${fresh}개 포함)` : ''}를 완전히 지웠습니다.`;

// 교과들을 휴지통 앞쪽에 한 번에 넣는다. SUBJECT_TRASH_LIMIT개를 넘으면 뒤쪽(오래된 것)부터 완전히 지우고 알린다(notify: false면 부른 쪽이 알린다). 지운 수를 돌려준다
function moveSubjectsToTrash(subjects, reason = '', { notify = true } = {}) {
    const at = new Date().toISOString();
    const entries = (subjects || []).filter(Boolean).map(subject => {
        const lessons = String(subject.id) === String(currentSubjectId) && Array.isArray(courseData) ? courseData : subject.lessons;
        return { subject: deepCopy({ ...subject, lessons: lessons || [] }), at, ...(reason ? { reason } : {}) };
    });
    if (!entries.length) return 0;
    const all = [...entries, ...liveSubjectTrash()];
    globalState.subjectTrash = all.slice(0, SUBJECT_TRASH_LIMIT);
    const dropped = all.length - globalState.subjectTrash.length;
    if (dropped && notify) window.showToast?.(subjectTrashCapText(dropped, Math.max(0, entries.length - SUBJECT_TRASH_LIMIT)), 'warning');
    return dropped;
}

function moveSubjectToTrash(subject, reason = '') {
    return moveSubjectsToTrash([subject], reason);
}

const allLessonIds = () => globalState.subjects.flatMap(subject => (subject.lessons || []).map(lesson => lesson.id));

// 같은 id나 이름의 교과가 있으면 새 id와 '(복원)'을 붙여 나란히 둔다. 차시 id는 화면 코드가 숫자로 쓰므로 숫자로 새로 준다
function restoreSubject(index) {
    const entry = liveSubjectTrash()[index];
    if (!entry) return null;
    const trashed = cleanTrashSubject(entry.subject);
    const clash = globalState.subjects.some(subject => String(subject.id) === String(trashed.id) || subject.title === trashed.title);
    const freshId = prefix => (typeof generateUniqueId === 'function' ? generateUniqueId(prefix) : `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const subject = clash
        ? { ...trashed, id: freshId('subject_'), title: `${trashed.title} (복원)`, lessons: renumberLessons(trashed.lessons || [], allLessonIds()) }
        : trashed;
    globalState.subjects = [...globalState.subjects, subject];
    globalState.subjectTrash = globalState.subjectTrash.filter((_, i) => i !== index);
    return subject;
}

/* ---------- 교과 백업 불러오기 (위쪽 ZIP) ---------- */
// 파일의 교과만 합친다. 같은 교과는 지금 내용을 교과 휴지통에 넣고 바꾸며, 다른 교과는 그대로 둔다
async function importSubjectsBackup(meta) {
    // 저장된 작업을 읽지 못한 동안에는 교과만 불러오지 않는다(합칠 지금 작업이 없다. 과정 전체 백업으로만 되살린다)
    if (typeof isStateLoadFailed === 'function' && isStateLoadFailed()) return window.showAlert(UNREAD_PARTIAL_BACKUP_TEXT);
    const incoming = (sanitizeState({ subjects: meta.context?.subjects || [] }) || { subjects: [] }).subjects;
    if (!incoming.length) return window.showAlert('이 파일에는 되살릴 교과가 없습니다.');
    const plan = planSubjectImport(globalState.subjects, incoming);
    // 그림을 뺀 파일('빼기')이면 확인 창에 알리고, 빈칸이 될 바뀌는 교과의 지금 그림 수를 함께 보인다
    const noImages = meta.imageMode === 'none';
    const replacedIds = new Set(plan.replaced.map(subject => String(subject.id)));
    const lostImages = noImages ? countBackupImages(currentSnapshot().subjects.filter(subject => replacedIds.has(String(subject.id)))) : 0;
    const ok = await confirmAsync(describeSubjectImport(plan, { noImages, lostImages }), { okLabel: '백업 받고 불러오기', tone: noImages ? 'danger' : 'primary', title: '교과 불러오기' });
    if (!ok) return;
    if (typeof stateReplaceBlocked === 'function' && stateReplaceBlocked()) return; // 확인 창을 띄운 사이 시작된 생성(바꾸는 교과의 차시를 만드는 중일 수 있다)
    if (typeof allowStateOverwrite === 'function' && !(await allowStateOverwrite())) return; // 다른 탭이 저장한 뒤면 바꾸기 전에 묻는다(state.js)
    const openReplaced = plan.replaced.some(subject => String(subject.id) === String(currentSubjectId));
    if (openReplaced) window.saveRawContent?.(); // 고치던 원문은 바뀌기 전 교과(휴지통으로 갈 쪽)에 먼저 넣는다
    if (!(await safetyBackupOrAsk('불러오기전'))) return; // 받지 못하면 까닭을 알리고 백업 없이 계속할지 묻는다
    // 바꾸기 전 값(브라우저에 저장하지 못하면 되돌린다. 새로고침하면 불러오기 전 저장본이 열리므로 화면도 그것과 맞춘다)
    const before = { subjects: globalState.subjects, subjectTrash: globalState.subjectTrash, courseData };
    const trashed = plan.replaced.map(subject => globalState.subjects.find(item => String(item.id) === String(subject.id)));
    const dropped = moveSubjectsToTrash(trashed, '불러오기 전', { notify: false }); // 넘쳐 지운 교과는 저장한 뒤에 알린다(되돌리면 지우지 않은 것이다)
    globalState.subjects = mergeSubjects(globalState.subjects, incoming);
    const open = globalState.subjects.find(subject => String(subject.id) === String(currentSubjectId));
    if (open) courseData = open.lessons || [];
    if (openReplaced) closeLessonEditor();
    // 이어진 PC 폴더에는 브라우저에 저장한 뒤에만 쓴다(되돌린 불러오기가 폴더에 남지 않게. 과정 전체 백업 되살리기와 같은 규칙)
    const saved = (await saveState({ folder: false })) !== false;
    if (!saved) {
        Object.assign(globalState, { subjects: before.subjects, subjectTrash: before.subjectTrash });
        courseData = before.courseData;
    }
    const resaved = saved || (await saveState()) !== false;
    if (saved && typeof projectFolderHandle !== 'undefined' && projectFolderHandle) syncToLinkedFolder().catch(err => console.warn('폴더 동기화 경고:', err.message));
    if (typeof renderOverviewLNB === 'function') renderOverviewLNB();
    if (typeof renderDiagram === 'function') renderDiagram();
    if (typeof renderSidebar === 'function') renderSidebar();
    location.hash = '#overview';
    if (!saved) {
        return window.showAlert('이 파일의 교과를 브라우저에 저장하지 못해 불러오지 않았습니다. 화면은 불러오기 전으로 돌려 두었습니다.\n'
            + '브라우저 저장 공간이 모자라거나 이 사이트의 저장을 막았을 수 있습니다. 확인한 뒤 다시 불러와 주세요.'
            + (resaved ? '' : '\n불러오기 전 작업도 다시 저장하지 못했습니다. 브라우저 저장 공간을 확인한 뒤 Ctrl+S로 다시 저장해 주세요.'));
    }
    window.showToast?.(`교과 ${incoming.length}개를 불러왔습니다.`, 'success');
    if (dropped) window.showToast?.(subjectTrashCapText(dropped, Math.max(0, trashed.length - SUBJECT_TRASH_LIMIT)), 'warning');
}

// 지금 연 차시 편집기를 닫는다. 내용이 바뀐 뒤 남은 편집기(원문 칸 등)가 옛 글을 새 내용 위에 저장하지 않게
function closeLessonEditor() {
    currentEditingModuleId = null;
    // 상태를 바꾼 뒤(저장 파일·폴더 불러오기, 되살리기, 초기화, 지금 교과 지우기) 부른다. 차시 화면 기억이 예전 차시의 글·그림을 붙잡지 않게 잊는다(api.js)
    if (typeof forgetLessonScreens === 'function') forgetLessonScreens();
    document.getElementById('raw-view')?.remove();
    const area = document.getElementById('editor-content-area');
    if (area) area.innerHTML = '<div class="h-full flex items-center justify-center text-textMuted text-sm">왼쪽 목록에서 차시를 고르세요.</div>';
}

/* ---------- 불러온 상태 검사: 백업 ZIP·폴더는 남이 준 파일일 수 있다 ---------- */
// id는 화면 코드(onclick 속성 등)에 그대로 들어가므로 안전한 글자만 받는다
const SAFE_STATE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const isSafeStateId = id => (typeof id === 'string' || typeof id === 'number') && SAFE_STATE_ID.test(String(id));

// 글 값은 문자열로 맞춘다(자르지 않는다). 객체는 받지 않는다(toString을 바꾼 객체로 멈추지 않게). 화면에는 escapeHtml을 거쳐 넣는다
const stateText = value => (['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '');

// 참고 링크는 http(s) 주소만 남긴다(javascript: 같은 주소를 막는다)
function safeReferenceUrls(list) {
    return (Array.isArray(list) ? list : [])
        .filter(ref => ref && typeof ref === 'object' && typeof ref.url === 'string' && /^https?:\/\//i.test(ref.url))
        .map(ref => ({ ...ref, title: stateText(ref.title) }));
}

/* ---------- 불러온 상태의 안쪽 값: 그림·탭 글·교수안·휴지통 날짜·작업 기록 ---------- */
// 백업 ZIP·PC 폴더·브라우저 저장본에서 온 값 가운데 화면·내보내기를 멈추게 하는 것만 고친다.
// 바른 값은 같은 객체 그대로 둔다. 검사는 어떤 값에도 던지지 않는다(던지면 저장된 작업 전체를 읽지 못한 것으로 본다)
// 그림 키: 글 속 local:키, 파일 이름, 화면 코드에 그대로 쓰이므로 이 글자만 받는다(앱이 만드는 img_123·ai1x2y 모양)
const SAFE_IMAGE_KEY = /^[\w-]{1,80}$/;
// 그림 값: data:image/형식(;이름=값)*;base64,글자 만 받는다. 따옴표·꺾쇠·빈칸이 들어갈 수 없어 속성·마크다운에 넣어도 안전하다.
// 형식(소문자·숫자·. + -)을 png·jpeg 등으로 좁히지 않는다(그림 서비스가 알려 준 형식 그대로 저장한 내 그림을 시작할 때 지우지 않게. 남이 준 교안 HTML은 output-import.js가 더 좁게 본다).
// 찾지 못한 그림 자리(teacher-image:…)는 isBackupImageRef가 따로 받는다
const SAFE_IMAGE_DATA = /^data:image\/[a-z0-9.+-]{1,40}(?:;[\w.+-]{1,40}=[\w.+-]{1,40})*;base64,[A-Za-z0-9+/=]+$/;
// 탭 이름(basicLearn 등): 영문자로 시작하는 영문·숫자·_ 만. 교과 백업 ZIP에서 파일 이름이 된다
const SAFE_TAB_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// 차시에서 목록이어야 하는 칸(아니면 .map에서 화면이 멈춘다)과 글이어야 하는 칸
const LESSON_LIST_FIELDS = ['objectives', 'tools', 'prereqs', 'illustrations', 'refImages', 'history'];
const LESSON_TEXT_FIELDS = ['content', 'uploadedMdName', 'uploadedMdContent'];
const LESSON_INFO_TEXT_FIELDS = ['category', 'reviewStatus']; // 차시 카드·검색·차시 정보 창이 글로 쓰는 칸(있을 때 글로 맞춘다)
const GYOSUAN_TEXT_FIELDS = ['docMd', 'deckMd', 'deckHtml', 'briefMd', 'briefDocKey']; // briefMd: 간이 교수안, briefDocKey: 그때 교수안의 지문(gyosuan-brief.js)
const TRASH_FUTURE_MS = 24 * 60 * 60 * 1000; // 이보다 먼 미래로 적힌 지운 날짜는 지금으로 본다(영영 비워지지 않는 일이 없게)

const textOrNull = value => (typeof value === 'string' ? value : null);
const isSafeImageKey = key => (typeof key === 'string' || typeof key === 'number') && SAFE_IMAGE_KEY.test(String(key));
const isSafeImageValue = value => typeof value === 'string' && (SAFE_IMAGE_DATA.test(value) || isBackupImageRef(value));
// 두 객체의 칸이 모두 같은 값인가(고칠 것이 없으면 처음 객체를 그대로 돌려줄 때 쓴다)
const sameFields = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.is(a[key], b[key]));

// 그림 서비스가 알려 준 형식을 그대로 붙여 'data:image/PNG; charset=binary;base64,…'처럼 저장된 그림(형식에 대문자·빈칸·매개변수)은
// 형식만 소문자로 남겨 'data:image/png;base64,…'로 고친다(진짜 그림을 다음에 열 때 지우지 않게). 이미 바른 값과 이 모양이 아닌 값은 그대로 돌려준다(뒤 검사가 가른다)
const LOOSE_IMAGE_DATA = /^data:image\/([a-z0-9.+-]{1,40})(?:\s*;\s*[\w.+-]{1,40}\s*=\s*[\w.+-]{1,40}){0,8}\s*;\s*base64,([A-Za-z0-9+/=]+)$/i;
function repairImageValue(value) {
    if (typeof value !== 'string' || SAFE_IMAGE_DATA.test(value)) return value;
    const match = LOOSE_IMAGE_DATA.exec(value);
    return match ? `data:image/${match[1].toLowerCase()};base64,${match[2]}` : value;
}

// 바른 키와 그림만 남긴다(고칠 수 있는 그림 값은 고쳐서, repairImageValue). 모두 바르면 같은 객체, 객체가 아니면 빈 목록
function safeImageMap(images) {
    if (!isObject(images)) return {};
    const kept = Object.fromEntries(Object.entries(images)
        .map(([key, value]) => [key, repairImageValue(value)])
        .filter(([key, value]) => isSafeImageKey(key) && isSafeImageValue(value)));
    return sameFields(kept, images) ? images : kept;
}

// 차시에 직접 넣은 동영상(lessonVideos: { vid_키: data URL }, lesson-insert-tools.js). 키는 vid_ + 영문 소문자·숫자, 값은 mp4·webm data URL만 받는다
// (보기 화면·내보내기가 <video>의 src로 쓴다). '그림' 폴더에서 찾지 못한 파일의 참조(teacher-image:…)는 그림처럼 남긴다(다음에 파일을 채우면 돌아온다)
const SAFE_VIDEO_KEY = /^vid_[a-z0-9]{6,40}$/;
const SAFE_VIDEO_DATA = /^data:video\/(?:mp4|webm);base64,[A-Za-z0-9+/=]+$/;
const isSafeVideoValue = value => typeof value === 'string' && (SAFE_VIDEO_DATA.test(value) || isBackupImageRef(value));

// 바른 키와 동영상만 남긴다. 모두 바르면 같은 객체, 객체가 아니면 빈 목록
function safeVideoMap(videos) {
    if (!isObject(videos)) return {};
    const kept = Object.fromEntries(Object.entries(videos).filter(([key, value]) => SAFE_VIDEO_KEY.test(key) && isSafeVideoValue(value)));
    return sameFields(kept, videos) ? videos : kept;
}

// 글(local:vid_키)이 가리키는 동영상만 고른다(기록 한 칸이 차시 동영상을 통째로 복사하지 않게). 키는 local: 뒤 id 글자 줄 그대로 견준다(vid_1은 vid_10이 아니다)
function referencedVideos(text, videos) {
    const entries = Object.entries(isObject(videos) ? videos : {}).filter(([key, value]) => SAFE_VIDEO_KEY.test(key) && typeof value === 'string');
    if (!entries.length) return {};
    const runs = new Set(localImageRuns(typeof text === 'string' ? text : ''));
    return Object.fromEntries(entries.filter(([key]) => runs.has(key)));
}

// 탭 글: 이름이 바른 탭만 두고, 글이 아니면 빈 탭(null)으로. 모두 바르면 같은 객체, 객체가 아니면 null
function safeTabContents(tabs) {
    if (!isObject(tabs)) return null;
    const kept = Object.fromEntries(Object.entries(tabs).filter(([key]) => SAFE_TAB_KEY.test(key)).map(([key, value]) => [key, textOrNull(value)]));
    return sameFields(kept, tabs) ? tabs : kept;
}

// 교수안: 글·화면 편집본은 글만, 차시별 화면 편집본(sessionDecks)도 글만, 그림은 차시 그림과 같은 규칙. 모두 바르면 같은 객체, 객체가 아니면 null
function safeGyosuan(gyosuan) {
    if (!isObject(gyosuan)) return null;
    const next = { ...gyosuan };
    GYOSUAN_TEXT_FIELDS.forEach(field => { if (next[field] !== undefined) next[field] = textOrNull(next[field]); });
    if (next.sessionDecks !== undefined) {
        const decks = isObject(next.sessionDecks) ? Object.fromEntries(Object.entries(next.sessionDecks).filter(([, html]) => typeof html === 'string')) : {};
        next.sessionDecks = isObject(next.sessionDecks) && sameFields(decks, next.sessionDecks) ? next.sessionDecks : decks;
    }
    if (next.images !== undefined) next.images = safeImageMap(next.images);
    return sameFields(next, gyosuan) ? gyosuan : next;
}

// 움직이는 GIF 기록(image-motion.js): { GIF 그림 키: { still: 간직한 원래 그림 키, at, sig, patterns, summary } }.
// GIF 그림 키와 원래 그림 키가 서로 다른 바른 키이고 둘 다 그 차시 그림(images)에 있을 때만 남긴다. 원래 그림 키를 앞 기록이 이미 쓰거나 다른 기록의 GIF 키면 뺀다.
// 칸은 작은 표시만 맞춰 남기고(모르는 칸은 버린다) 지문(sig)이 없는 기록은 뺀다. 고칠 것이 없으면 같은 객체, 객체가 아니면 빈 목록
const MOTION_SIG_RE = /^[0-9a-z]{1,12}-[0-9a-z]{1,8}$/;
const MOTION_RECORD_PATTERN_RE = /^[a-z]{2,8}$/;
const MOTION_SUMMARY_MAX = 120;
function safeImageMotions(records, images) {
    if (!isObject(records)) return {};
    const has = key => isObject(images) && Object.prototype.hasOwnProperty.call(images, key);
    const stills = new Set();
    const kept = {};
    let same = true;
    for (const [key, item] of Object.entries(records)) {
        const still = isObject(item) && typeof item.still === 'string' ? item.still : '';
        const ok = isSafeImageKey(key) && isSafeImageKey(still) && still !== key && has(key) && has(still) && !stills.has(still)
            && !Object.prototype.hasOwnProperty.call(records, still) && typeof item.sig === 'string' && MOTION_SIG_RE.test(item.sig);
        if (!ok) {
            same = false;
            continue;
        }
        stills.add(still);
        const patterns = (Array.isArray(item.patterns) ? item.patterns : []).filter(pattern => typeof pattern === 'string' && MOTION_RECORD_PATTERN_RE.test(pattern)).slice(0, 4);
        const clean = { still, at: Number.isFinite(item.at) && item.at >= 0 ? item.at : 0, sig: item.sig, patterns, summary: stateText(item.summary).slice(0, MOTION_SUMMARY_MAX) };
        const unchanged = Object.keys(item).length === Object.keys(clean).length && clean.at === item.at && clean.summary === item.summary
            && Array.isArray(item.patterns) && patterns.length === item.patterns.length && patterns.every((pattern, i) => pattern === item.patterns[i]);
        if (!unchanged) same = false;
        kept[key] = unchanged ? item : clean;
    }
    return same ? records : kept;
}

// 삽화 목록: 객체만 두고, 바르지 않은 그림 키(imgId)는 비운다(그 삽화는 본문에 다시 넣을 수 있다). 고칠 것이 없으면 같은 목록
function safeIllustrations(list) {
    const kept = list.filter(isObject).map(item => (item.imgId == null || isSafeImageKey(item.imgId) ? item : { ...item, imgId: null }));
    return kept.length === list.length && kept.every((item, index) => item === list[index]) ? list : kept;
}

// 줄 객체의 글 칸을 글로 맞춘다. need는 늘 글로 두는 칸(없으면 ''), may는 있을 때만 맞추는 칸. 객체가 아니면 null(뺄 줄), 고칠 것이 없으면 같은 객체
function textRow(row, need, may = []) {
    if (!isObject(row)) return null;
    const next = { ...row };
    need.forEach(field => { next[field] = stateText(row[field]); });
    may.forEach(field => { if (row[field] !== undefined) next[field] = stateText(row[field]); });
    return sameFields(next, row) ? row : next;
}

// 목록 칸의 줄(카드·검색·차시 정보 창·교재 내보내기가 줄마다 글로 쓴다): 학습 목표는 글, 툴은 name·version, 선행 차시는 title과 id(글·숫자),
// 변경 이력은 at·note. 쓸 수 없는 줄은 빼고 바른 줄은 그대로 둔다
const LESSON_ROW_RULES = {
    objectives: row => (typeof row === 'string' ? row : ['number', 'boolean'].includes(typeof row) ? String(row) : null),
    tools: row => textRow(row, ['name'], ['version']),
    prereqs: row => {
        const next = textRow(row, ['title']);
        if (!next || next.id == null || ['string', 'number'].includes(typeof next.id)) return next;
        const { id, ...rest } = next;
        return rest;
    },
    history: row => textRow(row, ['at', 'note'])
};

// 목록의 줄을 rule로 고친다(null이면 뺀다). 고칠 것이 없으면 같은 목록
function safeRows(list, rule) {
    const kept = list.map(rule).filter(row => row !== null);
    return kept.length === list.length && kept.every((row, index) => row === list[index]) ? list : kept;
}

// 생성 옵션의 실습 시간 칸(차시 gen, 과정 기본값 genOptions). lesson-lint.js PRACTICE_MINUTE_KEYS·practiceMinutesValue와 같은 규칙이다(이 파일은 그 파일 없이도 돈다)
const GEN_PRACTICE_KEYS = ['basicPracMinutes', 'advPracMinutes'];
const GEN_PRACTICE_RANGE = { min: 10, max: 600, step: 10 };

// 실습 시간으로 받을 수 있는 값: 10~600분 사이 10분 단위 정수(글자 '120'도 받는다). 아니면 null
function safePracticeMinutes(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const minutes = Number(value);
    const { min, max, step } = GEN_PRACTICE_RANGE;
    return Number.isInteger(minutes) && minutes >= min && minutes <= max && minutes % step === 0 ? minutes : null;
}

// 생성 옵션: 실습 시간 칸은 받을 수 있는 값이면 숫자로 맞추고 아니면 뺀다. 다른 칸은 그대로 둔다. 고칠 것이 없으면 같은 객체
function safeGenOptions(gen) {
    if (!isObject(gen)) return gen;
    const next = { ...gen };
    GEN_PRACTICE_KEYS.forEach(key => {
        if (next[key] === undefined) return;
        const minutes = safePracticeMinutes(next[key]);
        if (minutes === null) delete next[key];
        else next[key] = minutes;
    });
    return sameFields(next, gen) ? gen : next;
}

// 차시의 접은 블록 기억(block-tools.js foldedBlocks: { 탭 id: [열쇠, ...] }). 탭 id는 영문자, 열쇠는 64자까지의 글자만, 탭마다 최근 300개만 남긴다.
// 남길 것이 없으면 null(칸을 지운다). 고칠 것이 없으면 같은 객체
const FOLDED_BLOCK_LIMIT = 300;
const FOLDED_KEY_CHARS = 64;
const FOLDED_TAB_ID = /^[A-Za-z]{1,32}$/;
function safeFoldedBlocks(value) {
    if (!isObject(value)) return null;
    const goodKey = key => typeof key === 'string' && key.length > 0 && key.length <= FOLDED_KEY_CHARS;
    const entries = Object.entries(value)
        .filter(([tabId, list]) => FOLDED_TAB_ID.test(tabId) && Array.isArray(list))
        .map(([tabId, list]) => [tabId, list.filter(goodKey).slice(-FOLDED_BLOCK_LIMIT)])
        .filter(([, list]) => list.length);
    if (!entries.length) return null;
    const unchanged = entries.length === Object.keys(value).length && entries.every(([tabId, list]) => list.length === value[tabId].length);
    return unchanged ? value : Object.fromEntries(entries);
}

// 차시(최종 평가 포함)의 안쪽 값을 그 자리에서 고친다(sanitizeState가 부른다)
function cleanLessonFields(lesson) {
    lesson.images = safeImageMap(lesson.images);
    if (lesson.lessonVideos !== undefined) lesson.lessonVideos = safeVideoMap(lesson.lessonVideos);
    if (lesson.imageMotions !== undefined) lesson.imageMotions = safeImageMotions(lesson.imageMotions, lesson.images); // 그림을 고른 뒤에 본다
    if (lesson.foldedBlocks !== undefined) {
        const folded = safeFoldedBlocks(lesson.foldedBlocks);
        if (folded) lesson.foldedBlocks = folded;
        else delete lesson.foldedBlocks;
    }
    LESSON_TEXT_FIELDS.forEach(field => { if (lesson[field] !== undefined) lesson[field] = textOrNull(lesson[field]); });
    LESSON_INFO_TEXT_FIELDS.forEach(field => { if (lesson[field] != null && typeof lesson[field] !== 'string') lesson[field] = stateText(lesson[field]); });
    LESSON_LIST_FIELDS.forEach(field => { if (lesson[field] != null && !Array.isArray(lesson[field])) lesson[field] = []; });
    Object.entries(LESSON_ROW_RULES).forEach(([field, rule]) => { if (Array.isArray(lesson[field])) lesson[field] = safeRows(lesson[field], rule); });
    if (Array.isArray(lesson.illustrations)) lesson.illustrations = safeIllustrations(lesson.illustrations);
    if (lesson.tabContents !== undefined) lesson.tabContents = safeTabContents(lesson.tabContents);
    // 두 갈래의 교수안(기본학습 gyosuan · 심화학습 gyosuanAdv)을 같은 규칙으로 본다
    gyosuanFields().forEach(field => { if (lesson[field] !== undefined) lesson[field] = safeGyosuan(lesson[field]); });
    // 생성 옵션: 객체가 아니면 지운다(차시 정보 창이 칸마다 읽는다). 실습 시간은 받을 수 있는 값만 남긴다
    if (lesson.gen !== undefined) {
        if (isObject(lesson.gen)) lesson.gen = safeGenOptions(lesson.gen);
        else delete lesson.gen;
    }
    return lesson;
}

// 지운 날짜(at)를 ISO 글자로. 읽을 수 있으면 같은 시각의 ISO(다시 해도 같다), 못 읽거나 하루 넘게 미래면 null
function trashTimeIso(at, now = Date.now()) {
    const parsed = typeof at === 'number' ? at : typeof at === 'string' ? Date.parse(at) : NaN;
    const time = new Date(parsed).getTime(); // 나타낼 수 없는 시각은 NaN
    return Number.isFinite(time) && time <= now + TRASH_FUTURE_MS ? new Date(time).toISOString() : null;
}

// 휴지통 한 칸의 지운 날짜를 맞춘다. 못 읽으면 지금 시각(30일 뒤 비워진다). 바르면 같은 객체
function withTrashTime(entry, now = Date.now()) {
    const at = trashTimeIso(entry.at, now) || new Date(now).toISOString();
    return at === entry.at ? entry : { ...entry, at };
}

// 작업 기록 한 칸. id는 숫자로(historyIdOf), 있는 칸만 고친다: 제목·날짜·까닭은 글로, 본문은 글이나 null로, 그림·탭 글·교수안은 차시와 같은 규칙으로.
// 모르는 칸(tabId 등)은 그대로 둔다. 고칠 것이 없으면 같은 객체, 모양이 틀리면(객체가 아니거나 쓸 수 없는 id) null
function cleanHistoryItem(item) {
    if (!isObject(item)) return null;
    const id = historyIdOf(item);
    if (id === null) return null;
    const next = { ...item, id };
    ['title', 'date', 'reason'].forEach(field => { if (item[field] !== undefined) next[field] = stateText(item[field]); });
    if (item.content !== undefined) next.content = textOrNull(item.content);
    if (item.images !== undefined) next.images = safeImageMap(item.images);
    if (item.lessonVideos !== undefined) {
        const videos = safeVideoMap(item.lessonVideos);
        if (Object.keys(videos).length) next.lessonVideos = videos;
        else delete next.lessonVideos;
    }
    if (item.imageMotions !== undefined) {
        const motions = safeImageMotions(item.imageMotions, next.images);
        if (Object.keys(motions).length) next.imageMotions = motions;
        else delete next.imageMotions;
    }
    if (item.tabContents !== undefined) {
        const tabs = safeTabContents(item.tabContents);
        if (tabs) next.tabContents = tabs;
        else delete next.tabContents;
    }
    gyosuanFields().forEach(field => { if (item[field] !== undefined) next[field] = safeGyosuan(item[field]); });
    if (item.lessonId !== undefined) {
        const lessonId = normalizeLessonId(item.lessonId);
        if (lessonId === null) delete next.lessonId;
        else next.lessonId = lessonId;
    }
    if (item.subjectId !== undefined && !isSafeStateId(item.subjectId)) delete next.subjectId;
    return sameFields(next, item) ? item : next;
}

/* ---------- 과정 전체 백업 ZIP의 차시 MD 맞추기 ---------- */
// 앞머리(---로 시작해 '---\n\n'까지)나 '# 차시 제목' 머리를 뗀 본문. 제목은 글자 그대로 비교한다('C++ 기초', '1) 개요'도 된다)
function backupMarkdownBody(md, title) {
    const text = String(md || '').replace(/\r\n/g, '\n');
    const yamlEnd = text.indexOf('---\n\n');
    if (yamlEnd !== -1 && text.startsWith('---')) return text.substring(yamlEnd + 5);
    const head = `# ${title}\n\n`;
    return text.startsWith(head) ? text.slice(head.length) : text;
}

// 과정 전체 백업은 차시 MD를 '# 차시 제목'으로 시작한다(exportAllModules). 제목이 꼭 같은 파일을 앞에서부터 한 번씩만 쓴다
// (예전에는 경로나 글에 제목 일부만 있어도 골라 다른 차시의 글로 덮었다). mdFiles의 content는 줄바꿈을 \n으로 맞춘 것
function takeBackupMarkdown(mdFiles, title, used) {
    const head = `# ${title}\n\n`;
    const index = (mdFiles || []).findIndex((file, i) => !used.has(i) && file.content.startsWith(head));
    if (index === -1) return null;
    used.add(index);
    return mdFiles[index];
}

// MD의 ../첨부파일/이름 을 local:키 로 되돌리고 그 그림을 넣는다. 키는 파일 이름에서 확장자를 뗀 것이다.
// 바르지 않은 키는 그 자리를 그대로 두고, 이미 있는 진짜 그림은 바꾸지 않는다(찾지 못한 그림 자리면 첨부 그림으로 채운다). attached: 파일 이름 → data URL (Map)
function relinkAttachedImages(content, attached, images = {}) {
    const found = new Map();
    const keyOf = fileName => {
        const key = String(fileName).split('.')[0];
        if (!isSafeImageKey(key)) return null;
        const data = repairImageValue(attached?.get?.(fileName));
        const current = Object.prototype.hasOwnProperty.call(images, key) ? images[key] : undefined;
        if (!isPictureData(current) && isSafeImageValue(data)) found.set(key, data);
        return key;
    };
    const text = String(content || '')
        .replace(/!\[([^\]]+)\]\(\.\.\/첨부파일\/([^)]+)\)/g, (match, alt, fileName) => {
            const key = keyOf(fileName);
            return key ? `<!-- [IMG: "local:${key}"] -->` : match;
        })
        .replace(/src="\.\.\/첨부파일\/([^"]+)"/g, (match, fileName) => {
            const key = keyOf(fileName);
            return key ? `src="local:${key}"` : match;
        });
    return { content: text, images: found.size ? { ...images, ...Object.fromEntries(found) } : images };
}

// 그 교과의 차시 글을 백업의 MD로 맞춘다(MD를 고쳐 넣었으면 그 글을 쓴다). 첨부 그림도 되돌린다. 새 상태(지역 변수)에만 쓴다
function applyBackupMarkdown(subject, mdFiles, attached) {
    if (!subject) return subject;
    const files = (mdFiles || []).map(file => ({ ...file, content: String(file.content || '').replace(/\r\n/g, '\n') }));
    const used = new Set();
    (subject.lessons || []).forEach(lesson => {
        const file = takeBackupMarkdown(files, lesson.title, used);
        if (!file) return;
        const relinked = relinkAttachedImages(backupMarkdownBody(file.content, lesson.title), attached, lesson.images || {});
        lesson.content = relinked.content;
        lesson.images = relinked.images;
    });
    return subject;
}

/* ---------- 백업 ZIP·PC 폴더의 차시 MD: 그림 자리를 첨부 파일로 ---------- */
// 정해 둔 두 모양(<!-- [IMG: "local:id"] -->, src="local:id")만 찾고 그림 id는 글자 그대로 비교한다(id로 정규식을 만들지 않는다)
const MD_IMAGE_TAG_LOCAL = /<!--\s*\[IMG:\s*"?local:([^"\]\s]+)"?\]\s*-->/g;
const MD_IMAGE_SRC_LOCAL = /src="local:([^"]+)"/g;
const MD_ATTACH_DATA_URL = /^data:(image\/\w+);base64,(.*)$/;

// names: 그림 id → 첨부 파일 이름(Map). names에 없는 id의 자리는 그대로 둔다
function relinkLocalImages(markdown, names) {
    return String(markdown || '')
        .replace(MD_IMAGE_TAG_LOCAL, (match, id) => (names.has(id) ? `![${id}](../첨부파일/${names.get(id)})` : match))
        .replace(MD_IMAGE_SRC_LOCAL, (match, id) => (names.has(id) ? `src="../첨부파일/${names.get(id)}"` : match));
}

// 첨부 파일로 쓸 그림의 이름과 base64. data:image/형식;base64, 모양이 아니면 null(svg+xml 등은 예전처럼 쓰지 않는다)
function attachedImageFile(imgId, dataUrl) {
    const match = typeof dataUrl === 'string' ? dataUrl.match(MD_ATTACH_DATA_URL) : null;
    if (!match) return null;
    const type = match[1].split('/')[1];
    return { name: `${imgId}.${type === 'jpeg' ? 'jpg' : type}`, base64: match[2] };
}

// 백업 ZIP의 차시 MD: 그림 자리를 ../첨부파일/로 바꾸고 첨부할 그림 파일 목록을 돌려준다(state.js extractImagesToZip)
function attachmentImages(markdown, images) {
    const names = new Map();
    const files = [];
    Object.entries(isObject(images) ? images : {}).forEach(([imgId, dataUrl]) => {
        const file = attachedImageFile(imgId, dataUrl);
        if (!file) return;
        names.set(imgId, file.name);
        files.push(file);
    });
    return { content: relinkLocalImages(markdown, names), files };
}

// 저장된 작업을 읽지 못한 동안 교과·차시만 담은 백업을 고르면 보이는 말(그 상태에서는 과정 전체로만 되살린다)
const UNREAD_PARTIAL_BACKUP_TEXT = '이 파일은 교과(또는 차시)만 담은 백업이라, 읽지 못한 저장본 대신 열 수 없습니다.\n'
    + "과정 전체 백업 ZIP(파일 이름에 '과정전체백업'이나 '교안백업'이 든 것)을 골라 주세요. 없으면 '새로 시작'을 누른 뒤 이 파일을 불러오세요.";

/* ---------- 읽지 못한 저장본: 내려받을 글 조각, 남길 사본 (state.js가 쓴다) ---------- */
// 값을 JSON 글로 만들되 글 하나가 아니라 조각 목록으로 돌려준다(그림이 많은 저장본도 브라우저의 글 길이 한도에 걸리지 않게. 조각을 Blob에 그대로 넣는다).
// 조각을 이으면 JSON.stringify(value)와 같다(객체 안의 undefined·함수는 빼고, 목록 안이면 null). size: 조각 하나를 이만큼 모은 뒤 끊는다
function jsonTextParts(value, size = 1 << 20) {
    const parts = [];
    let buffer = '';
    const push = text => {
        buffer += text;
        if (buffer.length < size) return;
        parts.push(buffer);
        buffer = '';
    };
    const write = node => {
        if (node === null || typeof node !== 'object' || typeof node.toJSON === 'function') {
            const text = JSON.stringify(node);
            push(text === undefined ? 'null' : text);
        } else if (Array.isArray(node)) {
            push('[');
            for (let index = 0; index < node.length; index++) {
                if (index) push(',');
                write(node[index]);
            }
            push(']');
        } else {
            push('{');
            let first = true;
            for (const key of Object.keys(node)) {
                const item = node[key];
                if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
                push(`${first ? '' : ','}${JSON.stringify(key)}:`);
                first = false;
                write(item);
            }
            push('}');
        }
    };
    write(value);
    if (buffer) parts.push(buffer);
    return parts;
}

// 저장소 이름 가운데 따로 옮겨 둔 사본(prefix + 옮긴 시각 ms)만 [{ key, at }]로, 새것부터. 이 모양이 아닌 이름(지금 저장본·폴더 연결·판서 영상 등)은 고르지 않는다
function unreadCopyKeys(keys, prefix) {
    return (Array.isArray(keys) ? keys : [])
        .filter(key => typeof key === 'string' && key.startsWith(prefix) && /^\d{1,16}$/.test(key.slice(prefix.length)))
        .map(key => ({ key, at: Number(key.slice(prefix.length)) }))
        .sort((a, b) => b.at - a.at);
}

// 따로 옮겨 둔 사본 가운데 지울 것: 새것부터 keep개를 남긴 나머지. 이 모양이 아닌 이름은 건드리지 않는다
function staleUnreadCopies(keys, prefix, keep) {
    return unreadCopyKeys(keys, prefix).slice(Math.max(0, keep)).map(copy => copy.key);
}

// 차시 id는 화면 코드에 따옴표 없이 들어가므로 숫자여야 한다. 예전 형식에서 차시 목록에 든 최종 평가('mainQuest')는 그대로 둔다
function normalizeLessonId(id) {
    if (id === 'mainQuest') return id;
    if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) return id;
    if (typeof id === 'string' && /^\d{1,15}$/.test(id)) return Number(id);
    return null;
}

// 교과마다 차시 목록 안에서 숫자가 아니거나 겹치는 id에만 새 숫자를 준다. 바른 id는 그대로 둔다.
// 교과가 다르면 같은 id여도 된다(주소·판서 영상·작업 기록이 교과 id와 함께 가리킨다).
// 새 id는 그 목록의 가장 큰 id 다음 수라, 저장하지 않고 다시 열어도 같게 나온다
function assignLessonIds(lessonLists) {
    return lessonLists.map(list => {
        const reserved = new Set(list.map(lesson => normalizeLessonId(lesson?.id)).filter(id => typeof id === 'number'));
        const seen = new Set();
        let next = Math.max(0, ...reserved) + 1;
        const fresh = () => {
            while (reserved.has(next) || seen.has(next)) next += 1;
            return next;
        };
        return list.map(lesson => {
            const id = normalizeLessonId(lesson.id);
            const safe = id !== null && !seen.has(id) ? id : fresh();
            seen.add(safe);
            return safe === lesson.id ? lesson : { ...lesson, id: safe };
        });
    });
}

// 지금 있는 차시들과 겹치지 않는 새 숫자 id로 바꾼 사본(휴지통 되살리기·단일 차시 불러오기)
function renumberLessons(lessons, takenIds, start = Date.now()) {
    const taken = new Set([...takenIds].map(id => normalizeLessonId(id)).filter(id => id !== null));
    let next = start;
    return lessons.map(lesson => {
        while (taken.has(next)) next += 1;
        taken.add(next);
        return { ...lesson, id: next };
    });
}

/* ---------- 작업 기록 상한 ---------- */
// 기록 한 칸이 그 글이 쓰는 그림까지 담으므로 개수를 넘으면 가장 오래된 기록부터 지운다(백업·저장이 커지지 않게)
const HISTORY_LIMIT = 200;
const capHistory = (list, limit = HISTORY_LIMIT) => (list.length > limit ? list.slice(list.length - limit) : list);
const historyCapText = count => `작업 기록은 ${HISTORY_LIMIT}개까지 둡니다. 가장 오래된 기록 ${count}개를 지웠습니다.`;

/* ---------- 작업 기록 합치기 (백업 ZIP·PC 폴더 불러오기) ---------- */
// 불러올 때 살피는 들어온 기록 수(새것부터). 남이 준 아주 긴 목록에도 멈추지 않게 한다. 어차피 HISTORY_LIMIT개까지만 남는다
const HISTORY_MERGE_MAX = HISTORY_LIMIT * 5;

// 같은 기록인지 가르는 열쇠: 남긴 때·제목·까닭·차시와 교과·글 길이(옛 본문, 탭마다).
// 한 번에 남긴 기록(같은 때·같은 까닭)은 제목이 같아도 차시나 탭 글이 다르면 다른 기록이다.
// id는 넣지 않는다(합치며 id를 나누거나 미래 시각 id를 바꾼 기록도, 같은 파일을 다시 불러오면 같은 기록으로 알아보게. 합치기는 id만 바꾼다)
const historyTabLengths = tabs => (isObject(tabs) ? Object.keys(tabs).sort().map(key => `${key}:${stateText(tabs[key]).length}`) : []);
const historyRecordKey = item => JSON.stringify([stateText(item.date), stateText(item.title), stateText(item.reason),
    stateText(item.lessonId), stateText(item.subjectId), stateText(item.content).length, historyTabLengths(item.tabContents)]);

// start부터 아래로 빈 숫자를 찾아 taken에 더한다. 0 아래로는 내려가지 않고 그때는 start 위로 찾는다
// (음수 id는 historyIdOf가 받지 않아, 백업으로 옮긴 곳에서 그 기록이 빠진다)
function freeHistoryId(start, taken) {
    const from = Math.max(0, start);
    let next = from;
    while (next >= 0 && taken.has(next)) next -= 1;
    if (next < 0) {
        next = from + 1;
        while (taken.has(next)) next += 1;
    }
    taken.add(next);
    return next;
}

// 지금보다 미래인 id(시계가 앞선 PC·조작된 파일)를 below 아래의 빈 숫자로 바꾼다(below는 지금 시각을 넘지 않는다). 서로의 순서는 지킨다.
// taken: 이미 쓰는 id(여기서 새로 준 id도 더한다)
function settleHistoryIds(items, now, below = now, taken = new Set()) {
    const ahead = items.filter(item => item.id > now).sort((a, b) => b.id - a.id);
    if (!ahead.length) return items;
    const fixed = new Map();
    let next = Math.min(below, now);
    ahead.forEach(item => {
        next = freeHistoryId(next, taken);
        fixed.set(item, next);
    });
    return items.map(item => (fixed.has(item) ? { ...item, id: fixed.get(item) } : item));
}

// 다른 곳(백업 파일·PC 폴더)의 작업 기록을 지금 기록과 합친다. id는 0 이상의 정수로 맞춘다.
// 이 브라우저의 기록은 모두 남기고(칸이 모자라면 새것부터), 남는 칸에 들어온 기록을 새것부터 넣는다.
// 들어온 기록 가운데 이미 있는 기록(historyRecordKey가 같음)은 넣지 않는다. id만 같은 다른 기록(같은 순간에 남긴 기록 등)은 지우지 않고 아래쪽 빈 숫자로 나눈다.
// 들어온 기록의 미래 시각 id는 지금 시각과 이 브라우저의 가장 새 기록보다 아래로 바꾼다(방금 남긴 '불러오기 전' 기록이 맨 위에 남게)
function mergeHistory(current, incoming, now = Date.now(), limit = HISTORY_LIMIT) {
    const taken = new Set();
    // 쓸 수 없는 id(예전 코드가 받아 둔 소수·음수·지수 글자 등)는 0부터 빈 숫자를 준다(가장 오래된 쪽에 둔다)
    const withFreeId = item => {
        const id = freeHistoryId(historyIdOf(item) ?? 0, taken);
        return id === item.id ? item : { ...item, id };
    };
    // 이 브라우저의 기록은 id 모양과 상관없이 모두 남긴다(validHistory로 거르지 않는다). 객체가 아닌 칸은 기록이 아니어서 목록을 그리지 못하므로 뺀다
    const mine = (Array.isArray(current) ? current : []).filter(isObject).map(withFreeId);
    const known = new Set(mine.map(historyRecordKey));
    const arrived = validHistory(incoming).filter(item => historyIdOf(item) !== null);
    const skipped = Math.max(0, arrived.length - HISTORY_MERGE_MAX);
    const fresh = arrived.slice(skipped).filter(item => {
        const key = historyRecordKey(item);
        if (known.has(key)) return false;
        known.add(key);
        return true;
    }).map(withFreeId);
    const newest = mine.reduce((max, item) => Math.max(max, item.id), -1);
    const theirs = settleHistoryIds(fresh, now, newest >= 0 ? newest - 1 : now, taken);
    const keptOurs = mine.slice(Math.max(0, mine.length - limit));
    const keptTheirs = [...theirs].sort((a, b) => b.id - a.id).slice(0, Math.max(0, limit - keptOurs.length));
    return {
        list: [...keptOurs, ...keptTheirs].sort((a, b) => a.id - b.id),
        droppedIncoming: skipped + theirs.length - keptTheirs.length,
        droppedCurrent: mine.length - keptOurs.length
    };
}

// 불러오기를 마친 알림 끝에 붙이는 말. 칸이 모자라 남기지 못한 기록이 있을 때만. source: '파일' | '폴더'
// 넣지 못한 기록은 오래된 것만이 아니다(이 브라우저의 기록이 칸을 채우면 더 새 기록도 넣지 못한다).
// 백업 파일은 고치지 않으므로 그 파일에 남는다. 폴더는 곧 이어지는 폴더 저장이 저장본(save_data.yaml)을 지금 기록으로 다시 쓰므로 거기서도 빠진다.
// keptIn: 폴더의 그 기록이 그대로 남는 파일(폴더를 열 때 남긴 save_data.yaml 사본, 예전 save_data.json 폴더는 그 파일). 있으면 그 이름을 알린다
function historyMergeNote({ droppedIncoming = 0, droppedCurrent = 0, keptIn = '' } = {}, source = '파일') {
    const notTaken = source === '폴더'
        ? `폴더에 있던 기록 ${droppedIncoming}개는 넣지 않았고, 폴더의 저장본(save_data.yaml)에서도 빠집니다.${keptIn ? ` 그 기록은 ${keptIn}에 그대로 남아 있습니다.` : ''}`
        : `파일에 있던 기록 ${droppedIncoming}개는 넣지 않았습니다. 그 파일에는 그대로 남아 있습니다.`;
    const lost = [
        droppedIncoming ? notTaken : '',
        droppedCurrent ? `이 브라우저의 오래된 기록 ${droppedCurrent}개를 지웠습니다.` : ''
    ].filter(Boolean);
    return lost.length ? `\n\n작업 기록은 ${HISTORY_LIMIT}개까지만 둘 수 있어 이 브라우저의 기록을 먼저 남겼습니다. ${lost.join(' ')}` : '';
}

/* ---------- 작업 기록 되돌리기 ---------- */
// 탭 하나 기록은 그 차시의 그 탭만, 차시 기록은 모든 탭을 바꾼다. 그 차시가 없으면 지금 연 교과에 새 차시로 되살린다
async function restoreHistoryItem(id) {
    // 생성이 도는 동안에는 되돌리지 않는다(만들던 탭이 되돌린 글을 덮거나, 지웠다 되살린 차시에 쓰여 사라진다. course-meta.js trashRestoreBlocked)
    const busy = () => typeof trashRestoreBlocked === 'function' && trashRestoreBlocked();
    if (busy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    const entry = contentHistory.find(item => item.id === id);
    if (!entry) return window.showAlert('해당 작업 기록을 찾을 수 없습니다.');
    const target = historyRestoreTarget(entry, currentSnapshot().subjects);
    const openSubject = globalState.subjects.find(subject => String(subject.id) === String(currentSubjectId)) || null;
    if (target.mode !== 'replace' && !openSubject) return window.showAlert('되살릴 교과를 먼저 여세요(교과 편집기에서 다시 누르세요).');
    if (target.mode === 'replace' && target.part && historyMatchesNow(target.lesson, entry, target.part)) {
        // 쓸데없는 '되돌리기 전' 기록을 만들지 않는다(글이 같아도 그림이 다르면 되돌린다). 밖에서도 써서 지금 그림으로 두는 그림만 다르면 그 수도 알린다
        const sameKept = historyImagePlan(target.lesson, entry, target.part).kept.length;
        return window.showToast?.(`지금 내용이 이 기록과 같습니다.${historyKeptImagesNote(sameKept)}`, 'info');
    }
    const { text, okLabel, done: restoredText } = historyRestoreMessage(entry, target, openSubject);
    const ok = await confirmAsync(text, { okLabel, tone: 'primary', title: '작업 기록 되돌리기' });
    if (!ok) return;
    if (busy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.'); // 확인 창을 띄운 사이 시작된 생성
    // 되돌리는 쪽 밖에서도 써서 지금 그림으로 두는 그림 수를 끝 알림에 붙인다(applyHistoryEntry가 같은 규칙으로 고른다)
    const keptCount = target.mode === 'replace' ? historyImagePlan(target.lesson, entry, target.part).kept.length : 0;
    const done = `${restoredText}${historyKeptImagesNote(keptCount)}`;
    let mod;
    if (target.mode === 'replace') {
        await archiveContents([historyCurrentItem(target.lesson, target.part)], '되돌리기 전');
        if (busy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.'); // 기록을 남겨 저장하는 사이 시작된 생성(지금 내용은 기록에 남았다)
        mod = applyHistoryEntry(target.lesson, entry);
    } else {
        mod = lessonFromHistory(entry, renumberLessons([{}], courseData.map(lesson => lesson.id))[0].id); // 그 교과 차시와 겹치지 않는 숫자 id
        courseData = [...courseData, mod];
    }
    await saveState();
    if (typeof renderSidebar === 'function') renderSidebar();
    showRestoredHistory(mod, target.mode === 'replace' ? target.part : null);
    window.closeAppModal?.(); // 내용 보기 창이 열려 있으면 닫는다(내보내기 메뉴 같은 다른 화면은 건드리지 않는다)
    if (typeof refreshHistoryPanel === 'function' && !document.getElementById('history-panel')?.classList.contains('hidden')) refreshHistoryPanel();
    window.showToast?.(done, 'success');
}

// 되돌린 차시가 지금 연 차시(같은 객체)면 바뀐 곳을 보여 준다. 탭 하나 기록은 그 탭으로 옮겨 보여 준다
function showRestoredHistory(mod, part) {
    if (typeof getEditingModule !== 'function' || getEditingModule() !== mod) return;
    if (part && mod.tabContents && typeof switchLessonTab === 'function') switchLessonTab(part);
    else if (typeof renderEditor === 'function') renderEditor(mod);
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        stateSnapshot, backupMeta, planSubjectImport, mergeSubjects, describeSubjectImport, backupAgeLabel,
        historyEntry, historyRestoreTarget, lessonFromHistory, confirmAsync, subjectsBackupMeta,
        downloadSafetyBackup, recordBackupTime, renderBackupIndicator, moveSubjectToTrash, moveSubjectsToTrash, restoreSubject,
        liveSubjectTrash, restoreHistoryItem, importSubjectsBackup, mergeBackupExtras, closeLessonEditor,
        isSafeStateId, stateText, safeReferenceUrls, normalizeLessonId, assignLessonIds, renumberLessons, capHistory,
        mergeHistory, historyMergeNote, historyCapText,
        historyPart, historyPartName, referencedImages, historyImages, lessonOwnerId, freshHistoryIds, historySizeBytes, slimHistoryEntry, tidyStoredHistory,
        historyPartText, historyCurrentItem, applyHistoryEntry, historyRestoreMessage, historyRowLabels, showRestoredHistory,
        historyImagesFor, historyMatchesNow, isPictureData,
        historyImagePlan, historyOutsideImageKeys, historyKeptImagesNote, unreadCopyKeys,
        cleanTrashLesson, backupImageMode, setBackupImageMode, renderBackupImageMode, backupImageKey, detachBackupImages,
        attachBackupImages, backupImageFile, backupImageFromFile, writeBackupData, isBackupImageName, base64ByteLength,
        storedBackupImageMode, takeBackupImageMode, folderImageMode, clearBackupImagesDrop, switchBackupImagesToSeparate,
        isBackupTooBig, importStop, logImportFailure, backupFileName, withSeparateFallback, buildBackupZip, notifyBackupFallback, finishBackupDownload,
        safetyBackupOrAsk, countBackupImages, currentImageCount, noImagesImportNote,
        BACKUP_IMAGE_LABEL, BACKUP_NO_IMAGES_TAG, BACKUP_TOO_BIG_TEXT, BACKUP_FALLBACK_TEXT,
        isBackupImageRef, backupImageInfo, backupImageRefs, backupImageFileNames, folderImageModeOf, folderCopyName,
        folderOpenPrompt, folderOpenedMessage, folderSaveUnreadableText, backupImageFromKeyedFile,
        safeImageMap, safeTabContents, safeGyosuan, cleanLessonFields, cleanHistoryItem, isSafeImageKey, isSafeImageValue, validHistory, validTrash, cleanTrashEntry,
        safeImageMotions, historyMotionParts,
        trashTimeIso, withTrashTime, backupMarkdownBody, takeBackupMarkdown, relinkAttachedImages, applyBackupMarkdown,
        relinkLocalImages, attachedImageFile, attachmentImages, UNREAD_PARTIAL_BACKUP_TEXT, jsonTextParts, staleUnreadCopies,
        importTitleText, repairImageValue
    });
    if (typeof document !== 'undefined' && document.addEventListener) {
        // '빼기'는 메뉴를 연 채 바로 받는 백업 하나에만 쓴다. 메뉴 밖을 누르면 그 버튼이 일하기 전에(잡기 단계) 푼다(머리줄 백업 시각·교과 목록 ZIP 버튼)
        document.addEventListener('click', event => {
            if (!event.target?.closest?.('#export-dropdown-menu')) clearBackupImagesDrop();
        }, true);
        document.addEventListener('DOMContentLoaded', () => {
            renderBackupIndicator();
            renderBackupImageMode();
            setInterval(renderBackupIndicator, 60000);
        });
    }
}
