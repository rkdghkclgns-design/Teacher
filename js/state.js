// State & Configuration

// ------------------------------------------------------------------------

// Config variables (apiKey, STORAGE_KEY, TEXT_MODEL, IMAGE_MODEL) moved to data.js

// --- 간단한 YAML 직렬화/역직렬화 유틸 (외부 라이브러리 불필요) ---

function simpleYamlStringify(obj, indent = 0) {
    const pad = '  '.repeat(indent);
    let result = '';
    for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) {
            result += `${pad}${key}: null\n`;
        } else if (typeof value === 'boolean' || typeof value === 'number') {
            result += `${pad}${key}: ${value}\n`;
        } else if (typeof value === 'string') {
            // 복잡한 문자열(개행, 특수문자 포함)은 JSON 이스케이프 문자열 사용
            if (value.includes('\n') || value.includes('"') || value.includes(':') || value.includes('#') || value.length > 200) {
                result += `${pad}${key}: ${JSON.stringify(value)}\n`;
            } else {
                result += `${pad}${key}: "${value}"\n`;
            }
        } else if (Array.isArray(value)) {
            // 배열은 JSON 인라인으로 직렬화 (교안 데이터의 복잡한 구조 지원)
            result += `${pad}${key}: ${JSON.stringify(value)}\n`;
        } else if (typeof value === 'object') {
            result += `${pad}${key}:\n`;
            result += simpleYamlStringify(value, indent + 1);
        }
    }
    return result;
}

function simpleYamlParse(yamlText) {
    // YAML 텍스트를 파싱하여 시리얼라이즈 시 JSON.stringify로 인라인 처리된 값들을 복원
    try {
        const result = {};
        const lines = yamlText.split('\n');
        const stack = [{ obj: result, indent: -1 }];

        for (const line of lines) {
            if (!line.trim() || line.trim().startsWith('#')) continue;

            const indentMatch = line.match(/^(\s*)/);
            const currentIndent = indentMatch ? indentMatch[1].length : 0;
            const trimmed = line.trim();

            const colonIdx = trimmed.indexOf(':');
            if (colonIdx === -1) continue;

            const key = trimmed.substring(0, colonIdx).trim();
            let valueStr = trimmed.substring(colonIdx + 1).trim();

            // 스택에서 현재 인덴트 레벨에 맞는 부모 탐색
            while (stack.length > 1 && stack[stack.length - 1].indent >= currentIndent) {
                stack.pop();
            }
            const parent = stack[stack.length - 1].obj;

            if (!valueStr) {
                // 하위 객체 시작
                parent[key] = {};
                stack.push({ obj: parent[key], indent: currentIndent });
            } else if (valueStr === 'null') {
                parent[key] = null;
            } else if (valueStr === 'true') {
                parent[key] = true;
            } else if (valueStr === 'false') {
                parent[key] = false;
            } else if (!isNaN(Number(valueStr)) && valueStr !== '') {
                parent[key] = Number(valueStr);
            } else if (valueStr.startsWith('[') || valueStr.startsWith('{') || valueStr.startsWith('"')) {
                // JSON 인라인 값 파싱
                try {
                    parent[key] = JSON.parse(valueStr);
                } catch (e) {
                    parent[key] = valueStr.replace(/^"|"$/g, '');
                }
            } else {
                parent[key] = valueStr;
            }
        }
        return result;
    } catch (e) {
        console.warn('YAML 파싱 실패, JSON 대체 시도:', e);
        return JSON.parse(yamlText); // JSON 포맷 폴백
    }
}



// --- Global State ---

let globalState = {

    courseId: "course_" + Date.now(),

    courseTitle: "새 과정",

    subjects: []

};



let courseData = [];

let currentTopic = '';

let contentHistory = [];

let currentEditingModuleId = null;

let aiCommandMode = 'edit';

let currentSubjectId = null;

// v5.9 포팅: 강사 어투 상태
let instructorTone = 'formal';
try { instructorTone = localStorage.getItem('kyoan_tone') || 'formal'; } catch (e) {}

// v5.9 포팅: 참고자료 사이드바 탭 상태
let currentSidebarTab = 'topic';

// --- 로컬 폴더 연결 상태 (File System Access API) ---
let projectFolderHandle = null; // FileSystemDirectoryHandle | null
// 저장된 작업을 읽지 못했으면 true. 그동안은 브라우저 저장소와 PC 폴더에 쓰지 않는다(restoreState가 정하고, 새로 시작·되살리기가 푼다)
let stateLoadFailed = false;
// 읽지 못한 저장본을 읽어 오기는 했으면 그 값(막는 창의 '읽지 못한 저장본 내려받기'). 읽지도 못했으면 undefined
let unreadRecord;



// --- Diagram Pan/Zoom State ---

let diagramScale = 1;

let diagramX = 100;

let diagramY = 100;

let isDraggingDiagram = false;

window.hasDragged = false;

let startDragX = 0;

let startDragY = 0;



// --- State Normalization (방어 로직) ---

// 고유 ID 생성 유틸리티 (crypto API 사용, 폴백: timestamp + random)
function generateUniqueId(prefix = '') {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return prefix + crypto.randomUUID().replace(/-/g, '').substring(0, 12);
    }
    return prefix + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// 불러온 상태를 믿지 않는다(백업 ZIP·폴더는 남이 준 파일일 수 있다). 검사 함수는 data-safety.js
// id는 안전한 글자·숫자만 남기고, 글 값은 문자열로 맞춘다. 화면에 넣을 때는 escapeHtml을 거친다
function sanitizeState(state) {
    if (!state || typeof state !== 'object') return null;
    delete state.apiKey; // 이전 버전 저장 파일에 남은 API 키는 불러오지 않음
    state.courseId = isSafeStateId(state.courseId) ? state.courseId : "course_" + Date.now();
    state.courseTitle = stateText(state.courseTitle) || "새 과정";
    if (state.courseField !== undefined) state.courseField = stateText(state.courseField);
    state.subjects = Array.isArray(state.subjects) ? state.subjects.filter(s => s && typeof s === 'object') : [];

    const subjectIds = new Set();
    state.subjects.forEach(s => {
        s.id = isSafeStateId(s.id) && !subjectIds.has(String(s.id)) ? s.id : generateUniqueId('subject_');
        subjectIds.add(String(s.id));
        s.title = stateText(s.title) || '제목 없음';
        s.description = stateText(s.description);
        s.namingConvention = stateText(s.namingConvention);
        s.referenceUrls = safeReferenceUrls(s.referenceUrls);
        s.referenceText = typeof s.referenceText === 'string' ? s.referenceText : '';
        s.autoSlide = typeof s.autoSlide === 'boolean' ? s.autoSlide : false;
        s.lessons = Array.isArray(s.lessons) ? s.lessons.filter(l => l && typeof l === 'object') : [];
        s.mainQuest = (s.mainQuest && typeof s.mainQuest === 'object') ? s.mainQuest : {
            id: 'mainQuest', title: '👑 최종 평가', description: '교과 전체를 종합한 최종 평가입니다.', status: 'waiting', content: null, images: {}
        };
        s.mainQuest.id = 'mainQuest';
        s.mainQuest.title = stateText(s.mainQuest.title) || '👑 최종 평가';
        s.mainQuest.description = stateText(s.mainQuest.description);
        cleanLessonFields(s.mainQuest); // 그림 키·값, 글, 탭 글, 목록, 교수안(data-safety.js)
    });
    // 차시 id는 화면 코드에 따옴표 없이 들어가므로 숫자로 맞춘다(바른 id는 그대로)
    const numbered = assignLessonIds(state.subjects.map(s => s.lessons));
    state.subjects.forEach((s, index) => {
        s.lessons = numbered[index];
        s.lessons.forEach(l => {
            l.title = stateText(l.title) || '차시';
            l.description = stateText(l.description);
            cleanLessonFields(l); // 그림 키·값, 글, 탭 글, 목록, 교수안(data-safety.js)
            l.tabContents = l.tabContents || {
                basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null
            };
        });
    });
    // 저장본·폴더 저장본에 든 휴지통도 모양과 지운 날짜를 맞춘다(백업 ZIP·폴더를 열 때는 mergeBackupExtras가 합친다)
    if (state.lessonTrash !== undefined) state.lessonTrash = validTrash(state.lessonTrash, 'lesson');
    if (state.subjectTrash !== undefined) state.subjectTrash = validTrash(state.subjectTrash, 'subject');
    return state;
}

function getEditingModule(id = currentEditingModuleId) {
    if (id === 'mainQuest') {
        const subj = globalState.subjects.find(s => s.id === currentSubjectId);
        return subj ? subj.mainQuest : null;
    }
    return courseData.find(m => String(m.id) === String(id));
}

// =========================================================================
// Phase F8: IndexedDB 기반 로컬 스토리지 매니저 (웹 스토리지 용량 돌파)
// =========================================================================
const DBManager = {
    dbName: 'CourseAgentDB',
    dbVersion: 2, // 버전업 (새로운 store 추가)
    storeName: 'appData',
    cacheStoreName: 'image_cache', // [Phase F10] 캐시 전용 스토어 추가
    dbInstance: null,

    async init() {
        return new Promise((resolve, reject) => {
            if (this.dbInstance) {
                resolve(this.dbInstance);
                return;
            }
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
                // [Phase F10] 이미지 캐시 스토어 생성
                if (!db.objectStoreNames.contains(this.cacheStoreName)) {
                    // 키워드를 키값으로 사용
                    db.createObjectStore(this.cacheStoreName, { keyPath: 'keyword' });
                }
            };
            request.onsuccess = (e) => {
                this.dbInstance = e.target.result;
                resolve(this.dbInstance);
            };
            request.onerror = (e) => {
                console.error("IndexedDB 초기화 실패:", e);
                reject(e);
            };
        });
    },

    writing: 0, // 끝나지 않은 쓰기 수. 창을 닫기 전에 묻는다(isSavePending)

    // 기록이 끝까지 들어간 뒤(transaction complete)에 끝난 것으로 본다. 요청이 성공해도 기록 단계에서 취소될 수 있다(저장 공간이 모자라면 QuotaExceededError).
    // 그래서 saveState가 '브라우저에 저장했다'고 돌려주는 값을 믿을 수 있다
    async setItem(key, value) {
        this.writing += 1; // 부른 즉시 센다(창을 닫기 직전에 시작한 저장도 센다)
        try {
            const db = await this.init();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onabort = () => reject(tx.error || new Error('IndexedDB 저장이 취소되었습니다'));
                tx.objectStore(this.storeName).put(value, key);
            });
        } finally {
            this.writing -= 1;
        }
    },

    async getItem(key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e);
        });
    },

    async deleteItem(key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error || new Error('IndexedDB 지우기가 취소되었습니다'));
            tx.objectStore(this.storeName).delete(key);
        });
    },

    // 저장소에 든 이름 목록(따로 옮겨 둔 읽지 못한 저장본 사본을 셀 때 쓴다)
    async keys() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const request = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAllKeys();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    // --- [Phase F10] 이미지 캐시 관리 API ---
    async setCache(keyword, base64Data, sourceUrl, formatLabel) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.cacheStoreName, 'readwrite');
            const store = tx.objectStore(this.cacheStoreName);
            const payload = {
                keyword: keyword,        // PK
                base64: base64Data,      // 이미지
                source: sourceUrl,       // 출처 URL (안내용)
                format: formatLabel,     // 라벨 ("웹 검색 연동" 등)
                timestamp: Date.now()
            };
            const request = store.put(payload);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    },

    async getCache(keyword) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.cacheStoreName, 'readonly');
            const store = tx.objectStore(this.cacheStoreName);
            const request = store.get(keyword);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e);
        });
    },

    async getAllCaches() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.cacheStoreName, 'readonly');
            const store = tx.objectStore(this.cacheStoreName);
            const request = store.getAll();
            request.onsuccess = (e) => resolve(e.target.result.sort((a, b) => b.timestamp - a.timestamp));
            request.onerror = (e) => reject(e);
        });
    },

    async deleteCache(keyword) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.cacheStoreName, 'readwrite');
            const store = tx.objectStore(this.cacheStoreName);
            const request = store.delete(keyword);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    },

    async clearAllCaches() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.cacheStoreName, 'readwrite');
            const store = tx.objectStore(this.cacheStoreName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    }
};

// Data Management Layer

/* ---------- 다른 탭 변경 알림 ---------- */
// 저장은 과정 전체를 덮어쓰므로, 다른 탭의 변경을 모른 채 저장하면 그쪽 작업이 사라진다
const STATE_WARN_INTERVAL_MS = 60000;
const _stateTabs = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('teacher-state');
let _stateWarnedAt = 0;

if (_stateTabs) {
    _stateTabs.onmessage = () => {
        if (Date.now() - _stateWarnedAt < STATE_WARN_INTERVAL_MS) return;
        _stateWarnedAt = Date.now();
        window.showToast?.('다른 탭에서 과정이 바뀌었습니다. 여기서 저장하면 그 변경을 덮어쓰니 새로고침해 주세요.', 'warning');
    };
}

/* ---------- 저장 미루기와 PC 폴더 저장 줄 세우기 (DOM 없이 돈다. tests/folder-sync.test.js) ---------- */
// 짧은 사이에 여러 번 부르면 마지막 부름에서 delay가 지난 뒤 한 번만 한다. flush는 기다리던 일을 바로 하고 그 결과(없으면 null)를, cancel은 버린다.
// timers 기본값은 감싼 함수다(브라우저에서 { setTimeout }.setTimeout(…)처럼 부르면 Illegal invocation)
function createDebouncedTask(task, delay, timers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) }) {
    let timer = null;
    const cancel = () => {
        if (timer === null) return;
        timers.clear(timer);
        timer = null;
    };
    return {
        schedule() {
            cancel();
            timer = timers.set(() => {
                timer = null;
                task();
            }, delay);
        },
        flush() {
            if (timer === null) return null;
            cancel();
            return task();
        },
        cancel,
        pending: () => timer !== null
    };
}

// 한 번에 하나만 돌린다. 아직 시작하지 않은 요청이 있으면 거기에 합치고(기다리는 일은 하나), 그 일은 시작할 때의 최신 상태로 돈다.
// 앞 일이 끝나야(실패해도) 다음 일이 시작한다. idle은 지금까지 들어온 일이 모두 끝나면 풀린다
function createSerialRunner(task) {
    let tail = Promise.resolve();
    let waiting = null;
    const request = () => {
        if (waiting) return waiting;
        const run = tail.then(() => {
            waiting = null;
            return task();
        });
        waiting = run;
        tail = run.then(() => undefined, () => undefined);
        return run;
    };
    return { request, idle: () => tail };
}

// 참고자료 칸처럼 글자마다 바뀌는 칸은 입력이 1초 멈춘 뒤 한 번 저장한다(글자마다 과정 전체와 PC 폴더를 다시 쓰지 않게).
// 칸을 벗어나거나 창이 가려지거나 닫히면 바로 저장한다. 다른 까닭으로 saveState가 돌면 미뤄 둔 저장은 버린다(그 저장이 대신한다)
const SAVE_SOON_DELAY_MS = 1000;
const saveSoonTask = createDebouncedTask(() => saveState(), SAVE_SOON_DELAY_MS);

function saveStateSoon() {
    saveSoonTask.schedule();
}

// 미뤄 둔 저장이 있으면 지금 한다. 그 저장의 약속, 없으면 null
function flushSaveStateSoon() {
    return saveSoonTask.flush();
}

function cancelSaveStateSoon() {
    saveSoonTask.cancel();
}

window.saveStateSoon = saveStateSoon;
window.flushSaveStateSoon = flushSaveStateSoon;
window.cancelSaveStateSoon = cancelSaveStateSoon;

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushSaveStateSoon();
    });
}
if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', () => flushSaveStateSoon());

// 마지막 브라우저 저장(IndexedDB)이 실패했는지. 그동안 바뀐 내용은 화면(메모리)과 이어진 PC 폴더에만 있다.
// 창을 닫기 전에 묻고(isSavePending), 폴더 저장본에 '브라우저가 뒤처짐'을 적어 새로고침 뒤 옛 브라우저 저장본이 폴더를 덮지 않게 한다(rememberFolderSaveStamp)
let lastBrowserSaveFailed = false;

// 크롬은 IndexedDB 값 하나를 127MiB까지만 받는다. 작업 전체를 값 하나로 저장하므로 그림이 아주 많으면(큰 교안 HTML을 불러온 교과 등) 저장하지 못한다.
// 그만큼 클 수 있는 작업은 JSON 파일(Blob)로 저장한다. Blob은 그 한도에 세지 않고 따로 저장된다. 읽는 쪽은 둘 다 읽는다(readStoredState)
const STATE_BLOB_MIN_BYTES = 100 * 1024 * 1024;

// 값 하나로 저장할 때의 크기 어림(바이트). 그림 글(data:)은 한 글자 1바이트, 다른 글은 2바이트로 넉넉히 센다. 같은 객체는 한 번만 센다(값 저장도 한 번만 쓴다)
function storedSizeEstimate(value) {
    let bytes = 0;
    const seen = new WeakSet();
    const stack = [value];
    while (stack.length) {
        const node = stack.pop();
        if (typeof node === 'string') {
            bytes += node.startsWith('data:') ? node.length : node.length * 2;
        } else if (node && typeof node === 'object') {
            if (seen.has(node)) continue;
            seen.add(node);
            for (const key of Object.keys(node)) {
                bytes += key.length * 2 + 4;
                stack.push(node[key]);
            }
        } else {
            bytes += 9;
        }
    }
    return bytes;
}

