// data-safety.js - 작업을 잃지 않게: 확인 창(비동기), 복원되는 백업, 불러오기 전 자동 백업, 교과 휴지통, 히스토리 되돌리기, 마지막 백업 시각
// 계산만 하는 함수(교과 합치기 계획, 백업 나이, 되돌릴 곳)는 DOM 없이 돌고 tests/data-safety.test.js가 확인한다.

const BACKUP_FORMAT = 'teacher-backup';
const BACKUP_TIME_KEY = 'teacher:last-backup-at';
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

const trashKey = entry => `${entry.at}|${(entry.lesson || entry.subject || {}).id}`;

// 백업 파일의 히스토리·휴지통을 지금 것과 합친다(불러와도 기록을 잃지 않게)
// 휴지통 항목은 모양만 확인한다. 안의 교과·차시는 되살릴 때 sanitizeState를 거친다(restoreSubject, restoreLesson)
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const validTrash = (list, key) => (Array.isArray(list) ? list : []).filter(entry => isObject(entry) && isObject(entry[key]));
// 작업 기록 id는 남긴 시각(ms)이다. 0 이상의 안전한 정수이거나 숫자만 든 글자일 때만 받는다(화면은 Number(id)로 찾는다). 아니면 null
const historyIdOf = item => {
    const id = typeof item?.id === 'string' && /^\d{1,15}$/.test(item.id) ? Number(item.id) : item?.id;
    return Number.isSafeInteger(id) && id >= 0 ? id : null;
};
const validHistory = list => (Array.isArray(list) ? list : []).filter(item => isObject(item) && historyIdOf(item) !== null);

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
    const ids = new Set((current || []).map(subject => String(subject.id)));
    return {
        replaced: (incoming || []).filter(subject => ids.has(String(subject.id))),
        added: (incoming || []).filter(subject => !ids.has(String(subject.id)))
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

function describeSubjectImport(plan) {
    const lines = [
        ...plan.replaced.map(subject => `· ${subject.title} — 지금 교과를 파일 내용으로 바꿉니다(지금 내용은 교과 휴지통으로)`),
        ...plan.added.map(subject => `· ${subject.title} — 새로 추가합니다`)
    ];
    return `교과 ${plan.replaced.length + plan.added.length}개를 불러옵니다.\n${lines.join('\n')}\n\n다른 교과는 그대로 둡니다. 불러오기 전에 지금 상태를 백업 파일로 내려받습니다.`;
}

function backupAgeLabel(iso, now = Date.now()) {
    const at = Date.parse(iso || '');
    if (!Number.isFinite(at)) return { text: '백업 안 함', stale: true };
    const minutes = Math.max(0, Math.floor((now - at) / 60000));
    const days = Math.floor(minutes / 1440);
    const text = minutes < 1 ? '방금 백업'
        : minutes < 60 ? `${minutes}분 전 백업`
            : minutes < 1440 ? `${Math.floor(minutes / 60)}시간 전 백업`
                : `${days}일 전 백업`;
    return { text, stale: days >= BACKUP_STALE_DAYS };
}

// 히스토리 한 칸. 차시 id·탭 내용·이유를 함께 남겨 그 차시로 되돌릴 수 있게 한다
function historyEntry(mod, { id, date, reason, subjectId } = {}) {
    return {
        id,
        title: mod.title,
        content: mod.content,
        images: mod.images ? JSON.parse(JSON.stringify(mod.images)) : {},
        date,
        ...(mod.id != null ? { lessonId: mod.id } : {}),
        ...(subjectId != null ? { subjectId } : {}),
        ...(mod.tabContents ? { tabContents: { ...mod.tabContents } } : {}),
        ...(reason ? { reason } : {})
    };
}

// 되돌릴 곳: 탭 내용이 남은 기록이고 그 차시가 아직 있으면 그 차시, 아니면 새 차시로 되살린다
function historyRestoreTarget(entry, subjects) {
    if (entry.tabContents && entry.lessonId != null) {
        // 기록을 남긴 교과를 먼저 본다(복원한 교과 사본에 같은 차시 id가 있어도 엉뚱한 쪽을 고치지 않게)
        const ordered = [...(subjects || [])].sort((a, b) => Number(String(b.id) === String(entry.subjectId)) - Number(String(a.id) === String(entry.subjectId)));
        for (const subject of ordered) {
            const lesson = (subject.lessons || []).find(item => String(item.id) === String(entry.lessonId));
            if (lesson) return { mode: 'replace', subject, lesson };
        }
    }
    return { mode: 'new' };
}

// 예전 기록(탭 구분 없이 합친 글)은 기본학습 칸에 넣어 새 차시로 되살린다
function lessonFromHistory(entry, newId) {
    const tabs = entry.tabContents || { basicLearn: entry.content || '' };
    return {
        id: newId,
        title: `${entry.title || '되살린 교안'} (되살림)`,
        description: '',
        status: 'done',
        content: entry.content || '',
        images: { ...(entry.images || {}) },
        tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null, ...tabs },
        uploadedMdName: null,
        uploadedMdContent: null
    };
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

// 지금 작업 전체를 되살릴 수 있는 백업 파일을 내려받는다(불러오기·폴더 연결 직전)
/* ---------- 백업에 그림 담는 방식 (내보내기·백업 메뉴에서 고른다) ---------- */
// inline: save_data.yaml 안에 그대로(예전과 같음, 파일 하나로 끝)
// separate: '그림' 폴더의 파일로 떼고 같은 그림은 한 번만(작업 기록·휴지통의 사본까지 한 장으로). 가볍고 큰 과정도 된다
// none: 그림을 빼고 글만(가장 가벼움). 되살리면 그림 자리가 비고 일괄 이미지 찾기로 다시 채운다
const BACKUP_IMAGE_KEY = 'teacher:backup-images';
const BACKUP_IMAGE_MODES = ['inline', 'separate', 'none'];
const BACKUP_IMAGE_REF = 'teacher-image:';
const BACKUP_IMAGE_DIR = '그림';
const BACKUP_DATA_URL = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/;
const BACKUP_IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const BACKUP_IMAGE_MIN = 64; // 이보다 짧은 글은 그림으로 보지 않는다

function backupImageMode() {
    try {
        const mode = localStorage.getItem(BACKUP_IMAGE_KEY);
        return BACKUP_IMAGE_MODES.includes(mode) ? mode : 'inline';
    } catch (err) {
        return 'inline';
    }
}

function setBackupImageMode(mode) {
    if (!BACKUP_IMAGE_MODES.includes(mode)) return;
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

const isBackupImage = text => typeof text === 'string' && text.length >= BACKUP_IMAGE_MIN && BACKUP_DATA_URL.test(text);

// '그림/' 안에서 백업이 쓴 그림 파일만 고른다(backupImageKey 이름 + 그림 확장자). '그림'이라는 교과 폴더의 MD 등은 건너뛴다
const BACKUP_IMAGE_NAME = /^[0-9a-f]{17,24}\.(png|jpg|gif|webp|svg)$/;
const isBackupImageName = name => BACKUP_IMAGE_NAME.test(String(name));

// base64 글자 수로 그 파일의 바이트 수를 센다(디코딩하지 않고)
function base64ByteLength(base64) {
    const text = String(base64);
    const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
    return Math.floor(text.length * 3 / 4) - padding;
}

// 백업 내용에서 그림(data:image 글자 값)을 떼어 낸다. 글 속에 섞인 그림은 건드리지 않는다. 'none'이면 그 항목을 뺀다
function detachBackupImages(value, mode) {
    const files = {};
    const DROP = Symbol('drop');
    const walk = node => {
        if (isBackupImage(node)) {
            if (mode === 'none') return DROP;
            const key = backupImageKey(node);
            files[key] = node;
            return BACKUP_IMAGE_REF + key;
        }
        if (Array.isArray(node)) return node.map(walk).filter(item => item !== DROP);
        if (node && typeof node === 'object') {
            return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]).filter(([, item]) => item !== DROP));
        }
        return node;
    };
    return { value: walk(value), files };
}

