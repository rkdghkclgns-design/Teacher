// export-modal.js — 통합 내보내기 모달

window.showExportModal = function () {
    const mod = typeof getEditingModule === 'function' ? getEditingModule() : null;
    const hasContent = mod && (mod.content || mod.tabContents?.basicLearn);

    const html = `
    <div class="space-y-4">
        <div>
            <label class="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">내보내기 범위</label>
            <div class="flex gap-2">
                <label class="flex-1 cursor-pointer">
                    <input type="radio" name="export-scope" value="current" checked class="hidden peer">
                    <div class="peer-checked:border-accent peer-checked:bg-accent/10 border border-gray-200 rounded-lg p-3 text-center transition-all hover:bg-gray-50">
                        <i class="ph-bold ph-file-text text-lg block mb-1"></i>
                        <span class="text-xs font-bold">현재 차시</span>
                    </div>
                </label>
                <label class="flex-1 cursor-pointer">
                    <input type="radio" name="export-scope" value="all" class="hidden peer">
                    <div class="peer-checked:border-accent peer-checked:bg-accent/10 border border-gray-200 rounded-lg p-3 text-center transition-all hover:bg-gray-50">
                        <i class="ph-bold ph-folders text-lg block mb-1"></i>
                        <span class="text-xs font-bold">교과 전체 (ZIP)</span>
                    </div>
                </label>
            </div>
        </div>

        <div>
            <label class="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">파일 형식</label>
            <div class="grid grid-cols-2 gap-2" id="export-format-grid">
                <label class="cursor-pointer">
                    <input type="radio" name="export-format" value="pdf" checked class="hidden peer">
                    <div class="peer-checked:border-accent peer-checked:bg-accent/10 border border-gray-200 rounded-lg p-3 flex items-center gap-2 transition-all hover:bg-gray-50">
                        <i class="ph-bold ph-file-pdf text-red-500 text-lg"></i>
                        <span class="text-xs font-bold">PDF</span>
                    </div>
                </label>
                <label class="cursor-pointer">
                    <input type="radio" name="export-format" value="md" class="hidden peer">
                    <div class="peer-checked:border-accent peer-checked:bg-accent/10 border border-gray-200 rounded-lg p-3 flex items-center gap-2 transition-all hover:bg-gray-50">
                        <i class="ph-bold ph-file-text text-blue-500 text-lg"></i>
                        <span class="text-xs font-bold">Markdown (.md)</span>
                    </div>
                </label>
                <label class="cursor-pointer">
                    <input type="radio" name="export-format" value="slide" class="hidden peer">
                    <div class="peer-checked:border-accent peer-checked:bg-accent/10 border border-gray-200 rounded-lg p-3 flex items-center gap-2 transition-all hover:bg-gray-50">
                        <i class="ph-bold ph-presentation-chart text-purple-500 text-lg"></i>
                        <span class="text-xs font-bold">슬라이드 (HTML)</span>
                    </div>
                </label>
                <label class="cursor-pointer">
                    <input type="radio" name="export-format" value="html" class="hidden peer">
                    <div class="peer-checked:border-accent peer-checked:bg-accent/10 border border-gray-200 rounded-lg p-3 flex items-center gap-2 transition-all hover:bg-gray-50">
                        <i class="ph-bold ph-code text-emerald-500 text-lg"></i>
                        <span class="text-xs font-bold">HTML (단독 실행)</span>
                    </div>
                </label>
            </div>
        </div>

        <button onclick="executeExport()" class="w-full py-2.5 text-sm font-bold text-white bg-gradient-to-r from-accent to-accentHover rounded-lg hover:shadow-lg transition-all flex items-center justify-center gap-2">
            <i class="ph-bold ph-export"></i> 내보내기
        </button>
    </div>`;

    showModal('교안 내보내기', html);
};

window.executeExport = function () {
    const scope = document.querySelector('input[name="export-scope"]:checked')?.value || 'current';
    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'pdf';

    // 모달 닫기
    const modal = document.getElementById('custom-modal');
    if (modal) modal.classList.add('hidden');

    if (scope === 'all') {
        // 전체 내보내기
        if (format === 'pdf' && typeof exportSubjectToPDF === 'function') {
            exportSubjectToPDF();
        } else if (typeof exportAllModules === 'function') {
            exportAllModules();
        }
        return;
    }

    // 현재 차시 내보내기
    const mod = typeof getEditingModule === 'function' ? getEditingModule() : null;
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');

    const content = (mod.tabContents && mod.tabContents[currentLessonTab]) || mod.content;
    if (!content) return window.showAlert('교안 내용이 없습니다.');

    const lessonIdx = (typeof courseData !== 'undefined' && Array.isArray(courseData))
        ? courseData.findIndex(m => String(m.id) === String(mod.id))
        : 0;
    const filename = (typeof buildFilename === 'function')
        ? buildFilename(mod, Math.max(lessonIdx, 0), globalState.subjects.find(s => s.id === currentSubjectId))
        : mod.title.replace(/[^\w가-힣]/g, '_');

    switch (format) {
        case 'pdf':
            if (typeof exportToPDF === 'function') exportToPDF();
            break;
        case 'md': {
            const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename + '.md';
            a.click();
            URL.revokeObjectURL(a.href);
            window.showAlert('마크다운 파일이 다운로드되었습니다.');
            break;
        }
        case 'slide':
            if (typeof exportToSlideHTML === 'function') exportToSlideHTML();
            break;
        case 'html': {
            const htmlContent = typeof marked !== 'undefined' ? marked.parse(content) : content;
            const fullHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${mod.title}</title><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap" rel="stylesheet"><style>body{font-family:'Noto Sans KR',sans-serif;max-width:900px;margin:0 auto;padding:40px 20px;line-height:1.8;color:#1a1a2e;background:#fff;}h1,h2,h3,h4{margin-top:1.5em;color:#111827;}table{border-collapse:collapse;width:100%;margin:1em 0;}th,td{border:1px solid #ddd;padding:8px 12px;text-align:left;}th{background:#f5f5f5;font-weight:bold;}img{max-width:100%;border-radius:8px;margin:1em 0;}code{background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:0.9em;}pre{background:#1e1e2e;color:#e0e0e0;padding:16px;border-radius:8px;overflow-x:auto;}blockquote{border-left:4px solid #7c5bf5;margin:1em 0;padding:0.5em 1em;background:#f8f7ff;}</style></head><body>${htmlContent}</body></html>`;
            const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename + '.html';
            a.click();
            URL.revokeObjectURL(a.href);
            window.showAlert('HTML 파일이 다운로드되었습니다.');
            break;
        }
    }
};
