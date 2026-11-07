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
const MERGE_LOADING_TEXT = 'AI가 상세 교안을 작성하고 있습니다...';
const MERGE_GONE_TEXT = '병합한 기본학습을 채우는 동안 그 차시를 지웠거나 백업·PC 폴더를 불러와 차시에 넣지 않았습니다.';

// 병합한 기본학습의 낭독 목표(분, lesson-lint.js learnTargetMinutes). 분량 채우기(lesson-volume.js)를 싣지 않은 화면은 0(받은 글 그대로 둔다)
const mergeVolumeTarget = () => (typeof ensureSpokenVolume === 'function' && typeof learnTargetMinutes === 'function' ? learnTargetMinutes(null, 'basicLearn') : 0);

// 병합한 새 차시가 아직 그 교과(지금 데이터)에 있는가. 채우는 동안 지우거나 백업·PC 폴더를 불러오면 아니다(api.js lessonStillLive)
const mergeLessonLive = (subj, lesson) => (typeof lessonStillLive === 'function' ? lessonStillLive(subj, lesson) : globalState.subjects.includes(subj) && subj.lessons.includes(lesson));

function setMergeStatus(text) {
    const el = document.getElementById('editor-loading-text');
    if (el) el.textContent = text;
}

// 병합 전에 묻는다. 기본학습을 낭독 목표까지 채우면 그 일과 호출 수·시간도 보인다(cost-estimate.js)
function confirmMerge(titles, target) {
    const fill = target ? `\n\n병합한 기본학습은 강사가 소리 내어 읽어도 ${target}분이 걸리는 분량까지 섹션마다 나눠 채우느라 20분 넘게 걸릴 수 있습니다. 로딩 화면의 '이 단락까지만 받고 중단'으로 멈추면 받은 데까지 저장합니다.` : '';
    const message = `선택한 ${titles.length}개 차시를 병합하여 새 교안을 재생성합니다.\n\n병합 대상:\n${titles.join('\n')}${fill}\n\n계속하시겠습니까?`;
    const opts = { title: '차시 병합', okLabel: '병합해 만들기' };
    if (target && typeof confirmWithEstimate === 'function' && typeof lessonWork === 'function') {
        return confirmWithEstimate(message, lessonWork({ tabs: ['basicLearn'], ncs: false, volumeMinutes: target }, 'none', 0), opts);
    }
    return confirmAsync(message, { ...opts, tone: 'primary' });
}

// 병합한 기본학습 초안을 탭 생성과 같은 채우기로 낭독 목표까지 채우고 컨벤션 필수 지적을 고쳐 받는다(tabs.js generateTabContent와 같다).
// 기다린 뒤마다 그 차시가 그 교과에 그대로 있는지 본다. 없어졌으면 { gone: true, md: 채운 글 }. 결과: { md, volume }
async function fillMergedLearn(subj, lesson, draft, snapshot, target) {
    const live = () => mergeLessonLive(subj, lesson);
    const isStopped = () => !!window.isTabGenerationStopped?.();
    const volume = await ensureSpokenVolume({
        ...snapshot, md: draft, mod: lesson, tabId: 'basicLearn', lockedBlocks: [], targetMinutes: target,
        codeTopic: typeof lessonCodeTopic === 'function' && lessonCodeTopic(lesson), isStopped, isLive: live, onStatus: setMergeStatus,
        waitSignal: window.aiStopSignal?.() || null
    });
    if (volume.gone || !live()) return { gone: true, md: volume.added ? volume.md : '' };
    // 중지했거나 하루 한도·키 문제로 멈췄으면 고쳐 받지 않는다(고치기도 같은 까닭으로 실패한다)
    const quit = isStopped() || volume.stopped || (typeof isVolumeHalt === 'function' && isVolumeHalt(volume.error));
    if (quit || typeof autoFixGeneratedTab !== 'function') return { md: volume.md, volume };
    const fixed = await autoFixGeneratedTab({ tabId: 'basicLearn', md: volume.md, lockedBlocks: [], onStatus: setMergeStatus, rounds: VOLUME_FIX_ROUNDS, minSpokenChars: volume.targetChars, isStopped });
    // 고쳐 받은 체크리스트에도 다시 보기의 옛 (⏱) 시간이 남지 않게 뗀다(lesson-volume.js)
    const checked = typeof volumeChecklistText === 'function' ? volumeChecklistText(fixed, []) : fixed;
    // 주석이 모자란 코드 블록에는 주석만 더한다(code-comments-tool.js)
    const md = typeof addGeneratedCodeComments === 'function'
        ? (await addGeneratedCodeComments({ md: checked, tabId: 'basicLearn', lockedBlocks: [], label: '기본학습', onStatus: setMergeStatus, isStopped, waitSignal: window.aiStopSignal?.() || null })).md
        : checked;
    return live() ? { md, volume } : { gone: true, md };
}

