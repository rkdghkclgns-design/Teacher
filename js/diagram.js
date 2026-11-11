// --- Diagram Visualization & Minimap Logic ---

/* ---------- 메인 지도 접기·펴기와 지우기 ----------
 * 과정 카드와 교과 카드 오른쪽 끝의 단추로 자식(교과·차시)을 접고 편다. 접은 상태는 이 브라우저에만 기억한다(작업 데이터는 바꾸지 않는다).
 * 교과 카드의 휴지통 단추는 교과 목록의 삭제와 같다(ui.js deleteSubject: 차시까지 함께 휴지통으로).
 * 차시 카드의 X는 그 차시만 휴지통으로 옮긴다. 지금 연 교과가 아니어도 지운다(api.js deleteModule과 같은 규칙).
 * 테스트: tests/diagram-map.test.js */
const DIAGRAM_FOLD_KEY = 'teacher:diagram-folds';
const DIAGRAM_FOLD_LIMIT = 500; // 기억할 접은 교과 수
let diagramFolds = null; // { root: 과정을 접었는지, subjects: 접은 교과 id(글자) }

function readDiagramFolds() {
    if (diagramFolds) return diagramFolds;
    try {
        const saved = JSON.parse(localStorage.getItem(DIAGRAM_FOLD_KEY) || 'null');
        const subjects = Array.isArray(saved?.subjects) ? saved.subjects.filter(id => typeof id === 'string').slice(-DIAGRAM_FOLD_LIMIT) : [];
        diagramFolds = { root: saved?.root === true, subjects };
    } catch (err) {
        diagramFolds = { root: false, subjects: [] }; // 저장소를 못 쓰거나 값이 깨졌으면 모두 펼친다
    }
    return diagramFolds;
}

function writeDiagramFolds(next) {
    diagramFolds = next;
    try {
        localStorage.setItem(DIAGRAM_FOLD_KEY, JSON.stringify(next));
    } catch (err) {
        console.warn('[메인 지도] 접은 상태를 저장하지 못했습니다:', err.message);
    }
}

const diagramSubjectFolded = (folds, subj) => folds.subjects.includes(String(subj.id));

// 지도 단추의 data 속성(교과·차시 id는 글자로만 담는다. 누르면 onDiagramToolClick이 읽는다)
const diagramIdAttr = (name, id) => `data-${name}="${escapeHtml(String(id))}"`;

// 카드 오른쪽 끝(선이 나가는 자리)의 접기 단추. 접었으면 숨긴 자식 수를 보인다. left: 카드 너비에 맞춘 자리(px), attrs: 단추가 할 일
function diagramFoldButtonHtml({ folded, count, unit, left, attrs }) {
    const label = folded ? `${unit} ${count}개 펼치기` : `${unit} 접기`;
    return `<button type="button" ${attrs} data-diagram-fold="${folded ? 'folded' : 'open'}"
        class="absolute z-20 top-1/2 -translate-y-1/2 h-6 min-w-[24px] px-1.5 flex items-center justify-center gap-0.5 rounded-full border text-[0.6875rem] font-bold shadow-md transition-colors pointer-events-auto ${folded ? 'bg-accent border-accent text-white' : 'bg-bgSidebar border-white/20 text-textMuted hover:text-white hover:border-accent'}"
        style="left:${left}px" title="${label}" aria-label="${label}" aria-expanded="${folded ? 'false' : 'true'}">${folded ? `<i class="ph-bold ph-plus text-[0.625rem]"></i>${count}` : '<i class="ph-bold ph-minus text-[0.625rem]"></i>'}</button>`;
}