// 작업 전체를 JSON 파일 하나로. 조각으로 만들어(data-safety.js jsonTextParts) 글 길이 한도에 걸리지 않게 한다
const stateJsonBlob = stateData => new Blob(jsonTextParts(stateData), { type: 'application/json' });
// 브라우저가 값이 너무 크다고 거절했는지(크롬: The serialized keys and/or value are too large)
const isValueTooLarge = err => /too large/i.test(String(err?.message || ''));
// 한 번 거절되면 이 창에서는 처음부터 JSON 파일로 쓴다(값으로 바꾸다 거절되는 데 드는 시간을 저장마다 다시 쓰지 않게)
let browserStateAsFile = false;

// 작업 전체를 브라우저 저장소에 쓴다. 클 수 있으면 JSON 파일로, 아니면 값 그대로(예전과 같다). 값이 너무 크다고 거절되면 JSON 파일로 다시 쓴다.
// blobMin: JSON 파일로 쓸 어림 크기(테스트가 바꾼다)
async function writeBrowserState(stateData, { blobMin = STATE_BLOB_MIN_BYTES } = {}) {
    if (browserStateAsFile || storedSizeEstimate(stateData) > blobMin) return DBManager.setItem(STORAGE_KEY, stateJsonBlob(stateData));
    try {
        return await DBManager.setItem(STORAGE_KEY, stateData);
    } catch (err) {
        if (!isValueTooLarge(err)) throw err;
        console.warn('[저장] 작업이 커서 브라우저가 값으로 받지 않아 JSON 파일로 저장합니다:', err.message);
        browserStateAsFile = true;
        return DBManager.setItem(STORAGE_KEY, stateJsonBlob(stateData));
    }
}

// 브라우저 저장소(IndexedDB)에 쓴다. 끝까지 썼으면 true, 실패하면 알린 뒤 false(읽지 못한 동안은 쓰지 않고 false). 던지지 않는다.
// PC 폴더 저장은 기다리지 않는다(실패는 띠로 알린다)
// folder: false면 이어진 PC 폴더에는 쓰지 않는다(백업 ZIP 되살리기는 브라우저에 저장한 뒤에야 폴더에 쓴다. 저장하지 못해 되돌린 상태가 폴더에 남지 않게)
async function saveState({ folder = true } = {}) {
    // 저장된 작업을 읽지 못한 동안은 저장하지 않는다(읽지 못한 저장본과 PC 폴더를 빈 화면으로 덮지 않게)
    if (stateLoadFailed) {
        showStateLoadFailedDialog();
        return false;
    }
    window.cancelSaveStateSoon?.(); // 이 저장이 미뤄 둔 저장(참고자료 칸)을 대신한다
    let savedInBrowser = false;
    try {
        if (currentSubjectId) {
            const subject = globalState.subjects.find(s => s.id === currentSubjectId);
            if (subject) {
                subject.lessons = Array.isArray(courseData) ? courseData : [];
            }
        }

        // 1. IndexedDB에 저장한다. 아주 큰 작업은 JSON 파일로(writeBrowserState)
        const stateData = { state: globalState, history: contentHistory };
        await writeBrowserState(stateData);
        savedInBrowser = true;
        _stateTabs?.postMessage('saved');

    } catch (e) {
        console.error("IndexedDB 저장 실패", e);
        window.showAlert('데이터베이스 저장 중 오류가 발생했습니다. 브라우저 저장소 설정을 확인하세요.');
    }
    lastBrowserSaveFailed = !savedInBrowser;

    // 연결된 로컬 폴더 비동기 동기화 (UI 블로킹 방지)
    if (folder && projectFolderHandle) {
        syncToLinkedFolder().catch(e => console.warn('폴더 동기화 경고:', e.message));
    }
    return savedInBrowser; // 브라우저(IndexedDB)에 저장했는지. 폴더 열기는 저장했을 때만 새로고침 뒤 이어 쓸 폴더를 기억한다
}

// 끝나지 않은 브라우저 저장이 있거나, 입력이 멈추기를 기다리는 저장(saveSoonTask)이 있거나, 마지막 브라우저 저장이 실패했으면 true
// (그때 바뀐 내용은 아직 브라우저에 없다). 창을 닫기 전에 묻는다(ui.js warnBeforeUnload).
// PC 폴더 쓰기는 세지 않는다(임시 파일에 쓰고 닫을 때 바꾸므로 끊겨도 폴더의 이전 저장본은 그대로이고, 다음 저장이 따라잡는다)
function isSavePending() {
    return DBManager.writing > 0 || (typeof saveSoonTask !== 'undefined' && !!saveSoonTask.pending?.()) || lastBrowserSaveFailed;
}

function isStateLoadFailed() {
    return stateLoadFailed;
}

const isStoredBlob = value => typeof Blob !== 'undefined' && value instanceof Blob;

// 저장본 값 → 작업 객체. JSON 파일(Blob)로 저장한 큰 작업(writeBrowserState)은 그림 글을 떼어 둔 조각 읽기로 푼다(import-stream.js. 파일 전체를 글 하나로 만들지 않는다).
// 그렇게 풀지 못하면(너무 큰 그림 등) 파일을 글 하나로 읽어 푼다. 그래도 못 풀면 그 파일을 오류의 record에 담아 던진다(막는 창에서 내려받는다). 파일이 아니면 그대로
async function storedRecordData(record) {
    if (!isStoredBlob(record)) return record;
    try {
        let read = null;
        if (typeof readFileSkeleton === 'function') {
            try {
                read = await readFileSkeleton(record);
            } catch (err) {
                console.warn('[저장된 작업] 조각으로 읽지 못해 파일 전체로 읽습니다:', err.message);
            }
        }
        if (read && !read.oversized) return JSON.parse(read.text, (key, value) => (read.hasToken(value) ? read.restore(read.dataOf(value)) : value));
        return JSON.parse(await record.text());
    } catch (err) {
        throw Object.assign(new Error(`저장본 파일을 풀지 못했습니다: ${err.message}`), { record });
    }
}

// IndexedDB를 먼저 읽고, 비어 있으면 예전 localStorage 저장본을 옮긴다. 읽지 못하면 던진다(아무것도 지우지 않는다).
// fromDb: IndexedDB에서 읽었는지(그때만 남은 예전 저장본을 지운다). 예전 저장본을 풀지 못하면 그 글을 오류의 record에 담아 던진다(막는 창에서 내려받는다)
async function readStoredState() {
    const data = await DBManager.getItem(STORAGE_KEY);
    if (data != null) return { data: await storedRecordData(data), fromDb: true };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { data: null, fromDb: false };
    let legacy;
    try {
        legacy = JSON.parse(raw); // 못 풀면 예전 저장본은 그대로 남는다
    } catch (err) {
        throw Object.assign(new Error(`예전 저장본을 풀지 못했습니다: ${err.message}`), { record: raw });
    }
    try {
        await DBManager.setItem(STORAGE_KEY, legacy);
        localStorage.removeItem(STORAGE_KEY); // 옮긴 뒤에만 지운다
    } catch (err) {
        console.warn('[저장된 작업] 예전 저장본을 옮기지 못해 그대로 둡니다:', err);
    }
    return { data: legacy, fromDb: false };
}

// 시작할 때 저장된 작업을 연다. 'ok' 읽음 | 'empty' 처음 쓰는 브라우저(예시 과정을 넣는다) | 'failed' 읽지 못함(아무것도 덮어쓰지 않는다)
async function restoreState() {
    let stored;
    try {
        stored = await readStoredState();
    } catch (e) {
        return markStateUnread(e, e?.record);
    }
    const data = stored.data;
    if (data == null) {
        await loadMockData();
        return 'empty';
    }
    // 모양이 틀리면(망가졌거나 남이 쓴 값) 덮어쓰지 않고 멈춘다
    let state = null;
    try {
        if (isObject(data) && isObject(data.state)) state = sanitizeState(data.state);
    } catch (e) {
        return markStateUnread(e, data);
    }
    if (!state) return markStateUnread(new Error('저장된 작업의 모양이 맞지 않습니다'), data);
    globalState = state;
    // 저장해 둔 작업 기록을 정리해서 연다(data-safety.js tidyStoredHistory). 정리하다 실패해도 예전처럼 저장된 그대로 연다(예시로 덮어쓰지 않게)
    try {
        contentHistory = tidyStoredHistory(data.history);
    } catch (err) {
        console.warn('[작업 기록] 정리하지 못해 저장된 그대로 엽니다:', err);
        contentHistory = Array.isArray(data.history) ? data.history : [];
    }
    // IndexedDB에서 읽었으면 이미 옮겨 둔 예전 localStorage 저장본을 지운다(지우지 못해도 괜찮다)
    if (stored.fromDb) {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (err) {
            console.warn('[저장된 작업] 예전 저장본을 지우지 못했습니다:', err);
        }
    }
    return 'ok';
}

// 읽지 못했을 때: 저장본은 그대로 두고 빈 상태로 연다. 고를 때까지 저장을 멈춘다(index.html이 막는 창을 연다).
// record: 읽어 온 저장본(막는 창에서 내려받는다). 읽지도 못했으면 undefined
function markStateUnread(err, record) {
    console.error('[저장된 작업] 읽지 못해 저장을 멈춥니다. 저장본은 그대로 둡니다:', err);
    stateLoadFailed = true;
    unreadRecord = record;
    globalState = sanitizeState({ subjects: [] });
    contentHistory = [];
    return 'failed';
}

/* ---------- 읽지 못한 저장본: 따로 옮겨 두기, 내려받기, 막는 창, 새로 시작, 되살리기 실패 때 되돌리기 ---------- */
const UNREAD_COPY_LIMIT = 3; // 따로 옮겨 둔 사본은 새것부터 이만큼만 남긴다(큰 저장본이 브라우저 저장 공간을 다 쓰지 않게)
const unreadCopyPrefix = () => `${STORAGE_KEY}:읽지못함:`;
// 이 창에서 읽지 못한 저장본을 따로 옮겨 둔 이름(없으면 ''). 읽지 못한 동안 그 저장본은 바뀌지 않으므로 한 번만 옮긴다
// (되살리기를 다시 해도 같은 사본이 늘어 저장 공간을 차지하거나, 새것 셋 규칙에 다른 날 옮겨 둔 사본이 밀려나지 않게)
let unreadCopyKey = '';

// 읽지 못한 저장본 그대로(따로 옮겨 두기·내려받기). IndexedDB에 없으면 예전 localStorage 저장본(글자). 없으면 undefined
async function readUnreadRecord() {
    const record = await DBManager.getItem(STORAGE_KEY);
    if (record != null) return record;
    const legacy = localStorage.getItem(STORAGE_KEY);
    return legacy == null ? undefined : legacy;
}

// 저장본을 지금 다시 읽어 시작할 때와 같은 검사(restoreState)로 본다. 아무것도 쓰거나 지우지 않는다.
// 'loads' 이제 열 수 있다 | 'unread' 있지만 열 수 없다 | 'none' 없다 | 'error' 저장소를 읽지 못했다
async function storedRecordStatus() {
    let record;
    try {
        record = await readUnreadRecord();
    } catch (err) {
        console.warn('[저장된 작업] 저장본을 다시 읽지 못했습니다:', err);
        return 'error';
    }
    if (record === undefined) return 'none';
    try {
        const data = typeof record === 'string' ? JSON.parse(record) : await storedRecordData(record);
        return isObject(data) && isObject(data.state) && sanitizeState(data.state) ? 'loads' : 'unread';
    } catch (err) {
        return 'unread';
    }
}

// 읽지 못한 저장본을 바꾸기 직전(새로 시작·백업 ZIP·PC 폴더로 되살리기)에 부른다.
// 그 저장본을 같은 브라우저 저장소의 다른 이름(<STORAGE_KEY>:읽지못함:<시각>)으로 한 벌 옮겨 두고(읽는 코드를 고치면 되살릴 수 있게. 이 창에서는 한 번만),
// 예전 PC 폴더 연결을 잊는다(새 작업이 그 폴더의 마지막 저장본을 덮지 않게. 폴더 파일은 그대로). 옮기지 못해도 멈추지 않는다.
// prune: 오래된 사본을 바로 정리할지(새것 셋만 남긴다). 되돌릴 수 있는 백업 ZIP 되살리기는 브라우저에 저장한 뒤에 정리한다(되돌린 되살리기가 다른 사본을 밀어내지 않게)
async function setAsideUnreadState({ prune = true } = {}) {
    if (!unreadCopyKey) {
        try {
            const record = await readUnreadRecord();
            if (record !== undefined) {
                const key = `${unreadCopyPrefix()}${Date.now()}`;
                await DBManager.setItem(key, record);
                unreadCopyKey = key;
            }
        } catch (err) {
            console.warn('[저장된 작업] 읽지 못한 저장본을 따로 옮겨 두지 못했습니다:', err);
        }
    }
    if (prune) await pruneUnreadCopies();
    if (projectFolderHandle) updateFolderConnectionUI(false);
    projectFolderHandle = null;
    folderWriteCache = null;
    try {
        await DBManager.deleteItem('projectFolderHandle');
    } catch (err) {
        console.warn('[저장된 작업] 예전 폴더 연결을 지우지 못했습니다:', err);
    }
}

// 따로 옮겨 둔 사본 가운데 새것 UNREAD_COPY_LIMIT개만 남긴다(data-safety.js staleUnreadCopies). 이 창에서 옮겨 둔 사본은 지우지 않는다(시계가 뒤로 갔어도).
// 이 창에서 새 사본을 남겼을 때만 지운다(옮기지 못했으면 앞 사본이 가장 새것이다). 지우지 못해도 멈추지 않는다
async function pruneUnreadCopies() {
    if (!unreadCopyKey) return;
    try {
        const stale = staleUnreadCopies(await DBManager.keys(), unreadCopyPrefix(), UNREAD_COPY_LIMIT).filter(key => key !== unreadCopyKey);
        for (const key of stale) await DBManager.deleteItem(key);
    } catch (err) {
        console.warn('[저장된 작업] 오래된 사본을 정리하지 못했습니다:', err);
    }
}

// 되살리기를 브라우저에 저장하지 못해 읽지 못한 상태로 돌아갈 때 부른다. 저장본이 제자리에 열 수 없는 그대로 있을 때만 이 창에서 옮겨 둔 사본을 지운다
// (같은 저장본이 두 벌로 저장 공간을 차지한 채 남지 않게. 다시 되살리면 그때 새로 옮긴다). 확인하지 못하거나 지우지 못하면 사본을 그대로 둔다
async function dropUnreadCopy() {
    if (!unreadCopyKey || await storedRecordStatus() !== 'unread') return;
    try {
        await DBManager.deleteItem(unreadCopyKey);
        unreadCopyKey = '';
    } catch (err) {
        console.warn('[저장된 작업] 따로 옮겨 둔 사본을 지우지 못했습니다:', err);
    }
}

// 읽지 못한 상태를 끝낸다(새 상태로 바꾸는 순간). 다시 저장하고 막는 창을 닫는다(뒤 화면도 다시 쓸 수 있게)
function markStateLoaded() {
    stateLoadFailed = false;
    unreadRecord = undefined;
    document.getElementById('state-load-dialog')?.remove();
    releaseStateLoadBackdrop();
}

// 되살린 뒤 개요를 새 상태로 그린다. 이미 개요면 주소가 바뀌지 않아 다시 그려지지 않으므로 직접 그린다
function showOverviewAfterRestore() {
    if (location.hash !== '#overview') location.hash = '#overview';
    else if (typeof renderOverview === 'function') renderOverview();
}

// 되살려 브라우저에 저장한 뒤 목록과 개요를 다시 그린다. 그리다 실패해도(남이 준 파일에 화면이 쓰지 못하는 값이 있을 때) 되살린 작업은 이미 저장됐으므로
// 멈추지 않고 콘솔에만 남긴다(되살리지 못했다고 잘못 알리지 않게)
function redrawAfterRestore() {
    try {
        if (typeof renderSidebar === 'function') renderSidebar();
        showOverviewAfterRestore();
    } catch (err) {
        console.error('[되살리기] 화면을 다시 그리지 못했습니다:', err);
    }
}

// 막는 창의 글. folder: 이 브라우저가 폴더 열기를 지원하는지, download: 읽어 온 저장본이 있어 내려받을 수 있는지
function stateLoadFailedText({ folder = true, download = false } = {}) {
    return [
        '이 브라우저에 저장해 둔 작업을 읽지 못했습니다. 저장본은 지우지 않고 그대로 두었습니다.',
        '덮어쓰지 않도록 지금은 아무것도 저장하지 않습니다.',
        '',
        '· 다시 읽기: 새로고침해서 한 번 더 읽습니다. 잠깐 생긴 문제라면 이것으로 됩니다.',
        '  브라우저 설정에서 이 사이트의 쿠키·사이트 데이터를 막았다면 먼저 허용해 주세요.',
        folder ? '· 과정 전체 백업 ZIP이나 저장해 둔 PC 폴더가 있으면 그것으로 되살릴 수 있습니다.' : '· 과정 전체 백업 ZIP이 있으면 그것으로 되살릴 수 있습니다.',
        download ? '· 읽지 못한 저장본 내려받기: 읽지 못한 저장본을 고치지 않은 그대로 파일로 받아 둡니다. 이 앱의 백업 ZIP처럼 바로 되살리지는 못합니다.' : null,
        '· 새로 시작: 읽지 못한 저장본 대신 예시 과정으로 처음부터 시작합니다.',
        "  되살리거나 새로 시작하면 읽지 못한 저장본은 이 브라우저에 사본으로 남겨 두어, 나중에 '내보내기·백업' 메뉴에서 파일로 받을 수 있습니다."
    ].filter(line => line !== null).join('\n');
}

