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

    courseTitle: "게임 기획 전문가 양성 과정",

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

function sanitizeState(state) {
    if (!state) return null;
    state.courseId = state.courseId || "course_" + Date.now();
    state.courseTitle = state.courseTitle || "게임 기획 전문가 양성 과정";
    state.subjects = Array.isArray(state.subjects) ? state.subjects : [];

    state.subjects.forEach(s => {
        s.id = s.id || generateUniqueId('subject_');
        s.title = s.title || '제목 없음';
        s.description = s.description || '';
        s.namingConvention = s.namingConvention || '';
        s.referenceUrls = Array.isArray(s.referenceUrls) ? s.referenceUrls : [];
        s.referenceText = typeof s.referenceText === 'string' ? s.referenceText : '';
        s.autoSlide = typeof s.autoSlide === 'boolean' ? s.autoSlide : false;
        s.lessons = Array.isArray(s.lessons) ? s.lessons : [];
        s.mainQuest = s.mainQuest || {
            id: 'mainQuest', title: '메인 퀘스트', description: '최종 평가입니다.', status: 'waiting', content: null, images: {}
        };
        s.lessons.forEach(l => {
            l.id = l.id || generateUniqueId('lesson_');
            l.title = l.title || '차시';
            l.images = l.images || {};
            l.tabContents = l.tabContents || {
                basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null
            };
        });
    });
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

    async setItem(key, value) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
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
            const store = tx.objectStore(this.storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
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

async function saveState() {
    try {
        if (currentSubjectId) {
            const subject = globalState.subjects.find(s => s.id === currentSubjectId);
            if (subject) {
                subject.lessons = Array.isArray(courseData) ? courseData : [];
            }
        }

        // 1. IndexedDB에 무제한 비동기 저장 시도
        const stateData = { state: globalState, history: contentHistory };
        await DBManager.setItem(STORAGE_KEY, stateData);

    } catch (e) {
        console.error("IndexedDB 저장 실패", e);
        window.showAlert('데이터베이스 저장 중 오류가 발생했습니다. 브라우저 저장소 설정을 확인하세요.');
    }

    // 연결된 로컬 폴더 비동기 동기화 (UI 블로킹 방지)
    if (projectFolderHandle) {
        syncToLinkedFolder().catch(e => console.warn('폴더 동기화 경고:', e.message));
    }
}

async function restoreState() {
    try {
        // 1. IndexedDB에서 최우선 로드 (대용량 완벽 복원)
        let data = await DBManager.getItem(STORAGE_KEY);

        // 2. 만약 DB가 비어있다면, 기존 구버전 localStorage 데이터 마이그레이션 시도
        if (!data) {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                data = JSON.parse(raw);
                console.log("기존 localStorage 데이터를 IndexedDB로 마이그레이션합니다.");
                await DBManager.setItem(STORAGE_KEY, data); // 마이그레이션 후 저장
                // 마이그레이션 완료 후 쿼터 확보를 위해 삭제
                localStorage.removeItem(STORAGE_KEY);
            }
        } else {
            // 이미 마이그레이션이 끝났어도 남아있는 불필요한 localStorage 잔여물 삭제하여 API Key 등을 위한 쿼터 공간 100% 확보
            localStorage.removeItem(STORAGE_KEY);
        }

        if (data && data.state) {
            const sanitized = sanitizeState(data.state);
            if (sanitized) {
                globalState = sanitized;
            } else {
                await loadMockData();
            }
            contentHistory = Array.isArray(data.history) ? data.history : [];
        } else {
            await loadMockData();
        }

    } catch (e) {
        console.error("Failed to restore state from DB", e);
        await loadMockData();
    }
}

async function loadMockData() {
    globalState = sanitizeState(INITIAL_MOCK_STATE);
    await saveState();
}


async function archiveContent(mod) {
    contentHistory.push({
        id: Date.now(),
        title: mod.title,
        content: mod.content,
        images: mod.images ? JSON.parse(JSON.stringify(mod.images)) : {}, // 히스토리에 이미지 레지스트리도 복사
        date: new Date().toLocaleString()
    });

    await saveState();

    // 연결된 폴더의 히스토리 디렉토리에도 저장
    if (projectFolderHandle) {
        syncHistoryItemToFolder(contentHistory[contentHistory.length - 1]).catch(e => console.warn('히스토리 폴더 동기화 경고:', e.message));
    }
}

// --- History UI ---
const selectedHistoryIds = new Set();
let lastHistoryIdx = -1;

function toggleHistoryPanel() {
    const p = document.getElementById('history-panel');
    let bg = document.getElementById('history-bg');

    if (p.classList.contains('translate-x-full')) {
        // 열기
        if (!bg) {
            bg = document.createElement('div');
            bg.id = 'history-bg';
            bg.className = 'fixed inset-0 bg-black/50 z-40 animate-fade-in backdrop-blur-sm';
            bg.onclick = toggleHistoryPanel;
            document.body.appendChild(bg);
        }
        bg.style.display = 'block';
        p.classList.remove('translate-x-full');
        selectedHistoryIds.clear();
        lastHistoryIdx = -1;
        renderHistoryUI(p);
    } else {
        // 닫기
        p.classList.add('translate-x-full');
        if (bg) bg.style.display = 'none';
    }
}

async function renderHistoryUI(area) {
    if (!Array.isArray(contentHistory) || contentHistory.length === 0) {
        area.innerHTML = `<div class="h-full flex items-center justify-center text-textMuted bg-[#12121e]">저장된 히스토리가 없습니다. (모듈 삭제 시 자동 저장됩니다)</div>`;
        return;
    }

    selectedHistoryIds.clear();
    lastHistoryIdx = -1;

    area.innerHTML = `
        <div class="max-w-[800px] mx-auto p-8 flex flex-col h-full animate-fade-in bg-[#12121e]" style="min-height:100%;">
            <div class="flex justify-between items-end mb-6">
                <h2 class="text-2xl font-bold text-white/90 flex items-center gap-2"><i class="ph-bold ph-clock-counter-clockwise text-accent"></i> 교안 아카이브 (히스토리)</h2>
                <div class="text-xs text-textMuted bg-black/30 px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-2" id="history-capacity-info">
                    <i class="ph ph-spinner animate-spin"></i> DB 용량 계산중...
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
            capInfo.innerHTML = `DB 사용량: <span class="text-accent font-bold">${usageMB} MB</span> <span class="opacity-50">/ ${quotaMB} MB</span>`;
        } else {
            capInfo.innerHTML = `<span class="text-textMuted">용량 측정 API 미지원</span>`;
        }
    } catch (e) {
        capInfo.innerHTML = `<span class="text-textMuted text-orange-400">용량 계산 실패</span>`;
    }
}

window.renderHistoryList = function () {
    const container = document.getElementById('history-list-container');
    const countSpan = document.getElementById('history-select-count');
    if (!container) return;

    countSpan.innerText = `${selectedHistoryIds.size}개 선택됨`;
    const checkAll = document.getElementById('history-select-all');
    if (checkAll) checkAll.checked = contentHistory.length > 0 && selectedHistoryIds.size === contentHistory.length;

    const reversedHistory = [...contentHistory].reverse();
    container.innerHTML = reversedHistory.map((h, displayIdx) => {
        const isSelected = selectedHistoryIds.has(h.id);
        return `
            <div class="p-3 rounded-lg border ${isSelected ? 'bg-accent/20 border-accent/50' : 'bg-white/[0.04] border-transparent hover:bg-white/[0.08]'} cursor-pointer flex justify-between items-center transition-colors"
                 onclick="handleHistoryClick(event, ${h.id}, ${displayIdx})">
                <div class="flex items-center gap-3 pl-1">
                    <input type="checkbox" class="w-4 h-4 rounded border-white/20 bg-black/50 accent-accent pointer-events-none" ${isSelected ? 'checked' : ''}>
                    <div>
                        <h4 class="font-bold ${isSelected ? 'text-white' : 'text-white/80'} text-sm">${h.title}</h4>
                        <span class="text-xs text-white/40">${h.date}</span>
                    </div>
                </div>
                <button onclick="event.stopPropagation(); viewHistoryItem(${h.id})" class="text-accent hover:text-white hover:bg-accent text-xs font-bold px-3 py-1.5 bg-accent/10 rounded transition-colors border border-accent/20">내용 보기</button>
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
    showConfirm(`선택한 ${selectedHistoryIds.size}개의 히스토리를 영구 삭제하시겠습니까?`, async () => {
        contentHistory = contentHistory.filter(h => !selectedHistoryIds.has(h.id));
        selectedHistoryIds.clear();
        await saveState();
        toggleHistoryPanel(); // Refresh view
    });
}



window.exportSelectedHistoryMD = function () {

    if (selectedHistoryIds.size === 0) return window.showAlert('다운로드할 항목을 선택해주세요.');

    const text = contentHistory

        .filter(h => selectedHistoryIds.has(h.id))

        .map(h => `# ${h.title}\n\n*삭제일: ${h.date}*\n\n${resolveMarkdownImages(h.content, h.images)}`)

        .join('\n\n---\n\n');

    downloadFile(text, `아카이브_선택본_${Date.now()}.md`, 'text/markdown');

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

        htmlContent += `<h1 style="border-bottom: 2px solid #e8e6f0; padding-bottom: 10px; color: #1a1a2e;">${h.title}</h1>`;

        htmlContent += `<p style="color:#888; font-size:12px; margin-bottom: 20px;">삭제일: ${h.date}</p>`;



        try {

            htmlContent += typeof marked !== 'undefined' ? marked.parse(resolveMarkdownImages(h.content, h.images)) : `<pre>${resolveMarkdownImages(h.content, h.images)}</pre>`;

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

        filename: `아카이브_선택본_${Date.now()}.pdf`,

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



    // 1. 커스텀 HTML 래퍼를 표준 마크다운 이미지 문법으로 되돌림 (WAF 방어 및 깔끔한 수출)

    md = md.replace(/<div class="image-wrapper">\s*<img src="(local:img_[^"]+)" alt="([^"]*)"[^>]*>[\s\S]*?<\/div>/gi, '![$2]($1)');



    if (images) {

        for (const [imgId, b64] of Object.entries(images)) {

            md = md.split(`local:${imgId}`).join(b64);

        }

    }

    return md;

}



// ZIP 내보내기용 이미지 분리 헬퍼 — 마크다운에서 이미지 참조를 상대 경로로 치환하고 ZIP 폴더에 바이너리 추가
function extractImagesToZip(markdownContent, images, attachFolder) {
    let content = markdownContent || '';
    if (images && Object.keys(images).length > 0) {
        for (const [imgId, b64] of Object.entries(images)) {
            const matches = b64.match(/^data:(image\/\w+);base64,(.*)$/);
            if (matches) {
                let ext = matches[1].split('/')[1];
                if (ext === 'jpeg') ext = 'jpg';
                const imgFileName = `${imgId}.${ext}`;

                const tagRegex = new RegExp(`<!--\\s*\\[IMG:\\s*"?local:${imgId}"?\\]\\s*-->`, 'g');
                const imgRegex = new RegExp(`src="local:${imgId}"`, 'g');
                content = content.replace(tagRegex, `![${imgId}](../첨부파일/${imgFileName})`);
                content = content.replace(imgRegex, `src="../첨부파일/${imgFileName}"`);

                attachFolder.file(imgFileName, matches[2], { base64: true });
            }
        }
    }
    return content;
}

window.viewHistoryItem = function (id) {
    const item = contentHistory.find(h => h.id === id);
    if (!item) { window.showAlert("해당 히스토리 항목을 찾을 수 없습니다."); return; }

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
                htmlContent = marked.parse(resolved);
                if (typeof reParseInstructorCallouts === 'function') htmlContent = reParseInstructorCallouts(htmlContent);
                if (typeof applyPeriodLineBreakHTML === 'function') htmlContent = applyPeriodLineBreakHTML(htmlContent);
            } catch (parseErr) {
                console.warn("marked.parse 파싱 경고:", parseErr);
                htmlContent = `<pre style="white-space:pre-wrap;word-break:break-word;">${resolved.replace(/</g, '&lt;')}</pre>`;
            }
        } else {
            htmlContent = `<pre style="white-space:pre-wrap;word-break:break-word;">${resolved.replace(/</g, '&lt;')}</pre>`;
        }

        showModal(`[복구] ${item.title || '제목 없음'}`, htmlContent);

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

    let fileName = `${mod.title}.md`;

    if (subj && subj.namingConvention) {
        if (mod.id === 'mainQuest') {
            fileName = subj.namingConvention.replace(/nn/g, 'MQ') + '.md';
        } else {
            const idx = courseData.findIndex(m => m.id === mod.id);
            if (idx !== -1) {
                fileName = subj.namingConvention.replace(/nn/g, String(idx + 1).padStart(2, '0')) + '.md';
            }
        }
    }

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

        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `${safeCourseName}_${fileName.replace('.md', '')}.zip`);

    } catch (e) {
        console.error("ZIP 생성 오류:", e);
        window.showAlert('압축 파일 생성 중 오류가 발생했습니다. JSZip 라이브러리가 로드되었는지 확인하세요.');
    }
}