// 떼어 둔 그림을 제자리에 돌려놓는다. 없는 그림은 빈 글로 둔다
function attachBackupImages(value, files) {
    const walk = node => {
        if (typeof node === 'string') return node.startsWith(BACKUP_IMAGE_REF) ? (files[node.slice(BACKUP_IMAGE_REF.length)] || '') : node;
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]));
        return node;
    };
    return walk(value);
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

// 백업 ZIP(또는 그 안의 폴더)에 save_data.yaml을 쓴다. 고른 방식에 따라 그림은 안에 두거나, '그림/' 파일로 떼거나, 뺀다
function writeBackupData(folder, meta, mode = backupImageMode()) {
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

async function downloadSafetyBackup(label) {
    const zip = new JSZip();
    const extra = { history: contentHistory, trash: { lessonTrash: globalState.lessonTrash || [], subjectTrash: globalState.subjectTrash || [] } };
    // 되살릴 때 쓸 안전 백업이므로 '빼기'를 골랐어도 그림은 따로 담는다
    const mode = backupImageMode() === 'none' ? 'separate' : backupImageMode();
    writeBackupData(zip, backupMeta('full', currentSnapshot(), new Date(), extra), mode);
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `교안백업_${backupStamp()}_${label}.zip`);
    recordBackupTime();
}