// 막는 창이 떠 있는 동안 뒤 화면은 누르거나 키보드로 닿지 못하게 한다(inert).
// 창 위에 뜨는 알림·확인 창·토스트(ui.js의 data-app-dialog, data-app-toast)는 막지 않는다(되살리지 못해 이 창을 다시 열 때 먼저 뜬 알림도 닫을 수 있게)
let stateLoadInert = [];

function holdStateLoadBackdrop(overlay) {
    stateLoadInert = [...document.body.children].filter(el => el !== overlay && !el.inert && !el.matches?.('[data-app-dialog], [data-app-toast]'));
    stateLoadInert.forEach(el => { el.inert = true; });
}

// 이 창이 막은 것만 푼다(원래 inert였던 것은 그대로)
function releaseStateLoadBackdrop() {
    stateLoadInert.forEach(el => { el.inert = false; });
    stateLoadInert = [];
}

// 저장된 작업을 읽지 못했을 때 여는 창. 다른 화면을 덮고(그동안 저장하지 않는다) 다시 읽기·되살리기·내려받기·새로 시작 가운데 고르게 한다.
// 닫기 버튼과 Esc는 일부러 없다(고르기 전에는 아무것도 저장되지 않는다)
function showStateLoadFailedDialog() {
    if (document.getElementById('state-load-dialog')) return;
    window.closeTutorialDialog?.();
    const folder = 'showDirectoryPicker' in window;
    const download = unreadRecord !== undefined;
    const overlay = document.createElement('div');
    overlay.id = 'state-load-dialog';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'state-load-title');
    overlay.setAttribute('aria-describedby', 'state-load-text');
    overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[9500] animate-fade-in';
    const button = (action, label, tone) => `<button type="button" data-state-load="${action}" class="w-full px-4 py-2.5 text-sm font-bold rounded-xl transition-colors ${tone}">${escapeHtml(label)}</button>`;
    const plain = 'text-white bg-white/10 hover:bg-white/20';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[440px] max-w-[92vw] max-h-[92vh] overflow-y-auto p-6 shadow-2xl flex flex-col gap-4">
            <div class="flex items-center gap-3">
                <i class="ph-fill ph-warning-circle text-2xl text-amber-400" aria-hidden="true"></i>
                <h3 id="state-load-title" class="font-bold text-white text-sm">${escapeHtml('저장된 작업을 읽지 못했습니다')}</h3>
            </div>
            <p id="state-load-text" class="text-sm text-textMuted leading-relaxed whitespace-pre-wrap break-keep">${escapeHtml(stateLoadFailedText({ folder, download }))}</p>
            <div class="flex flex-col gap-2">
                ${button('reload', '다시 읽기', 'text-white bg-accent hover:bg-accentHover')}
                ${button('zip', '백업 ZIP으로 되살리기', plain)}
                ${folder ? button('folder', '저장해 둔 폴더 열기', plain) : ''}
                ${download ? button('download', '읽지 못한 저장본 내려받기', plain) : ''}
                ${button('fresh', '새로 시작', 'text-rose-300 bg-white/5 hover:bg-white/10')}
            </div>
            <input type="file" accept=".zip" class="hidden" data-state-load-file>
        </div>`;
    overlay.addEventListener('click', onStateLoadDialogClick);
    // 머리줄의 파일 고르기 칸은 막힌(inert) 뒤 화면에 있으므로 이 창 안의 칸으로 고른다
    overlay.querySelector('[data-state-load-file]')?.addEventListener('change', event => window.importProjectZip(event));
    document.body.appendChild(overlay);
    holdStateLoadBackdrop(overlay);
    overlay.querySelector('[data-state-load="reload"]')?.focus();
}

function onStateLoadDialogClick(event) {
    const action = event.target.closest?.('[data-state-load]')?.dataset.stateLoad;
    if (action === 'reload') location.reload();
    else if (action === 'zip') event.currentTarget.querySelector('[data-state-load-file]')?.click();
    else if (action === 'folder') window.loadFromProjectFolder();
    else if (action === 'download') downloadUnreadRecord();
    else if (action === 'fresh') startFreshAfterUnreadState();
}

// 저장본 값을 고치지 않은 그대로 파일(baseName.json·.txt)로 내려받는다. 파일로 만들지 못하면 던진다.
// 조각으로 만들어(data-safety.js jsonTextParts) 그림이 많은 저장본도 글 길이 한도에 걸리지 않게 한다. 예전 localStorage 저장본(글자)은 .txt, JSON 파일로 저장한 큰 작업은 그 파일 그대로
function downloadRecordFile(record, baseName) {
    const isText = typeof record === 'string';
    const blob = isStoredBlob(record) ? record : new Blob(isText ? [record] : jsonTextParts(record), { type: isText ? 'text/plain;charset=utf-8' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}.${isText ? 'txt' : 'json'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// 읽지 못한 저장본을 고치지 않은 그대로 파일로 내려받는다. 저장소에서 다시 읽고(검사하다 바뀐 값이 아니게), 못 읽으면 처음 읽은 것을 쓴다
async function downloadUnreadRecord() {
    let record;
    try {
        record = await readUnreadRecord();
    } catch (err) {
        console.warn('[저장된 작업] 내려받으려고 다시 읽지 못해 처음 읽은 것을 씁니다:', err);
    }
    if (record === undefined) record = unreadRecord;
    if (record === undefined) return window.showAlert('내려받을 저장본을 찾지 못했습니다.');
    try {
        downloadRecordFile(record, `교안_읽지못한저장본_${backupStamp()}`);
        window.showToast?.('읽지 못한 저장본을 파일로 내려받습니다.', 'success');
    } catch (err) {
        console.error('[저장된 작업] 읽지 못한 저장본을 파일로 만들지 못했습니다:', err);
        window.showAlert(`읽지 못한 저장본을 파일로 만들지 못했습니다(${err?.message || '알 수 없는 오류'}).`);
    }
}

/* ---------- 따로 옮겨 둔 사본: 내보내기·백업 메뉴에서 보고 내려받기 ---------- */
// 따로 옮겨 둔 사본 [{ key, at }](새것부터, data-safety.js unreadCopyKeys). 시각으로 읽을 수 없는 이름은 뺀다. 저장소를 읽지 못하면 빈 목록
async function listUnreadCopies() {
    try {
        return unreadCopyKeys(await DBManager.keys(), unreadCopyPrefix()).filter(copy => Number.isFinite(new Date(copy.at).getTime()));
    } catch (err) {
        console.warn('[저장된 작업] 따로 옮겨 둔 사본 목록을 읽지 못했습니다:', err);
        return [];
    }
}

// 사본 하나를 고치지 않은 그대로 파일로 내려받는다. 누른 때 목록을 다시 읽어 그 안의 이름만 받는다
// (그사이 정리된 사본이면 알리고, 사본이 아닌 이름(지금 저장본·폴더 연결·판서 영상)은 읽지 않는다). 사본은 JSON 파일(큰 작업)이나 예전 글자일 수도 있다
async function downloadUnreadCopy(key) {
    const copy = (await listUnreadCopies()).find(item => item.key === key);
    const gone = '그 사본을 찾지 못했습니다. 이미 정리되었을 수 있습니다. 내보내기·백업 메뉴를 다시 열어 확인해 주세요.';
    if (!copy) return window.showAlert(gone);
    let record;
    try {
        record = await DBManager.getItem(copy.key);
    } catch (err) {
        console.error('[저장된 작업] 따로 옮겨 둔 사본을 읽지 못했습니다:', err);
        return window.showAlert(`그 사본을 읽지 못했습니다(${err?.message || '알 수 없는 오류'}).`);
    }
    if (record == null) return window.showAlert(gone);
    try {
        downloadRecordFile(record, `교안_읽지못한저장본_사본_${backupStamp(new Date(copy.at))}`);
        window.showToast?.('따로 옮겨 둔 사본을 파일로 내려받습니다.', 'success');
    } catch (err) {
        console.error('[저장된 작업] 따로 옮겨 둔 사본을 파일로 만들지 못했습니다:', err);
        window.showAlert(`그 사본을 파일로 만들지 못했습니다(${err?.message || '알 수 없는 오류'}).`);
    }
}

// 내보내기·백업 메뉴의 사본 칸을 그린다(메뉴를 열 때마다, ui.js toggleExportDropdown). 사본이 없거나 목록을 읽지 못하면 칸을 숨긴다.
// 버튼에는 옮긴 시각만 보이고, 이름은 data 속성에 이스케이프해 넣는다(누를 때 downloadUnreadCopy가 다시 확인한다)
async function renderUnreadCopies() {
    const section = document.getElementById('unread-copies-section');
    const list = document.getElementById('unread-copies-list');
    if (!section || !list) return;
    const copies = await listUnreadCopies();
    const when = at => (typeof localTimeText === 'function' ? localTimeText(new Date(at).toISOString()) : new Date(at).toLocaleString());
    list.innerHTML = copies.map(copy => `<button type="button" data-unread-copy="${escapeHtml(copy.key)}" title="고치지 않은 그대로 파일로 받습니다. 앱에서 바로 되살리지는 못합니다"
                    class="flex items-center gap-2 w-full px-3 py-2 text-left text-[0.7rem] font-medium text-white/90 hover:bg-white/10 transition-colors">
                    <i class="ph-bold ph-file-arrow-down text-amber-300 text-sm"></i> ${escapeHtml(`${when(copy.at)}에 남긴 사본`)}
                </button>`).join('');
    list.onclick = event => {
        const button = event.target?.closest?.('[data-unread-copy]');
        if (!button) return;
        downloadUnreadCopy(button.dataset.unreadCopy);
        window.toggleExportDropdown?.(); // 닫기(다른 메뉴 항목과 같다)
    };
    section.hidden = !copies.length;
}

// 저장본을 다시 읽어 보니 이제 열 수 있을 때(잠깐 생긴 문제였거나 다른 창이 저장했다) 알리는 말. 지금 열 수 있는 작업을 덮지 않고 '다시 읽기'로 열게 한다.
// action: 하지 않은 일('새로 시작하지', '이 파일로 바꾸지', '이 폴더로 바꾸지')
const unreadNowLoadsText = action => `저장된 작업을 다시 읽어 보니 이제 열 수 있어, ${action} 않았습니다(지운 것은 없습니다).\n'다시 읽기'를 눌러 열어 주세요.`;

// 새로 시작: 읽지 못한 저장본 대신 예시 과정으로 연다(그 저장본은 setAsideUnreadState가 한 벌 옮겨 둔다)
async function startFreshAfterUnreadState() {
    const keep = unreadRecord !== undefined ? "\n먼저 '읽지 못한 저장본 내려받기'로 그 저장본을 파일로 받아 둘 수 있습니다." : '';
    // 읽지 못한 저장본은 지우지 않고 사본으로 옮겨 둔다(setAsideUnreadState). 그 사본을 내려받는 곳을 알린다(앱에서 다시 열지는 못한다)
    const ok = await confirmAsync(
        '읽지 못한 저장본 대신 예시 과정으로 새로 시작합니다.\n'
        + "읽지 못한 저장본은 이 브라우저에 사본으로 한 벌 옮겨 두고(새것 셋까지), 나중에 '내보내기·백업' 메뉴의 '읽지 못한 저장본 사본'에서 파일로 받을 수 있습니다. 앱에서 바로 다시 열지는 못합니다.\n"
        + 'PC 폴더 자동 저장도 끕니다. 폴더에 저장해 둔 작업은 그대로 남습니다.\n\n'
        + `백업 ZIP이나 PC 폴더가 있으면 먼저 그것으로 되살려 보세요.${keep}`,
        { okLabel: '새로 시작', title: '새로 시작', tone: 'danger' }
    );
    if (!ok || !stateLoadFailed) return; // 두 번 눌러 확인 창이 둘 떴어도 한 번만 한다
    // 잠깐 생긴 문제였으면(이제 읽히거나 다른 창이 저장했으면) 지금 열 수 있는 작업을 예시 과정으로 덮지 않는다. 다시 읽기로 연다
    const status = await storedRecordStatus();
    if (!stateLoadFailed) return;
    if (status === 'loads') return window.showAlert(unreadNowLoadsText('새로 시작하지'));
    await setAsideUnreadState();
    // 주소로 연 빈 교과(#editor/subject_1)가 남아 있으면 첫 저장이 예시 교과의 차시를 비우므로 열린 교과 없이 시작한다
    currentSubjectId = null;
    courseData = [];
    markStateLoaded();
    closeLessonEditor();
    await loadMockData();
    if (typeof renderSidebar === 'function') renderSidebar();
    showOverviewAfterRestore();
}

// 백업 ZIP으로 바꾼 상태를 브라우저에 저장하지 못했을 때 바꾸기 전 상태로 되돌린다(새로고침하면 바꾸기 전 저장본이 열리므로 화면도 그것과 맞춘다).
// before: 바꾸기 직전의 { globalState, contentHistory, currentSubjectId, courseData, unread(읽지 못한 상태였는지), unreadRecord }.
// 바꾼 상태는 이어진 PC 폴더에도 쓰지 않았다(브라우저에 저장한 뒤에만 쓴다).
// 읽지 못한 상태였으면 그 창으로 돌아가고, 저장본이 제자리에 그대로라 이번에 옮겨 둔 사본은 지운다. 아니면 되돌린 상태를 다시 저장한다. 다시 저장하지 못했으면 false
async function rollbackRestore(before) {
    globalState = before.globalState;
    contentHistory = before.contentHistory;
    currentSubjectId = before.currentSubjectId;
    courseData = before.courseData;
    closeLessonEditor();
    let saved = true;
    if (before.unread) {
        stateLoadFailed = true;
        unreadRecord = before.unreadRecord;
    } else {
        saved = await saveState();
    }
    if (typeof renderSidebar === 'function') renderSidebar();
    showOverviewAfterRestore();
    if (before.unread) {
        showStateLoadFailedDialog();
        await dropUnreadCopy();
    }
    return saved;
}

async function loadMockData() {
    globalState = sanitizeState(INITIAL_MOCK_STATE);
    await saveState();
}


// 여러 글을 한 번에 남긴다. 글마다 저장하면 이미지가 많은 과정에서 느려진다
// mods: 차시(또는 최종 평가) 객체, 또는 탭 하나만 남길 때 { title, content, images, tabId, lesson }(data-safety.js historyEntry)
// reason: '다시 생성 전'·'되돌리기 전'·'불러오기 전'처럼 남긴 까닭(작업 기록 목록에 보인다)
// id와 기록 칸은 첫 await 전에 만든다. 기다리지 않고 여러 번 불러도 앞 호출의 칸을 보고 겹치지 않는 id를 받는다
async function archiveContents(mods, reason = '') {
    const date = new Date().toLocaleString();
    const kept = mods.filter(mod => mod && (mod.content || Object.values(mod.tabContents || {}).some(Boolean)));
    const ids = freshHistoryIds(kept.length, contentHistory); // 같은 순간에 여러 번 남겨도 id가 겹치지 않게
    // 교과 id는 그 차시가 든 교과다(만드는 동안 다른 교과를 열었거나 열지 않은 교과의 차시를 남겨도 맞게).
    // 탭 하나 기록인데 그 차시를 어느 교과에서도 못 찾으면 비워 둔다(되돌리면 새 차시로)
    const entries = kept.map((mod, index) => {
        const lesson = isObject(mod.lesson) ? mod.lesson : mod;
        const owner = lessonOwnerId(lesson, globalState.subjects, currentSubjectId, courseData);
        return historyEntry(mod, { id: ids[index], date, reason, subjectId: owner ?? (lesson === mod ? currentSubjectId : null) });
    });
    if (!entries.length) return;
    const merged = [...contentHistory, ...entries];
    contentHistory = capHistory(merged);
    // 상한으로 지운 기록은 화면에 알린다(조용히 사라지지 않게)
    if (merged.length > contentHistory.length) window.showToast?.(historyCapText(merged.length - contentHistory.length), 'warning');

    await saveState();

    // 연결된 폴더의 히스토리 디렉토리에도 저장
    if (projectFolderHandle) {
        entries.forEach(entry => syncHistoryItemToFolder(entry).catch(e => console.warn('히스토리 폴더 동기화 실패:', e)));
    }
}

async function archiveContent(mod, reason = '') {
    await archiveContents([mod], reason);
}

// --- History UI ---
const selectedHistoryIds = new Set();
let lastHistoryIdx = -1;

// 캐시 패널과 같이 hidden으로 여닫는다. 목록은 패널의 머리글 아래에 그린다
function toggleHistoryPanel() {
    const panel = document.getElementById('history-panel');
    if (!panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        return;
    }
    document.getElementById('cache-panel')?.classList.add('hidden');
    panel.classList.remove('hidden');
    selectedHistoryIds.clear();
    lastHistoryIdx = -1;
    refreshHistoryPanel();
}

// 창을 그리다 실패하면(기록이 망가졌거나 너무 큼) 열린 창에 안내를 보인다. 빈칸이나 예전 목록이 남지 않게
function refreshHistoryPanel() {
    const area = document.getElementById('history-list');
    renderHistoryUI(area).catch(err => {
        console.error('[작업 기록] 창을 그리지 못했습니다:', err);
        if (area) area.innerHTML = '<div class="p-4 text-sm text-rose-300">작업 기록을 보여 주지 못했습니다. 페이지를 새로고침한 뒤 다시 열어 주세요.</div>';
    });
}

function updateHistoryBadges() {
    const count = document.getElementById('history-count-badge');
    const size = document.getElementById('history-storage-badge');
    if (count) count.textContent = contentHistory.length;
    // 기록 전체를 글 하나로 만들지 않고 글자 수를 더해 어림한다(큰 기록에서 창이 멈추거나 열리지 않던 문제)
    if (size) size.textContent = `약 ${(historySizeBytes(contentHistory) / (1024 * 1024)).toFixed(1)} MB`;
}

async function renderHistoryUI(area) {
    updateHistoryBadges();
    if (!Array.isArray(contentHistory) || contentHistory.length === 0) {
        area.innerHTML = `<div class="h-full flex items-center justify-center text-textMuted bg-[#12121e]">작업 기록이 없습니다. 차시를 지우거나 다시 만들기 전, 탭 전체를 AI로 고치기 전에 자동으로 남습니다.</div>`;
        return;
    }

    selectedHistoryIds.clear();
    lastHistoryIdx = -1;

    area.innerHTML = `
        <div class="p-2 flex flex-col h-full animate-fade-in bg-[#12121e]" style="min-height:100%;">
            <div class="flex flex-wrap justify-between items-center gap-2 mb-3">
                <h2 class="text-sm font-bold text-white/90 flex items-center gap-2"><i class="ph-bold ph-clock-counter-clockwise text-accent"></i> 작업 기록</h2>
                <div class="text-xs text-textMuted bg-black/30 px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-2" id="history-capacity-info">
                    <i class="ph ph-spinner animate-spin"></i> 저장 공간 확인 중...
                </div>
            </div>
            
            <div class="flex items-center justify-between bg-white/5 p-3 rounded-t-xl border border-white/10 border-b-0">
                <div class="flex items-center gap-3 pl-1">
                    <input type="checkbox" id="history-select-all" onchange="toggleSelectAllHistory(this.checked)" class="w-4 h-4 rounded border-white/20 bg-black/50 accent-accent cursor-pointer">
                    <label for="history-select-all" class="text-sm font-bold text-white/80 cursor-pointer select-none">전체 선택</label>
                    <span class="text-xs font-bold text-accent ml-2 bg-accent/10 px-2 py-0.5 rounded" id="history-select-count">0개 선택됨</span>
                </div>
                <div class="flex gap-2">
                    <button onclick="exportSelectedHistoryMD()" class="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-white/10 hover:bg-white/20 text-white rounded transition-colors"><i class="ph-bold ph-file-text"></i> MD 다운로드</button>
                    <button onclick="exportSelectedHistoryPDF()" class="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-white/10 hover:bg-white/20 text-white rounded transition-colors"><i class="ph-bold ph-file-pdf"></i> PDF 다운로드</button>
                    <div class="w-px h-5 bg-white/20 mx-1 self-center"></div>
                    <button onclick="deleteSelectedHistory()" class="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-red-500/20 hover:bg-red-500/40 text-red-300 rounded transition-colors"><i class="ph-bold ph-trash"></i> 선택 삭제</button>
                </div>
            </div>
            
            <div id="history-list-container" class="flex-1 overflow-y-auto editor-scroll border border-white/10 rounded-b-xl bg-black/30 p-2 flex flex-col gap-1 select-none">
                <!-- list injected here -->
            </div>
        </div>
    `;
    renderHistoryList();

    // IndexedDB 전체 용량 비동기 측정
    const capInfo = document.getElementById('history-capacity-info');
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const estimation = await navigator.storage.estimate();
            const usageMB = (estimation.usage / (1024 * 1024)).toFixed(1);
            const quotaMB = (estimation.quota / (1024 * 1024)).toFixed(1);
            capInfo.innerHTML = `브라우저 저장 공간: <span class="text-accent font-bold">${usageMB} MB</span> <span class="opacity-50">/ ${quotaMB} MB</span>`;
        } else {
            capInfo.innerHTML = `<span class="text-textMuted">이 브라우저는 저장 공간을 알려 주지 않습니다</span>`;
        }
    } catch (e) {
        capInfo.innerHTML = `<span class="text-textMuted text-orange-400">저장 공간을 확인하지 못했습니다</span>`;
    }
}

window.renderHistoryList = function () {
    const container = document.getElementById('history-list-container');
    const countSpan = document.getElementById('history-select-count');
    if (!container) return;

    countSpan.innerText = `${selectedHistoryIds.size}개 선택됨`;
    const checkAll = document.getElementById('history-select-all');
    if (checkAll) checkAll.checked = contentHistory.length > 0 && selectedHistoryIds.size === contentHistory.length;

    const subjects = currentSnapshot().subjects; // 줄마다 그 차시가 아직 있는지 보고 버튼 이름을 고른다
    const reversedHistory = [...contentHistory].reverse();
    container.innerHTML = reversedHistory.map((h, displayIdx) => {
        const isSelected = selectedHistoryIds.has(h.id);
        const labels = historyRowLabels(h, historyRestoreTarget(h, subjects));
        return `
            <div class="p-3 rounded-lg border ${isSelected ? 'bg-accent/20 border-accent/50' : 'bg-white/[0.04] border-transparent hover:bg-white/[0.08]'} cursor-pointer flex justify-between items-center transition-colors"
                 onclick="handleHistoryClick(event, ${Number(h.id)}, ${displayIdx})">
                <div class="flex items-center gap-3 pl-1">
                    <input type="checkbox" class="w-4 h-4 rounded border-white/20 bg-black/50 accent-accent pointer-events-none" ${isSelected ? 'checked' : ''}>
                    <div>
                        <h4 class="font-bold ${isSelected ? 'text-white' : 'text-white/80'} text-sm">${escapeHtml(h.title)}</h4>
                        <span class="text-xs text-white/60">${escapeHtml(h.date)}${h.reason ? ` · ${escapeHtml(h.reason)}` : ''}${labels.kind ? ` · ${escapeHtml(labels.kind)}` : ''}</span>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button onclick="event.stopPropagation(); viewHistoryItem(${Number(h.id)})" class="text-accent hover:text-white hover:bg-accent text-xs font-bold px-3 py-1.5 bg-accent/10 rounded transition-colors border border-accent/20">내용 보기</button>
                    <button onclick="event.stopPropagation(); restoreHistoryItem(${Number(h.id)})" class="text-white text-xs font-bold px-3 py-1.5 bg-accent hover:bg-accentHover rounded transition-colors" title="${escapeHtml(labels.tip)}">${escapeHtml(labels.button)}</button>
                </div>
            </div>
        `;
    }).join('');
}

window.handleHistoryClick = function (e, id, displayIdx) {
    const reversedHistory = [...contentHistory].reverse();

    if (e.shiftKey && lastHistoryIdx !== -1) {
        const start = Math.min(lastHistoryIdx, displayIdx);
        const end = Math.max(lastHistoryIdx, displayIdx);
        for (let i = start; i <= end; i++) selectedHistoryIds.add(reversedHistory[i].id);
    } else if (e.ctrlKey || e.metaKey) {
        if (selectedHistoryIds.has(id)) selectedHistoryIds.delete(id);
        else selectedHistoryIds.add(id);
        lastHistoryIdx = displayIdx;
    } else {
        selectedHistoryIds.clear();
        selectedHistoryIds.add(id);
        lastHistoryIdx = displayIdx;
    }
    renderHistoryList();
}

window.toggleSelectAllHistory = function (isChecked) {
    if (isChecked) contentHistory.forEach(h => selectedHistoryIds.add(h.id));
    else selectedHistoryIds.clear();
    lastHistoryIdx = -1;
    renderHistoryList();
}

window.deleteSelectedHistory = async function () {
    if (selectedHistoryIds.size === 0) return window.showAlert('삭제할 항목을 선택해주세요.');
    showConfirm(`선택한 ${selectedHistoryIds.size}개의 작업 기록을 영구 삭제할까요?`, async () => {
        contentHistory = contentHistory.filter(h => !selectedHistoryIds.has(h.id));
        selectedHistoryIds.clear();
        await saveState();
        refreshHistoryPanel();
    });
}



window.clearHistory = function () {
    if (contentHistory.length === 0) return window.showAlert('지울 작업 기록이 없습니다.');
    showConfirm(`작업 기록 ${contentHistory.length}개를 모두 영구 삭제할까요?`, async () => {
        contentHistory = [];
        selectedHistoryIds.clear();
        await saveState();
        refreshHistoryPanel();
    });
}

window.exportSelectedHistoryMD = function () {

    if (selectedHistoryIds.size === 0) return window.showAlert('다운로드할 항목을 선택해주세요.');

    const text = contentHistory

        .filter(h => selectedHistoryIds.has(h.id))

        .map(h => `# ${h.title}\n\n*삭제일: ${h.date}*\n\n${resolveMarkdownImages(h.content, h.images)}`)

        .join('\n\n---\n\n');

    downloadFile(text, `작업기록_선택본_${Date.now()}.md`, 'text/markdown');

}



