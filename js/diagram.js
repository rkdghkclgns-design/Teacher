// --- Diagram Visualization & Minimap Logic ---

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



            container.innerHTML = `

                <!-- Course Node (Root) -->

                <div id="node-course" class="bg-gradient-to-br from-bgSidebar to-black border-2 border-accent/50 p-6 rounded-2xl shadow-[0_0_30px_rgba(124,91,245,0.15)] z-10 w-[260px] shrink-0 pointer-events-auto">

                    <div class="flex items-center gap-2 mb-2">

                        <i class="ph-fill ph-target text-accent text-xl"></i>

                        <div class="text-[0.65rem] font-bold text-accent uppercase tracking-widest">Course</div>

                    </div>

                    <div class="font-bold text-lg text-white leading-tight">${globalState.courseTitle}</div>

                </div>



                <!-- Subjects & Lessons Branches -->

                <div class="flex flex-col gap-12 ml-20">

                    ${globalState.subjects.map(subj => `

                        <div class="flex items-center relative">

                            <!-- Subject Node -->

                            <div id="node-subj-${subj.id}" class="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-accent/50 p-5 rounded-xl shadow-lg z-10 w-[280px] shrink-0 cursor-pointer transition-all group relative overflow-hidden pointer-events-auto" onclick="openSubjectDetail('${subj.id}')">

                                <div class="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-accent/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

                                <div class="flex justify-between items-start mb-3 relative z-10">

                                    <span class="text-xs font-bold text-textLight bg-black/30 border border-white/10 px-2 py-1 rounded">교과 모듈</span>

                                    <button onclick="event.stopPropagation(); location.hash='#editor/${subj.id}'" class="opacity-0 group-hover:opacity-100 px-3 py-1.5 bg-accent hover:bg-accentHover text-white text-[0.65rem] font-bold rounded shadow-md transition-all flex items-center gap-1 -mr-1 -mt-1" title="상세 교안 편집기로 이동">

                                        <i class="ph-bold ph-pencil-simple"></i> 편집기 열기

                                    </button>

                                </div>

                                <div class="font-bold text-white text-[1.1rem] mb-2 truncate relative z-10" title="${subj.title}">${subj.title}</div>

                                <div class="text-xs text-textMuted line-clamp-2 leading-relaxed relative z-10" title="${subj.description}">${subj.description || '교과 설명을 입력해주세요.'}</div>

                                ${subj.mainQuest && subj.mainQuest.status === 'done' ? `<div class="mt-3 text-xs text-yellow-400 font-bold"><i class="ph-fill ph-crown"></i> 메인 퀘스트 완료됨</div>` : ''}

                            </div>



                            <!-- Lessons Column -->

                            <div class="flex flex-col gap-3 ml-20">

                                ${subj.lessons && subj.lessons.length > 0 ? subj.lessons.map((lesson, lIdx) => `

                                    <div id="node-less-${subj.id}-${lesson.id}" onclick="event.stopPropagation(); location.hash='#editor/${subj.id}/${lesson.id}'" class="bg-black/30 border ${lesson.status === 'done' ? 'border-accent/30 bg-accent/5' : 'border-white/5'} px-4 py-3 rounded-lg z-10 w-[240px] shrink-0 hover:border-white/20 hover:-translate-y-0.5 shadow-sm hover:shadow-lg transition-all group cursor-pointer pointer-events-auto" title="${lesson.description || ''} (클릭하여 편집)">

                                        <div class="flex gap-2.5 items-center">

                                            <span class="text-[0.65rem] font-bold text-textMuted group-hover:text-accent transition-colors">${lIdx + 1}</span>

                                            <div class="text-sm font-bold text-textLight truncate flex-1">${lesson.title}</div>

                                        </div>

                                    </div>

                                `).join('') : `

                                    <div class="text-xs text-textMuted/40 italic px-4 py-2 bg-black/10 rounded border border-white/5 border-dashed z-10 w-[240px]">

                                        <i class="ph-fill ph-warning-circle mr-1"></i>아직 생성된 차시가 없습니다.

                                    </div>

                                `}

                            </div>

                        </div>

                    `).join('')}

                </div>

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



            const courseNode = document.getElementById('node-course');

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

                const subjNode = document.getElementById(`node-subj-${subj.id}`);

                if (subjNode) {

                    const endP = getCenter(subjNode, false);

                    drawCurve(startP, endP, false);



                    const subjStartP = getCenter(subjNode, true);

                    if (subj.lessons && subj.lessons.length > 0) {

                        subj.lessons.forEach(lesson => {

                            const lessonNode = document.getElementById(`node-less-${subj.id}-${lesson.id}`);

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

        