function readBackupTime() {
    try { return localStorage.getItem(BACKUP_TIME_KEY); } catch (err) { return null; }
}

function recordBackupTime() {
    try { localStorage.setItem(BACKUP_TIME_KEY, new Date().toISOString()); } catch (err) { console.warn('[백업] 시각을 저장하지 못했습니다:', err.message); }
    renderBackupIndicator();
}

function renderBackupIndicator() {
    const el = document.getElementById('last-backup-indicator');
    if (!el) return;
    const age = backupAgeLabel(readBackupTime());
    el.textContent = age.text;
    el.classList.toggle('text-amber-300', age.stale);
    el.classList.toggle('text-white/60', !age.stale);
    el.title = `${age.stale ? '오래 백업하지 않았습니다. ' : ''}작업은 이 브라우저에만 저장됩니다. 눌러서 ZIP으로 백업하세요(내보내기·백업 → 백업 ZIP으로 되살리기로 되살립니다).`;
}

/* ---------- 교과 휴지통 ---------- */
function liveSubjectTrash() {
    const live = typeof liveLessonTrash === 'function' ? liveLessonTrash(globalState.subjectTrash) : (globalState.subjectTrash || []);
    globalState.subjectTrash = live;
    return live;
}

const deepCopy = value => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

function moveSubjectToTrash(subject, reason = '') {
    if (!subject) return;
    const lessons = String(subject.id) === String(currentSubjectId) && Array.isArray(courseData) ? courseData : subject.lessons;
    const entry = { subject: deepCopy({ ...subject, lessons: lessons || [] }), at: new Date().toISOString(), ...(reason ? { reason } : {}) };
    globalState.subjectTrash = [entry, ...liveSubjectTrash()].slice(0, SUBJECT_TRASH_LIMIT);
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
    const incoming = (sanitizeState({ subjects: meta.context?.subjects || [] }) || { subjects: [] }).subjects;
    if (!incoming.length) return window.showAlert('이 파일에는 되살릴 교과가 없습니다.');
    const plan = planSubjectImport(globalState.subjects, incoming);
    const ok = await confirmAsync(describeSubjectImport(plan), { okLabel: '백업 받고 불러오기', tone: 'primary', title: '교과 불러오기' });
    if (!ok) return;
    const openReplaced = plan.replaced.some(subject => String(subject.id) === String(currentSubjectId));
    if (openReplaced) window.saveRawContent?.(); // 고치던 원문은 바뀌기 전 교과(휴지통으로 갈 쪽)에 먼저 넣는다
    await downloadSafetyBackup('불러오기전');
    plan.replaced.forEach(subject => moveSubjectToTrash(globalState.subjects.find(item => String(item.id) === String(subject.id)), '불러오기 전'));
    globalState.subjects = mergeSubjects(globalState.subjects, incoming);
    const open = globalState.subjects.find(subject => String(subject.id) === String(currentSubjectId));
    if (open) courseData = open.lessons || [];
    if (openReplaced) closeLessonEditor();
    await saveState();
    if (typeof renderOverviewLNB === 'function') renderOverviewLNB();
    if (typeof renderDiagram === 'function') renderDiagram();
    if (typeof renderSidebar === 'function') renderSidebar();
    location.hash = '#overview';
    window.showToast?.(`교과 ${incoming.length}개를 불러왔습니다.`, 'success');
}