window.exportSelectedHistoryPDF = async function () {

    if (selectedHistoryIds.size === 0) return window.showAlert('다운로드할 항목을 선택해주세요.');



    // html2pdf 라이브러리 로드 확인 (네트워크 문제 방어)

    if (typeof html2pdf === 'undefined') {

        return window.showAlert('PDF 변환 라이브러리를 불러오지 못했습니다. 잠시 후 다시 시도하거나 새로고침 해주세요.');

    }



    const items = contentHistory.filter(h => selectedHistoryIds.has(h.id));



    const btn = document.querySelector('button[onclick="exportSelectedHistoryPDF()"]');

    const origHTML = btn.innerHTML;

    btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i> 변환중...';

    btn.disabled = true;



    const tempContainer = document.createElement('div');

    tempContainer.className = 'markdown-body';

    // PDF 렌더링용 인라인 스타일 강제 주입 (오프스크린에서도 html2canvas가 정상 캡처하도록)

    Object.assign(tempContainer.style, {

        padding: '40px',

        background: '#fff',

        color: '#3a3a4a',

        fontFamily: 'Noto Sans KR, Inter, sans-serif',

        lineHeight: '1.8',

        letterSpacing: '-0.01em',

        position: 'fixed',

        left: '0',

        top: '0',

        width: '800px',

        zIndex: '-9999',

        visibility: 'hidden'

    });



    let htmlContent = '';

    items.forEach(h => {

        htmlContent += `<h1 style="border-bottom: 2px solid #e8e6f0; padding-bottom: 10px; color: #1a1a2e;">${escapeHtml(h.title)}</h1>`;

        htmlContent += `<p style="color:#888; font-size:12px; margin-bottom: 20px;">삭제일: ${escapeHtml(h.date)}</p>`;



        try {

            // 교안 렌더 단일 파이프라인 사용 (기존엔 callout 재파싱·후처리 없이 marked만 호출해 강사 박스가 깨져 보였음)
            htmlContent += (typeof renderLessonHTML === 'function')
                ? renderLessonHTML(resolveMarkdownImages(h.content, h.images))
                : (typeof marked !== 'undefined' ? sanitizeLessonHtml(marked.parse(resolveMarkdownImages(h.content, h.images))) : `<pre>${escapeHtml(resolveMarkdownImages(h.content, h.images))}</pre>`);

        } catch (e) {

            htmlContent += `<p>변환 오류 발생</p>`;

        }



        htmlContent += `<div style="page-break-after: always; margin-top: 50px;"></div>`;

    });

    tempContainer.innerHTML = htmlContent;

    document.body.appendChild(tempContainer);



    // DOM 렌더링 완료 대기 (html2canvas가 빈 캔버스를 캡처하는 문제 방지)

    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 200)));



    const opt = {

        margin: 15,

        filename: `작업기록_선택본_${Date.now()}.pdf`,

        image: { type: 'jpeg', quality: 0.98 },

        html2canvas: { scale: 2, useCORS: true, windowWidth: 800 },

        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }

    };



    try {

        await html2pdf().set(opt).from(tempContainer).save();

    } catch (e) {

        window.showAlert('PDF 변환 중 오류가 발생했습니다: ' + e.message);

    } finally {

        document.body.removeChild(tempContainer);

        btn.innerHTML = origHTML;

        btn.disabled = false;

    }

}



// 이미지 데이터 치환 헬퍼 함수 (내보내기 용도로 깔끔하게 변환)

function resolveMarkdownImages(content, images) {

    let md = content || '> 내용 없음';



    // 1. 커스텀 HTML 래퍼를 표준 마크다운 이미지 문법으로 되돌림 (WAF 방어 및 깔끔한 수출). 그림 키는 [\w-]만 쓴다(data-safety.js SAFE_IMAGE_KEY)

    md = md.replace(/<div class="image-wrapper">\s*<img src="(local:[\w-]+)" alt="([^"]*)"[^>]*>[\s\S]*?<\/div>/gi, '![$2]($1)');

    // 2. local:그림 키를 그림으로. 키 모양 하나로 찾아 키 끝까지 읽고 목록에서 꺼낸다(그림 키로 글을 자르거나 정규식을 만들지 않는다. img_1이 img_10을 건드리지 않는다).
    //    목록에 있는 키는 진짜 그림이면 그 그림, 찾지 못한 그림(teacher-image 참조)·빈 값이면 빈 그림. 목록에 없는 키는 그대로 둔다
    if (images && typeof images === 'object') {
        const known = new Map(Object.entries(images));
        md = md.replace(/local:([\w-]{1,80})(?![\w-])/g, (whole, id) => {
            if (!known.has(id)) return whole;
            const data = known.get(id);
            return typeof data === 'string' && /^data:image\//.test(data) ? data : '';
        });
    }

    return md;

}



// ZIP 내보내기용 이미지 분리 헬퍼 — 마크다운에서 이미지 참조를 상대 경로로 치환하고 ZIP 폴더에 바이너리 추가
// 그림 id로 정규식을 만들지 않는다(data-safety.js attachmentImages. PC 폴더 저장의 writeLessonMd도 같은 규칙)
function extractImagesToZip(markdownContent, images, attachFolder) {
    const { content, files } = attachmentImages(markdownContent, images);
    files.forEach(file => attachFolder.file(file.name, file.base64, { base64: true }));
    return content;
}

window.viewHistoryItem = function (id) {
    const item = contentHistory.find(h => h.id === id);
    if (!item) { window.showAlert("해당 작업 기록을 찾을 수 없습니다."); return; }

    try {
        const rawContent = item.content || '(빈 내용)';
        let resolved = rawContent;

        // 이미지 치환 시도 (실패해도 원본 텍스트로 진행)
        try {
            resolved = resolveMarkdownImages(rawContent, item.images || {});
        } catch (imgErr) {
            console.warn("히스토리 이미지 치환 경고:", imgErr);
        }

        // marked 파서 시도 (실패 시 원본 텍스트를 pre 폴백)
        let htmlContent;
        if (typeof marked !== 'undefined') {
            try {
                // 교안 렌더 단일 파이프라인 (편집기와 동일: collapse→marked→reParse→마침표줄바꿈→postprocess)
                // 기존 이력 보기 경로는 postprocessHtml이 누락되어 화면과 다르게 렌더되던 것을 통합으로 수정
                htmlContent = (typeof renderLessonHTML === 'function') ? renderLessonHTML(resolved) : marked.parse(resolved);
            } catch (parseErr) {
                console.warn("marked.parse 파싱 경고:", parseErr);
                htmlContent = `<pre style="white-space:pre-wrap;word-break:break-word;">${resolved.replace(/</g, '&lt;')}</pre>`;
            }
        } else {
            htmlContent = `<pre style="white-space:pre-wrap;word-break:break-word;">${resolved.replace(/</g, '&lt;')}</pre>`;
        }

        const target = historyRestoreTarget(item, currentSnapshot().subjects); // 그 차시가 없으면 버튼이 '새 차시로 되살리기'
        const kind = historyRowLabels(item, target).kind;
        const restoreBar = `<div class="not-prose mb-4 flex items-center gap-2 p-3 rounded-lg bg-accent/10 border border-accent/30 text-xs text-gray-700"><span class="flex-1">${escapeHtml(item.date || '')}${item.reason ? ` · ${escapeHtml(item.reason)}` : ''}${kind ? ` · ${escapeHtml(kind)}` : ''} 기록입니다.</span><button onclick="restoreHistoryItem(${Number(item.id)})" class="px-3 py-1.5 font-bold text-white bg-accent rounded hover:bg-accentHover">${target.mode === 'replace' ? '이 버전으로 되돌리기' : '새 차시로 되살리기'}</button></div>`;
        showModal(`작업 기록: ${escapeHtml(item.title || '제목 없음')}`, restoreBar + htmlContent);

    } catch (e) {
        console.error("히스토리 복원 오류:", e);
        window.showAlert("내용을 불러오는 중 오류가 발생했습니다: " + e.message);
    }
}



let draggedId = null;

function initDragAndDrop() {

    const cards = document.querySelectorAll('.module-card');

    cards.forEach(card => {

        card.addEventListener('dragstart', (e) => {

            draggedId = card.dataset.id === 'mainQuest' ? 'mainQuest' : parseInt(card.dataset.id);

            card.classList.add('dragging');

            e.dataTransfer.effectAllowed = 'move';

        });

        card.addEventListener('dragend', () => {

            card.classList.remove('dragging');

            draggedId = null;

            document.querySelectorAll('.module-card').forEach(c => c.classList.remove('drag-over'));

        });

        card.addEventListener('dragover', (e) => {

            e.preventDefault();

            e.dataTransfer.dropEffect = 'move';

            card.classList.add('drag-over');

        });

        card.addEventListener('dragleave', () => {

            card.classList.remove('drag-over');

        });

        card.addEventListener('drop', (e) => {

            e.preventDefault();

            card.classList.remove('drag-over');

            const targetId = card.dataset.id === 'mainQuest' ? 'mainQuest' : parseInt(card.dataset.id);



            if (draggedId !== null && draggedId !== targetId && draggedId !== 'mainQuest' && targetId !== 'mainQuest') {

                const fromIdx = courseData.findIndex(m => m.id === draggedId);

                const toIdx = courseData.findIndex(m => m.id === targetId);

                if (fromIdx !== -1 && toIdx !== -1) {

                    const [moved] = courseData.splice(fromIdx, 1);

                    courseData.splice(toIdx, 0, moved);

                    saveState().then(() => {
                        renderSidebar();
                    });

                }

            }

        });

    });

}



