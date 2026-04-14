// merge.js — 교안 병합 재생성 시스템

let mergeSelectedIds = new Set();

function toggleMergeCheckbox(lessonId) {
    const id = String(lessonId);
    if (mergeSelectedIds.has(id)) {
        mergeSelectedIds.delete(id);
    } else {
        mergeSelectedIds.add(id);
    }
    updateMergeUI();
}

function updateMergeUI() {
    const btn = document.getElementById('merge-btn');
    if (!btn) return;
    const count = mergeSelectedIds.size;
    if (count >= 2) {
        btn.classList.remove('hidden');
        const countSpan = btn.querySelector('.merge-count');
        if (countSpan) countSpan.textContent = count;
    } else {
        btn.classList.add('hidden');
    }
    document.querySelectorAll('.merge-checkbox').forEach(cb => {
        cb.checked = mergeSelectedIds.has(cb.dataset.lessonId);
    });
}

function clearMergeSelection() {
    mergeSelectedIds.clear();
    updateMergeUI();
}

async function executeMerge() {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return;

    const selectedLessons = subj.lessons.filter(l => mergeSelectedIds.has(String(l.id)));
    if (selectedLessons.length < 2) return window.showAlert('2개 이상의 차시를 선택해주세요.');

    const titles = selectedLessons.map(l => l.title);
    if (!confirm(`선택한 ${selectedLessons.length}개 차시를 병합하여 새 교안을 재생성합니다.\n\n병합 대상:\n${titles.join('\n')}\n\n계속하시겠습니까?`)) return;

    const mergedContext = selectedLessons.map(l => {
        const tabContent = l.tabContents ? Object.values(l.tabContents).filter(Boolean).join('\n\n') : '';
        const content = (tabContent || l.content || '').substring(0, 3000) || '(내용 없음)';
        return `[${l.title}]\n${l.description || ''}\n\n${content}`;
    }).join('\n\n---\n\n');

    const { systemInstruction, userPrompt } = buildTaskContext('merge', {
        titles: titles,
        mergedContext: mergedContext
    });

    const newLesson = {
        id: Date.now(),
        title: '[병합] ' + titles.join(' + '),
        description: '병합 재생성된 차시입니다.',
        status: 'generating',
        content: null,
        images: {},
        tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null }
    };
    subj.lessons.push(newLesson);
    courseData = subj.lessons;

    renderSidebar();

    try {
        document.getElementById('editor-loading').style.display = 'flex';

        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] }
        };

        const data = await fetchWithRetry(
            `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${apiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        );

        const resultText = extractText(data);
        newLesson.content = resultText;
        if (!newLesson.tabContents) newLesson.tabContents = {};
        newLesson.tabContents.basicLearn = resultText;
        newLesson.status = 'done';

        await saveState();
        renderSidebar();
        renderEditor(newLesson);
        window.showAlert('병합 재생성이 완료되었습니다.');
    } catch (err) {
        console.error('[Merge] 실패:', err);
        newLesson.status = 'error';
        window.showAlert('병합 재생성 중 오류가 발생했습니다: ' + err.message);
    } finally {
        document.getElementById('editor-loading').style.display = 'none';
        mergeSelectedIds.clear();
        updateMergeUI();
    }
}
