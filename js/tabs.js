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
    const baseArgs = {
        title: mod.title,
        description: mod.description,
        keyConcepts: [],
        tabId: tabId,
        tabLabel: tabMeta.label,
        otherTabContents: otherTabSummaries || null,
        hasMainQuest: !!subj?.mainQuest,
        mainQuestText: subj?.mainQuest?.description || ''
    };
    const { systemInstruction, userPrompt } = buildTaskContext('tab_content', baseArgs);

    try {
        document.getElementById('editor-loading').style.display = 'flex';

        // 진행도 표기: 로딩 오버레이의 안내 문구를 단계별로 갱신해 사용자가 현재 진행 상황을 알 수 있게 함
        const setLoadingText = (txt) => {
            const el = document.getElementById('editor-loading-text');
            if (el) el.textContent = txt;
        };

        // 재시도 발생 시(특히 429 호출 한도) 로딩 문구를 갱신해 멈춘 것처럼 보이지 않게 함
        const onRetry = ({ delayMs, isRateLimit }) => {
            const sec = Math.round((delayMs || 0) / 1000);
            if (isRateLimit) {
                setLoadingText(`⏳ API 호출 한도에 도달했습니다. ${sec}초 후 자동으로 다시 시도합니다...`);
            } else {
                setLoadingText(`⏳ 일시적인 응답 지연이 발생했습니다. ${sec}초 후 자동으로 다시 시도합니다...`);
            }
        };

        // ─── CONTINUE/END 분할 생성 루프 (긴 탭, 특히 기본 학습 480분이 잘리지 않도록) ───
        const CONTINUE_MARKER = '<!-- CONTINUE -->';
        const END_MARKER = '<!-- END -->';
        // 기본 학습은 분량이 가장 크므로 더 많은 청크 허용
        const MAX_CHUNKS = tabId === 'basicLearn' ? 6 : 3;

        setLoadingText(`📝 ${tabMeta.label} 작성 중입니다... (1/${MAX_CHUNKS} 단락)`);

        // 강사 callout 4항목 구조를 안정적으로 유도하기 위해 Few-Shot 예시 turn을 contents 앞에 주입
        // (규칙·예시 텍스트만으로는 모델이 "강사 스크립트"를 말하기 대본으로 출력하는 prior를 못 이김)
        const calloutFewshot = (typeof CALLOUT_FORMAT_FEWSHOT !== 'undefined') ? CALLOUT_FORMAT_FEWSHOT : [];

        const firstPayload = {
            contents: [...calloutFewshot, { role: 'user', parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: { maxOutputTokens: 65536 }
        };

        let fullText = extractText(await callGemini(TEXT_MODEL, firstPayload, onRetry));
        let chunkCount = 1;
        // 이어쓰기 단계에서 호출 한도 등으로 실패하면, 이미 만든 단락은 버리지 않고 보존하기 위한 플래그
        let partialDueToError = false;

        while (fullText.includes(CONTINUE_MARKER) && chunkCount < MAX_CHUNKS) {
            // 마커 제거 후 이어쓰기 준비
            fullText = fullText.replace(new RegExp(CONTINUE_MARKER, 'g'), '').trimEnd();
            const contextTail = fullText.length > 2000 ? fullText.slice(-2000) : fullText;

            const cont = buildTaskContext('tab_content_continue', {
                ...baseArgs,
                chunkIndex: chunkCount,
                previousContent: contextTail
            });

            setLoadingText(`✍️ ${tabMeta.label} 이어서 작성 중입니다... (${chunkCount + 1}/${MAX_CHUNKS} 단락)`);

            await new Promise(r => setTimeout(r, 1500));

            // 이어쓰기 청크에도 few-shot을 재주입한다. (텍스트 규칙만으로는 모델이 "강사 스크립트"를
            // 말하기 대본(narration)으로 회귀하므로, 모든 청크가 4항목 구조를 유지하려면 few-shot이 필요.
            // 첫 청크에만 넣으면 후반 섹션이 narration으로 깨지는 문제가 있어 형식 일관성을 위해 토큰을 감수.)
            const contPayload = {
                contents: [...calloutFewshot, { role: 'user', parts: [{ text: cont.userPrompt }] }],
                systemInstruction: { parts: [{ text: cont.systemInstruction }] },
                generationConfig: { maxOutputTokens: 65536 }
            };

            let contText;
            try {
                contText = extractText(await callGemini(TEXT_MODEL, contPayload, onRetry));
            } catch (contErr) {
                // 이어쓰기 청크 실패(예: 429 호출 한도) — 첫 청크는 이미 성공했으므로
                // 지금까지 생성된 분량을 보존하고 루프를 종료한다 (전체 폐기 방지)
                partialDueToError = true;
                break;
            }

            // 중복 헤딩 제거: 이어쓴 첫 헤딩이 직전 마지막 헤딩과 같으면 제거
            const prevHeadings = fullText.match(/^(#{1,4}\s+.+)$/gm) || [];
            const lastHeading = prevHeadings.length ? prevHeadings[prevHeadings.length - 1].trim() : null;
            if (lastHeading) {
                const contLines = contText.split('\n');
                const firstNonEmpty = contLines.findIndex(l => l.trim() !== '');
                if (firstNonEmpty !== -1 && contLines[firstNonEmpty].trim() === lastHeading) {
                    contLines.splice(firstNonEmpty, 1);
                    contText = contLines.join('\n');
                }
            }

            fullText += '\n\n' + contText.trimStart();
            chunkCount++;
        }

        // 잔여 마커 정리
        fullText = fullText
            .replace(new RegExp(CONTINUE_MARKER, 'g'), '')
            .replace(new RegExp(END_MARKER, 'g'), '')
            .trimEnd();

        let resultText = fullText;
        // 마크다운 정리 + 강사 callout 자동 래핑 (예상 소요 등이 학생뷰에 노출되지 않도록)
        if (typeof sanitizeMarkdownContent === 'function') {
            resultText = sanitizeMarkdownContent(resultText);
        }

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
            setLoadingText(`🖼️ ${tabMeta.label} 이미지와 서식을 정리하고 있습니다...`);
            // LLM 응답의 이미지 태그 개수 진단 로깅 — 왜 이미지가 안 나오는지 원인 파악
            const tagCount = (resultText.match(/<!--\s*\[IMG:/g) || []).length;
            console.log(`[TabGen] ${tabMeta.label} 생성 완료 — LLM이 생성한 이미지 태그: ${tagCount}개`);
            if (tagCount === 0 && tabId !== 'assessment') {
                console.warn(`[TabGen] ⚠️ ${tabMeta.label} 에 이미지 태그가 없음. 자동 주입 로직이 활성화됩니다.`);
            }
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
        if (!_suppressTabAlert) {
            window.showAlert(partialDueToError
                ? `${tabMeta.label} 탭이 생성되었지만, API 호출 한도로 일부 단락이 누락되었을 수 있습니다. 잠시 후(1~2분) 다시 생성하면 전체 분량이 완성됩니다.`
                : `${tabMeta.label} 탭이 생성되었습니다.`);
        }
    } catch (err) {
        console.error(`[TabGen] ${tabMeta.label} 실패:`, err);
        // 429(호출 한도)는 원인과 대처법을 명확히 안내해 사용자가 무한 재시도하지 않도록 함
        const is429 = /status:\s*429/.test(err.message || '');
        window.showAlert(is429
            ? `${tabMeta.label} 생성 실패: API 호출 한도(429)에 도달했습니다. 1~2분 후 다시 시도해 주세요. (짧은 시간에 여러 탭을 연속 생성하면 한도에 걸릴 수 있습니다.)`
            : `${tabMeta.label} 생성 중 오류: ${err.message}`);
    } finally {
        // 진행도 안내 문구를 기본값으로 복원해 다음 작업에 잔여 텍스트가 남지 않도록 함
        const loadingTextEl = document.getElementById('editor-loading-text');
        if (loadingTextEl) loadingTextEl.textContent = 'AI가 상세 교안을 작성하고 있습니다...';
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
        if (progressBar) progressBar.innerHTML = `<span style="color:#f87171;">⚠️ 생성 중 오류 발생: ${(typeof escapeHtml === 'function' ? escapeHtml(String(e.message || e)) : String(e.message || e))}</span>`;
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