function downloadFile(content, fileName, mimeType) {

    const blob = new Blob([content], { type: mimeType });

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url;

    a.download = fileName;

    a.click();

    URL.revokeObjectURL(url);

}



window.exportCurrentModule = async function () {
    const mod = getEditingModule();
    // v7.5: 5탭 시스템 — tabContents도 확인
    const hasContent = mod && (mod.content || (mod.tabContents && Object.values(mod.tabContents).some(v => v)));
    if (!hasContent) return window.showAlert('내보낼 내용이 없습니다.');
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);

    // 과정명(Project Name) 및 교과명 안전화
    const rawCourseTitle = globalState.courseTitle || '새_교안프로젝트';
    const safeCourseName = rawCourseTitle.replace(/[\/\?<>\\:\*\|"]/g, '_').trim();
    const safeSubjName = subj ? subj.title.replace(/[\/\?<>\\:\*\|"]/g, '_').trim() : '기본_교과';

    let fileName = lessonFileName(mod, 'md', subj);


    try {
        const zip = new JSZip();

        // 1. 최상단: 과정명 폴더 생성
        const rootFolder = zip.folder(safeCourseName);

        // 2. 메타데이터 루트 배치
        const metaObj = {
            project: rawCourseTitle,
            subject: subj ? subj.title : '',
            module: mod.title,
            timestamp: new Date().toISOString()
        };
        rootFolder.file('save_data.yaml', JSON.stringify(metaObj, null, 2));

        // 3. 리소스(첨부파일) & 교과 폴더 생성
        const attachFolder = rootFolder.folder("첨부파일");
        const subjFolder = rootFolder.folder(safeSubjName);

        const markdownContent = extractImagesToZip(mod.content, mod.images, attachFolder);
        subjFolder.file(fileName, markdownContent);
        lessonGyosuanFiles(mod).forEach(file => subjFolder.file(`${fileName.replace('.md', '')}_${file.name}`, file.content));

        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `${safeCourseName}_${fileName.replace('.md', '')}.zip`);

    } catch (e) {
        console.error("ZIP 생성 오류:", e);
        window.showAlert('압축 파일 생성 중 오류가 발생했습니다. JSZip 라이브러리가 로드되었는지 확인하세요.');
    }
}



window.exportAllModules = async function () {
    // 과정 전체를 담으므로 지금 연 교과가 없어도(개요 화면) 받을 수 있다
    if (!globalState.subjects.length) return window.showAlert('백업할 교과가 없습니다.');
    if (!Array.isArray(courseData)) courseData = [];
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    const imageMode = takeBackupImageMode(); // 이 파일에 쓸 그림 담기. 골라 둔 '빼기'는 이 파일에만 쓴다(data-safety.js)

    // 과정명(Project Name) 안전화
    const rawCourseTitle = globalState.courseTitle || '새_교안프로젝트';
    const safeCourseName = rawCourseTitle.replace(/[\/\?<>\\:\*\|"]/g, '_').trim();
    // 교과명(Subject Name) 안전화
    const safeSubjName = subj ? subj.title.replace(/[\/\?<>\\:\*\|"]/g, '_').trim() : '기본_교과';

    try {
        const zip = new JSZip();

        // 1. 최상단: 과정명 폴더 생성
        const rootFolder = zip.folder(safeCourseName);

        // 2. 메타데이터 (save_data.yaml에 넣을 내용. 파일은 5에서 넣는다)
        const metaObj = {
            project: rawCourseTitle,
            subject: subj ? subj.title : '',
            timestamp: new Date().toISOString(),
            module_count: courseData.length,
            // 전체 설정 및 현황 컨텍스트 직렬화 (API 키와 삭제한 차시는 공유 파일에 남지 않도록 제외)
            context: { ...globalState, apiKey: undefined, lessonTrash: undefined }
        };

        // 3. 리소스(첨부파일) 서브폴더 & 교과 폴더 생성
        const attachFolder = rootFolder.folder("첨부파일");
        const subjFolder = rootFolder.folder(safeSubjName);

        courseData.forEach((m, idx) => {
            const moduleTitle = `# ${m.title}\n\n`;

            // 차시명 뷰티파이 (예: 01_차시명.md)
            const mdFileName = lessonFileName(m, 'md', subj);


            const markdownContent = extractImagesToZip(m.content, m.images, attachFolder);
            subjFolder.file(mdFileName, moduleTitle + markdownContent);
            lessonGyosuanFiles(m).forEach(file => subjFolder.file(`${mdFileName.replace('.md', '')}_${file.name}`, file.content));
        });

        // 4. 메인 퀘스트(mainQuest) 별도 내보내기 — subj.mainQuest는 courseData(lessons)에 미포함
        if (subj && subj.mainQuest && subj.mainQuest.content) {
            const mq = subj.mainQuest;
            const mqFileName = lessonFileName(mq, 'md', subj);

            const mqContent = extractImagesToZip(mq.content, mq.images, attachFolder);
            subjFolder.file(mqFileName, `# ${mq.title}\n\n` + mqContent);
        }

        // 5. 되살리기용 save_data.yaml(편의상 JSON을 yaml 확장자로)을 넣고 묶는다. '함께'가 크기 한도에 걸리면 '따로·가볍게'로 다시 만든다(data-safety.js)
        const result = await buildBackupZip(zip, rootFolder, metaObj, imageMode);
        saveAs(result.blob, backupFileName(`${safeCourseName}_과정전체백업_${backupStamp()}`, result.mode));
        finishBackupDownload(result);

    } catch (e) {
        console.error("전체 ZIP 생성 오류:", e);
        window.showAlert(isBackupTooBig(e)
            ? BACKUP_TOO_BIG_TEXT.full
            : `백업 파일을 만들지 못했습니다: ${e?.message || '알 수 없는 오류'}`);
    }
}



// =========================================================================
// PDF 드롭다운 토글 (클릭 기반)
// =========================================================================
window.togglePdfDropdown = function (event) {
    const dropdown = document.getElementById('pdf-dropdown-menu');
    if (!dropdown) return;
    const isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) {
        dropdown.classList.add('hidden');
        document.removeEventListener('click', _closePdfDropdownOnOutside);
        return;
    }
    const btn = document.getElementById('pdf-dropdown-btn');
    if (btn) {
        const rect = btn.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 4) + 'px';
        dropdown.style.left = rect.left + 'px';
    }
    dropdown.classList.remove('hidden');
    setTimeout(() => { document.addEventListener('click', _closePdfDropdownOnOutside); }, 0);
    if (event) event.stopPropagation();
}
function _closePdfDropdownOnOutside(e) {
    const dropdown = document.getElementById('pdf-dropdown-menu');
    const btn = document.getElementById('pdf-dropdown-btn');
    if (dropdown && !dropdown.contains(e.target) && btn && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
        document.removeEventListener('click', _closePdfDropdownOnOutside);
    }
}



// 교수안 문서는 마크다운 이미지만 되살리므로(resolveGyosuanImages) 그 칸에는 마크다운으로 넣는다
function insertedImageTag(target, imgId) {
    if (target.id === 'gyosuan-raw') return `\n\n![붙여넣은 이미지](local:${imgId})\n\n`;
    return `\n<img src="local:${imgId}" alt="inserted image" style="max-width:100%; border-radius:8px;">\n`;
}

function handleImageFileInsertion(file, target) {
    const fileType = file.type; // e.g. 'image/png', 'image/gif'
    const reader = new FileReader();

    reader.onload = (event) => {
        const originalB64 = event.target.result;

        // GIF나 특수 포맷은 캔버스 압축(정적 변환)을 피하고 원본 유지
        if (fileType === 'image/gif') {
            const mod = getEditingModule();
            if (!mod.images) mod.images = {};
            const imgId = 'img_' + Date.now() + Math.floor(Math.random() * 1000);
            mod.images[imgId] = originalB64; // 원본 B64 보존

            insertTextAtCursor(target, insertedImageTag(target, imgId));
            return;
        }

        // 일반 정적 이미지는 해상도를 낮추어 png(또는 jpeg) 통일 처리
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const MAX_WIDTH = 800;

            if (width > MAX_WIDTH) {
                height = Math.round((height * MAX_WIDTH) / width);
                width = MAX_WIDTH;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // 규정에 따라 정적 이미지는 png로 통일
            const compressedBase64 = canvas.toDataURL('image/png');

            const mod = getEditingModule();
            if (!mod.images) mod.images = {};
            const imgId = 'img_' + Date.now() + Math.floor(Math.random() * 1000);
            mod.images[imgId] = compressedBase64;

            insertTextAtCursor(target, insertedImageTag(target, imgId));
        };
        img.src = originalB64;
    };
    reader.readAsDataURL(file);
}

function insertTextAtCursor(target, text) {
    const pos = target.selectionStart;
    target.value = target.value.substring(0, pos) + text + target.value.substring(pos);
    target.setSelectionRange(pos + text.length, pos + text.length);

    // 메인 에디터인 경우에만 즉시 원문 스코프 동기화를 수행
    // (인라인 에디팅 팝업 폼의 경우 onBlur/Enter 이벤트에서 직접 AST로 저장하므로 스킵)
    if (target.id === 'raw-view') {
        if (typeof saveRawContent === 'function') saveRawContent();
    }
    if (target.id === 'gyosuan-raw') window.saveGyosuanRaw?.();
}

function initImageInsertionHandlers() {
    const isInsertionTarget = (target) => {
        if (!target) return false;
        // 메인 에디터(#raw-view) 거나 인라인 에디팅 폼(TEXTAREA)일 경우 허용
        return target.id === 'raw-view' || target.id === 'gyosuan-raw' || (target.tagName === 'TEXTAREA' && target.closest('#render-view'));
    };

    // Paste Event
    document.addEventListener('paste', (e) => {
        const target = e.target;
        if (isInsertionTarget(target)) {
            const items = (e.clipboardData || window.clipboardData).items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
                    e.preventDefault();
                    handleImageFileInsertion(items[i].getAsFile(), target);
                    break;
                }
            }
        }
    });

    // Dragover Event (To allow drop)
    document.addEventListener('dragover', (e) => {
        const target = e.target;
        if (isInsertionTarget(target)) {
            e.preventDefault(); // allow drop
            target.classList.add('border-accent', 'bg-accent/10'); // Optional: Add visual cue
        }
    });

    // Dragleave Event
    document.addEventListener('dragleave', (e) => {
        const target = e.target;
        if (isInsertionTarget(target)) {
            target.classList.remove('border-accent', 'bg-accent/10');
        }
    });

    // Drop Event
    document.addEventListener('drop', (e) => {
        const target = e.target;
        if (isInsertionTarget(target)) {
            e.preventDefault();
            target.classList.remove('border-accent', 'bg-accent/10');

            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                // Handle multiple files if dropped
                for (let i = 0; i < files.length; i++) {
                    if (files[i].type.startsWith('image/')) {
                        handleImageFileInsertion(files[i], target);
                    }
                }
            }
        }
    });
}


// =========================================================================
// 이미지 파일 선택 삽입 핸들러 (에디터 도구모음 "이미지 삽입" 버튼)
// =========================================================================
window.handleImageInputSelect = function (event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // 삽입 대상: 수정 모드(raw-view) 또는 활성 인라인 에디팅 textarea
    let target = document.getElementById('raw-view');
    if (!target || target.classList.contains('hidden')) {
        // 인라인 에디팅 textarea 탐색
        const renderView = document.getElementById('render-view');
        if (renderView) {
            target = renderView.querySelector('textarea');
        }
    }

    if (!target) {
        window.showAlert('이미지를 넣을 단락을 두 번 눌러 연 뒤 다시 누르거나, 도구 → 원문 전체 수정에서 넣어 주세요.');
        event.target.value = '';
        return;
    }

    for (let i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/')) {
            handleImageFileInsertion(files[i], target);
        }
    }

    // 같은 파일 재선택을 허용하기 위해 인풋 리셋
    event.target.value = '';
};

