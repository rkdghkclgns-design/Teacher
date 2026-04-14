// panel-manager.js — 패널/드롭다운 중앙 관리 (한 번에 1개만 열림)

const PanelManager = {
    _panels: new Map(),

    register(id, { element, triggerSelector, openFunc, closeFunc }) {
        this._panels.set(id, { element, triggerSelector, openFunc, closeFunc, isOpen: false });
    },

    open(id) {
        this.closeAll();
        const panel = this._panels.get(id);
        if (!panel) return;
        panel.openFunc();
        panel.isOpen = true;
    },

    close(id) {
        const panel = this._panels.get(id);
        if (!panel || !panel.isOpen) return;
        panel.closeFunc();
        panel.isOpen = false;
    },

    toggle(id) {
        const panel = this._panels.get(id);
        if (!panel) return;
        if (panel.isOpen) {
            this.close(id);
        } else {
            this.open(id);
        }
    },

    closeAll() {
        for (const [id, panel] of this._panels) {
            if (panel.isOpen) {
                panel.closeFunc();
                panel.isOpen = false;
            }
        }
    },

    handleOutsideClick(e) {
        for (const [id, panel] of this._panels) {
            if (!panel.isOpen) continue;
            const el = typeof panel.element === 'string' ? document.querySelector(panel.element) : panel.element;
            if (!el) continue;
            // 패널 내부 클릭이면 무시
            if (el.contains(e.target)) continue;
            // 트리거 버튼 클릭이면 무시 (toggle이 처리)
            if (panel.triggerSelector) {
                const trigger = document.querySelector(panel.triggerSelector);
                if (trigger && trigger.contains(e.target)) continue;
            }
            this.close(id);
        }
    }
};

// 전역 외부 클릭 핸들러
document.addEventListener('click', (e) => {
    PanelManager.handleOutsideClick(e);
});