// 지금 연 차시 편집기를 닫는다. 내용이 바뀐 뒤 남은 편집기(원문 칸 등)가 옛 글을 새 내용 위에 저장하지 않게
function closeLessonEditor() {
    currentEditingModuleId = null;
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
// 기록 한 칸이 차시 그림까지 담으므로 개수를 넘으면 가장 오래된 기록부터 지운다(백업·저장이 커지지 않게)
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
// 백업 파일은 고치지 않으므로 그 파일에 남는다. 폴더는 곧 이어지는 폴더 저장이 저장본(save_data.yaml)을 지금 기록으로 다시 쓰므로 거기서도 빠진다
function historyMergeNote({ droppedIncoming = 0, droppedCurrent = 0 } = {}, source = '파일') {
    const notTaken = source === '폴더'
        ? `폴더에 있던 기록 ${droppedIncoming}개는 넣지 않았고, 폴더의 저장본(save_data.yaml)에서도 빠집니다.`
        : `파일에 있던 기록 ${droppedIncoming}개는 넣지 않았습니다. 그 파일에는 그대로 남아 있습니다.`;
    const lost = [
        droppedIncoming ? notTaken : '',
        droppedCurrent ? `이 브라우저의 오래된 기록 ${droppedCurrent}개를 지웠습니다.` : ''
    ].filter(Boolean);
    return lost.length ? `\n\n작업 기록은 ${HISTORY_LIMIT}개까지만 둘 수 있어 이 브라우저의 기록을 먼저 남겼습니다. ${lost.join(' ')}` : '';
}

/* ---------- 작업 기록(히스토리) 되돌리기 ---------- */
async function restoreHistoryItem(id) {
    const entry = contentHistory.find(item => item.id === id);
    if (!entry) return window.showAlert('해당 작업 기록을 찾을 수 없습니다.');
    const target = historyRestoreTarget(entry, currentSnapshot().subjects);
    const openSubject = globalState.subjects.find(subject => String(subject.id) === String(currentSubjectId));
    const message = target.mode === 'replace'
        ? `'${target.lesson.title}' 차시를 이 기록(${entry.date})으로 되돌립니다.\n지금 내용은 작업 기록에 먼저 남겨 다시 되돌릴 수 있습니다.`
        : `이 기록(${entry.date})을 '${openSubject?.title || '지금 교과'}'에 새 차시로 되살립니다.${entry.tabContents ? '' : '\n예전 기록이라 탭 구분 없이 기본학습 칸에 들어갑니다.'}`;
    const ok = await confirmAsync(message, { okLabel: target.mode === 'replace' ? '되돌리기' : '새 차시로 되살리기', tone: 'primary', title: '작업 기록 되돌리기' });
    if (!ok) return;
    if (target.mode === 'replace') {
        await archiveContents([target.lesson], '되돌리기 전');
        target.lesson.tabContents = { ...entry.tabContents };
        target.lesson.content = entry.content || '';
        target.lesson.images = { ...(target.lesson.images || {}), ...(entry.images || {}) };
        target.lesson.status = 'done';
    } else {
        if (!currentSubjectId) return window.showAlert('되살릴 교과를 먼저 여세요(교과 편집기에서 다시 누르세요).');
        courseData = [...courseData, lessonFromHistory(entry, Date.now())];
    }
    await saveState();
    if (typeof renderSidebar === 'function') renderSidebar();
    const mod = target.mode === 'replace' ? target.lesson : courseData[courseData.length - 1];
    if (String(currentEditingModuleId) === String(mod.id)) renderEditor(mod);
    document.querySelector('.fixed .ph-book-open-text')?.closest('.fixed')?.remove(); // 내용 보기 창이 열려 있으면 닫는다
    if (typeof refreshHistoryPanel === 'function' && !document.getElementById('history-panel')?.classList.contains('hidden')) refreshHistoryPanel();
    window.showToast?.(target.mode === 'replace' ? `'${mod.title}'을(를) 되돌렸습니다.` : `'${mod.title}' 차시로 되살렸습니다.`, 'success');
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        stateSnapshot, backupMeta, planSubjectImport, mergeSubjects, describeSubjectImport, backupAgeLabel,
        historyEntry, historyRestoreTarget, lessonFromHistory, confirmAsync, subjectsBackupMeta,
        downloadSafetyBackup, recordBackupTime, renderBackupIndicator, moveSubjectToTrash, restoreSubject,
        liveSubjectTrash, restoreHistoryItem, importSubjectsBackup, mergeBackupExtras, closeLessonEditor,
        isSafeStateId, stateText, safeReferenceUrls, normalizeLessonId, assignLessonIds, renumberLessons, capHistory,
        mergeHistory, historyMergeNote, historyCapText,
        cleanTrashLesson, backupImageMode, setBackupImageMode, renderBackupImageMode, backupImageKey, detachBackupImages,
        attachBackupImages, backupImageFile, backupImageFromFile, writeBackupData, isBackupImageName, base64ByteLength
    });
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', () => {
            renderBackupIndicator();
            renderBackupImageMode();
            setInterval(renderBackupIndicator, 60000);
        });
    }
}