// =========================================================================
// ZIP 세이브 파일 복원 (Load Import) 체계
// =========================================================================
window.importProjectZip = async function (event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
        window.showAlert('지원하지 않는 세이브 파일입니다. (.zip 형식만 가능)');
        event.target.value = '';
        return;
    }

    try {
        let zip;
        try {
            zip = await JSZip.loadAsync(file);
        } catch (err) {
            throw isBackupTooBig(err) ? err : importStop(err?.message || 'ZIP 파일을 열지 못했습니다'); // ZIP이 아니거나 망가진 파일: 일부러 멈춘 것으로 본다
        }
        let metaObj = null;
        let imageMap = new Map(); // fileName -> base64
        let mdFiles = [];
        const backupImages = {}; // 그림을 따로 담은 백업의 '그림/' 파일들

        // 1순회: 메타데이터 추출 및 이미지(바이너리) 버퍼링
        const entries = Object.keys(zip.files);
        for (const relativePath of entries) {
            const zipEntry = zip.files[relativePath];
            if (zipEntry.dir) continue;

            if (relativePath.includes('save_data.yaml')) {
                const yamlText = await zipEntry.async("string");
                metaObj = safeJSONParse(yamlText); // yaml이라 썼지만 이전 단계에서 편의상 JSON 직렬화함
            } else if (/(^|\/)그림\/[^/]+$/.test(relativePath) && isBackupImageName(relativePath.split('/').pop())) {
                // 내용이 이름(키)과 맞으면 원래 그림 글 그대로(예전에 .png로 쓴 avif도). 맞지 않으면 예전처럼 확장자로 받는다
                const name = relativePath.split('/').pop();
                const base64 = await zipEntry.async('base64');
                const key = name.replace(/\.[^.]+$/, '');
                backupImages[key] = backupImageFromKeyedFile(key, name, base64) || backupImageFromFile(name, base64).dataUrl;
            } else if (relativePath.includes('첨부파일/')) {
                const binaryData = await zipEntry.async("base64");
                const ext = relativePath.split('.').pop().toLowerCase();
                const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
                const safeB64 = `data:${mimeType};base64,${binaryData}`;

                // 파일명을 키로 사용 (예: "img_12345.png")
                const fileName = relativePath.split('/').pop();
                imageMap.set(fileName, safeB64);
            } else if (relativePath.endsWith('.md')) {
                const mdContent = await zipEntry.async("string");
                mdFiles.push({ path: relativePath, content: mdContent });
            }
        }

        if (!metaObj || typeof metaObj !== 'object' || Array.isArray(metaObj)) {
            throw importStop("되살릴 수 있는 백업 파일이 아닙니다(save_data.yaml이 없거나 읽을 수 없습니다). 내보내기·백업에서 받은 백업 ZIP을 골라 주세요.");
        }
        if (metaObj.imageMode === 'separate') metaObj = attachBackupImages(metaObj, backupImages);

        if (metaObj.scope === 'subjects') {
            await importSubjectsBackup(metaObj);
            return;
        }

        let isSingleModule = !metaObj.context;

        if (isSingleModule) {
            // 단일 차시(exportCurrentModule) 복원 모드: 현재 교과에 새 모듈로 종속시킴
            if (isStateLoadFailed()) return window.showAlert(UNREAD_PARTIAL_BACKUP_TEXT); // 읽지 못한 동안은 과정 전체로만 되살린다
            const subj = globalState.subjects.find(s => s.id === currentSubjectId);
            if (!subj) throw importStop("현재 선택된 교과가 없습니다. 교과를 먼저 생성해주세요.");

            const newMod = {
                id: renumberLessons([{}], (subj.lessons || []).map(lesson => lesson.id))[0].id,
                title: stateText(metaObj.module) || '불러온 교안',
                description: '',
                status: 'waiting',
                content: '',
                images: {},
                uploadedMdName: null,
                uploadedMdContent: null
            };

            // 앞머리나 '# 제목' 머리를 떼고 ../첨부파일/ 그림을 local:로 되돌린다. 제목과 그림 id는 정규식에 넣지 않는다(data-safety.js)
            const matchedMd = mdFiles.find(mf => mf.path.endsWith('.md'));
            if (matchedMd) {
                const relinked = relinkAttachedImages(backupMarkdownBody(matchedMd.content, newMod.title), imageMap, newMod.images);
                newMod.content = relinked.content;
                newMod.images = relinked.images;
            }

            courseData.push(cleanTrashLesson(newMod)); // 불러온 차시도 sanitizeState 규칙으로 검사한 사본을 넣는다(같은 id)

            await saveState(); // 로컬스토리지 백업
            if (typeof renderSidebar === 'function') renderSidebar();
            if (typeof viewModule === 'function') viewModule(newMod.id);
            window.showAlert('단일 차시 교안을 현재 교과에 성공적으로 가져왔습니다!');

        } else {
            // 1. 새 상태를 지역 변수에서 다 만들고 검사한다. 여기서 멈추면 지금 작업은 그대로다.
            //    차시 MD는 내보낸 교과(metaObj.subject)의 차시 가운데 제목이 꼭 같은 것에만 맞춘다(data-safety.js applyBackupMarkdown)
            const nextState = sanitizeState(metaObj.context);
            if (!nextState?.subjects.length) throw importStop('이 파일에는 되살릴 교과가 없습니다.');
            applyBackupMarkdown(nextState.subjects.find(s => s.title === stateText(metaObj.subject)), mdFiles, imageMap);

            // 2. 바꾸기 전에 묻고, 지금 상태를 백업 파일로 내려받는다. 그림을 뺀 파일('빼기')이면 확인 창에 알린다.
            //    읽지 못한 저장본 대신 열 때는 받을 지금 작업이 없어 백업 대신 그 저장본을 따로 옮겨 둔다
            const unread = isStateLoadFailed();
            const imageNote = metaObj.imageMode === 'none' ? noImagesImportNote('full', currentImageCount()) : '';
            const ok = await confirmAsync(unread
                ? `읽지 못한 브라우저 저장본 대신 이 파일의 작업(교과 ${nextState.subjects.length}개)으로 엽니다.\n읽지 못한 저장본은 이 파일 내용으로 바뀝니다. PC 폴더 자동 저장은 꺼 둡니다. 필요하면 다시 켜 주세요.${imageNote}`
                : `지금 브라우저의 모든 작업(교과 ${globalState.subjects.length}개)을 이 파일의 내용(교과 ${nextState.subjects.length}개)으로 바꿉니다.\n바꾸기 전에 지금 상태를 백업 파일로 내려받습니다. 마음이 바뀌면 그 파일을 다시 불러오면 됩니다.${imageNote}`,
                { okLabel: unread ? '이 파일로 되살리기' : '백업 받고 바꾸기', title: '전체 불러오기' });
            if (!ok) return;
            // 읽지 못한 저장본이 이제 열리면(잠깐 생긴 문제였거나 다른 창이 저장했다) 그 작업을 이 파일로 바꾸지 않는다(새로 시작과 같은 규칙)
            if (unread && await storedRecordStatus() === 'loads') return window.showAlert(unreadNowLoadsText('이 파일로 바꾸지'));
            if (unread) {
                await setAsideUnreadState({ prune: false }); // 오래된 사본은 되살린 것을 저장한 뒤에 정리한다(아래 4)
            } else {
                window.saveRawContent?.(); // 고치던 원문을 먼저 저장해 백업에 들어가게 한다
                if (!(await safetyBackupOrAsk('불러오기전'))) return; // 받지 못하면 까닭을 알리고 백업 없이 계속할지 묻는다
                await archiveContents((courseData || []).filter(Boolean), '불러오기 전');
            }
            // 휴지통과 작업 기록은 지금 것과 파일 것을 합친다(방금 남긴 '불러오기 전' 기록도 들어가게 archiveContents 다음에)
            const extras = mergeBackupExtras(metaObj, { history: contentHistory, lessonTrash: globalState.lessonTrash, subjectTrash: globalState.subjectTrash });

            // 3. 한 번에 바꾼다(이 사이에는 던질 수 있는 코드를 넣지 않는다). 바꾸기 전 상태는 저장하지 못했을 때 되돌리려고 둔다
            const before = { globalState, contentHistory, currentSubjectId, courseData, unread, unreadRecord };
            const open = nextState.subjects.find(s => s.id === currentSubjectId) || nextState.subjects[0];
            globalState = Object.assign(nextState, { lessonTrash: extras.lessonTrash, subjectTrash: extras.subjectTrash });
            contentHistory = extras.history;
            currentSubjectId = open.id;
            courseData = open.lessons || [];
            markStateLoaded();
            closeLessonEditor();

            // 4. 브라우저에 먼저 저장하고 새 상태로 다시 그린다(개요가 이미 열려 있어도 옛 과정이 남지 않게).
            //    브라우저에 저장하지 못하면 바꾸기 전 상태로 되돌린다(새로고침하면 바꾸기 전 저장본이 열리므로). 이어진 PC 폴더에는 저장한 뒤에만 쓴다
            //    (먼저 쓰면 되돌린 이 파일의 작업이 폴더의 저장본·차시 MD로 남는다)
            if (!(await saveState({ folder: false }))) {
                const resaved = await rollbackRestore(before);
                return window.showAlert('이 파일의 작업을 브라우저에 저장하지 못해 되살리지 않았습니다. 화면은 되살리기 전으로 돌려 두었습니다.\n'
                    + '브라우저 저장 공간이 모자라거나 이 사이트의 저장을 막았을 수 있습니다. 확인한 뒤 다시 되살려 주세요.'
                    + (resaved ? '' : '\n되살리기 전 작업도 다시 저장하지 못했습니다. 브라우저 저장 공간을 확인한 뒤 Ctrl+S로 다시 저장해 주세요.'));
            }
            if (projectFolderHandle) syncToLinkedFolder().catch(e => console.warn('폴더 동기화 경고:', e.message));
            redrawAfterRestore();
            await pruneUnreadCopies(); // 읽지 못한 저장본 대신 되살렸으면 이제 오래된 사본을 정리한다(새것 셋만)

            window.showAlert(`백업 파일로 과정 전체를 되살렸습니다.${historyMergeNote(extras.historyDropped, '파일')}`);
        }

    } catch (e) {
        logImportFailure('ZIP 불러오기 오류:', e); // 일부러 멈춘 것(백업이 아닌 ZIP 등)은 경고로, 그 밖은 오류로
        window.showAlert(isBackupTooBig(e) ? BACKUP_TOO_BIG_TEXT.openFile : `백업 파일을 되살리지 못했습니다: ${e.message}`);
    } finally {
        event.target.value = ''; // 재업로드를 위해 인풋 리셋
    }
};


// =========================================================================
// 산출물 로컬 디스크 저장 (File System Access API)
// =========================================================================

/**
 * base64 Data URL → Uint8Array 바이너리 변환 헬퍼
 */
function base64ToUint8Array(b64DataUrl) {
    const base64 = b64DataUrl.split(',')[1];
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/**
 * FileSystemDirectoryHandle 에 텍스트 파일 쓰기 헬퍼
 */
async function writeTextFile(dirHandle, fileName, content) {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
        await writable.write(content);
    } catch (err) {
        await writable.abort?.().catch(() => {}); // 쓰다 실패하면 바꾸지 않고 닫는다(예전 파일은 그대로, 같은 파일에 다시 쓸 수 있게)
        throw err;
    }
    await writable.close();
}

/**
 * FileSystemDirectoryHandle 에 바이너리 파일 쓰기 헬퍼
 */
async function writeBinaryFile(dirHandle, fileName, uint8Array) {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(uint8Array);
    await writable.close();
}


// =========================================================================
// 로컬 프로젝트 폴더 실시간 연결/동기화 시스템 (Phase F7)
// =========================================================================

/**
 * 프로젝트 폴더 연결 — 사용자가 폴더를 선택하면 이후 모든 saveState() 호출 시
 * 해당 폴더에 자동으로 데이터를 동기화합니다.
 */
window.connectProjectFolder = async function () {
    if (isStateLoadFailed()) return showStateLoadFailedDialog(); // 저장된 작업을 읽지 못한 동안은 폴더에 쓰기 시작하지 않는다
    if (!('showDirectoryPicker' in window)) {
        return window.showAlert('이 브라우저는 폴더 연결을 지원하지 않습니다.\nChrome 또는 Edge를 사용해주세요.');
    }

    try {
        const dirHandle = await window.showDirectoryPicker({
            mode: 'readwrite'
        });
        // 이미 저장본이 있는 폴더면 덮어쓰기 전에 묻고, 기존 저장본은 다른 이름으로 남긴다
        if (!(await confirmFolderOverwrite(dirHandle))) return;
        // 표시를 먼저 바꾸고 저장한다(첫 저장이 실패하면 그 알림이 남는다)
        useLinkedFolder(dirHandle);
        await rememberFolderHandle(dirHandle);

        // 연결 즉시 현재 상태를 폴더에 저장. 실패했으면 띠로 알렸으므로 연결 알림을 띄우지 않는다
        if (!(await syncToLinkedFolder())) return;

        window.showToast(`[${dirHandle.name}] 폴더가 연동되었습니다. 이후 모든 변경사항이 자동 동기화됩니다.`);

    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('폴더 연결 오류:', err);
            window.showAlert('폴더 연결 중 오류가 발생했습니다: ' + err.message);
        }
    }
};

/**
 * 프로젝트 폴더 연결 해제
 */
window.disconnectProjectFolder = async function () {
    projectFolderHandle = null;
    folderWriteCache = null; // 다음에 다시 이으면 폴더의 파일을 처음부터 다시 확인한다

    // [추가] DB에서 핸들 삭제
    if (typeof DBManager !== 'undefined') {
        try {
            await DBManager.deleteItem('projectFolderHandle');
        } catch (dbErr) {
            console.warn('DB에서 폴더 핸들을 삭제하는 데 실패했습니다:', dbErr);
        }
    }

    document.getElementById('folder-connection-indicator').innerHTML = `
        <i class="ph ph-folder-dashed text-sm text-white/60"></i>
        <span class="text-white/60">PC 폴더 저장 꺼짐</span>
    `;
    // 클릭 시 바로 연결 창 띄우기 (PC 폴더 저장 꺼짐)
    document.getElementById('folder-connection-indicator').onclick = () => window.connectProjectFolder();
    window.showToast('폴더 연동이 해제되었습니다.');
};

/**
 * FileSystemDirectoryHandle의 권한을 확인하고 필요시 요청합니다.
 * @param {FileSystemDirectoryHandle} handle
 * @param {boolean} requestIfNotGranted 클릭 이벤트 컨텍스트 내부 등에서 권한을 물어봐도 되는지 여부
 * @returns {Promise<boolean>} 권한이 부여되었으면 true, 아니면 false
 */
async function verifyPermission(handle, requestIfNotGranted = false) {
    const options = { mode: 'readwrite' };
    let permission = await handle.queryPermission(options);
    if (permission === 'granted') {
        return true;
    }

    // 사용자 클릭 상호작용 없이 requestPermission을 시도하면 브라우저 보안에 의해 에러 팝업/차단이 발생함
    if (requestIfNotGranted) {
        permission = await handle.requestPermission(options);
        return permission === 'granted';
    }
    return false;
}

const FOLDER_LOCKED_MESSAGE = 'PC 폴더 쓰기 권한이 풀려 자동 저장을 멈췄습니다. 지금 작업은 브라우저에만 저장됩니다.';
const FOLDER_REOPENED_MESSAGE = '브라우저를 다시 열어 PC 폴더 자동 저장이 멈췄습니다. 지금 작업은 브라우저에만 저장됩니다.';
const FOLDER_CHANGED_MESSAGE = '이 브라우저가 마지막으로 저장한 뒤 PC 폴더의 저장본이 바뀌었거나(다른 PC나 브라우저에서 저장) 확인할 수 없어, 덮어쓰지 않도록 자동 저장을 멈췄습니다. 지금 작업은 브라우저에만 저장됩니다.';
const FOLDER_BEHIND_MESSAGE = "지난번에 브라우저에 저장하지 못한 작업이 PC 폴더에만 저장되어 있어, 덮어쓰지 않도록 자동 저장을 멈췄습니다. 그 작업을 되찾으려면 내보내기·백업 → '저장해 둔 폴더 열기'로 이 폴더를 여세요.";

// 이 폴더에 자동 저장을 켠다(머리줄·드롭다운·실패 알림 정리). 저장은 부른 쪽이 한다. 표시를 먼저 바꾸므로 첫 저장이 실패하면 그 알림이 남는다
function useLinkedFolder(handle) {
    projectFolderHandle = handle;
    folderWriteCache = null;
    folderSyncFailed = false;
    setFolderIndicator('on', handle.name);
    window.hideFolderSyncBanner?.();
    const indicator = document.getElementById('folder-connection-indicator');
    if (indicator) indicator.onclick = toggleFolderDropdown;
}

// 새로고침 뒤에도 같은 폴더에 이어 저장하도록 손잡이를 기억한다(브라우저 정책상 DataCloneError가 나면 넘어간다)
async function rememberFolderHandle(handle) {
    try {
        await DBManager.setItem('projectFolderHandle', handle);
    } catch (dbErr) {
        console.warn('폴더 연결은 됐지만 새로고침 뒤 이어 쓰도록 기억하지 못했습니다:', dbErr);
    }
}

// 새로고침 뒤 이어 쓸 폴더를 잊는다(지금 창의 연결은 그대로. 지우지 못해도 넘어간다)
async function forgetFolderHandle() {
    try {
        await DBManager.deleteItem('projectFolderHandle');
    } catch (dbErr) {
        console.warn('새로고침 뒤 이어 쓸 폴더를 잊지 못했습니다:', dbErr);
    }
}

// 자동 저장을 멈추고 머리줄과 띠의 '다시 연결'로만 다시 잇는다(권한 창은 사용자가 누를 때만 뜬다). 손잡이는 IndexedDB에 두어 새로고침해도 다시 연결할 수 있다
function lockLinkedFolder(handle, message) {
    projectFolderHandle = null;
    folderSyncFailed = false;
    setFolderIndicator('locked', handle.name);
    const indicator = document.getElementById('folder-connection-indicator');
    if (indicator) indicator.onclick = () => regrantLinkedFolder(handle, message);
    showFolderSyncBanner(message, '다시 연결', () => regrantLinkedFolder(handle, message));
}

// '다시 연결': 클릭 안에서 권한을 다시 받고 바로 저장해 그동안 브라우저에만 저장된 변경을 폴더에 옮긴다.
// 이 브라우저가 마지막으로 쓴 뒤 저장본이 다른 곳에서 바뀌었으면 덮어쓰기 전에 묻고 기존 저장본은 사본으로 남긴다. 거절·취소하면 멈춘 채로 둔다
async function regrantLinkedFolder(handle, message = FOLDER_LOCKED_MESSAGE) {
    try {
        if (!(await verifyPermission(handle, true))) return lockLinkedFolder(handle, message);
        const changed = await folderSaveChangedElsewhere(handle); // '' | 'changed' | 'behind'
        if (changed && !(await confirmFolderOverwrite(handle, { changed }))) return lockLinkedFolder(handle, changed === 'behind' ? FOLDER_BEHIND_MESSAGE : FOLDER_CHANGED_MESSAGE);
        useLinkedFolder(handle);
        if (await syncToLinkedFolder()) window.showToast(`[${handle.name}] 폴더에 다시 저장했습니다. 이후 바뀐 내용도 자동으로 저장합니다.`, 'success');
    } catch (err) {
        console.error('[PC 폴더] 다시 연결 실패:', err);
        lockLinkedFolder(handle, message);
        window.showAlert(`PC 폴더에 다시 연결하지 못했습니다(${err?.message || '알 수 없는 오류'}). 다시 눌러 보거나 다른 폴더를 고르세요.`);
    }
}

/* ---------- 이 브라우저가 마지막으로 쓴 저장본의 이름표 (그 뒤에 다른 PC·브라우저가 썼는지 알아본다) ---------- */
const FOLDER_STAMP_KEY = 'teacher:folder-save-stamp';

// save_data.yaml을 쓴 뒤 그 크기·고친 시각을 이 브라우저에 남긴다(못 남겨도 저장은 된 것이다).
// browserBehind: 이 저장본에 든 작업을 브라우저에는 저장하지 못했다(새로고침하면 브라우저의 옛 작업이 열리므로 폴더에 이어 쓰지 않고 묻는다)
async function rememberFolderSaveStamp(handle, browserBehind = false) {
    try {
        const file = await (await handle.getFileHandle('save_data.yaml')).getFile();
        localStorage.setItem(FOLDER_STAMP_KEY, JSON.stringify({ name: handle.name, size: file.size, modified: file.lastModified, ...(browserBehind ? { browserBehind: true } : {}) }));
    } catch (err) {
        console.warn('[PC 폴더] 저장본 이름표를 남기지 못했습니다:', err.message);
    }
}

// 이 브라우저가 마지막으로 남긴 폴더 저장본 이름표 { name, size, modified, browserBehind }. 없거나 읽지 못하면 null
function readFolderSaveStamp() {
    try {
        const stamp = JSON.parse(localStorage.getItem(FOLDER_STAMP_KEY) || 'null');
        return stamp && typeof stamp === 'object' ? stamp : null;
    } catch (err) {
        return null;
    }
}

// 이 브라우저가 마지막으로 쓴 뒤 그 폴더의 save_data.yaml이 바뀌었는지: 'changed'(다른 곳에서 바뀌었거나 읽지 못함. 묻는 쪽이 안전),
// 'behind'(그대로지만 이 브라우저가 쓴 그 저장본의 작업을 브라우저에는 저장하지 못했다. 폴더가 브라우저보다 새것이다), ''(바뀌지 않음).
// 이름표가 없거나 다른 폴더 것이면 알 수 없어 '', 저장본이 없으면 ''(지킬 것이 없다)
async function folderSaveChangedElsewhere(handle) {
    const stamp = readFolderSaveStamp();
    if (!stamp || stamp.name !== handle.name) return '';
    try {
        const file = await (await handle.getFileHandle('save_data.yaml')).getFile();
        if (file.size !== stamp.size || file.lastModified !== stamp.modified) return 'changed';
        return stamp.browserBehind ? 'behind' : '';
    } catch (err) {
        return err?.name === 'NotFoundError' ? '' : 'changed';
    }
}

/**
 * 페이지 로드 시 IndexedDB에 저장된 프로젝트 폴더 연결을 복원합니다.
 */