// 지도 단추를 누르면 그 일만 한다. 붙잡는 단계에서 받아 카드의 클릭(교과 상세·편집기 열기)으로 번지지 않게 한다
function onDiagramToolClick(event) {
    const button = event.target.closest?.('[data-diagram-action]');
    if (!button || !button.closest('#diagram-dynamic-content')) return;
    event.stopPropagation();
    event.preventDefault();
    const { diagramAction: action, subjectId, lessonId } = button.dataset;
    if (action === 'fold-root') window.toggleDiagramRoot();
    else if (action === 'fold-subject') window.toggleDiagramSubject(subjectId);
    else if (action === 'delete-subject' && typeof deleteSubject === 'function') deleteSubject(subjectId);
    else if (action === 'delete-lesson') window.deleteLessonFromMap(subjectId, lessonId);
}

if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', onDiagramToolClick, true);

window.toggleDiagramRoot = function () {
    const folds = readDiagramFolds();
    writeDiagramFolds({ ...folds, root: !folds.root });
    renderDiagram();
};

window.toggleDiagramSubject = function (id) {
    const folds = readDiagramFolds();
    const key = String(id);
    const live = new Set(globalState.subjects.map(subj => String(subj.id)));
    const kept = folds.subjects.filter(item => item !== key && live.has(item)); // 지운 교과의 기억은 버린다
    writeDiagramFolds({ ...folds, subjects: folds.subjects.includes(key) ? kept : [...kept, key] });
    renderDiagram();
};

