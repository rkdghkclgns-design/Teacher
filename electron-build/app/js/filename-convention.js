// filename-convention.js — 파일명 규칙 관리

const FILENAME_PARTS = [
    { id: 'unit',      label: '단원',     defaultEnabled: true },
    { id: 'lesson',    label: '차시',     defaultEnabled: true },
    { id: 'title',     label: '제목',     defaultEnabled: true },
    { id: 'date',      label: '날짜',     defaultEnabled: false },
    { id: 'author',    label: '작성자',   defaultEnabled: false }
];

const FILENAME_STORAGE_KEY = 'kyoan_filename_convention';

let filenameConvention = {
    enabledParts: ['unit', 'lesson', 'title'],
    separator: '_',
    author: '',
    customPrefix: ''
};

function loadFilenameConvention() {
    try {
        const saved = localStorage.getItem(FILENAME_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            filenameConvention = { ...filenameConvention, ...parsed };
        }
    } catch (e) {}
}

function saveFilenameConvention() {
    try {
        localStorage.setItem(FILENAME_STORAGE_KEY, JSON.stringify(filenameConvention));
    } catch (e) {}
}

function buildFilename(mod, idx, subj) {
    const parts = [];
    const sep = filenameConvention.separator || '_';
    const ep = filenameConvention.enabledParts || [];

    if (ep.includes('unit') && subj) {
        parts.push(subj.title.replace(/[^\w가-힣]/g, '').substring(0, 20));
    }
    if (ep.includes('lesson')) {
        parts.push(String(idx + 1).padStart(2, '0') + '차시');
    }
    if (ep.includes('title') && mod) {
        parts.push(mod.title.replace(/[\/\?<>\\:\*\|"]/g, '').substring(0, 30));
    }
    if (ep.includes('date')) {
        parts.push(new Date().toISOString().slice(0, 10));
    }
    if (ep.includes('author') && filenameConvention.author) {
        parts.push(filenameConvention.author);
    }
    if (filenameConvention.customPrefix) {
        parts.unshift(filenameConvention.customPrefix);
    }

    return parts.join(sep) || 'export';
}

function renderFilenameConventionUI() {
    // 설정 패널과 사이드바 양쪽에 렌더링
    const containers = [
        document.getElementById('filename-convention-ui'),
        document.getElementById('sidebar-filename-convention-ui')
    ].filter(Boolean);
    if (containers.length === 0) return;

    const html = `
        <div class="space-y-2">
            <div class="flex flex-wrap gap-2">
                ${FILENAME_PARTS.map(p => {
                    const checked = filenameConvention.enabledParts.includes(p.id) ? 'checked' : '';
                    return `<label class="flex items-center gap-1 text-[0.7rem] text-white/70 cursor-pointer">
                        <input type="checkbox" ${checked} onchange="toggleFilenamePart('${p.id}', this.checked)"
                            class="w-3 h-3 accent-accent rounded">
                        ${p.label}
                    </label>`;
                }).join('')}
            </div>
            <div class="flex gap-2 items-center">
                <label class="text-[0.6rem] text-white/50 shrink-0">구분자:</label>
                <select onchange="updateFilenameSeparator(this.value)" class="px-2 py-1 text-[0.65rem] bg-white/5 border border-white/10 rounded text-white">
                    ${['_', '-', '.', ' '].map(s => `<option value="${s}" ${filenameConvention.separator === s ? 'selected' : ''}>${s === ' ' ? '공백' : s}</option>`).join('')}
                </select>
                <label class="text-[0.6rem] text-white/50 shrink-0 ml-2">작성자:</label>
                <input type="text" value="${filenameConvention.author || ''}" onblur="updateFilenameAuthor(this.value)" placeholder="이름"
                    class="px-2 py-1 text-[0.65rem] bg-white/5 border border-white/10 rounded text-white w-16">
            </div>
            <div class="flex gap-2 items-center">
                <label class="text-[0.6rem] text-white/50 shrink-0">접두사:</label>
                <input type="text" value="${filenameConvention.customPrefix || ''}" onblur="updateFilenamePrefix(this.value)" placeholder="기타 접두사"
                    class="flex-1 px-2 py-1 text-[0.65rem] bg-white/5 border border-white/10 rounded text-white">
            </div>
        </div>`;
    containers.forEach(c => { c.innerHTML = html; });
}

function toggleFilenamePart(partId, enabled) {
    if (enabled && !filenameConvention.enabledParts.includes(partId)) {
        filenameConvention.enabledParts.push(partId);
    } else if (!enabled) {
        filenameConvention.enabledParts = filenameConvention.enabledParts.filter(p => p !== partId);
    }
    saveFilenameConvention();
}

function updateFilenameSeparator(sep) {
    filenameConvention.separator = sep;
    saveFilenameConvention();
}

function updateFilenameAuthor(name) {
    filenameConvention.author = name.trim();
    saveFilenameConvention();
}

function updateFilenamePrefix(prefix) {
    filenameConvention.customPrefix = prefix.trim();
    saveFilenameConvention();
}

// 초기화
loadFilenameConvention();