window.restoreProjectFolderConnection = async function () {
    if (!('showDirectoryPicker' in window) || typeof DBManager === 'undefined') {
        return;
    }

    try {
        let storedHandle = null;
        try {
            storedHandle = await DBManager.getItem('projectFolderHandle');
        } catch (dbErr) {
            console.warn('DB에서 폴더 핸들 읽기 실패:', dbErr);
            return; // 읽기에 실패했다면 복원 중단
        }

        if (storedHandle) {
            // 처음 열 때는 권한 창을 띄우지 못하므로 상태만 본다. 권한이 있으면 바로 이어 쓰고(다음 저장에서 씀), 없으면 '다시 연결'을 기다린다.
            // 이 브라우저가 마지막으로 쓴 뒤 다른 곳에서 저장본이 바뀌었으면 덮어쓰지 않게 멈추고 '다시 연결'에서 묻는다
            // 지난번에 브라우저에 저장하지 못한 작업이 폴더에만 있으면(폴더가 앞섰다) 브라우저의 옛 작업이 그 폴더를 덮지 않게 멈추고, 폴더 열기로 되찾게 알린다
            const stamp = readFolderSaveStamp();
            if (stamp?.browserBehind && stamp.name === storedHandle.name) {
                lockLinkedFolder(storedHandle, FOLDER_BEHIND_MESSAGE);
            } else if (!(await verifyPermission(storedHandle, false))) {
                console.warn('저장된 폴더 핸들의 권한이 만료되었습니다. 클릭을 통해 재인증이 필요합니다.');
                lockLinkedFolder(storedHandle, FOLDER_REOPENED_MESSAGE);
            } else if (await folderSaveChangedElsewhere(storedHandle)) {
                lockLinkedFolder(storedHandle, FOLDER_CHANGED_MESSAGE);
            } else {
                useLinkedFolder(storedHandle);
            }
        }
    } catch (e) {
        console.error('폴더 연결 복원 중 오류 발생:', e);
        await window.disconnectProjectFolder();
    }
}

/**
 * 연결된 프로젝트 폴더에서 데이터 불러오기
 */
window.loadFromProjectFolder = async function () {
    if (!('showDirectoryPicker' in window)) {
        return window.showAlert('이 브라우저는 폴더 불러오기를 지원하지 않습니다.');
    }

    try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        // 미뤄 둔 저장과 돌던 폴더 저장을 먼저 마친다(연결된 폴더를 다시 열 때 옛 저장본을 읽지 않게)
        await flushSaveStateSoon();
        await waitFolderSync();

        // save_data.yaml을 찾는다. 없으면 예전 이름 save_data.json(JSON)
        let saveDataHandle;
        let isYaml = true;
        try {
            saveDataHandle = await dirHandle.getFileHandle('save_data.yaml');
        } catch (e) {
            try {
                saveDataHandle = await dirHandle.getFileHandle('save_data.json');
                isYaml = false;
            } catch (e2) { return window.showAlert('유효한 프로젝트 폴더가 아닙니다.\nsave_data.yaml 파일을 찾을 수 없습니다.'); }
        }

        const text = await (await saveDataHandle.getFile()).text();
        const saved = isYaml ? simpleYamlParse(text) : safeJSONParse(text);
        const savedState = saved?.state;
        const saveFileName = isYaml ? 'save_data.yaml' : 'save_data.json';
        const noSubjects = `이 폴더의 저장본(${saveFileName})에는 되살릴 교과가 없습니다.`;
        // 풀지 못했거나 모양이 틀린 저장본은 빈 저장본과 다르게 알린다(망가진 것이지 비어 있는 것이 아니다)
        if (!savedState || typeof savedState !== 'object' || Array.isArray(savedState)) return window.showAlert(folderSaveUnreadableText(saveFileName));

        // 저장본이 가리키는 그림만 파일마다 읽는다. 빠진 수를 확인 창에 보이려고 바꾸기 전에 읽는다. 새 상태도 확인 창보다 먼저 만들고 검사한다(아직 아무것도 바꾸지 않는다).
        // 교과가 없으면 묻지 않고 멈춘다(지금 작업은 그대로). 읽지 못한 저장본 대신 열 때는 받을 지금 작업이 없어 백업 대신 그 저장본을 따로 옮겨 둔다
        const images = await readFolderImages(dirHandle, saved);
        const nextState = sanitizeState(images.value.state);
        if (!nextState.subjects.length) return window.showAlert(noSubjects);
        const unread = isStateLoadFailed();
        const imageNote = saved.imageMode === 'none' ? noImagesImportNote('folder', currentImageCount()) : ''; // 그림을 빼고 저장된 폴더
        const ask = folderOpenPrompt({ folderName: dirHandle.name, subjectCount: globalState.subjects.length, incomingCount: nextState.subjects.length, unread, total: images.total, missing: images.missing, imageNote });
        if (!(await confirmAsync(ask.message, { okLabel: ask.okLabel, title: '작업 폴더에서 불러오기' }))) return;
        // 읽지 못한 저장본이 이제 열리면 그 작업을 이 폴더로 바꾸지 않는다(새로 시작과 같은 규칙)
        if (unread && await storedRecordStatus() === 'loads') return window.showAlert(unreadNowLoadsText('이 폴더로 바꾸지'));

        // 첫 저장이 save_data.yaml을 다시 쓰기 전에 지금 파일을 다른 이름으로 남긴다. 못 남기면 아무것도 바꾸지 않고 멈춘다
        // (예전 save_data.json만 있는 폴더는 첫 저장이 새 save_data.yaml을 만들고 save_data.json은 건드리지 않는다)
        let keptName = '';
        if (isYaml) {
            try {
                keptName = await freeFolderCopyName(dirHandle);
                await writeTextFile(dirHandle, keptName, text);
            } catch (copyErr) {
                console.warn('[폴더 열기] 저장본 사본을 남기지 못했습니다:', copyErr);
                return window.showAlert(`'${dirHandle.name}' 폴더의 저장본(save_data.yaml)을 다른 이름으로 남기지 못해 열기를 멈췄습니다. 지금 작업은 바뀌지 않았습니다. (${copyErr?.message || '알 수 없는 오류'})`);
            }
        }

        if (unread) {
            await setAsideUnreadState(); // 읽지 못한 저장본을 따로 옮겨 두고 예전 폴더 연결을 잊는다(아래에서 이 폴더로 다시 잇는다)
        } else {
            window.saveRawContent?.(); // 고치던 원문을 먼저 저장해 백업에 들어가게 한다
            if (!(await safetyBackupOrAsk('폴더연결전'))) return; // 받지 못하면 까닭을 알리고 백업 없이 계속할지 묻는다
            await archiveContents((courseData || []).filter(Boolean), '불러오기 전');
        }

        // 휴지통·작업 기록은 지금 것과 폴더 것을 합친다(백업 ZIP 되살리기와 같은 규칙). 방금 남긴 '불러오기 전' 기록도 들어가게 archiveContents 다음에 한다.
        // 넣지 못한 폴더의 기록이 그대로 남는 곳(열기 전에 남긴 사본, 예전 save_data.json 폴더는 그 파일)도 마침 알림에 적는다.
        // 같은 기록·휴지통 항목은 이 브라우저 것을 남기므로, 이 브라우저 것에 남은 찾지 못한 그림 자리(teacher-image:…)도 폴더의 그림 파일로 채운다
        // (그림 파일을 채운 뒤 폴더를 다시 열면 작업 기록·휴지통의 그림도 돌아오게)
        const current = { history: contentHistory, lessonTrash: globalState.lessonTrash, subjectTrash: globalState.subjectTrash };
        const mine = Object.keys(images.files).length ? attachBackupImages(current, images.files) : current;
        const merged = mergeBackupExtras(
            { history: images.value.history, trash: { lessonTrash: nextState.lessonTrash, subjectTrash: nextState.subjectTrash } },
            mine
        );
        const extras = { ...merged, historyDropped: { ...merged.historyDropped, keptIn: isYaml ? keptName : 'save_data.json' } };
        const firstSubject = nextState.subjects[0] || null;
        const folderMode = folderImageModeOf(saved);
        const modeChanged = folderMode !== folderImageMode();

        // 한 번에 바꾼다(이 사이에는 기다리지 않는다)
        globalState = Object.assign(nextState, { lessonTrash: extras.lessonTrash, subjectTrash: extras.subjectTrash });
        contentHistory = extras.history;
        currentSubjectId = firstSubject ? firstSubject.id : null;
        courseData = firstSubject ? (firstSubject.lessons || []) : [];
        markStateLoaded(); // 읽지 못한 상태였으면 끝낸다(다시 저장하고 막는 창을 닫는다)
        closeLessonEditor();
        if (modeChanged) setBackupImageMode(folderMode); // 이 폴더가 그림을 담아 온 방식으로 이어 저장한다
        useLinkedFolder(dirHandle);

        // 새로고침 뒤 이 폴더에 이어 쓰는 것은 연 작업을 브라우저에 저장한 뒤에야 기억하고, 그 전에 앞서 기억한 폴더는 잊는다.
        // 그 사이에 창이 닫히거나 브라우저 저장이 실패해도, 다시 열 때 브라우저에 남은 옛 작업이 이 폴더나 앞 폴더의 저장본을 덮지 않게
        await forgetFolderHandle();
        const browserSaved = await saveState();
        if (browserSaved) await rememberFolderHandle(dirHandle);
        redrawAfterRestore(); // 개요가 이미 열려 있어도 옛 과정이 남지 않게 다시 그린다

        // 첫 폴더 저장이 끝난 뒤 결과대로 알린다(실패했으면 화면 위 띠가 까닭을 알린다)
        await waitFolderSync();
        const synced = projectFolderHandle === dirHandle && !folderSyncFailed;
        window.showAlert(folderOpenedMessage({ folderName: dirHandle.name, synced, browserSaved, unread, keptName, missing: images.missing, mode: modeChanged ? folderMode : '', wasNone: saved.imageMode === 'none' })
            + historyMergeNote(extras.historyDropped, '폴더')); // 작업 기록을 다 넣지 못했으면 몇 개인지, 그 기록이 어디에 남는지 덧붙인다
    } catch (e) {
        if (e.name === 'AbortError') return;
        logImportFailure('폴더 불러오기 오류:', e); // 권한 거절·크기 한도는 경고로, 그 밖은 오류로
        window.showAlert(isBackupTooBig(e) ? BACKUP_TOO_BIG_TEXT.openFolder : '폴더 불러오기 중 오류가 발생했습니다: ' + e.message);
    }
}

/* ---------- PC 폴더 저장 줄 세우기 ---------- */
// 저장이 겹치면 늦게 시작한 저장이 먼저 끝나 옛 상태가 마지막에 남을 수 있다(그림을 따로 담으면 save_data.yaml을 그림 뒤에 쓴다).
// 한 번에 하나만 돌리고, 도는 동안 들어온 요청은 하나로 합쳐 끝난 뒤 그때의 최신 상태로 한 번 더 쓴다
const folderSyncRunner = createSerialRunner(syncLinkedFolderNow);

// 연결된 폴더에 저장한다(saveState 등이 부른다). 저장했으면 true, 실패하면 화면 위 띠로 알리고 false
function syncToLinkedFolder() {
    return folderSyncRunner.request();
}

// 도는 폴더 저장과 기다리는 폴더 저장이 모두 끝나면 풀린다
function waitFolderSync() {
    return folderSyncRunner.idle();
}

// 이 앱을 연 뒤 이 폴더에 쓰거나 확인한 파일(메모리에만 둔다). 같은 내용을 다시 쓰지 않는다. 폴더가 바뀌거나 저장이 실패하면 버린다
let folderWriteCache = null;

function folderWriteCacheFor(handle) {
    if (!folderWriteCache || folderWriteCache.handle !== handle) {
        folderWriteCache = { handle, images: new Set(), imageInfo: null, attachments: new Map(), texts: new Map() };
    }
    return folderWriteCache;
}

// 지금 상태를 연결된 폴더에 쓴다. 손잡이와 상태를 처음에 함께 잡아, 도중에 폴더나 상태가 바뀌어도 섞어 쓰지 않는다
async function syncLinkedFolderNow() {
    const handle = projectFolderHandle;
    if (!handle || stateLoadFailed) return false; // 저장된 작업을 읽지 못한 동안은 폴더에도 쓰지 않는다
    const snapshot = { state: globalState, history: contentHistory, subjectId: currentSubjectId, lessons: courseData };
    const browserBehind = lastBrowserSaveFailed; // 이 상태를 브라우저에는 저장하지 못했다(폴더 저장본 이름표에 적는다)
    const cache = folderWriteCacheFor(handle);
    try {
        // 권한이 풀렸으면 묻지 않고 멈춘다(저장은 클릭 없이 돌아 브라우저가 권한 창을 띄우지 못한다)
        if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
            if (projectFolderHandle === handle) lockLinkedFolder(handle, FOLDER_LOCKED_MESSAGE);
            return false;
        }

        // 1. save_data.yaml(전체 상태 + 작업 기록). 그림 파일을 먼저 쓰고 save_data.yaml을 쓴다(저장본이 아직 없는 그림 파일을 가리키지 않게).
        //    그림은 '함께'나 '따로·가볍게'로만 담는다(data-safety.js folderImageMode). '함께'가 크기 한도에 걸리면 '따로·가볍게'로 바꿔 다시 쓰고 한 번 알린다
        const fullData = { state: snapshot.state, history: snapshot.history, lastSync: new Date().toISOString() };
        const written = await withSeparateFallback(folderImageMode(), async mode => {
            const saveData = mode === 'inline' ? fullData : await writeFolderImages(handle, fullData, mode, cache);
            await writeTextFile(handle, 'save_data.yaml', simpleYamlStringify(saveData));
        });
        if (written.switched) notifyBackupFallback('folder');
        await rememberFolderSaveStamp(handle, browserBehind);

        // 2. 지금 교과의 차시 MD와 첨부 그림(사람이 읽는 사본, 되살리기에는 쓰지 않는다)
        await writeSubjectExport(handle, snapshot, cache);

        if (projectFolderHandle === handle) markFolderSyncOk(); // 다시 저장되면 실패 알림을 거둔다
        return true;
    } catch (e) {
        if (folderWriteCache === cache) folderWriteCache = null; // 다음 저장에서 폴더의 파일을 처음부터 다시 확인한다
        console.warn('폴더 동기화 실패:', e.message);
        if (projectFolderHandle !== handle) return false; // 그사이 폴더를 바꿨거나 껐으면 지금 표시를 건드리지 않는다
        // 상태 캐시 에러 처리 (크롬 버그 등 대응)
        if (e.message && e.message.includes('state cached in an interface object')) {
            console.warn('File System 핸들 만료 문제. 연결 해제 처리합니다.');
            projectFolderHandle = null;
            await window.disconnectProjectFolder();
            notifyFolderStopped();
            return false;
        }
        // 쓰는 도중 권한이 풀렸으면 끄지 않고 멈춘다('다시 연결'로 이어 쓴다)
        if (e.name === 'NotAllowedError') {
            lockLinkedFolder(handle, FOLDER_LOCKED_MESSAGE);
            return false;
        }
        // 폴더가 옮겨졌거나 지워졌으면 자동 저장을 끈다
        if (e.name === 'NotFoundError') {
            projectFolderHandle = null;
            await window.disconnectProjectFolder();
            notifyFolderStopped();
            return false;
        }
        markFolderSyncFailed(e); // 저장만 실패했으면 연결은 두고 화면 위에 알린다
        return false;
    }
}