window.exportAllModules = async function () {
    if (!Array.isArray(courseData) || courseData.length === 0) return window.showAlert('내보낼 데이터가 없습니다.');
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);

    // 과정명(Project Name) 안전화
    const rawCourseTitle = globalState.courseTitle || '새_교안프로젝트';
    const safeCourseName = rawCourseTitle.replace(/[\/\?<>\\:\*\|"]/g, '_').trim();
    // 교과명(Subject Name) 안전화
    const safeSubjName = subj ? subj.title.replace(/[\/\?<>\\:\*\|"]/g, '_').trim() : '기본_교과';

    try {
        const zip = new JSZip();

        // 1. 최상단: 과정명 폴더 생성
        const rootFolder = zip.folder(safeCourseName);

        // 2. 메타데이터 (save_data.yaml) 루트 배치
        const metaObj = {
            project: rawCourseTitle,
            subject: subj ? subj.title : '',
            timestamp: new Date().toISOString(),
            module_count: courseData.length,
            context: globalState // 전체 설정 및 현황 컨텍스트 직렬화
        };
        rootFolder.file('save_data.yaml', JSON.stringify(metaObj, null, 2)); // 편의상 JSON 직렬화를 yaml 확장자로 보존

        // 3. 리소스(첨부파일) 서브폴더 & 교과 폴더 생성
        const attachFolder = rootFolder.folder("첨부파일");
        const subjFolder = rootFolder.folder(safeSubjName);

        courseData.forEach((m, idx) => {
            const moduleTitle = `# ${m.title}\n\n`;

            // 차시명 뷰티파이 (예: 01_차시명.md)
            let mdFileName = `${String(idx + 1).padStart(2, '0')}_${m.title}.md`;
            if (m.id === 'mainQuest') mdFileName = `MQ_단원평가.md`;

            // 네이밍 컨벤션 덮어쓰기 로직 유지
            if (subj && subj.namingConvention) {
                if (m.id === 'mainQuest') {
                    mdFileName = subj.namingConvention.replace(/nn/g, 'MQ') + '.md';
                } else {
                    mdFileName = subj.namingConvention.replace(/nn/g, String(idx + 1).padStart(2, '0')) + '.md';
                }
            }

            const markdownContent = extractImagesToZip(m.content, m.images, attachFolder);
            subjFolder.file(mdFileName, moduleTitle + markdownContent);
        });

        // 4. 메인 퀘스트(mainQuest) 별도 내보내기 — subj.mainQuest는 courseData(lessons)에 미포함
        if (subj && subj.mainQuest && subj.mainQuest.content) {
            const mq = subj.mainQuest;
            let mqFileName = 'MQ_단원평가.md';
            if (subj.namingConvention) {
                mqFileName = subj.namingConvention.replace(/nn/g, 'MQ') + '.md';
            }

            const mqContent = extractImagesToZip(mq.content, mq.images, attachFolder);
            subjFolder.file(mqFileName, `# ${mq.title}\n\n` + mqContent);
        }

        // 묶음 ZIP 생성 (이름은 프로젝트_교과명)
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `${safeCourseName}_${safeSubjName}.zip`);

    } catch (e) {
        console.error("전체 ZIP 생성 오류:", e);
        window.showAlert('압축 파일 생성 중 오류가 발생했습니다. JSZip 라이브러리가 로드되었는지 확인하세요.');
    }
}



// =========================================================================
// PDF 내보내기 (현재 차시)
// =========================================================================
window.exportToPDF = async function () {
    if (typeof html2pdf === 'undefined') {
        return window.showAlert('PDF 변환 라이브러리를 불러오지 못했습니다. 잠시 후 다시 시도하거나 새로고침 해주세요.');
    }

    const mod = getEditingModule();
    if (!mod || !mod.content) {
        return window.showAlert('PDF로 변환할 교안 내용이 없습니다. 차시를 선택하고 교안을 먼저 생성해주세요.');
    }

    const btn = document.getElementById('pdf-dropdown-btn');
    let originalHTML = '';
    if (btn) { originalHTML = btn.innerHTML; btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i> 변환중'; btn.disabled = true; }

    try {
        await _generatePdfFromMarkdown(mod.content, mod.title, mod.images || {});
    } catch (e) {
        window.showAlert('PDF 변환 오류가 발생했습니다: ' + e.message);
    } finally {
        if (btn) { btn.innerHTML = originalHTML; btn.disabled = false; }
    }
}

// =========================================================================
// PDF 내보내기 (현재 교과 전체 - 차시별 페이지)
// =========================================================================
window.exportSubjectToPDF = async function () {
    if (typeof html2pdf === 'undefined') {
        return window.showAlert('PDF 변환 라이브러리를 불러오지 못했습니다.');
    }

    if (!Array.isArray(courseData) || courseData.length === 0) {
        return window.showAlert('현재 교과에 차시가 없습니다.');
    }

    const contentModules = courseData.filter(m => m.content);
    if (contentModules.length === 0) {
        return window.showAlert('PDF로 변환할 교안이 없습니다. 교안을 먼저 생성해주세요.');
    }

    const btn = document.getElementById('pdf-dropdown-btn');
    let originalHTML = '';
    if (btn) { originalHTML = btn.innerHTML; btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i> 변환중'; btn.disabled = true; }

    try {
        // 모든 차시의 Markdown을 차시 구분선과 함께 합침
        let combinedMarkdown = '';
        for (let i = 0; i < contentModules.length; i++) {
            const m = contentModules[i];
            combinedMarkdown += m.content;
            if (i < contentModules.length - 1) {
                combinedMarkdown += '\n\n<div style="page-break-after: always;"></div>\n\n---\n\n';
            }
        }

        // 모든 이미지를 합침
        const allImages = {};
        contentModules.forEach(m => {
            if (m.images) Object.assign(allImages, m.images);
        });

        const subj = globalState.subjects.find(s => s.id === currentSubjectId);
        const subjTitle = subj ? subj.title : '교과전체';

        await _generatePdfFromMarkdown(combinedMarkdown, subjTitle, allImages);
    } catch (e) {
        window.showAlert('PDF 변환 오류가 발생했습니다: ' + e.message);
    } finally {
        if (btn) { btn.innerHTML = originalHTML; btn.disabled = false; }
    }
}

// =========================================================================
// PDF 공통 유틸: Markdown → HTML → html2pdf 변환
// =========================================================================
async function _generatePdfFromMarkdown(markdownContent, title, images) {
    // ─── 1. 외부 라이브러리(html2canvas 등) 캡처 한계로 인한 네이티브 전환 ───
    // 기존의 jsPDF/html2canvas는 문서 복잡도, CSS 모드에 따라 지속적 백지 렌더링 발생 확인.
    // 100% 백지를 방지하고 벡터 텍스트를 보존하기 위해 숨겨진 iframe을 사용한 브라우저 자체 인쇄 사용

    try {
        // ─── 2. Markdown → HTML 변환 ───
        var htmlContent = '';
        if (typeof marked !== 'undefined') {
            htmlContent = marked.parse(markdownContent);
            if (typeof reParseInstructorCallouts === 'function') htmlContent = reParseInstructorCallouts(htmlContent);
            if (typeof applyPeriodLineBreakHTML === 'function') htmlContent = applyPeriodLineBreakHTML(htmlContent);
        } else {
            htmlContent = '<pre style="white-space:pre-wrap;">' + markdownContent + '</pre>';
        }

        // ─── 3. 이미지 참조를 base64 data URI로 교체 ───
        if (images && Object.keys(images).length > 0) {
            for (const [imgId, b64] of Object.entries(images)) {
                htmlContent = htmlContent.replace(new RegExp('src="local:' + imgId + '"', 'g'), 'src="' + b64 + '"');
            }
        }

        // ─── 4. 숨겨진 Iframe 생성 (현재 페이지 내부에 삽입) ───
        var iframe = document.createElement('iframe');
        iframe.id = 'pdf-hidden-print-frame';
        // 화면에 보이지 않고 공간도 차지하지 않도록 처리
        iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:none; visibility:hidden; z-index:-9999;';
        document.body.appendChild(iframe);

        // ─── 5. Iframe 내부에 인쇄 전용 형태의 완전한 HTML 삽입 ───
        var doc = iframe.contentWindow || iframe.contentDocument;
        if (doc.document) doc = doc.document;

        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="utf-8">
                <title>${title}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;800&display=swap');
                    
                    * { box-sizing: border-box; }
                    /* 화면 표출용 베이스 스타일 (모의) */
                    body {
                        margin: 0; padding: 0; background: #fff; color: #111;
                        font-family: 'Noto Sans KR', 'Inter', sans-serif;
                        font-size: 14px; line-height: 1.7;
                    }
                    .pdf-content { padding: 20px 30px; }
                    h1 { font-size: 1.7rem; font-weight: 800; border-bottom: 2px solid #5b4fcc; padding-bottom: 0.5rem; margin-bottom: 1rem; color: #000; }
                    h2 { font-size: 1.35rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.6rem; color: #000; }
                    h3 { font-size: 1.1rem; font-weight: 600; margin-top: 1.2rem; margin-bottom: 0.4rem; color: #222; }
                    p { margin-bottom: 0.8rem; }
                    ul, ol { padding-left: 1.5rem; margin-bottom: 0.8rem; }
                    code { background: #f0f0f0; padding: 0.1rem 0.3rem; border-radius: 3px; color: #5b4fcc; font-family: monospace; }
                    pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; border: 1px solid #ddd; page-break-inside: avoid; }
                    pre code { background: none; color: #333; padding: 0; }
                    blockquote { border-left: 3px solid #5b4fcc; padding: 0.5rem 1rem; background: #f9f9f9; color: #444; margin: 1rem 0; page-break-inside: avoid; }
                    table { border-collapse: collapse; width: 100%; margin: 1rem 0; page-break-inside: avoid; }
                    th, td { border: 1px solid #aaa; padding: 8px 10px; }
                    th { background: #eee; font-weight: 600; }
                    img { max-width: 100%; height: auto; display: block; margin: 1rem auto; page-break-inside: avoid; max-height: 80vh; object-fit: contain; }
                    
                    /* 에디터 전용 객체 강제 숨김 */
                    .image-wrapper button, .image-wrapper span.absolute, .image-regenerate-btn { display: none !important; }

                    /* ★ 가장 중요한 인쇄(Print) 전용 최적화 ★ */
                    @media print {
                        @page { margin: 1.5cm; } /* A4 기본 마진 설정 */
                        body { width: 100%; background: #ffffff !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                        h1, h2, h3 { page-break-after: avoid; }
                        img, table, pre, blockquote { page-break-inside: avoid; }
                    }
                </style>
            </head>
            <body>
                <div class="pdf-content">${htmlContent}</div>
            </body>
            </html>
        `);
        doc.close();

        // ─── 6. 이미지 로드 대기 (인쇄 전 모든 리소스 배치 완료) ───
        var imgEls = doc.querySelectorAll('img');
        if (imgEls.length > 0) {
            await Promise.all(Array.from(imgEls).map(function (img) {
                if (img.complete) return Promise.resolve();
                return new Promise(function (res) { img.onload = res; img.onerror = res; });
            }));
        }

        // 렌더 트리 구성 및 폰트 로드 대기
        await new Promise(function (res) { setTimeout(res, 800); });

        // ─── 7. 네이티브 인쇄 다이얼로그 호출 ───
        // 새 창(Tab) 이동 없이 현재 창 위에 팝업 형식으로 호출됩니다.
        iframe.contentWindow.focus();
        iframe.contentWindow.print();

        // ─── 8. 청소 ───
        // print()는 동기(차단) 함수처럼 동작하지만 브라우저마다 차이가 있으므로
        // 인쇄 창이 닫히거나 시간이 충분히 지난 후 iframe을 삭제합니다.
        setTimeout(function () {
            if (iframe && iframe.parentNode) {
                iframe.remove();
            }
        }, 10000); // 10초 후 자동 소멸

    } catch (e) {
        console.error('PDF 변환 오류:', e);
        window.showAlert('PDF (인쇄) 창을 여는 중 일시적인 오류가 발생했습니다.');
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

            const imgTag = `\n<img src="local:${imgId}" alt="inserted image" style="max-width:100%; border-radius:8px;">\n`;
            insertTextAtCursor(target, imgTag);
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

            const imgTag = `\n<img src="local:${imgId}" alt="inserted image" style="max-width:100%; border-radius:8px;">\n`;
            insertTextAtCursor(target, imgTag);
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
}

function initImageInsertionHandlers() {
    const isInsertionTarget = (target) => {
        if (!target) return false;
        // 메인 에디터(#raw-view) 거나 인라인 에디팅 폼(TEXTAREA)일 경우 허용
        return target.id === 'raw-view' || (target.tagName === 'TEXTAREA' && target.closest('#render-view'));
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
        window.showAlert('이미지를 삽입하려면 수정 모드로 전환하거나, 블록을 더블클릭하여 인라인 편집을 시작하세요.');
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
        const zip = await JSZip.loadAsync(file);
        let metaObj = null;
        let imageMap = new Map(); // fileName -> base64
        let mdFiles = [];

        // 1순회: 메타데이터 추출 및 이미지(바이너리) 버퍼링
        const entries = Object.keys(zip.files);
        for (const relativePath of entries) {
            const zipEntry = zip.files[relativePath];
            if (zipEntry.dir) continue;

            if (relativePath.includes('save_data.yaml')) {
                const yamlText = await zipEntry.async("string");
                metaObj = safeJSONParse(yamlText); // yaml이라 썼지만 이전 단계에서 편의상 JSON 직렬화함
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

        if (!metaObj) {
            throw new Error("유효한 Web Agent 세이브 파일(save_data.yaml 파싱 실패 또는 누락)이 아닙니다.");
        }

        let isSingleModule = !metaObj.context;

        if (isSingleModule) {
            // 단일 차시(exportCurrentModule) 복원 모드: 현재 교과에 새 모듈로 종속시킴
            const subj = globalState.subjects.find(s => s.id === currentSubjectId);
            if (!subj) throw new Error("현재 선택된 교과가 없습니다. 교과를 먼저 생성해주세요.");

            let newMod = {
                id: 'm_' + Date.now() + Math.floor(Math.random() * 1000),
                title: metaObj.module || '불러온 교안',
                description: '',
                status: 'waiting',
                content: '',
                images: {},
                uploadedMdName: null,
                uploadedMdContent: null
            };

            const matchedMd = mdFiles.find(mf => mf.path.endsWith('.md'));
            if (matchedMd) {
                let content = matchedMd.content;
                // YAML 헤더 스트립
                const yamlEndIdx = content.indexOf('---\n\n');
                if (yamlEndIdx !== -1 && content.startsWith('---')) {
                    content = content.substring(yamlEndIdx + 5);
                } else if (content.startsWith('# ' + newMod.title)) {
                    content = content.replace(new RegExp(`^# ${newMod.title}\\n\\n`), '');
                }

                // 이미지 경로 역치환 (../첨부파일/img_xxx -> local:img_xxx)
                const revertTagRegex = /!\[([^\]]+)\]\(\.\.\/첨부파일\/([^)]+)\)/g;
                const revertImgRegex = /src="\.\.\/첨부파일\/([^"]+)"/g;

                content = content.replace(revertTagRegex, (match, altStr, fileName) => {
                    const originalId = fileName.split('.')[0];
                    if (imageMap.has(fileName)) newMod.images[originalId] = imageMap.get(fileName);
                    return `<!-- [IMG: "local:${originalId}"] -->`;
                });

                content = content.replace(revertImgRegex, (match, fileName) => {
                    const originalId = fileName.split('.')[0];
                    if (imageMap.has(fileName)) newMod.images[originalId] = imageMap.get(fileName);
                    return `src="local:${originalId}"`;
                });

                newMod.content = content;
            }

            courseData.push(newMod);

            await saveState(); // 로컬스토리지 백업
            if (typeof renderSidebar === 'function') renderSidebar();
            if (typeof viewModule === 'function') viewModule(newMod.id);
            window.showAlert('단일 차시 교안을 현재 교과에 성공적으로 가져왔습니다!');

        } else {
            // 기존 교안 데이터를 히스토리에 백업 (덮어쓰기 전 안전장치)
            if (Array.isArray(courseData) && courseData.length > 0) {
                courseData.forEach(mod => {
                    if (mod && mod.content) archiveContent(mod);
                });
            }

            // 2순회: globalState 통째 복원 (전체 코스 모드)
            globalState = sanitizeState(metaObj.context) || sanitizeState({});
            // API 키 등 브라우저 의존 휘발성 값 보존
            if (typeof apiKey !== 'undefined') globalState.apiKey = apiKey;

            // 3순회: courseData 재구성 및 이미지 역치환 (Map에서 로컬 에디전트 메모리로 전송)
            const restoredSubj = globalState.subjects.find(s => s.id === currentSubjectId) || globalState.subjects[0];
            if (restoredSubj) {
                currentSubjectId = restoredSubj.id;
                courseData = restoredSubj.lessons || [];

                courseData.forEach(mod => {
                    if (!mod.images) mod.images = {};

                    const matchedMd = mdFiles.find(mf => mf.path.includes(mod.title) || mf.content.includes(`# ${mod.title}`));
                    if (matchedMd) {
                        let content = matchedMd.content;

                        const yamlEndIdx = content.indexOf('---\n\n');
                        if (yamlEndIdx !== -1 && content.startsWith('---')) {
                            content = content.substring(yamlEndIdx + 5);
                        } else if (content.startsWith('# ' + mod.title)) {
                            content = content.replace(new RegExp(`^# ${mod.title}\\n\\n`), '');
                        }

                        const revertTagRegex = /!\[([^\]]+)\]\(\.\.\/첨부파일\/([^)]+)\)/g;
                        const revertImgRegex = /src="\.\.\/첨부파일\/([^"]+)"/g;

                        content = content.replace(revertTagRegex, (match, altStr, fileName) => {
                            const originalId = fileName.split('.')[0]; // img_123
                            if (imageMap.has(fileName)) mod.images[originalId] = imageMap.get(fileName);
                            return `<!-- [IMG: "local:${originalId}"] -->`;
                        });

                        content = content.replace(revertImgRegex, (match, fileName) => {
                            const originalId = fileName.split('.')[0];
                            if (imageMap.has(fileName)) mod.images[originalId] = imageMap.get(fileName);
                            return `src="local:${originalId}"`;
                        });

                        mod.content = content;
                    }
                });
            }

            // 4. UI 및 메모리 싱크 파이프라인
            await saveState(); // 로컬스토리지에 즉각 백업
            if (typeof renderSidebar === 'function') renderSidebar();
            // SPA 라우터를 통해 개요 화면으로 안전하게 전환
            location.hash = '#overview';

            window.showAlert('성공적으로 로컬 세이브 파일을 불러와 전역 복원했습니다!');
        }

    } catch (e) {
        console.error("ZIP 불러오기 오류:", e);
        window.showAlert(`불러오기 실패: ${e.message}`);
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
    await writable.write(content);
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
    if (!('showDirectoryPicker' in window)) {
        return window.showAlert('이 브라우저는 폴더 연결을 지원하지 않습니다.\nChrome 또는 Edge를 사용해주세요.');
    }

    try {
        const dirHandle = await window.showDirectoryPicker({
            mode: 'readwrite'
        });
        projectFolderHandle = dirHandle;

        // [추가] IndexedDB에 핸들 저장 (새로고침 유지용) - 브라우저 정책상 DataCloneError 발생 시 넘겨감
        if (typeof DBManager !== 'undefined') {
            try {
                await DBManager.setItem('projectFolderHandle', dirHandle);
            } catch (dbErr) {
                console.warn('폴더 연결 자체는 성공했으나 핸들(새로고침 유지용) 저장에 실패했습니다:', dbErr);
            }
        }

        // 연결 즉시 현재 상태를 폴더에 동기화
        await syncToLinkedFolder();

        // UI 업데이트
        document.getElementById('folder-connection-indicator').innerHTML = `
            <i class="ph-fill ph-folder text-cyan-400 text-sm"></i>
            <span class="text-white/90 font-medium truncate max-w-[100px]">${dirHandle.name}</span>
            <i class="ph-bold ph-caret-down text-[0.6rem] text-white/50 ml-1"></i>
        `;
        // 드롭다운 토글 기능으로 변경
        document.getElementById('folder-connection-indicator').onclick = toggleFolderDropdown;

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

    // [추가] DB에서 핸들 삭제
    if (typeof DBManager !== 'undefined') {
        try {
            await DBManager.deleteItem('projectFolderHandle');
        } catch (dbErr) {
            console.warn('DB에서 폴더 핸들을 삭제하는 데 실패했습니다:', dbErr);
        }
    }

    document.getElementById('folder-connection-indicator').innerHTML = `
        <i class="ph ph-folder-dashed text-sm text-white/40"></i>
        <span class="text-white/40">연결 안됨</span>
    `;
    // 클릭 시 바로 연결 창 띄우기 (미연결 상태)
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
            // 초기 로딩에는 requestPermission 팝업을 띄우지 못하므로 상태(query)만 체크
            const hasPermission = await verifyPermission(storedHandle, false);

            if (hasPermission) {
                // 이미 권한이 유지되어 있다면 바로 복원
                projectFolderHandle = storedHandle;
                document.getElementById('folder-connection-indicator').innerHTML = `
                    <i class="ph-fill ph-folder text-cyan-400 text-sm"></i>
                    <span class="text-white/90 font-medium truncate max-w-[100px]">${storedHandle.name}</span>
                    <i class="ph-bold ph-caret-down text-[0.6rem] text-white/50 ml-1"></i>
                `;
                document.getElementById('folder-connection-indicator').onclick = toggleFolderDropdown;
                console.log(`[${storedHandle.name}] 폴더 연결이 자동 복원되었습니다.`);
            } else {
                // 권한이 만료된 상태 -> 사용자가 버튼을 눌렀을 때만 requestPermission 호출
                console.warn('저장된 폴더 핸들의 권한이 만료되었습니다. 클릭을 통해 재인증이 필요합니다.');

                const indicator = document.getElementById('folder-connection-indicator');
                indicator.innerHTML = `
                    <i class="ph-fill ph-folder-lock text-orange-400 text-sm"></i>
                    <span class="text-orange-400/90 font-medium truncate max-w-[100px]">${storedHandle.name} (클릭하여 재연결)</span>
                `;
                // 원클릭 재인증 이벤트 바인딩
                indicator.onclick = async () => {
                    try {
                        const granted = await verifyPermission(storedHandle, true); // 클릭 이벤트 컨텍스트에서는 팝업 가능
                        if (granted) {
                            projectFolderHandle = storedHandle;
                            indicator.innerHTML = `
                                <i class="ph-fill ph-folder text-cyan-400 text-sm"></i>
                                <span class="text-white/90 font-medium truncate max-w-[100px]">${storedHandle.name}</span>
                                <i class="ph-bold ph-caret-down text-[0.6rem] text-white/50 ml-1"></i>
                            `;
                            indicator.onclick = toggleFolderDropdown; // 드롭다운으로 롤백
                            window.showToast(`[${storedHandle.name}] 폴더 쓰기 권한이 복원되었습니다.`);
                        }
                    } catch (permError) {
                        console.error('권한 요청 실패', permError);
                        window.showAlert('폴더 권한 획득에 실패했습니다. 다른 폴더 연결을 시도해주세요.');
                    }
                };
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

        // save_data.yaml 존재 여부 확인
        let saveDataHandle;
        try {
            saveDataHandle = await dirHandle.getFileHandle('save_data.yaml');
        } catch (e) {
            // JSON 폴백 (이전 버전 호환)
            try { saveDataHandle = await dirHandle.getFileHandle('save_data.json'); }
            catch (e2) { return window.showAlert('유효한 프로젝트 폴더가 아닙니다.\nsave_data.yaml 파일을 찾을 수 없습니다.'); }
        }

        const file = await saveDataHandle.getFile();
        const text = await file.text();
        const parsed = simpleYamlParse(text);

        if (!parsed.state) {
            return window.showAlert('save_data.yaml에 유효한 상태 데이터가 없습니다.');
        }

        // 현재 데이터 백업
        if (Array.isArray(courseData) && courseData.length > 0) {
            courseData.forEach(mod => {
                if (mod && mod.content) archiveContent(mod);
            });
        }

        // 상태 복원
        const sanitized = sanitizeState(parsed.state);
        if (sanitized) {
            globalState = sanitized;
        }

        // 히스토리 복원
        if (Array.isArray(parsed.history)) {
            contentHistory = parsed.history;
        }

        // 교과 데이터 복원
        if (globalState.subjects.length > 0) {
            const firstSubj = globalState.subjects[0];
            currentSubjectId = firstSubj.id;
            courseData = firstSubj.lessons || [];
        }

        // 폴더 연결 유지
        projectFolderHandle = dirHandle; // linkedDirHandle -> projectFolderHandle
        if (typeof DBManager !== 'undefined') {
            try {
                await DBManager.setItem('projectFolderHandle', dirHandle);
            } catch (dbErr) {
                console.warn('기존 작업 폴더 연결 자체는 성공했으나 핸들(새로고침 유지용) 저장에 실패했습니다:', dbErr);
            }
        }

        // UI 동기화
        await saveState();
        document.getElementById('folder-connection-indicator').innerHTML = `
            <i class="ph-fill ph-folder text-cyan-400 text-sm"></i>
            <span class="text-white/90 font-medium truncate max-w-[100px]">${dirHandle.name}</span>
            <i class="ph-bold ph-caret-down text-[0.6rem] text-white/50 ml-1"></i>
        `;
        document.getElementById('folder-connection-indicator').onclick = toggleFolderDropdown;


        if (typeof renderSidebar === 'function') renderSidebar();
        location.hash = '#overview';

        window.showAlert(`✅ 프로젝트 폴더에서 성공적으로 불러왔습니다!\n📁 ${dirHandle.name}\n\n폴더가 자동으로 연결되어 이후 변경사항도 동기화됩니다.`);

    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error('폴더 불러오기 오류:', e);
        window.showAlert('폴더 불러오기 중 오류가 발생했습니다: ' + e.message);
    }
}

/**
 * 연결된 폴더에 전체 상태를 동기화 (saveState 후크에서 호출)
 */
async function syncToLinkedFolder() {
    if (!projectFolderHandle) return; // linkedDirHandle -> projectFolderHandle

    try {
        // 권한 재확인 (탭 전환 후 권한 만료 방어)
        const permission = await projectFolderHandle.queryPermission({ mode: 'readwrite' }); // linkedDirHandle -> projectFolderHandle
        if (permission !== 'granted') {
            const request = await projectFolderHandle.requestPermission({ mode: 'readwrite' }); // linkedDirHandle -> projectFolderHandle
            if (request !== 'granted') {
                projectFolderHandle = null; // linkedDirHandle -> projectFolderHandle
                // updateFolderConnectionUI(false); // Removed, replaced by direct UI update in disconnect
                console.warn('폴더 쓰기 권한이 거부되어 연결이 해제되었습니다.');
                await window.disconnectProjectFolder(); // Call the new disconnect function
                return;
            }
        }

        // 1. save_data.yaml (전체 상태 + 히스토리)
        const saveData = {
            state: globalState,
            history: contentHistory,
            lastSync: new Date().toISOString()
        };
        await writeTextFile(projectFolderHandle, 'save_data.yaml', simpleYamlStringify(saveData)); // linkedDirHandle -> projectFolderHandle

        // 2. 교과별 md 파일 및 이미지 동기화
        const subj = globalState.subjects.find(s => s.id === currentSubjectId);
        if (subj && Array.isArray(courseData) && courseData.length > 0) {
            const rawCourseTitle = globalState.courseTitle || '새_교안프로젝트';
            const safeCourseName = rawCourseTitle.replace(/[\/\?<>\\:\*\|"]/g, '_').trim();
            const safeSubjName = subj.title.replace(/[\/\?<>\\:\*\|"]/g, '_').trim();

            const courseFolder = await projectFolderHandle.getDirectoryHandle(safeCourseName, { create: true }); // linkedDirHandle -> projectFolderHandle
            const attachFolder = await courseFolder.getDirectoryHandle('첨부파일', { create: true });
            const subjFolder = await courseFolder.getDirectoryHandle(safeSubjName, { create: true });

            for (let idx = 0; idx < courseData.length; idx++) {
                const m = courseData[idx];
                if (!m.content) continue;

                let markdownContent = m.content;
                let mdFileName = `${String(idx + 1).padStart(2, '0')}_${m.title}.md`;
                if (m.id === 'mainQuest') mdFileName = `MQ_단원평가.md`;
                if (subj.namingConvention) {
                    if (m.id === 'mainQuest') mdFileName = subj.namingConvention.replace(/nn/g, 'MQ') + '.md';
                    else mdFileName = subj.namingConvention.replace(/nn/g, String(idx + 1).padStart(2, '0')) + '.md';
                }

                // 이미지 분리 저장
                if (m.images && Object.keys(m.images).length > 0) {
                    for (const [imgId, b64] of Object.entries(m.images)) {
                        const matches = b64.match(/^data:(image\/\w+);base64,(.*)$/);
                        if (matches) {
                            let ext = matches[1].split('/')[1];
                            if (ext === 'jpeg') ext = 'jpg';
                            const imgFileName = `${imgId}.${ext}`;
                            markdownContent = markdownContent.replace(new RegExp(`<!--\\s*\\[IMG:\\s*"?local:${imgId}"?\\]\\s*-->`, 'g'), `![${imgId}](../첨부파일/${imgFileName})`);
                            markdownContent = markdownContent.replace(new RegExp(`src="local:${imgId}"`, 'g'), `src="../첨부파일/${imgFileName}"`);
                            await writeBinaryFile(attachFolder, imgFileName, base64ToUint8Array(b64));
                        }
                    }
                }

                const safeName = mdFileName.replace(/[\/\?<>\\:\*\|"]/g, '_');
                await writeTextFile(subjFolder, safeName, `# ${m.title}\n\n` + markdownContent);
            }

            // 메인 퀘스트 별도 저장
            if (subj.mainQuest && subj.mainQuest.content) {
                const mq = subj.mainQuest;
                let mqContent = mq.content;
                let mqFileName = 'MQ_단원평가.md';
                if (subj.namingConvention) mqFileName = subj.namingConvention.replace(/nn/g, 'MQ') + '.md';

                if (mq.images && Object.keys(mq.images).length > 0) {
                    for (const [imgId, b64] of Object.entries(mq.images)) {
                        const matches = b64.match(/^data:(image\/\w+);base64,(.*)$/);
                        if (matches) {
                            let ext = matches[1].split('/')[1];
                            if (ext === 'jpeg') ext = 'jpg';
                            const imgFileName = `${imgId}.${ext}`;
                            mqContent = mqContent.replace(new RegExp(`<!--\\s*\\[IMG:\\s*"?local:${imgId}"?\\]\\s*-->`, 'g'), `![${imgId}](../첨부파일/${imgFileName})`);
                            mqContent = mqContent.replace(new RegExp(`src="local:${imgId}"`, 'g'), `src="../첨부파일/${imgFileName}"`);
                            await writeBinaryFile(attachFolder, imgFileName, base64ToUint8Array(b64));
                        }
                    }
                }
                const safeMqName = mqFileName.replace(/[\/\?<>\\:\*\|"]/g, '_');
                await writeTextFile(subjFolder, safeMqName, `# ${mq.title}\n\n` + mqContent);
            }
        }

    } catch (e) {
        console.warn('폴더 동기화 실패:', e.message);
        // 상태 캐시 에러 처리 (크롬 버그 등 대응)
        if (e.message && e.message.includes('state cached in an interface object')) {
            console.warn('File System 핸들 만료 문제. 연결 해제 처리합니다.');
            projectFolderHandle = null; // linkedDirHandle -> projectFolderHandle
            // updateFolderConnectionUI(false); // Removed
            await window.disconnectProjectFolder(); // Call the new disconnect function
            return;
        }

        // 폴더 접근 실패 시 자동 연결 해제 (예: 폴더 삭제됨, 권한 만료 등)
        if (e.name === 'NotFoundError' || e.name === 'NotAllowedError') {
            projectFolderHandle = null; // linkedDirHandle -> projectFolderHandle
            // updateFolderConnectionUI(false); // Removed
            await window.disconnectProjectFolder(); // Call the new disconnect function
        }
    }
}

/**
 * 히스토리 항목 1건을 연결된 폴더의 히스토리 디렉토리에 저장
 */
async function syncHistoryItemToFolder(historyItem) {
    if (!projectFolderHandle || !historyItem) return; // linkedDirHandle -> projectFolderHandle

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
        indicator.innerHTML = `<i class="ph ph-folder-dashed text-sm text-white/40"></i> <span class="text-white/40">미연결</span>`;
        indicator.title = '프로젝트 폴더 연결하기';
        indicator.onclick = () => connectProjectFolder();
    }
}


// =========================================================================
// 데이터 관리 드롭다운 (클릭 기반 토글)
// =========================================================================

window.toggleDataManageDropdown = function (event) {
    const dropdown = document.getElementById('data-manage-dropdown');
    if (!dropdown) return;

    const isOpen = !dropdown.classList.contains('hidden');

    if (isOpen) {
        dropdown.classList.add('hidden');
        document.removeEventListener('click', _closeDataManageOnOutside);
        return;
    }

    // 버튼 위치 기준으로 드롭다운 배치
    const btn = document.getElementById('data-manage-btn');
    if (btn) {
        const rect = btn.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 4) + 'px';
        dropdown.style.left = rect.left + 'px';
    }

    dropdown.classList.remove('hidden');

    // 외부 클릭으로 닫기 (다음 틱에 등록하여 현재 클릭이 즉시 닫히는 것 방지)
    setTimeout(() => {
        document.addEventListener('click', _closeDataManageOnOutside);
    }, 0);

    if (event) event.stopPropagation();
}

function _closeDataManageOnOutside(e) {
    const dropdown = document.getElementById('data-manage-dropdown');
    const btn = document.getElementById('data-manage-btn');
    if (dropdown && !dropdown.contains(e.target) && btn && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
        document.removeEventListener('click', _closeDataManageOnOutside);
    }
}