// 병합을 마친 알림. 기본학습을 채웠으면 낭독 분량을 함께 알린다
function mergeDoneText({ md, volume }) {
    if (!volume) return '병합 재생성이 완료되었습니다.';
    const minutes = readAloudMinutes(md);
    const resume = " 기본학습 탭 위 '분량 채우기'로 이어서 늘릴 수 있습니다.";
    if (volume.stopped) return `병합한 차시를 만들었지만 분량 채우기를 중단해 기본학습은 낭독 약 ${minutes}분까지 저장했습니다.${resume}`;
    if (spokenChars(md) < volume.targetChars) {
        return `병합 재생성이 완료되었지만 기본학습은 낭독 약 ${minutes}분으로 목표 ${volume.targetMinutes}분에 못 미칩니다.${resume}${volume.error?.message ? ` ${volume.error.message}` : ''}`;
    }
    return `병합 재생성이 완료되었습니다. 기본학습은 낭독 약 ${minutes}분(목표 ${volume.targetMinutes}분)입니다.`;
}

async function executeMerge() {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return;

    const selectedLessons = subj.lessons.filter(l => mergeSelectedIds.has(String(l.id)));
    if (selectedLessons.length < 2) return window.showAlert('2개 이상의 차시를 선택해주세요.');
    if (mergeBusy()) return window.showAlert(MERGE_BUSY_TEXT);

    const titles = selectedLessons.map(l => l.title);
    const target = mergeVolumeTarget();
    const ok = await confirmMerge(titles, target);
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
        tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null, advAssessment: null }
    };
    subj.lessons.push(newLesson);
    courseData = subj.lessons;

    renderSidebar();
    // 기본학습을 채울 때 붙일 참고 자료는 기다리기 전에 잡아 둔다(기다리는 동안 다른 교과로 옮겨도 그 교과 자료를 섞지 않는다)
    const snapshot = target && typeof volumeSnapshot === 'function' ? volumeSnapshot(newLesson) : {};

    try {
        document.getElementById('editor-loading').style.display = 'flex';
        if (target) window.beginGenerationStop?.(); // 로딩 화면의 중단 단추(tabs.js)

        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] }
        };

        const data = await callGemini(TEXT_MODEL, payload);

        const draft = extractText(data);
        // 병합한 기본학습도 낭독 목표(480분)까지 채운다(lesson-volume.js). 채우기를 싣지 않은 화면은 받은 글 그대로다
        const filled = target ? await fillMergedLearn(subj, newLesson, draft, snapshot, target) : { md: draft, volume: null };
        if (filled.gone) {
            const kept = filled.md && typeof keepVolumeText === 'function' ? ` ${await keepVolumeText(newLesson, filled.md, 'basicLearn')}` : '';
            return window.showAlert(`${MERGE_GONE_TEXT}${kept}`);
        }
        newLesson.content = filled.md;
        newLesson.tabContents = { ...(newLesson.tabContents || {}), basicLearn: filled.md };
        newLesson.status = 'done';

        await saveState();
        renderSidebar();
        if (currentSubjectId === subj.id) renderEditor(newLesson); // 채우는 동안 다른 교과로 옮겼으면 그 교과 화면에 이 차시를 그리지 않는다
        window.showAlert(mergeDoneText(filled));
    } catch (err) {
        console.error('[Merge] 실패:', err);
        newLesson.status = 'error';
        window.showAlert('병합 재생성 중 오류가 발생했습니다: ' + err.message);
    } finally {
        document.getElementById('editor-loading').style.display = 'none';
        if (target) {
            setMergeStatus(MERGE_LOADING_TEXT);
            window.endGenerationStop?.();
        }
        mergeSelectedIds.clear();
        updateMergeUI();
    }
}
