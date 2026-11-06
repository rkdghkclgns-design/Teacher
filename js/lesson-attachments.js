// lesson-attachments.js - 차시의 AI 수정과 교안 생성에 붙이는 참고 파일
// develocket-slide(assets/course-textbook.js ui.refs @3a7303f)를 따른다. 호출에만 쓰는 자료라 저장하지 않고 이 화면을 여는 동안만 들고 있는다.

const ATTACH_MAX_FILES = 3;
const ATTACH_MAX_CHARS = 20000;

let _lessonAttachments = []; // { moduleId, name, text }

const attachmentsOf = moduleId => _lessonAttachments.filter(item => String(item.moduleId) === String(moduleId));

function lessonAttachmentPrompt(moduleId) {
    const files = attachmentsOf(moduleId);
    if (!files.length) return '';
    return `\n\n[참고 파일 — 사실과 예시의 근거로 쓰고 문장을 그대로 옮기지 않습니다]\n${files.map(file => `### ${file.name}\n${file.text}`).join('\n\n')}`;
}

// AI 입력줄은 빈 차시에서 숨으므로 빈 차시 화면에도 같은 목록을 둔다
function renderLessonAttachments() {
    const chips = attachmentsOf(currentEditingModuleId).map((file, index) => `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 text-[0.6875rem] rounded bg-gray-500/20 text-gray-400">
            ${escapeHtml(file.name)}
            <button data-attach-remove="${index}" title="참고 파일 빼기" class="hover:text-red-400">✕</button>
        </span>`).join('');
    ['ai-attach-list', 'empty-attach-list'].map(id => document.getElementById(id)).filter(Boolean).forEach(box => {
        box.innerHTML = chips;
        box.classList.toggle('hidden', !chips);
    });
}

async function readAttachment(file, moduleId) {
    try {
        const text = String(await extractTextFromFile(file, { maxChars: ATTACH_MAX_CHARS })).trim(); // 붙일 만큼만 읽는다(큰 파일도)
        if (!text) throw new Error('읽을 글자가 없습니다.');
        return { moduleId, name: file.name, text: text.slice(0, ATTACH_MAX_CHARS) };
    } catch (err) {
        console.warn('[참고 파일] 읽지 못해 붙이지 않습니다:', file.name, err); // 까닭은 바로 알림으로 보인다
        window.showAlert(`${file.name}을 읽지 못했습니다: ${err.message}`);
        return null;
    }
}

window.addLessonAttachments = async function (event) {
    const input = event.target;
    const moduleId = currentEditingModuleId;
    const room = Math.max(0, ATTACH_MAX_FILES - attachmentsOf(moduleId).length);
    const files = [...input.files];
    if (files.length > room) window.showToast?.(`참고 파일은 차시마다 ${ATTACH_MAX_FILES}개까지 붙일 수 있습니다.`, 'warning');
    const read = await Promise.all(files.slice(0, room).map(file => readAttachment(file, moduleId)));
    _lessonAttachments = [..._lessonAttachments, ...read.filter(Boolean)];
    input.value = ''; // 같은 파일을 다시 고를 수 있게 한다
    renderLessonAttachments();
};

window.onLessonAttachmentClick = function (event) {
    const index = event.target.dataset?.attachRemove;
    if (index === undefined) return;
    const target = attachmentsOf(currentEditingModuleId)[Number(index)];
    _lessonAttachments = _lessonAttachments.filter(item => item !== target);
    renderLessonAttachments();
};
