// tabs.js — 5탭 에디터 시스템

let currentLessonTab = 'basicLearn';
let _suppressTabAlert = false;

const TAB_COLORS = {
    blue:    { active: 'bg-blue-500 border-blue-500 text-white shadow-md', inactive: 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200' },
    emerald: { active: 'bg-emerald-500 border-emerald-500 text-white shadow-md', inactive: 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200' },
    amber:   { active: 'bg-amber-500 border-amber-500 text-white shadow-md', inactive: 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200' },
    red:     { active: 'bg-red-500 border-red-500 text-white shadow-md', inactive: 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200' },
    violet:  { active: 'bg-violet-500 border-violet-500 text-white shadow-md', inactive: 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200' }
};

function renderTabBar(mod) {
    if (!mod || !LESSON_TABS) return '';
    const tabContents = mod.tabContents || {};
    return LESSON_TABS.map(tab => {
        const isActive = currentLessonTab === tab.id;
        const hasContent = !!tabContents[tab.id];
        const colors = TAB_COLORS[tab.color] || TAB_COLORS.blue;
        const cls = isActive ? colors.active : colors.inactive;
        const dot = hasContent
            ? '<span class="w-2 h-2 rounded-full bg-current opacity-70"></span>'
            : '<span class="w-2 h-2 rounded-full bg-gray-300 opacity-40"></span>';
        return `<button onclick="switchLessonTab('${tab.id}')"
            class="px-3 py-2 text-[0.75rem] font-bold rounded-t-lg border-b-2 transition-all cursor-pointer select-none flex items-center gap-1.5 whitespace-nowrap ${cls}">
            <i class="ph-bold ${tab.icon} text-sm"></i>
            ${tab.label}
            ${dot}
        </button>`;
    }).join('');
}

function switchLessonTab(tabId) {
    currentLessonTab = tabId;
    const mod = getEditingModule();
    if (mod) renderEditor(mod);
}

function getActiveTabContent(mod) {
    if (!mod) return '';
    if (mod.tabContents && mod.tabContents[currentLessonTab]) {
        return mod.tabContents[currentLessonTab];
    }
    // 폴백: 기존 content 필드 사용
    if (currentLessonTab === 'basicLearn' && mod.content) {
        return mod.content;
    }
    return '';
}

function migrateMonolithicContent(mod) {
    if (mod && mod.content && (!mod.tabContents || !mod.tabContents.basicLearn)) {
        if (!mod.tabContents) {
            mod.tabContents = { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null };
        }
        mod.tabContents.basicLearn = mod.content;
    }
}

async function generateTabContent(moduleId, tabId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return;

    const tabMeta = LESSON_TABS.find(t => t.id === tabId);
    if (!tabMeta) return;

    // Cross-tab context
    const tabContents = mod.tabContents || {};
    const otherTabSummaries = LESSON_TABS
        .filter(t => t.id !== tabId && tabContents[t.id])
        .map(t => `[${t.label}] ${tabContents[t.id].substring(0, 500)}...`)
        .join('\n');

    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    const { systemInstruction, userPrompt } = buildTaskContext('tab_content', {
        title: mod.title,
        description: mod.description,
        keyConcepts: [],
        tabId: tabId,
        tabLabel: tabMeta.label,
        otherTabContents: otherTabSummaries || null,
        hasMainQuest: !!subj?.mainQuest,
        mainQuestText: subj?.mainQuest?.description || ''
    });

    try {
        document.getElementById('editor-loading').style.display = 'flex';

        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] }
        };

        const data = await callGemini(TEXT_MODEL, payload);

        const resultText = extractText(data);
        if (!mod.tabContents) mod.tabContents = { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null };
        mod.tabContents[tabId] = resultText;
        mod.status = 'done';

        // content 필드도 업데이트 (역호환)
        mod.content = LESSON_TABS
            .map(t => (mod.tabContents[t.id] || ''))
            .filter(Boolean)
            .join('\n\n---\n\n');

        // 이미지 태그 자동 처리 (딥리서치 파이프라인 활용)
        if (typeof processImageTags === 'function') {
            try {
                const processed = await processImageTags(mod, resultText);
                if (processed !== resultText) {
                    mod.tabContents[tabId] = processed;
                    mod.content = LESSON_TABS.map(t => (mod.tabContents[t.id] || '')).filter(Boolean).join('\n\n---\n\n');
                }
            } catch (imgErr) {
                console.warn('[TabGen] 이미지 처리 경고:', imgErr.message);
            }
        }

        await saveState();
        renderSidebar();
        renderEditor(mod);
        if (!_suppressTabAlert) window.showAlert(`${tabMeta.label} 탭이 생성되었습니다.`);
    } catch (err) {
        console.error(`[TabGen] ${tabMeta.label} 실패:`, err);
        window.showAlert(`${tabMeta.label} 생성 중 오류: ${err.message}`);
    } finally {
        document.getElementById('editor-loading').style.display = 'none';
    }
}

async function generateAllTabs(moduleId) {
    _suppressTabAlert = true;
    const total = LESSON_TABS.length;
    // 프로그레스 바 생성
    let progressBar = document.getElementById('gen-progress-bar');
    if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.id = 'gen-progress-bar';
        progressBar.style.cssText = 'position:fixed;top:0;left:0;width:100%;z-index:9999;background:rgba(0,0,0,0.85);color:#fff;padding:12px 24px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:16px;backdrop-filter:blur(8px);';
        document.body.appendChild(progressBar);
    }
    try {
        for (let i = 0; i < total; i++) {
            const tab = LESSON_TABS[i];
            const pct = Math.round(((i) / total) * 100);
            progressBar.innerHTML = `
                <div style="flex:1">
                    <div style="margin-bottom:6px;">📝 전체 교안 생성 중... <span style="color:#22d3ee;">${tab.label}</span> (${i + 1}/${total})</div>
                    <div style="width:100%;height:6px;background:rgba(255,255,255,0.15);border-radius:4px;overflow:hidden;">
                        <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#22d3ee,#a78bfa);border-radius:4px;transition:width 0.5s;"></div>
                    </div>
                </div>
                <span style="font-size:20px;min-width:50px;text-align:right;">${pct}%</span>`;
            await generateTabContent(moduleId, tab.id);
            await new Promise(r => setTimeout(r, 2000));
        }
        // 완료 표시
        progressBar.innerHTML = `
            <div style="flex:1;text-align:center;">
                <span style="font-size:18px;">✅ 전체 5탭 교안 생성 완료!</span>
                <div style="width:100%;height:6px;background:rgba(255,255,255,0.15);border-radius:4px;overflow:hidden;margin-top:6px;">
                    <div style="width:100%;height:100%;background:linear-gradient(90deg,#22c55e,#10b981);border-radius:4px;"></div>
                </div>
            </div>
            <span style="font-size:20px;">100%</span>`;
        setTimeout(() => progressBar?.remove(), 3000);
    } catch (e) {
        if (progressBar) progressBar.innerHTML = `<span style="color:#f87171;">⚠️ 생성 중 오류 발생: ${e.message || e}</span>`;
        setTimeout(() => progressBar?.remove(), 5000);
        throw e;
    } finally {
        _suppressTabAlert = false;
    }
}

// 이미 생성된 탭을 건너뛰고 나머지만 생성
async function generateRemainingTabs(moduleId) {
    _suppressTabAlert = true;
    try {
        for (const tab of LESSON_TABS) {
            const mod = getEditingModule(moduleId);
            if (mod?.tabContents?.[tab.id]) continue;
            await generateTabContent(moduleId, tab.id);
            await new Promise(r => setTimeout(r, 2000));
        }
        window.showAlert('전체 5탭 교안 생성이 완료되었습니다!');
    } finally {
        _suppressTabAlert = false;
    }
}

// 보강 재생성: 기존 탭 내용 + 사용자 보강 명령으로 재생성
async function reinforceCurrentTab(moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return;
    const tabId = currentLessonTab;
    const existingContent = mod.tabContents?.[tabId];
    if (!existingContent) return window.showAlert('먼저 이 탭의 교안을 생성해주세요.');

    const reinforceInput = document.getElementById('reinforce-input');
    const reinforceCmd = (reinforceInput?.value || '').trim();
    if (!reinforceCmd) return window.showAlert('보강 명령을 입력해주세요.');

    const tabMeta = LESSON_TABS.find(t => t.id === tabId);

    try {
        document.getElementById('editor-loading').style.display = 'flex';

        const systemInstruction = CONTEXT_CORE.personas.instructor +
            '\n[규칙]\n- 기존 교안 내용을 유지하면서, 사용자의 보강 명령에 따라 내용을 개선하세요.\n- 전체 구조와 서식은 보존하되, 요청된 부분만 보강·수정하세요.\n- ' +
            CONTEXT_CORE.rules.korean_period + '\n- ' +
            (CONTEXT_CORE.rules.emoji_rule || '');

        const userPrompt = `[현재 작업: ${tabMeta.label} 보강 재생성]\n모듈명: ${mod.title}\n\n[사용자 보강 명령]\n${reinforceCmd}\n\n[기존 교안 내용 — 이 내용을 기반으로 보강하세요]\n${existingContent}`;

        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] }
        };

        const data = await callGemini(TEXT_MODEL, payload);

        const resultText = extractText(data);
        mod.tabContents[tabId] = resultText;
        mod.content = LESSON_TABS.map(t => (mod.tabContents[t.id] || '')).filter(Boolean).join('\n\n---\n\n');

        await saveState();
        renderEditor(mod);
        reinforceInput.value = '';
        window.showAlert(`${tabMeta.label} 보강 재생성이 완료되었습니다.`);
    } catch (err) {
        console.error('[Reinforce] 실패:', err);
        window.showAlert('보강 재생성 중 오류: ' + err.message);
    } finally {
        document.getElementById('editor-loading').style.display = 'none';
    }
}