// 폴더에 쓰는 파일·폴더 이름. 과정·교과 이름과 그림 이름은 불러온 파일에서 올 수도 있다. 경로를 나누거나 Windows가 받지 않는 글자는 '_'로 바꾸고,
// 비거나 점뿐이면('.', '..') fallback을 쓴다(브라우저는 그런 이름에 TypeError를 내어 폴더 저장이 매번 실패한다)
function folderEntryName(name, fallback) {
    const safe = String(name ?? '').replace(/[\/\?<>\\:\*\|"\u0000-\u001f]/g, '_').trim();
    return /^[.\s]*$/.test(safe) ? fallback : safe;
}

// 지금 교과의 차시 MD와 첨부 그림(사람이 읽는 사본). 이 앱을 연 뒤 이 폴더에 같은 내용으로 쓴 파일은 다시 쓰지 않는다.
// 기억은 이번 저장에서 쓴 파일만 남긴다(지운 그림·다른 교과의 사본을 메모리에 붙잡아 두지 않게)
async function writeSubjectExport(handle, snapshot, cache) {
    const subj = snapshot.state.subjects.find(s => s.id === snapshot.subjectId);
    const lessons = snapshot.lessons;
    if (!subj || !Array.isArray(lessons) || lessons.length === 0) return;
    const safeCourseName = folderEntryName(snapshot.state.courseTitle, '새_교안프로젝트');
    const safeSubjName = folderEntryName(subj.title, `교과_${subj.id}`);
    const courseFolder = await handle.getDirectoryHandle(safeCourseName, { create: true });
    const target = {
        cache,
        next: { attachments: new Map(), texts: new Map() },
        base: safeCourseName,
        subjName: safeSubjName,
        attachFolder: await courseFolder.getDirectoryHandle('첨부파일', { create: true }),
        subjFolder: await courseFolder.getDirectoryHandle(safeSubjName, { create: true })
    };
    for (const m of lessons) {
        if (m && m.content) await writeLessonMd(m, subj, target);
    }
    // 최종 평가 별도 저장
    if (subj.mainQuest && subj.mainQuest.content) await writeLessonMd(subj.mainQuest, subj, target);
    cache.attachments = target.next.attachments;
    cache.texts = target.next.texts;
}

// 차시 하나의 MD. 그림 자리는 첨부 그림 경로로 바꾼다(그림 id로 정규식을 만들지 않고 정해 둔 모양에서 찾은 id를 견준다. 백업 ZIP과 같은 규칙,
// data-safety.js relinkLocalImages). 지난번과 같은 글이면 쓰지 않는다
async function writeLessonMd(m, subj, target) {
    const { cache, next, base, subjName, subjFolder } = target;
    const names = new Map(); // 그림 id → 첨부 파일 이름
    for (const [imgId, b64] of Object.entries(m.images || {})) {
        const imgFileName = await writeAttachedImage(imgId, b64, target);
        if (imgFileName) names.set(imgId, imgFileName);
    }
    const markdownContent = relinkLocalImages(String(m.content), names);
    const safeName = folderEntryName(lessonFileName(m, 'md', subj), 'export.md');
    const text = `# ${m.title}\n\n` + markdownContent;
    const textKey = `${base}/${subjName}/${safeName}`;
    // 이번 저장에서 같은 이름으로 먼저 쓴 글이 있으면 그것과 견준다(이름 규칙에 차시 번호가 없으면 두 차시가 한 파일에 쓰고, 마지막 차시가 남는다)
    const previous = next.texts.has(textKey) ? next.texts.get(textKey) : cache.texts.get(textKey);
    if (previous !== text) await writeTextFile(subjFolder, safeName, text);
    next.texts.set(textKey, text);
}

// 첨부 그림 파일을 쓰고 파일 이름을 돌려준다. 이 앱을 연 뒤 이 폴더에 같은 그림을 이미 썼으면 다시 쓰지 않는다. 그림이 아니면(빈 글·참조) null.
// 이번 저장에서 쓴 것을 먼저 본다(두 차시가 같은 그림 이름을 쓰면 마지막 그림이 남는다)
async function writeAttachedImage(imgId, b64, { cache, next, base, attachFolder }) {
    const cacheKey = `${base}/${imgId}`;
    const known = next.attachments.get(cacheKey) || cache.attachments.get(cacheKey);
    if (known && known.data === b64) {
        next.attachments.set(cacheKey, known);
        return known.name;
    }
    const matches = typeof b64 === 'string' ? b64.match(/^data:(image\/\w+);base64,(.*)$/) : null;
    if (!matches) return null;
    let ext = matches[1].split('/')[1];
    if (ext === 'jpeg') ext = 'jpg';
    const name = folderEntryName(`${imgId}.${ext}`, `그림.${ext}`);
    await writeBinaryFile(attachFolder, name, base64ToUint8Array(b64));
    next.attachments.set(cacheKey, { data: b64, name });
    return name;
}

/* ---------- PC 폴더의 '그림' 폴더 (그림을 따로 담을 때) ---------- */
// 그림을 떼어 '그림/'에 쓰고 그림 대신 이름이 든 저장 내용을 돌려준다. 같은 내용이면 같은 이름이다.
// cache가 있으면 이 앱을 연 뒤 쓰거나 크기를 맞춰 본 이름은 건너뛰고, 처음 보는 이름만 크기를 본다(크기가 다르면 없거나 쓰다 끊긴 파일로 보고 다시 쓴다)
async function writeFolderImages(dirHandle, data, mode, cache = null) {
    const { value, files, memo } = detachBackupImages(data, mode, cache?.imageInfo);
    if (mode === 'separate') {
        const imageDir = await dirHandle.getDirectoryHandle(BACKUP_IMAGE_DIR, { create: true });
        for (const dataUrl of Object.values(files)) {
            const info = memo.get(dataUrl);
            if (!info || cache?.images.has(info.name)) continue;
            if (await folderFileSize(imageDir, info.name) !== info.bytes) {
                await writeBinaryFile(imageDir, info.name, base64ToUint8Array(dataUrl));
            }
            cache?.images.add(info.name);
        }
    }
    if (cache) cache.imageInfo = memo;
    return { ...value, imageMode: mode };
}

// 폴더 안 파일의 바이트 수. 없으면 -1
async function folderFileSize(dirHandle, name) {
    try {
        return (await (await dirHandle.getFileHandle(name)).getFile()).size;
    } catch (err) {
        if (err.name === 'NotFoundError') return -1;
        throw err;
    }
}

// 저장본이 가리키는 그림만 '그림' 폴더에서 파일마다 따로 읽어 제자리에 돌려놓는다. 가리키지 않는 파일은 읽지 않는다.
// 찾지 못했거나 읽지 못했거나 내용이 이름과 맞지 않는(빈 파일, 복사가 끊긴 파일) 그림은 참조를 그대로 둔다. 그림을 담은 방식과 상관없이 참조가 있으면 읽는다.
// 돌려주는 값: { value, files: 읽은 그림(키 → data URL), total: 가리키는 그림 수, missing: 찾지 못했거나 읽지 못했거나 망가진 수 }
async function readFolderImages(dirHandle, saved) {
    const keys = backupImageRefs(saved);
    if (!keys.size) return { value: saved, files: {}, total: 0, missing: 0 };
    window.showToast?.(`폴더의 그림 ${keys.size}장을 읽고 있습니다...`, 'info');
    const files = {};
    let imageDir = null;
    try {
        imageDir = await dirHandle.getDirectoryHandle(BACKUP_IMAGE_DIR);
    } catch (err) {
        console.warn('[폴더 열기] 그림 폴더를 열지 못했습니다:', err.message);
    }
    if (imageDir) {
        const names = [];
        try {
            for await (const name of imageDir.keys()) names.push(name);
        } catch (err) {
            console.warn('[폴더 열기] 그림 폴더 목록을 끝까지 읽지 못했습니다:', err.message);
        }
        const byKey = backupImageFileNames(names);
        for (const key of keys) {
            const name = byKey.get(key);
            if (!name) continue;
            try {
                const buffer = await (await (await imageDir.getFileHandle(name)).getFile()).arrayBuffer();
                // 내용이 이름(키)과 맞는 파일만 받는다. 빈 파일·복사가 끊긴 파일을 받으면 다음 저장이 망가진 그림을 새 이름으로 써서 원래 그림을 가리키지 않게 된다
                const dataUrl = buffer.byteLength ? backupImageFromKeyedFile(key, name, uint8ToBase64(new Uint8Array(buffer))) : null;
                if (dataUrl) files[key] = dataUrl;
                else console.warn('[폴더 열기] 그림 파일이 비었거나 내용이 이름과 맞지 않습니다(복사가 끊겼을 수 있음):', name);
            } catch (err) {
                console.warn('[폴더 열기] 그림 파일을 읽지 못했습니다:', name, err.message);
            }
        }
    }
    return { value: attachBackupImages(saved, files), files, total: keys.size, missing: keys.size - Object.keys(files).length };
}

function uint8ToBase64(bytes) {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(binary);
}

/* ---------- PC 폴더 상태 표시와 멈춤 알림 ---------- */
let folderSyncFailed = false;

// 폴더 이름은 macOS 등에서 <, > 를 쓸 수 있어 escapeHtml로 넣는다
function folderIndicatorHtml(kind, name = '') {
    const safe = escapeHtml(name);
    if (kind === 'locked') return `<i class="ph-fill ph-folder-lock text-orange-400 text-sm"></i>
        <span class="text-orange-400/90 font-medium truncate max-w-[160px]">${safe} (눌러서 다시 연결)</span>`;
    if (kind === 'failed') return `<i class="ph-fill ph-warning text-rose-400 text-sm"></i>
        <span class="text-rose-300 font-medium truncate max-w-[160px]">PC 폴더 저장 실패</span>`;
    return `<i class="ph-fill ph-folder text-cyan-400 text-sm"></i>
        <span class="text-white/90 font-medium truncate max-w-[100px]">${safe}</span>
        <i class="ph-bold ph-caret-down text-[0.6875rem] text-white/50 ml-1"></i>`;
}

function setFolderIndicator(kind, name) {
    const indicator = document.getElementById('folder-connection-indicator');
    if (indicator) indicator.innerHTML = folderIndicatorHtml(kind, name);
}

function showFolderSyncBanner(message, actionLabel, onAction) {
    const banner = document.getElementById('folder-sync-banner');
    if (!banner) return;
    document.getElementById('folder-sync-banner-text').textContent = message;
    const action = document.getElementById('folder-sync-banner-action');
    action.textContent = actionLabel;
    action.onclick = () => {
        window.hideFolderSyncBanner();
        onAction?.();
    };
    banner.classList.remove('hidden');
}

window.hideFolderSyncBanner = function () {
    document.getElementById('folder-sync-banner')?.classList.add('hidden');
};

function folderSyncFailureMessage(err) {
    if (isBackupTooBig(err)) return BACKUP_TOO_BIG_TEXT.folder;
    if (err?.name === 'QuotaExceededError') return 'PC 디스크 공간이 부족해 폴더에 저장하지 못했습니다. 브라우저에는 저장됐습니다.';
    return `PC 폴더에 저장하지 못했습니다(${err?.message || '알 수 없는 오류'}). 브라우저에는 저장됐습니다.`;
}

// 저장이 실패하면 한 번만 알린다. 다음 저장이 되면 markFolderSyncOk가 거둔다
function markFolderSyncFailed(err) {
    if (folderSyncFailed) return;
    folderSyncFailed = true;
    setFolderIndicator('failed', projectFolderHandle?.name || '');
    showFolderSyncBanner(folderSyncFailureMessage(err), '다른 폴더에 저장', () => window.connectProjectFolder());
}

function markFolderSyncOk() {
    if (!folderSyncFailed) return;
    folderSyncFailed = false;
    setFolderIndicator('on', projectFolderHandle?.name || '');
    window.hideFolderSyncBanner();
}

// 폴더에 닿지 못해 자동 저장을 껐을 때(폴더가 사라졌거나 브라우저가 손잡이를 잃음). 쓰기 권한이 풀린 것은 lockLinkedFolder가 따로 알린다
function notifyFolderStopped() {
    folderSyncFailed = false;
    showFolderSyncBanner('PC 폴더에 닿지 못해 자동 저장을 껐습니다(폴더가 옮겨졌거나 지워졌거나 브라우저가 폴더 연결을 잃었습니다). 지금 작업은 브라우저에만 저장됩니다.', '다른 폴더에 저장', () => window.connectProjectFolder());
}

// 고른 폴더에 저장본(save_data.yaml)이 있으면 덮어쓰기 전에 묻는다. 덮어쓰면 기존 파일은 다른 이름으로 남긴다
// { status: 'none' } 저장본 없음 / { status: 'ok', text } / { status: 'unreadable', error }
async function readFolderSave(dirHandle) {
    let handle;
    try {
        handle = await dirHandle.getFileHandle('save_data.yaml');
    } catch (err) {
        if (err.name === 'NotFoundError' || err.name === 'TypeMismatchError') return { status: 'none' };
        return { status: 'unreadable', error: err };
    }
    try {
        return { status: 'ok', text: await (await handle.getFile()).text() };
    } catch (err) {
        return { status: 'unreadable', error: err };
    }
}

const FOLDER_SUMMARY_MAX = 5 * 1024 * 1024; // 이보다 크면 요약을 건너뛴다(화면이 멈추지 않게)

function folderSaveSummary(text) {
    if (text.length > FOLDER_SUMMARY_MAX) return '';
    try {
        const parsed = simpleYamlParse(text);
        const count = parsed?.state?.subjects?.length;
        const time = parsed?.lastSync ? new Date(parsed.lastSync) : null;
        const when = time && !Number.isNaN(time.getTime()) ? time.toLocaleString() : '';
        return [Number.isFinite(count) ? `교과 ${count}개` : '', when ? `마지막 저장 ${when}` : ''].filter(Boolean).join(', ');
    } catch (err) {
        console.warn('[폴더 연결] 기존 저장본 요약 실패:', err.message);
        return '';
    }
}

const FOLDER_COPY_TRIES = 50;

// 폴더에 아직 없는 저장본 사본 이름(save_data_이전_날짜.yaml, 있으면 _2, _3…). 폴더를 읽지 못하면 오류를 낸다
async function freeFolderCopyName(dirHandle, stamp = backupStamp()) {
    for (let n = 1; n <= FOLDER_COPY_TRIES; n++) {
        const name = folderCopyName(stamp, n);
        if (await folderFileSize(dirHandle, name) === -1) return name;
    }
    throw new Error('저장본 사본 이름을 정하지 못했습니다');
}

// changed: '다시 연결'에서 저장본이 이 브라우저가 마지막으로 쓴 것과 다를 때 그 까닭('changed' 다른 곳에서 바뀜, 'behind' 브라우저에 저장하지 못한 작업이 폴더에만 있음).
// 첫 문장과 제목만 다르다. 저장본을 읽지 못하면 사본을 남길 수 없어 덮어쓰지 않고 false
async function confirmFolderOverwrite(dirHandle, { changed = '' } = {}) {
    const save = await readFolderSave(dirHandle);
    if (save.status === 'none') return true;
    if (save.status === 'unreadable') {
        console.warn('[폴더 연결] 기존 저장본을 읽지 못했습니다:', save.error);
        window.showAlert(changed
            ? `'${dirHandle.name}' 폴더의 저장본(save_data.yaml)을 읽지 못해 사본을 남길 수 없어 덮어쓰지 않았습니다. 자동 저장은 멈춘 채로 둡니다. 폴더의 파일을 확인한 뒤 '다시 연결'을 누르거나, 내보내기·백업 → '빈 폴더에 저장 시작'으로 다른 폴더를 고르세요.`
            : `'${dirHandle.name}' 폴더의 기존 저장본(save_data.yaml)을 읽지 못해 사본을 남길 수 없습니다. 덮어쓰지 않도록 연결을 멈췄습니다. 다른 빈 폴더를 골라 주세요.`);
        return false;
    }
    const existing = save.text;
    const summary = folderSaveSummary(existing);
    const keepName = await freeFolderCopyName(dirHandle);
    const head = changed === 'behind'
        ? `'${dirHandle.name}' 폴더의 저장본${summary ? `(${summary})` : ''}에는 지난번에 이 브라우저에 저장하지 못한 작업이 들어 있어, 지금 브라우저의 작업보다 새것일 수 있습니다.`
        : changed
            ? `이 브라우저가 마지막으로 저장한 뒤 '${dirHandle.name}' 폴더의 저장본이 바뀌었습니다${summary ? `(${summary})` : ''}. 다른 PC나 브라우저에서 저장했을 수 있습니다.`
            : `'${dirHandle.name}' 폴더에는 이미 저장해 둔 작업이 있습니다${summary ? `(${summary})` : ''}.`;
    const ok = await confirmAsync(
        `${head}\n\n`
        + `그 작업을 열려면 취소한 뒤 내보내기·백업 → '저장해 둔 폴더 열기'를 누르세요.\n`
        + `지금 작업으로 덮어쓰면 기존 저장본은 ${keepName}으로 남겨 둡니다.`,
        { okLabel: '지금 작업으로 덮어쓰기', title: changed === 'behind' ? '폴더에 더 새 작업이 있습니다' : changed ? '폴더 저장본이 바뀌었습니다' : '이 폴더에 저장본이 있습니다' }
    );
    if (!ok) return false;
    await writeTextFile(dirHandle, keepName, existing);
    return true;
}

/**
 * 히스토리 항목 1건을 연결된 폴더의 히스토리 디렉토리에 저장
 */
async function syncHistoryItemToFolder(historyItem) {
    if (!projectFolderHandle || !historyItem || stateLoadFailed) return; // 저장된 작업을 읽지 못한 동안은 폴더에 쓰지 않는다

    try {
        const historyFolder = await projectFolderHandle.getDirectoryHandle('히스토리', { create: true }); // linkedDirHandle -> projectFolderHandle

        // 타임스탬프 기반 고유 파일명
        const safeTitle = (historyItem.title || '').replace(/[\/\?<>\\:\*\|"]/g, '_').substring(0, 30);
        const fileName = `${historyItem.id}_${safeTitle}.json`;

        // 이미지 제외한 경량 메타만 저장 (용량 절약)
        const lightItem = {
            id: historyItem.id,
            title: historyItem.title,
            content: historyItem.content,
            date: historyItem.date,
            hasImages: historyItem.images ? Object.keys(historyItem.images).length : 0
        };

        await writeTextFile(historyFolder, fileName, JSON.stringify(lightItem, null, 2));
    } catch (e) {
        console.warn('히스토리 저장 실패:', e.message);
    }
}

/**
 * 폴더 연결 상태 UI 업데이트
 */
function updateFolderConnectionUI(connected, folderName = '') {
    const indicator = document.getElementById('folder-connection-indicator');
    if (!indicator) return;

    if (connected) {
        indicator.innerHTML = `<i class="ph-fill ph-folder-open text-sm text-emerald-400"></i> <span class="text-emerald-300">${folderName}</span>`;
        indicator.title = `연결됨: ${folderName} (클릭하여 해제)`;
        indicator.onclick = () => window.disconnectProjectFolder(); // Changed to call the new disconnect function
    } else {
        indicator.innerHTML = `<i class="ph ph-folder-dashed text-sm text-white/60"></i> <span class="text-white/60">PC 폴더 저장 꺼짐</span>`;
        indicator.title = 'PC 폴더 자동 저장이 꺼져 있습니다. 눌러서 빈 폴더를 고르면 켜집니다';
        indicator.onclick = () => connectProjectFolder();
    }
}

