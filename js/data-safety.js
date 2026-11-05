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

// save_data.yaml 내용. scope 'full'은 지금 작업 전체를 바꾸고, 'subjects'는 고른 교과만 합친다
function backupMeta(scope, context, now = new Date()) {
    return {
        format: BACKUP_FORMAT,
        scope,
        project: context.courseTitle || '',
        timestamp: now.toISOString(),
        subject_count: (context.subjects || []).length,
        context
    };
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
function historyEntry(mod, { id, date, reason } = {}) {
    return {
        id,
        title: mod.title,
        content: mod.content,
        images: mod.images ? JSON.parse(JSON.stringify(mod.images)) : {},
        date,
        ...(mod.id != null ? { lessonId: mod.id } : {}),
        ...(mod.tabContents ? { tabContents: { ...mod.tabContents } } : {}),
        ...(reason ? { reason } : {})
    };
}

// 되돌릴 곳: 탭 내용이 남은 기록이고 그 차시가 아직 있으면 그 차시, 아니면 새 차시로 되살린다
function historyRestoreTarget(entry, subjects) {
    if (entry.tabContents && entry.lessonId != null) {
        for (const subject of subjects || []) {
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
async function downloadSafetyBackup(label) {
    const zip = new JSZip();
    zip.file('save_data.yaml', JSON.stringify(backupMeta('full', currentSnapshot()), null, 2));
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
    el.title = `${age.stale ? '오래 백업하지 않았습니다. ' : ''}작업은 이 브라우저에만 저장됩니다. 눌러서 ZIP으로 백업하세요(데이터 연동 → zip 파일 불러오기로 되살립니다).`;
}

/* ---------- 교과 휴지통 ---------- */
function liveSubjectTrash() {
    const live = typeof liveLessonTrash === 'function' ? liveLessonTrash(globalState.subjectTrash) : (globalState.subjectTrash || []);
    globalState.subjectTrash = live;
    return live;
}

function moveSubjectToTrash(subject, reason = '') {
    if (!subject) return;
    const lessons = String(subject.id) === String(currentSubjectId) && Array.isArray(courseData) ? courseData : subject.lessons;
    const entry = { subject: { ...subject, lessons }, at: new Date().toISOString(), ...(reason ? { reason } : {}) };
    globalState.subjectTrash = [entry, ...liveSubjectTrash()].slice(0, SUBJECT_TRASH_LIMIT);
}

// 같은 id나 이름의 교과가 있으면 새 id와 '(복원)'을 붙여 나란히 둔다
function restoreSubject(index) {
    const entry = liveSubjectTrash()[index];
    if (!entry) return null;
    const clash = globalState.subjects.some(subject => String(subject.id) === String(entry.subject.id) || subject.title === entry.subject.title);
    const subject = clash ? { ...entry.subject, id: `subject_${Date.now()}`, title: `${entry.subject.title} (복원)` } : entry.subject;
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
    await downloadSafetyBackup('불러오기전');
    plan.replaced.forEach(subject => moveSubjectToTrash(globalState.subjects.find(item => String(item.id) === String(subject.id)), '불러오기 전'));
    globalState.subjects = mergeSubjects(globalState.subjects, incoming);
    const open = globalState.subjects.find(subject => String(subject.id) === String(currentSubjectId));
    if (open) courseData = open.lessons || [];
    await saveState();
    if (typeof renderOverviewLNB === 'function') renderOverviewLNB();
    if (typeof renderDiagram === 'function') renderDiagram();
    if (typeof renderSidebar === 'function') renderSidebar();
    location.hash = '#overview';
    window.showToast?.(`교과 ${incoming.length}개를 불러왔습니다.`, 'success');
}

/* ---------- 히스토리 되돌리기 ---------- */
async function restoreHistoryItem(id) {
    const entry = contentHistory.find(item => item.id === id);
    if (!entry) return window.showAlert('해당 히스토리 항목을 찾을 수 없습니다.');
    const target = historyRestoreTarget(entry, currentSnapshot().subjects);
    const openSubject = globalState.subjects.find(subject => String(subject.id) === String(currentSubjectId));
    const message = target.mode === 'replace'
        ? `'${target.lesson.title}' 차시를 이 기록(${entry.date})으로 되돌립니다.\n지금 내용은 히스토리에 먼저 남겨 다시 되돌릴 수 있습니다.`
        : `이 기록(${entry.date})을 '${openSubject?.title || '지금 교과'}'에 새 차시로 되살립니다.${entry.tabContents ? '' : '\n예전 기록이라 탭 구분 없이 기본학습 칸에 들어갑니다.'}`;
    const ok = await confirmAsync(message, { okLabel: target.mode === 'replace' ? '되돌리기' : '새 차시로 되살리기', tone: 'primary', title: '히스토리 되돌리기' });
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
        liveSubjectTrash, restoreHistoryItem, importSubjectsBackup
    });
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', () => {
            renderBackupIndicator();
            setInterval(renderBackupIndicator, 60000);
        });
    }
}
