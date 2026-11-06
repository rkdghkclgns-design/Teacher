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

// 로딩 화면을 함께 쓰는 다른 생성이나 기본 학습 분량 채우기(lesson-volume.js)가 도는 동안은 병합하지 않는다(끝날 때 남의 로딩 화면을 내리지 않게)
const mergeBusy = () => !!(window.generationBusy?.() || window.isVolumeFilling?.());
const MERGE_BUSY_TEXT = '진행 중인 생성이 끝난 뒤 다시 시도해주세요.';

async function executeMerge() {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return;

    const selectedLessons = subj.lessons.filter(l => mergeSelectedIds.has(String(l.id)));
    if (selectedLessons.length < 2) return window.showAlert('2개 이상의 차시를 선택해주세요.');
    if (mergeBusy()) return window.showAlert(MERGE_BUSY_TEXT);

    const titles = selectedLessons.map(l => l.title);
    const ok = await confirmAsync(`선택한 ${selectedLessons.length}개 차시를 병합하여 새 교안을 재생성합니다.\n\n병합 대상:\n${titles.join('\n')}\n\n계속하시겠습니까?`, { title: '차시 병합', okLabel: '병합해 만들기', tone: 'primary' });
    if (!ok) return;
    // 묻는 동안 다른 교과로 옮겼거나 다른 생성이 시작됐으면 시작하지 않는다(새 차시가 엉뚱한 교과에 들어가지 않게)
    if (globalState.subjects.find(s => s.id === currentSubjectId) !== subj) return window.showToast?.('묻는 동안 교과가 바뀌어 병합하지 않았습니다.', 'warning');
    if (mergeBusy()) return window.showAlert(MERGE_BUSY_TEXT);

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

        const data = await callGemini(TEXT_MODEL, payload);

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