// 메인 지도의 차시 X: 그 차시를 휴지통으로 옮긴다. 생성이 도는 동안에는 옮기지 않는다(course-meta.js trashRestoreBlocked)
window.deleteLessonFromMap = function (subjectId, lessonId) {
    const subject = globalState.subjects.find(item => String(item.id) === String(subjectId));
    const busy = () => typeof trashRestoreBlocked === 'function' && trashRestoreBlocked();
    const lessonsOf = () => (typeof subjectLessonList === 'function' ? subjectLessonList(subject) : subject.lessons) || [];
    const findLesson = () => lessonsOf().find(item => String(item.id) === String(lessonId));
    if (!subject || String(lessonId) === 'mainQuest' || !findLesson()) return;
    if (busy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    window.showConfirm(`'${findLesson().title}' 차시를 휴지통으로 옮길까요?\n30일 안에 차시 목록 위 휴지통에서 되살릴 수 있습니다.`, () => {
        if (busy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.'); // 확인 창을 띄운 사이 시작된 생성
        const current = String(subject.id) === String(currentSubjectId);
        if (current) window.saveRawContent?.(); // 고치던 원문을 먼저 그 차시에 넣고 옮긴다
        const lesson = findLesson();
        if (!lesson) return;
        if (lesson.content && typeof archiveContent === 'function') archiveContent(lesson);
        moveLessonsToTrash([lesson], subject.id);
        subject.lessons = lessonsOf().filter(item => item !== lesson);
        if (current) {
            courseData = subject.lessons;
            if (String(currentEditingModuleId) === String(lessonId)) currentEditingModuleId = null;
        }
        Promise.resolve(saveState()).then(() => {
            if (typeof renderOverviewLNB === 'function') renderOverviewLNB();
            renderDiagram();
            if (current && typeof renderSidebar === 'function') renderSidebar();
            window.showToast?.(`'${lesson.title}' 차시를 휴지통으로 옮겼습니다.`, 'success');
        }).catch(err => {
            console.error('[메인 지도] 차시 삭제 저장 실패:', err);
            renderDiagram();
            window.showToast?.('차시를 휴지통으로 옮겼지만 저장하지 못했습니다. 잠시 뒤 Ctrl+S로 다시 저장해 주세요.', 'error');
        });
    });
};

        function renderDiagram() {

            const container = document.getElementById('diagram-dynamic-content');

            const svgLines = document.getElementById('diagram-lines');

            const minimapContent = document.getElementById('minimap-content');



            if (!container) return;



            if (!Array.isArray(globalState.subjects) || globalState.subjects.length === 0) {

                container.innerHTML = `

                    <div class="text-center text-textMuted bg-black/40 p-10 rounded-2xl border border-white/5 backdrop-blur-sm m-auto">

                        <i class="ph-duotone ph-tree-structure text-6xl mb-4 opacity-50 text-accent"></i>

                        <h3 class="text-xl font-bold text-white mb-2">교과 과정이 비어있습니다</h3>

                        <p class="text-sm">좌측 목차 패널에서 '+' 버튼을 눌러 교과를 추가해보세요.</p>

                    </div>`;

                if (svgLines) svgLines.innerHTML = '';

                if (minimapContent) minimapContent.innerHTML = '';

                return;

            }



            const folds = readDiagramFolds(); // 접어 둔 과정·교과(이 브라우저에 기억)

            container.innerHTML = `

                <!-- Course Node (Root) -->

                <div class="relative shrink-0">

                <div id="node-course" class="bg-gradient-to-br from-bgSidebar to-black border-2 border-accent/50 p-6 rounded-2xl shadow-[0_0_30px_rgba(124,91,245,0.15)] z-10 w-[260px] shrink-0 pointer-events-auto">

                    <div class="flex items-center gap-2 mb-2">

                        <i class="ph-fill ph-target text-accent text-xl"></i>

                        <div class="text-[0.6875rem] font-bold text-accent tracking-widest">과정</div>

                    </div>

                    <div class="font-bold text-lg text-white leading-tight">${escapeHtml(globalState.courseTitle)}</div>

                </div>

                ${diagramFoldButtonHtml({ folded: folds.root, count: globalState.subjects.length, unit: '교과', left: 248, attrs: 'data-diagram-action="fold-root"' })}

                </div>



                <!-- Subjects & Lessons Branches -->

                ${folds.root ? '' : `<div class="flex flex-col gap-12 ml-20">

                    ${globalState.subjects.map(subj => `

                        <div class="flex items-center relative">

                            <!-- Subject Node -->

                            <div id="node-subj-${subj.id}" class="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-accent/50 p-5 rounded-xl shadow-lg z-10 w-[280px] shrink-0 cursor-pointer transition-all group relative overflow-hidden pointer-events-auto" onclick="openSubjectDetail('${subj.id}')">

                                <div class="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-accent/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

                                <div class="flex justify-between items-start mb-3 relative z-10">

                                    <span class="text-xs font-bold text-textLight bg-black/30 border border-white/10 px-2 py-1 rounded">교과</span>

                                    <div class="flex items-center gap-1 -mr-1 -mt-1">

                                    <button onclick="event.stopPropagation(); location.hash='#editor/${subj.id}'" class="opacity-0 group-hover:opacity-100 px-3 py-1.5 bg-accent hover:bg-accentHover text-white text-[0.6875rem] font-bold rounded shadow-md transition-all flex items-center gap-1" title="상세 교안 편집기로 이동">

                                        <i class="ph-bold ph-pencil-simple"></i> 편집기 열기

                                    </button>

                                    <button type="button" data-diagram-action="delete-subject" ${diagramIdAttr('subject-id', subj.id)} class="opacity-0 group-hover:opacity-100 focus:opacity-100 px-2 py-1.5 bg-white/10 hover:bg-rose-500 text-textLight hover:text-white text-[0.6875rem] rounded shadow-md transition-all" title="이 교과를 차시와 함께 휴지통으로 옮깁니다" aria-label="교과 삭제">

                                        <i class="ph-bold ph-trash"></i>

                                    </button>

                                    </div>

                                </div>

                                <div class="font-bold text-white text-[1.1rem] mb-2 truncate relative z-10" title="${escapeHtml(subj.title)}">${escapeHtml(subj.title)}</div>

                                <div class="text-xs text-textMuted line-clamp-2 leading-relaxed relative z-10" title="${escapeHtml(subj.description)}">${escapeHtml(subj.description || '교과 설명을 입력해주세요.')}</div>

                                ${subj.mainQuest && subj.mainQuest.status === 'done' ? `<div class="mt-3 text-xs text-yellow-400 font-bold"><i class="ph-fill ph-crown"></i> 최종 평가 완료</div>` : ''}

                            </div>



                            ${diagramFoldButtonHtml({ folded: diagramSubjectFolded(folds, subj), count: (subj.lessons || []).length, unit: '차시', left: 268, attrs: `data-diagram-action="fold-subject" ${diagramIdAttr('subject-id', subj.id)}` })}

                            <!-- Lessons Column -->

                            ${diagramSubjectFolded(folds, subj) ? '' : `<div class="flex flex-col gap-3 ml-20">

                                ${subj.lessons && subj.lessons.length > 0 ? subj.lessons.map((lesson, lIdx) => `

                                    <div id="node-less-${escapeHtml(String(subj.id))}-${escapeHtml(String(lesson.id))}" onclick="event.stopPropagation(); location.hash='#editor/${escapeHtml(String(subj.id))}/${escapeHtml(String(lesson.id))}'" class="bg-black/30 border ${lesson.status === 'done' ? 'border-accent/30 bg-accent/5' : 'border-white/5'} px-4 py-3 rounded-lg z-10 w-[240px] shrink-0 hover:border-white/20 hover:-translate-y-0.5 shadow-sm hover:shadow-lg transition-all group cursor-pointer pointer-events-auto" title="${escapeHtml(lesson.description || '')} (클릭하여 편집)">

                                        <div class="flex gap-2.5 items-center">

                                            <span class="text-[0.6875rem] font-bold text-textMuted group-hover:text-accent transition-colors">${lIdx + 1}</span>

                                            <div class="text-sm font-bold text-textLight truncate flex-1">${escapeHtml(lesson.title)}</div>

                                            ${lesson.id === 'mainQuest' ? '' : `<button type="button" data-diagram-action="delete-lesson" ${diagramIdAttr('subject-id', subj.id)} ${diagramIdAttr('lesson-id', lesson.id)} class="opacity-0 group-hover:opacity-100 focus:opacity-100 -mr-1 w-5 h-5 shrink-0 flex items-center justify-center rounded text-textMuted hover:bg-rose-500 hover:text-white transition-all" title="이 차시를 휴지통으로 옮깁니다" aria-label="차시 삭제"><i class="ph-bold ph-x text-xs"></i></button>`}

                                        </div>

                                    </div>

                                `).join('') : `

                                    <div class="text-xs text-textMuted italic px-4 py-2 bg-black/10 rounded border border-white/5 border-dashed z-10 w-[240px]">

                                        <i class="ph-fill ph-warning-circle mr-1"></i>아직 생성된 차시가 없습니다.

                                    </div>

                                `}

                            </div>`}

                        </div>

                    `).join('')}

                </div>`}

            `;



            setTimeout(() => {

                drawDiagramLines();

                renderMinimap();

            }, 50);

        }



        function drawDiagramLines() {

            const svg = document.getElementById('diagram-lines');

            const layer = document.getElementById('diagram-transform-layer');

            if (!svg || !layer || globalState.subjects.length === 0) return;

            svg.innerHTML = '';



            // 지도 안의 카드만 찾는다. 미니맵은 지도를 그대로 복사해 같은 id가 있고, 접어서 지도에 없는 카드를 미니맵의 옛 복사본에서 찾으면 엉뚱한 곳으로 선을 긋는다
            const content = document.getElementById('diagram-dynamic-content');

            const nodeById = id => {
                const el = document.getElementById(id);
                return el && content && content.contains(el) ? el : null;
            };

            const courseNode = nodeById('node-course');

            if (!courseNode) return;



            const getCenter = (el, isStart) => {

                const rect = el.getBoundingClientRect();

                const layerRect = layer.getBoundingClientRect();

                return {

                    x: (rect.left - layerRect.left + (isStart ? rect.width : 0)) / diagramScale,

                    y: (rect.top - layerRect.top + (rect.height / 2)) / diagramScale

                };

            };



            const drawCurve = (p1, p2, isSubBranch) => {

                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

                const offset = 40;

                const d = `M ${p1.x} ${p1.y} C ${p1.x + offset} ${p1.y}, ${p2.x - offset} ${p2.y}, ${p2.x} ${p2.y}`;

                path.setAttribute('d', d);

                path.setAttribute('fill', 'none');

                path.setAttribute('stroke', isSubBranch ? 'rgba(255, 255, 255, 0.1)' : 'rgba(124, 91, 245, 0.4)');

                path.setAttribute('stroke-width', isSubBranch ? '1.5' : '2.5');

                svg.appendChild(path);

            };



            const startP = getCenter(courseNode, true);



            globalState.subjects.forEach(subj => {

                const subjNode = nodeById(`node-subj-${subj.id}`);

                if (subjNode) {

                    const endP = getCenter(subjNode, false);

                    drawCurve(startP, endP, false);



                    const subjStartP = getCenter(subjNode, true);

                    if (subj.lessons && subj.lessons.length > 0) {

                        subj.lessons.forEach(lesson => {

                            const lessonNode = nodeById(`node-less-${subj.id}-${lesson.id}`);

                            if (lessonNode) {

                                const lessonEndP = getCenter(lessonNode, false);

                                drawCurve(subjStartP, lessonEndP, true);

                            }

                        });

                    }

                }

            });

        }



        function renderMinimap() {

            const content = document.getElementById('diagram-dynamic-content');

            const minimapContent = document.getElementById('minimap-content');

            const container = document.getElementById('minimap-container');



            if (!content || !minimapContent || !container) return;



            minimapContent.innerHTML = content.innerHTML;



            setTimeout(() => {

                const contentRect = content.getBoundingClientRect();

                const unscaledWidth = contentRect.width / diagramScale;

                const unscaledHeight = contentRect.height / diagramScale;



                const boundsW = Math.max(unscaledWidth + 100, 800);

                const boundsH = Math.max(unscaledHeight + 100, 600);



                const scaleX = container.clientWidth / boundsW;

                const scaleY = container.clientHeight / boundsH;

                const mapScale = Math.min(scaleX, scaleY) * 0.9;



                minimapContent.style.transform = `scale(${mapScale})`;

                minimapContent.style.width = `${boundsW}px`;

                minimapContent.style.height = `${boundsH}px`;



                container.dataset.mapScale = mapScale;

                updateMinimapIndicator();

            }, 50);

        }



        function updateMinimapIndicator() {

            const indicator = document.getElementById('minimap-indicator');

            const container = document.getElementById('minimap-container');

            const viewport = document.getElementById('diagram-viewport');



            if (!indicator || !container || !viewport) return;



            const mapScale = parseFloat(container.dataset.mapScale || 1);



            const viewW = viewport.clientWidth / diagramScale;

            const viewH = viewport.clientHeight / diagramScale;



            const viewX = -diagramX / diagramScale;

            const viewY = -diagramY / diagramScale;



            indicator.style.width = `${viewW * mapScale}px`;

            indicator.style.height = `${viewH * mapScale}px`;



            indicator.style.left = `${Math.max(0, viewX * mapScale)}px`;

            indicator.style.top = `${Math.max(0, viewY * mapScale)}px`;

        }



        function initDiagramInteractions() {

            const viewport = document.getElementById('diagram-viewport');

            if (!viewport) return;



            viewport.addEventListener('mousedown', (e) => {

                if (e.target.closest('#overview-detail-panel') || e.target.closest('#minimap-container') || e.target.closest('button')) return;



                isDraggingDiagram = true;

                window.hasDragged = false;

                startDragX = e.clientX - diagramX;

                startDragY = e.clientY - diagramY;

                viewport.classList.add('cursor-grabbing');

            });



            window.addEventListener('mousemove', (e) => {

                if (!isDraggingDiagram) return;



                const newX = e.clientX - startDragX;

                const newY = e.clientY - startDragY;



                if (Math.abs(diagramX - newX) > 5 || Math.abs(diagramY - newY) > 5) {

                    window.hasDragged = true;

                }



                diagramX = newX;

                diagramY = newY;

                updateDiagramTransform();

            });



            window.addEventListener('mouseup', () => {

                isDraggingDiagram = false;

                viewport.classList.remove('cursor-grabbing');

                setTimeout(() => { window.hasDragged = false; }, 50);

            });



            viewport.addEventListener('wheel', (e) => {

                if (e.target.closest('#overview-detail-panel') || e.target.closest('#overview-lnb-list')) return;

                e.preventDefault();



                const zoomIntensity = 0.1;

                const wheel = e.deltaY < 0 ? 1 : -1;

                const zoom = Math.exp(wheel * zoomIntensity);



                const rect = viewport.getBoundingClientRect();

                const mouseX = e.clientX - rect.left;

                const mouseY = e.clientY - rect.top;



                diagramX = mouseX - (mouseX - diagramX) * zoom;

                diagramY = mouseY - (mouseY - diagramY) * zoom;

                diagramScale *= zoom;



                diagramScale = Math.max(0.2, Math.min(diagramScale, 3));

                updateDiagramTransform();

            }, { passive: false });

        }



        function initMinimapInteractions() {

            const container = document.getElementById('minimap-container');

            const viewport = document.getElementById('diagram-viewport');

            if (!container || !viewport) return;



            let isDraggingMinimap = false;



            const updateFromMinimap = (e) => {

                const rect = container.getBoundingClientRect();

                const mapScale = parseFloat(container.dataset.mapScale || 1);



                const clickX = e.clientX - rect.left;

                const clickY = e.clientY - rect.top;



                const targetCenterX = clickX / mapScale;

                const targetCenterY = clickY / mapScale;



                diagramX = -(targetCenterX * diagramScale - viewport.clientWidth / 2);

                diagramY = -(targetCenterY * diagramScale - viewport.clientHeight / 2);



                updateDiagramTransform();

            };



            container.addEventListener('mousedown', (e) => {

                isDraggingMinimap = true;

                updateFromMinimap(e);

            });



            window.addEventListener('mousemove', (e) => {

                if (isDraggingMinimap) updateFromMinimap(e);

            });



            window.addEventListener('mouseup', () => {

                isDraggingMinimap = false;

            });

        }



        window.zoomDiagram = function (amount) {

            const viewport = document.getElementById('diagram-viewport');

            const centerPointX = viewport.clientWidth / 2;

            const centerPointY = viewport.clientHeight / 2;



            const zoom = amount > 0 ? 1.2 : 0.8;



            diagramX = centerPointX - (centerPointX - diagramX) * zoom;

            diagramY = centerPointY - (centerPointY - diagramY) * zoom;

            diagramScale *= zoom;

            diagramScale = Math.max(0.2, Math.min(diagramScale, 3));



            updateDiagramTransform();

        }



        window.resetDiagramView = function () {

            diagramScale = 1;

            diagramX = 100;

            diagramY = 100;

            updateDiagramTransform();

        }



        function updateDiagramTransform() {

            const layer = document.getElementById('diagram-transform-layer');

            const viewport = document.getElementById('diagram-viewport');



            if (layer) {

                layer.style.transform = `translate(${diagramX}px, ${diagramY}px) scale(${diagramScale})`;

            }

            if (viewport) {

                viewport.style.backgroundPosition = `${diagramX}px ${diagramY}px`;

                viewport.style.backgroundSize = `${24 * diagramScale}px ${24 * diagramScale}px`;

            }

            updateMinimapIndicator();

        }



        window.addEventListener('resize', () => {

            if (window.location.hash !== '#overview' && !window.location.hash.startsWith('#editor')) {

                drawDiagramLines();

                updateMinimapIndicator();

            }

        });



        // ------------------------------------------------------------------------

        