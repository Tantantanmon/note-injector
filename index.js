const EXTENSION_NAME = 'note-injector';

import { event_types } from '../../../events.js';
import { extension_prompt_types, eventSource, setExtensionPrompt, saveSettingsDebounced } from '../../../../script.js';
import { renderExtensionTemplateAsync, extension_settings as extensionSettings, getContext } from '../../../extensions.js';

const INJECT_POSITION = {
    'authors_note': extension_prompt_types.IN_CHAT,
    'before_system': extension_prompt_types.BEFORE_PROMPT,
    'after_system': extension_prompt_types.IN_PROMPT,
    'chat_start': extension_prompt_types.IN_CHAT,
};
const POSITION_DEPTH = { 'authors_note': 2, 'before_system': 0, 'after_system': 0, 'chat_start': 100 };
const POSITION_LABELS = { 'authors_note': "Author's Note", 'before_system': 'System 앞', 'after_system': 'System 뒤', 'chat_start': '채팅 맨 앞' };
const POSITION_DESCS = { 'authors_note': '귓속말처럼 — AI가 가장 잘 들음', 'before_system': '헌법 — 모든 것보다 우선', 'after_system': '법률 — 강력하지만 헌법 아래', 'chat_start': '오래된 기억 — 잘 잊혀짐' };
const POSITION_ICON_CLASS = { 'authors_note': 'ni-icon-an', 'before_system': 'ni-icon-sp', 'after_system': 'ni-icon-sa', 'chat_start': 'ni-icon-cf' };
const POSITION_ICONS = {
    'authors_note': `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    'before_system': `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    'after_system': `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    'chat_start': `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
};

let currentChar = '__global__';
let currentData = getDefaultData();
let currentGroupIdx = 0;
let currentTabIdx = 0;
let currentSectionIdx = 0;
let currentView = 'home';
let panelOpen = false;
let panelCollapsed = false;
let modalSelectedGroup = null;
let modalNewGroupName = null;

function isMobile() {
    try {
        if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
        return window.matchMedia('(max-width:768px),(pointer:coarse)').matches;
    } catch { return window.innerWidth <= 768; }
}

function getDefaultData() { return { groups: [], ungrouped: [], home: { writingStyle: '', upcomingEvents: '', bannedWords: [] } }; }

function getCurrentCharacter() {
    try {
        const ctx = getContext();
        return ctx.characters?.[ctx.characterId]?.name || '__global__';
    } catch { return '__global__'; }
}

function saveData() {
    if (!extensionSettings[EXTENSION_NAME]) extensionSettings[EXTENSION_NAME] = {};
    extensionSettings[EXTENSION_NAME][currentChar] = currentData;
    saveSettingsDebounced();
}

function loadData(charName) {
    const d = extensionSettings[EXTENSION_NAME]?.[charName];
    return d ? JSON.parse(JSON.stringify(d)) : getDefaultData();
}

function getCurrentTab() {
    return currentData.groups?.[currentGroupIdx]?.tabs?.[currentTabIdx] || null;
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getHintText(sec) {
    if (!sec.enabled) return '주입 꺼짐';
    return `${POSITION_LABELS[sec.position || 'authors_note']} 위치로 주입 중`;
}

// ===== 패널 HTML =====
function buildPanelHTML() {
    return `
<div id="ni-panel" class="ni-panel">
  <div class="ni-panel-inner">
    <div class="ni-sidebar">
      <div class="ni-sb-head">
        <span class="ni-sb-title">Note</span>
        <div style="display:flex;align-items:center;gap:4px;">
          <button class="ni-icon-btn ni-collapse-only-pc" id="ni-collapse-btn" title="접기">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 18l6-6-6-6"/></svg>
          </button>
          <button class="ni-icon-btn ni-close-btn" id="ni-close-btn" title="닫기">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="ni-sb-list" id="ni-sb-list"></div>
      <button class="ni-sb-add-btn" id="ni-add-tab-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M12 5v14M5 12h14"/></svg>
        탭 추가
      </button>
    </div>
    <div class="ni-main" id="ni-main">
      <div class="ni-main-head">
        <div class="ni-main-head-top">
          <span class="ni-main-title" id="ni-main-title">-</span>
          <button class="ni-add-sec-btn" id="ni-add-sec-btn">+ 섹션</button>
        </div>
        <div class="ni-sec-tabbar" id="ni-sec-tabbar"></div>
      </div>
      <div class="ni-pages" id="ni-pages"></div>
    </div>
  </div>

  <!-- 모달: 패널 inner 안에 위치 (PC에서 패널 위에 올라옴, 모바일은 CSS로 화면 하단 고정) -->
  <div class="ni-modal-overlay" id="ni-tab-modal" style="display:none;">
    <div class="ni-modal-box">
      <div class="ni-modal-head">
        <span class="ni-modal-title">탭 추가</span>
        <button class="ni-modal-x" id="ni-tab-modal-close">✕</button>
      </div>
      <div class="ni-modal-body">
        <div class="ni-field">
          <label class="ni-field-label">탭 이름</label>
          <input class="ni-field-input" id="ni-tab-name-input" placeholder="예: Ghost, 내 페르소나..." />
        </div>
        <div class="ni-field">
          <label class="ni-field-label">그룹</label>
          <div id="ni-group-opts"></div>
          <div class="ni-new-group-row" id="ni-new-group-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M12 5v14M5 12h14"/></svg>
            새 그룹 만들기
          </div>
          <div class="ni-new-group-input-row" id="ni-new-group-input-row" style="display:none;">
            <input class="ni-new-group-input" id="ni-new-group-input" placeholder="그룹 이름..." />
            <button class="ni-new-group-confirm" id="ni-new-group-confirm">확인</button>
          </div>
        </div>
      </div>
      <div class="ni-modal-footer">
        <button class="ni-btn-cancel" id="ni-tab-modal-cancel">취소</button>
        <button class="ni-btn-confirm" id="ni-tab-modal-add">추가</button>
      </div>
    </div>
  </div>

  <div class="ni-modal-overlay" id="ni-sec-modal" style="display:none;">
    <div class="ni-modal-box">
      <div class="ni-modal-head">
        <span class="ni-modal-title">섹션 추가</span>
        <button class="ni-modal-x" id="ni-sec-modal-close">✕</button>
      </div>
      <div class="ni-modal-body">
        <div class="ni-field">
          <label class="ni-field-label">섹션 이름</label>
          <input class="ni-field-input" id="ni-sec-name-input" placeholder="예: 말투, 성격, 세계관..." />
        </div>
      </div>
      <div class="ni-modal-footer">
        <button class="ni-btn-cancel" id="ni-sec-modal-cancel">취소</button>
        <button class="ni-btn-confirm" id="ni-sec-modal-add">추가</button>
      </div>
    </div>
  </div>
</div>

<div class="ni-handle" id="ni-handle">
  <div class="ni-handle-dot"></div>
  <div class="ni-handle-dot"></div>
  <div class="ni-handle-dot"></div>
  <div class="ni-handle-dot"></div>
  <div class="ni-handle-dot"></div>
</div>
`;
}

// ===== 렌더링 =====
function renderSidebar() {
    const list = document.getElementById('ni-sb-list');
    if (!list) return;
    list.innerHTML = '';

    // 홈 탭
    const homeRow = document.createElement('div');
    homeRow.className = `ni-sb-row${currentView === 'home' ? ' active' : ''}`;
    homeRow.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg><span class="ni-sb-row-name">Home</span>`;
    homeRow.addEventListener('click', () => selectHome());
    homeRow.addEventListener('touchend', (e) => { e.preventDefault(); selectHome(); }, { passive: false });
    list.appendChild(homeRow);

    const askRow = document.createElement('div');
    askRow.className = `ni-sb-row${currentView === 'ask' ? ' active' : ''}`;
    askRow.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span class="ni-sb-row-name">Ask</span>`;
    askRow.addEventListener('click', () => selectAsk());
    askRow.addEventListener('touchend', (e) => { e.preventDefault(); selectAsk(); }, { passive: false });
    list.appendChild(askRow);

    const divHome = document.createElement('div');
    divHome.className = 'ni-sb-div';
    list.appendChild(divHome);

    if (!currentData.groups?.length) {
        list.innerHTML += '<div class="ni-sb-empty">탭을 추가해보세요</div>';
        return;
    }

    // ungrouped 탭들 (그룹 없는 탭)
    if (currentData.ungrouped?.length) {
        currentData.ungrouped.forEach((tab, tIdx) => {
            list.appendChild(makeTabRow(tab, -1, tIdx));
        });
        const div = document.createElement('div');
        div.className = 'ni-sb-div';
        list.appendChild(div);
    }

    currentData.groups.forEach((group, gIdx) => {
        const lblWrap = document.createElement('div');
        lblWrap.className = 'ni-sb-group-row';
        lblWrap.innerHTML = `<span class="ni-sb-sec-lbl" style="flex:1;">${escapeHtml(group.name)}</span><button class="ni-sb-del-group" data-gidx="${gIdx}" title="그룹 삭제">✕</button>`;
        lblWrap.querySelector('.ni-sb-del-group').addEventListener('click', e => { e.stopPropagation(); deleteGroup(gIdx); });
        list.appendChild(lblWrap);

        (group.tabs || []).forEach((tab, tIdx) => {
            list.appendChild(makeTabRow(tab, gIdx, tIdx));
        });

        const div = document.createElement('div');
        div.className = 'ni-sb-div';
        list.appendChild(div);
    });
}

function makeTabRow(tab, gIdx, tIdx) {
    const row = document.createElement('div');
    const isActive = gIdx === currentGroupIdx && tIdx === currentTabIdx && currentView === 'tab';
    row.className = `ni-sb-row${isActive ? ' active' : ''}`;
    row.draggable = true;
    row.dataset.gidx = gIdx;
    row.dataset.tidx = tIdx;
    row.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="13" height="13"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        <span class="ni-sb-row-name">${escapeHtml(tab.name)}</span>
        <button class="ni-sb-del-tab" title="탭 삭제">✕</button>`;
    row.querySelector('.ni-sb-del-tab').addEventListener('click', e => { e.stopPropagation(); deleteTab(gIdx, tIdx); });
    row.querySelector('.ni-sb-del-tab').addEventListener('touchend', e => { e.stopPropagation(); e.preventDefault(); deleteTab(gIdx, tIdx); }, { passive: false });

    // 모바일: long-press 드래그 + 단일 탭으로 이동
    let touchMoved = false;
    let longPressTimer = null;
    let dragging = false;
    let startX = 0, startY = 0;
    row.addEventListener('touchstart', (e) => {
        touchMoved = false;
        dragging = false;
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        longPressTimer = setTimeout(() => {
            dragging = true;
            startMobileDrag(row, gIdx, tIdx, startX, startY);
        }, 350);
    }, { passive: true });
    row.addEventListener('touchmove', (e) => {
        if (!dragging) {
            // 움직임이 크면 long-press 취소 (스크롤로 간주)
            if (e.touches.length === 1) {
                const dx = Math.abs(e.touches[0].clientX - startX);
                const dy = Math.abs(e.touches[0].clientY - startY);
                if (dx > 8 || dy > 8) {
                    touchMoved = true;
                    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
                }
            }
            return;
        }
        // 드래그 중
        e.preventDefault();
        updateMobileDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    row.addEventListener('touchend', (e) => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        if (dragging) {
            e.preventDefault();
            endMobileDrag();
            dragging = false;
            return;
        }
        if (touchMoved) return;
        if (e.target.classList.contains('ni-sb-del-tab')) return;
        e.preventDefault();
        selectTab(gIdx, tIdx);
    }, { passive: false });
    row.addEventListener('touchcancel', () => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        if (dragging) { endMobileDrag(); dragging = false; }
    });

    row.addEventListener('click', (e) => {
        if (e.target.classList.contains('ni-sb-del-tab')) return;
        selectTab(gIdx, tIdx);
    });
    row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', JSON.stringify({gIdx, tIdx})); row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    return row;
}

// ===== 모바일 터치 드래그 구현 =====
let mobileDragState = null;
function startMobileDrag(row, gIdx, tIdx, x, y) {
    // 햅틱 피드백 (지원 시)
    try { if (navigator.vibrate) navigator.vibrate(30); } catch(_) {}

    // 드래그 고스트 (반투명 복제본)
    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;opacity:0.75;z-index:100000;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,0.25);border-radius:8px;transform:scale(1.02);`;
    document.body.appendChild(ghost);

    row.classList.add('dragging');
    row.style.opacity = '0.3';

    mobileDragState = {
        row, ghost, gIdx, tIdx,
        offsetX: x - rect.left,
        offsetY: y - rect.top,
        lastTarget: null,
    };
}
function updateMobileDrag(x, y) {
    if (!mobileDragState) return;
    const { ghost, offsetX, offsetY } = mobileDragState;
    ghost.style.left = (x - offsetX) + 'px';
    ghost.style.top = (y - offsetY) + 'px';

    // 고스트 잠시 숨기고 아래 요소 찾기
    ghost.style.display = 'none';
    const under = document.elementFromPoint(x, y);
    ghost.style.display = '';

    if (!under) return;
    const target = under.closest && under.closest('.ni-sb-row[draggable]');
    // 이전 타겟 하이라이트 제거
    if (mobileDragState.lastTarget && mobileDragState.lastTarget !== target) {
        mobileDragState.lastTarget.classList.remove('drag-over');
    }
    if (target && target !== mobileDragState.row) {
        target.classList.add('drag-over');
        mobileDragState.lastTarget = target;
    } else {
        mobileDragState.lastTarget = null;
    }
}
function endMobileDrag() {
    if (!mobileDragState) return;
    const { row, ghost, gIdx, tIdx, lastTarget } = mobileDragState;
    ghost.remove();
    row.classList.remove('dragging');
    row.style.opacity = '';
    if (lastTarget) lastTarget.classList.remove('drag-over');

    if (lastTarget && lastTarget !== row) {
        const toGIdx = parseInt(lastTarget.dataset.gidx);
        const toTIdx = parseInt(lastTarget.dataset.tidx);
        if (!(gIdx === toGIdx && tIdx === toTIdx)) {
            // PC 드롭 로직과 동일
            let tab;
            if (gIdx === -1) {
                tab = currentData.ungrouped.splice(tIdx, 1)[0];
            } else {
                tab = currentData.groups[gIdx].tabs.splice(tIdx, 1)[0];
                if (!currentData.groups[gIdx].tabs.length) currentData.groups.splice(gIdx, 1);
            }
            const destGIdx = toGIdx === -1 ? -1 : toGIdx;
            if (destGIdx === -1) {
                if (!currentData.ungrouped) currentData.ungrouped = [];
                currentData.ungrouped.splice(toTIdx, 0, tab);
            } else {
                if (currentData.groups[destGIdx]) currentData.groups[destGIdx].tabs.splice(toTIdx, 0, tab);
            }
            saveData(); renderSidebar();
        }
    }
    mobileDragState = null;
}

function deleteTab(gIdx, tIdx) {
    if (gIdx === -1) {
        currentData.ungrouped.splice(tIdx, 1);
    } else {
        currentData.groups[gIdx].tabs.splice(tIdx, 1);
        if (!currentData.groups[gIdx].tabs.length) currentData.groups.splice(gIdx, 1);
    }
    saveData(); renderSidebar();
    currentGroupIdx = 0; currentTabIdx = 0;
    const firstTab = currentData.groups?.[0]?.tabs?.[0];
    if (firstTab) selectTab(0, 0); else selectHome();
}

function deleteGroup(gIdx) {
    const tabs = currentData.groups[gIdx].tabs || [];
    if (!currentData.ungrouped) currentData.ungrouped = [];
    currentData.ungrouped.push(...tabs);
    currentData.groups.splice(gIdx, 1);
    saveData(); renderSidebar();
}

function initDragDrop() {
    const list = document.getElementById('ni-sb-list');
    if (!list) return;
    list.addEventListener('dragover', e => {
        e.preventDefault();
        const target = e.target.closest('.ni-sb-row[draggable]');
        if (target) target.classList.add('drag-over');
    });
    list.addEventListener('dragleave', e => {
        const target = e.target.closest('.ni-sb-row[draggable]');
        if (target) target.classList.remove('drag-over');
    });
    list.addEventListener('drop', e => {
        e.preventDefault();
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        const target = e.target.closest('.ni-sb-row[draggable]');
        if (!target) return;
        target.classList.remove('drag-over');
        const toGIdx = parseInt(target.dataset.gidx);
        const toTIdx = parseInt(target.dataset.tidx);
        if (data.gIdx === toGIdx && data.tIdx === toTIdx) return;

        let tab;
        if (data.gIdx === -1) {
            tab = currentData.ungrouped.splice(data.tIdx, 1)[0];
        } else {
            tab = currentData.groups[data.gIdx].tabs.splice(data.tIdx, 1)[0];
            if (!currentData.groups[data.gIdx].tabs.length) currentData.groups.splice(data.gIdx, 1);
        }

        const destGIdx = toGIdx === -1 ? -1 : toGIdx;
        if (destGIdx === -1) {
            if (!currentData.ungrouped) currentData.ungrouped = [];
            currentData.ungrouped.splice(toTIdx, 0, tab);
        } else {
            if (currentData.groups[destGIdx]) currentData.groups[destGIdx].tabs.splice(toTIdx, 0, tab);
        }
        saveData(); renderSidebar();
    });
}

function renderTabBar(sections) {
    const bar = document.getElementById('ni-sec-tabbar');
    if (!bar) return;
    bar.innerHTML = '';
    (sections || []).forEach((sec, sIdx) => {
        const t = document.createElement('div');
        t.className = `ni-sec-tab${sIdx === currentSectionIdx ? ' active' : ''}${sec.enabled ? ' injecting' : ''}`;
        t.innerHTML = `<span class="ni-tab-dot"></span>${escapeHtml(sec.name)}<span class="ni-sec-tab-del" data-idx="${sIdx}">✕</span>`;
        t.addEventListener('click', (e) => {
            if (e.target.classList.contains('ni-sec-tab-del')) return;
            selectSection(sIdx);
        });
        t.querySelector('.ni-sec-tab-del').addEventListener('click', (e) => {
            e.stopPropagation();
            const tab = getCurrentTab();
            if (!tab) return;
            tab.sections.splice(sIdx, 1);
            if (currentSectionIdx >= tab.sections.length) currentSectionIdx = Math.max(0, tab.sections.length - 1);
            saveData(); applyInjection();
            renderTabBar(tab.sections);
            renderPages(tab.sections);
        });
        bar.appendChild(t);
    });
    const add = document.createElement('div');
    add.className = 'ni-sec-tab-add';
    add.textContent = '+';
    add.addEventListener('click', openSecModal);
    bar.appendChild(add);
}

function renderPages(sections) {
    const pages = document.getElementById('ni-pages');
    if (!pages) return;
    pages.innerHTML = '';
    (sections || []).forEach((sec, sIdx) => {
        const page = document.createElement('div');
        page.className = `ni-page${sIdx === currentSectionIdx ? ' ni-page-active' : ''}`;
        page.id = `ni-page-${sIdx}`;
        const pos = sec.position || 'authors_note';
        const isOn = sec.enabled;
        const locOpts = Object.entries(POSITION_LABELS).map(([key, label]) => `
            <div class="ni-loc-opt${key===pos?' ni-loc-opt-selected':''}" data-pos="${key}" data-idx="${sIdx}">
                <div class="ni-loc-icon ${POSITION_ICON_CLASS[key]}">${POSITION_ICONS[key]}</div>
                <div class="ni-loc-opt-text">
                    <span class="ni-loc-opt-name">${label}</span>
                    <span class="ni-loc-opt-sub">${POSITION_DESCS[key]}</span>
                </div>
                ${key===pos?'<span class="ni-loc-check">✓</span>':''}
            </div>`).join('');
        page.innerHTML = `
            <div class="ni-page-controls">
                <div class="ni-ctrl-left">
                    <span class="ni-ctrl-lbl">주입</span>
                    <span class="ni-badge ${isOn?'ni-badge-on':'ni-badge-off'}" id="ni-badge-${sIdx}">${isOn?'켜짐':'꺼짐'}</span>
                </div>
                <div class="ni-ctrl-right">
                    <div class="ni-loc-wrapper">
                        <button class="ni-loc-btn" id="ni-loc-btn-${sIdx}" data-idx="${sIdx}">
                            <div class="ni-loc-icon ${POSITION_ICON_CLASS[pos]}">${POSITION_ICONS[pos]}</div>
                            <span class="ni-loc-text">${POSITION_LABELS[pos]}</span>
                            <span class="ni-loc-chevron">⌄</span>
                        </button>
                        <div class="ni-loc-dropdown" id="ni-loc-dd-${sIdx}" style="display:none;">${locOpts}</div>
                    </div>
                    <button class="ni-tog${isOn?' ni-tog-on':''}" id="ni-tog-${sIdx}" data-idx="${sIdx}"></button>
                </div>
            </div>
            <textarea class="ni-page-ta" id="ni-ta-${sIdx}" data-idx="${sIdx}" placeholder="내용을 입력하세요...">${escapeHtml(sec.content||'')}</textarea>
            <div class="ni-page-footer">
                <span class="ni-hint" id="ni-hint-${sIdx}">${getHintText(sec)}</span>
                <span class="ni-count" id="ni-count-${sIdx}">${(sec.content||'').length}자</span>
            </div>`;
        pages.appendChild(page);
    });
    bindPageEvents(sections);
}

function bindPageEvents(sections) {
    document.querySelectorAll('.ni-tog').forEach(btn => {
        btn.addEventListener('click', () => {
            const sIdx = parseInt(btn.dataset.idx);
            const sec = sections[sIdx];
            if (!sec) return;
            sec.enabled = !sec.enabled;
            btn.classList.toggle('ni-tog-on', sec.enabled);
            const badge = document.getElementById(`ni-badge-${sIdx}`);
            if (badge) { badge.className=`ni-badge ${sec.enabled?'ni-badge-on':'ni-badge-off'}`; badge.textContent=sec.enabled?'켜짐':'꺼짐'; }
            const hint = document.getElementById(`ni-hint-${sIdx}`);
            if (hint) hint.textContent = getHintText(sec);
            const tabs = document.querySelectorAll('.ni-sec-tab');
            if (tabs[sIdx]) tabs[sIdx].classList.toggle('injecting', sec.enabled);
            applyInjection(); saveData();
        });
    });
    document.querySelectorAll('.ni-page-ta').forEach(ta => {
        ta.addEventListener('input', () => {
            const sIdx = parseInt(ta.dataset.idx);
            if (sections[sIdx]) sections[sIdx].content = ta.value;
            const c = document.getElementById(`ni-count-${sIdx}`);
            if (c) c.textContent = ta.value.length + '자';
            applyInjection(); saveData();
        });
    });
    document.querySelectorAll('.ni-loc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const sIdx = btn.dataset.idx;
            document.querySelectorAll('.ni-loc-dropdown').forEach(d => { if (d.id!==`ni-loc-dd-${sIdx}`) d.style.display='none'; });
            const dd = document.getElementById(`ni-loc-dd-${sIdx}`);
            if (dd) dd.style.display = dd.style.display==='none' ? 'block' : 'none';
        });
    });
    document.querySelectorAll('.ni-loc-opt').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const sIdx = parseInt(opt.dataset.idx);
            const pos = opt.dataset.pos;
            const sec = sections[sIdx];
            if (!sec) return;
            sec.position = pos;
            const btn = document.getElementById(`ni-loc-btn-${sIdx}`);
            if (btn) {
                btn.querySelector('.ni-loc-icon').className=`ni-loc-icon ${POSITION_ICON_CLASS[pos]}`;
                btn.querySelector('.ni-loc-icon').innerHTML=POSITION_ICONS[pos];
                btn.querySelector('.ni-loc-text').textContent=POSITION_LABELS[pos];
            }
            const dd = document.getElementById(`ni-loc-dd-${sIdx}`);
            dd?.querySelectorAll('.ni-loc-opt').forEach(o => {
                o.classList.toggle('ni-loc-opt-selected', o.dataset.pos===pos);
                const ck=o.querySelector('.ni-loc-check');
                if (o.dataset.pos===pos && !ck) o.insertAdjacentHTML('beforeend','<span class="ni-loc-check">✓</span>');
                else if (o.dataset.pos!==pos && ck) ck.remove();
            });
            if (dd) dd.style.display='none';
            const hint=document.getElementById(`ni-hint-${sIdx}`);
            if (hint) hint.textContent=getHintText(sec);
            applyInjection(); saveData();
        });
    });
}

function selectHome() {
    currentView = 'home';
    renderSidebar();
    renderHome();
}

function selectAsk() {
    currentView = 'ask';
    renderSidebar();
    renderAsk();
}

function renderAsk() {
    const main = document.getElementById('ni-main');
    if (!main) return;
    main.innerHTML = `
        <div class="ni-main-head">
            <div class="ni-main-head-top"><span class="ni-main-title">Ask</span></div>
        </div>
        <div class="ni-ask-body">
            <div class="ni-ask-modes">
                <button class="ni-ask-mode active" data-mode="compress">노트 압축</button>
                <button class="ni-ask-mode" data-mode="section">섹션 생성</button>
                <button class="ni-ask-mode" data-mode="event">이벤트 생성</button>
                <button class="ni-ask-mode" data-mode="genre">장르 생성</button>
            </div>
            <div class="ni-ask-input-wrap">
                <div class="ni-ask-input-label" id="ni-ask-label">줄이고 싶은 노트를 붙여넣어요</div>
                <textarea class="ni-ask-ta" id="ni-ask-ta" placeholder="텍스트 입력..."></textarea>
            </div>
            <button class="ni-ask-run" id="ni-ask-run">실행</button>
            <div class="ni-ask-result-wrap" id="ni-ask-result-wrap" style="display:none;">
                <div class="ni-ask-result-head">
                    <span class="ni-ask-result-label">결과</span>
                    <button class="ni-ask-copy" id="ni-ask-copy">복사</button>
                </div>
                <div class="ni-ask-result" id="ni-ask-result"></div>
            </div>
        </div>`;

    let currentMode = 'compress';

    const modeLabels = {
        compress: '줄이고 싶은 노트를 붙여넣어요',
        section: '캐릭터 특징을 자유롭게 써줘요 (한/영 모두 가능)',
        event: '캐릭터나 현재 상황을 설명해줘요',
        genre: '채팅 분위기나 캐릭터를 설명해줘요'
    };

    const modePrompts = {
        compress: `Compress the input into the shortest possible English plain text. 1-2 sentences max per idea. Cut all filler and elaboration. No markdown, no bullets. Output only the compressed text.`,
        section: `Convert the input (Korean or English) into concise English plain text for a roleplay prompt section. Under 60 words. No markdown, no bullets, no headers. Short punchy lines. English only.`,
        event: `Convert the input into exactly 3 upcoming roleplay events in timeline format. Each line: "Time/context — what happens." One sentence max per event. No dramatic titles. Just time context and situation. English only.`,
        genre: `Generate a genre/style tag for roleplay based on the input. Format: 3-6 comma-separated English tags only. Example: "Dark romance, Slow burn, Enemies to lovers". Nothing else.`
    };

    main.querySelectorAll('.ni-ask-mode').forEach(btn => {
        btn.addEventListener('click', () => {
            main.querySelectorAll('.ni-ask-mode').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.mode;
            document.getElementById('ni-ask-label').textContent = modeLabels[currentMode];
            document.getElementById('ni-ask-result-wrap').style.display = 'none';
            document.getElementById('ni-ask-ta').value = '';
        });
    });

    document.getElementById('ni-ask-run').addEventListener('click', async () => {
        const input = document.getElementById('ni-ask-ta').value.trim();
        if (!input) return;
        const btn = document.getElementById('ni-ask-run');
        btn.textContent = '생성 중...';
        btn.disabled = true;
        try {
            const ctx = SillyTavern.getContext();
            const response = await ctx.generateQuietPrompt(
                `${modePrompts[currentMode]}\n\nUser input:\n${input}`,
                false, false
            );
            const resultWrap = document.getElementById('ni-ask-result-wrap');
            const resultEl = document.getElementById('ni-ask-result');
            resultEl.textContent = response?.trim() || '결과를 가져오지 못했어요.';
            resultWrap.style.display = 'flex';
        } catch(e) {
            document.getElementById('ni-ask-result-wrap').style.display = 'flex';
            document.getElementById('ni-ask-result').textContent = '오류: ' + e.message;
        } finally {
            btn.textContent = '실행';
            btn.disabled = false;
        }
    });

    document.getElementById('ni-ask-copy').addEventListener('click', async () => {
        const text = document.getElementById('ni-ask-result').textContent;
        const btn = document.getElementById('ni-ask-copy');
        let ok = false;
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                ok = true;
            } else {
                // HTTP/구형 환경용 fallback
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                ta.setSelectionRange(0, text.length);
                try { ok = document.execCommand('copy'); } catch(_) { ok = false; }
                document.body.removeChild(ta);
            }
        } catch(_) { ok = false; }
        btn.textContent = ok ? '복사됨' : '실패';
        setTimeout(() => { btn.textContent = '복사'; }, 1500);
    });
}

function renderHome() {
    const main = document.getElementById('ni-main');
    if (!main) return;
    const home = currentData.home || {};
    const banned = home.bannedWords || [];
    main.innerHTML = `
        <div class="ni-main-head">
            <div class="ni-main-head-top">
                <span class="ni-main-title">Home</span>
            </div>
        </div>
        <div class="ni-home-body">
            <div class="ni-home-accordion" id="ni-style-accordion">
                <div class="ni-home-acc-head" id="ni-style-acc-head">
                    <span class="ni-home-acc-title">Genre</span>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:10px;color:#bbb;">항상 주입</span>
                        <span class="ni-home-acc-arrow" id="ni-style-arrow">▾</span>
                    </div>
                </div>
                <div class="ni-home-acc-body" id="ni-style-body">
                    <textarea class="ni-home-ta" id="ni-style-ta" placeholder="장르, 문체, 분위기...">${escapeHtml(home.writingStyle||'')}</textarea>
                </div>
            </div>
            <div class="ni-home-section">
                <div class="ni-home-sec-head"><span class="ni-home-sec-title">Upcoming Events</span><span style="font-size:10px;color:#bbb;">항상 주입</span></div>
                <div class="ni-home-sec-body"><textarea class="ni-home-ta" id="ni-events-ta" placeholder="앞으로 일어날 이벤트...">${escapeHtml(home.upcomingEvents||'')}</textarea></div>
            </div>
            <div class="ni-home-section">
                <div class="ni-home-sec-head"><span class="ni-home-sec-title">No Repeat</span><span style="font-size:10px;color:#bbb;">항상 주입</span></div>
                <div class="ni-home-sec-body">
                    <div class="ni-tag-wrap" id="ni-tag-wrap">
                        ${banned.map((w,i)=>`<div class="ni-tag">${escapeHtml(w)}<span class="ni-tag-x" data-idx="${i}">✕</span></div>`).join('')}
                        <input class="ni-tag-input" id="ni-tag-input" placeholder="단어 입력 후 Enter..." />
                    </div>
                </div>
            </div>
            <div class="ni-home-divider"></div>
            <div class="ni-home-btns">
                <button class="ni-home-btn-on" id="ni-all-on">전체 켜기</button>
                <button class="ni-home-btn-off" id="ni-all-off">전체 끄기</button>
                <button class="ni-home-btn-reset" id="ni-reset">초기화</button>
            </div>
        </div>`;

    let accOpen = true;
    document.getElementById('ni-style-acc-head').addEventListener('click', () => {
        accOpen = !accOpen;
        document.getElementById('ni-style-body').style.display = accOpen ? 'block' : 'none';
        document.getElementById('ni-style-arrow').textContent = accOpen ? '▾' : '▸';
    });

    document.getElementById('ni-style-ta').addEventListener('input', function() {
        if (!currentData.home) currentData.home = {};
        currentData.home.writingStyle = this.value;
        saveData(); applyInjection();
    });

    document.getElementById('ni-events-ta').addEventListener('input', function() {
        if (!currentData.home) currentData.home = {};
        currentData.home.upcomingEvents = this.value;
        saveData(); applyInjection();
    });

    document.getElementById('ni-tag-input').addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ',') return;
        e.preventDefault();
        const val = this.value.trim().replace(/,$/, '');
        if (!val) return;
        if (!currentData.home) currentData.home = {};
        if (!currentData.home.bannedWords) currentData.home.bannedWords = [];
        currentData.home.bannedWords.push(val);
        this.value = '';
        saveData(); applyInjection(); renderHome();
    });

    document.querySelectorAll('.ni-tag-x').forEach(btn => {
        btn.addEventListener('click', () => {
            currentData.home.bannedWords.splice(parseInt(btn.dataset.idx), 1);
            saveData(); applyInjection(); renderHome();
        });
    });

    document.getElementById('ni-all-on').addEventListener('click', () => {
        currentData.groups?.forEach(g=>g.tabs?.forEach(t=>t.sections?.forEach(s=>{ s.enabled=true; })));
        currentData.ungrouped?.forEach(t=>t.sections?.forEach(s=>{ s.enabled=true; }));
        saveData(); applyInjection();
        if (currentView === 'tab') {
            const tab = currentGroupIdx === -1 ? currentData.ungrouped?.[currentTabIdx] : currentData.groups[currentGroupIdx]?.tabs[currentTabIdx];
            if (tab) { renderTabBar(tab.sections||[]); renderPages(tab.sections||[]); }
        }
    });

    document.getElementById('ni-all-off').addEventListener('click', () => {
        currentData.groups?.forEach(g=>g.tabs?.forEach(t=>t.sections?.forEach(s=>{ s.enabled=false; })));
        currentData.ungrouped?.forEach(t=>t.sections?.forEach(s=>{ s.enabled=false; }));
        saveData(); applyInjection();
        if (currentView === 'tab') {
            const tab = currentGroupIdx === -1 ? currentData.ungrouped?.[currentTabIdx] : currentData.groups[currentGroupIdx]?.tabs[currentTabIdx];
            if (tab) { renderTabBar(tab.sections||[]); renderPages(tab.sections||[]); }
        }
    });

    document.getElementById('ni-reset').addEventListener('click', () => {
        if (!confirm('모든 데이터를 초기화할까요?')) return;
        currentData = getDefaultData();
        saveData(); renderSidebar(); selectHome();
    });
}

function selectTab(gIdx, tIdx) {
    currentView = 'tab';
    currentGroupIdx=gIdx; currentTabIdx=tIdx; currentSectionIdx=0;
    renderSidebar();
    const tab = gIdx === -1 ? currentData.ungrouped?.[tIdx] : currentData.groups[gIdx]?.tabs[tIdx];
    if (!tab) return;
    const main = document.getElementById('ni-main');
    main.innerHTML = `
        <div class="ni-main-head">
            <div class="ni-main-head-top">
                <span class="ni-main-title" id="ni-main-title">${escapeHtml(tab.name)}</span>
                <button class="ni-add-sec-btn" id="ni-add-sec-btn">+ 섹션</button>
            </div>
            <div class="ni-sec-tabbar" id="ni-sec-tabbar"></div>
        </div>
        <div class="ni-pages" id="ni-pages"></div>`;
    $(document).off('click','#ni-add-sec-btn').on('click','#ni-add-sec-btn', openSecModal);
    renderTabBar(tab.sections||[]);
    renderPages(tab.sections||[]);
}

function selectSection(sIdx) {
    currentSectionIdx=sIdx;
    document.querySelectorAll('.ni-sec-tab').forEach((t,i)=>t.classList.toggle('active',i===sIdx));
    document.querySelectorAll('.ni-page').forEach((p,i)=>p.classList.toggle('ni-page-active',i===sIdx));
}

function applyInjection() {
    Object.entries(INJECT_POSITION).forEach(([pos,type])=>setExtensionPrompt(`${EXTENSION_NAME}_${pos}`,'',type,POSITION_DEPTH[pos]));
    const collected={};

    currentData.groups?.forEach(g=>g.tabs?.forEach(t=>t.sections?.forEach(sec=>{
        if (!sec.enabled||!sec.content?.trim()) return;
        const pos=sec.position||'authors_note';
        if (!collected[pos]) collected[pos]=[];
        collected[pos].push(`[${sec.name}]\n${sec.content.trim()}`);
    })));
    currentData.ungrouped?.forEach(t=>t.sections?.forEach(sec=>{
        if (!sec.enabled||!sec.content?.trim()) return;
        const pos=sec.position||'authors_note';
        if (!collected[pos]) collected[pos]=[];
        collected[pos].push(`[${sec.name}]\n${sec.content.trim()}`);
    }));

    const home = currentData.home||{};
    const homeParts = [];
    if (home.writingStyle?.trim()) homeParts.push(`WRITING GENRE AND STYLE (strictly follow):\n${home.writingStyle.trim()}`);
    if (home.upcomingEvents?.trim()) homeParts.push(`[Upcoming Events]\n${home.upcomingEvents.trim()}`);
    if (home.bannedWords?.length) homeParts.push(`[ABSOLUTE RESTRICTION] The following words are STRICTLY FORBIDDEN. You MUST NOT use them under any circumstances, in any language, in any form (including synonyms, abbreviations, or paraphrases): ${home.bannedWords.join(', ')}. Violation of this rule is not acceptable.`);

    setExtensionPrompt(`${EXTENSION_NAME}_genre`, homeParts.join('\n\n'), extension_prompt_types.BEFORE_PROMPT, 0);

    Object.entries(collected).forEach(([pos,texts])=>setExtensionPrompt(`${EXTENSION_NAME}_${pos}`,texts.join('\n\n'),INJECT_POSITION[pos],POSITION_DEPTH[pos]));
    updateActiveCount();
}

function updateActiveCount() {
    let total=0;
    currentData.groups?.forEach(g=>g.tabs?.forEach(t=>t.sections?.forEach(s=>{if(s.enabled&&s.content?.trim())total++;})));
    const badge=document.getElementById('ni-active-count');
    if (!badge) return;
    badge.style.display=total>0?'inline-flex':'none';
    badge.textContent=total;
}

// ===== 패널 열기/닫기 — display+클래스 병행 제어 =====
function openPanel() {
    const p = document.getElementById('ni-panel');
    if (!p) return;
    p.style.display = ''; // 인라인 스타일 제거 → CSS .ni-open { display:flex } 적용
    p.classList.remove('ni-collapsed');
    p.classList.add('ni-open');
    panelOpen = true;
    panelCollapsed = false;
    const h = document.getElementById('ni-handle');
    if (h) h.classList.remove('ni-handle-visible');
    if (extensionSettings[EXTENSION_NAME]) {
        extensionSettings[EXTENSION_NAME].__panelOpen = true;
        saveSettingsDebounced();
    }
}

function closePanel() {
    const p = document.getElementById('ni-panel');
    if (!p) return;
    p.style.display = ''; // 인라인 스타일 제거 → CSS 기본값 display:none 적용
    p.classList.remove('ni-open');
    p.classList.remove('ni-collapsed');
    panelOpen = false;
    panelCollapsed = false;
    const h = document.getElementById('ni-handle');
    if (h) h.classList.remove('ni-handle-visible');
    if (extensionSettings[EXTENSION_NAME]) {
        extensionSettings[EXTENSION_NAME].__panelOpen = false;
        saveSettingsDebounced();
    }
}

function toggleCollapse() {
    if (isMobile()) { panelOpen ? closePanel() : openPanel(); return; }
    const p = document.getElementById('ni-panel');
    const h = document.getElementById('ni-handle');
    if (!p) return;
    panelCollapsed = !panelCollapsed;
    p.style.display = 'flex';
    p.classList.toggle('ni-collapsed', panelCollapsed);
    p.classList.toggle('ni-open', !panelCollapsed);
    if (h) h.classList.toggle('ni-handle-visible', panelCollapsed);
    if (!panelCollapsed) panelOpen = true;
}

function initHandleDrag() {
    if (isMobile()) return;
    const h = document.getElementById('ni-handle');
    if (!h) return;
    let dragging = false, startY = 0, startTop = 0;
    h.addEventListener('mousedown', e => {
        dragging = true;
        startY = e.clientY;
        startTop = parseInt(h.style.top) || window.innerHeight / 2;
        h.style.transform = 'none';
        h.style.top = startTop + 'px';
        e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        let newTop = startTop + (e.clientY - startY);
        newTop = Math.max(40, Math.min(window.innerHeight - 80, newTop));
        h.style.top = newTop + 'px';
    });
    document.addEventListener('mouseup', e => {
        if (!dragging) return;
        dragging = false;
        const moved = Math.abs(e.clientY - startY) > 5;
        if (!moved) toggleCollapse();
    });
}

// 모바일: 모달을 body로 '텔레포트'시켜 패널의 transform 영향권에서 빼냄
// (조상에 transform이 있으면 자손의 position:fixed가 뷰포트 기준이 되지 못함)
function _mobilePortal(modalId, on) {
    if (!isMobile()) return;
    const m = document.getElementById(modalId);
    if (!m) return;
    if (on) {
        if (m.parentElement !== document.body) {
            m.dataset.originalParent = '1';
            // 원래 부모 보관용 주석 노드로 자리 표시
            const placeholder = document.createComment('ni-modal-placeholder-' + modalId);
            m.parentElement.insertBefore(placeholder, m);
            m._niPlaceholder = placeholder;
            document.body.appendChild(m);
        }
        // body로 옮겨진 뒤에는 $(document) 위임이 안 먹을 수 있으므로 직접 바인딩 (1회만)
        if (!m._niBound) {
            m._niBound = true;
            m.addEventListener('click', (e) => {
                const t = e.target.closest('button, [id]');
                if (!t) return;
                // 오버레이 자체 클릭 = 바깥 클릭
                if (e.target === m) {
                    if (modalId === 'ni-tab-modal') closeTabModal();
                    else if (modalId === 'ni-sec-modal') closeSecModal();
                    return;
                }
                const id = t.id;
                if (id === 'ni-tab-modal-close' || id === 'ni-tab-modal-cancel') { closeTabModal(); }
                else if (id === 'ni-tab-modal-add') { addTab(); }
                else if (id === 'ni-sec-modal-close' || id === 'ni-sec-modal-cancel') { closeSecModal(); }
                else if (id === 'ni-sec-modal-add') { addSection(); }
                else if (id === 'ni-new-group-row') {
                    document.getElementById('ni-new-group-row').style.display='none';
                    document.getElementById('ni-new-group-input-row').style.display='flex';
                }
                else if (id === 'ni-new-group-confirm') {
                    const val = document.getElementById('ni-new-group-input').value.trim();
                    if (!val) return;
                    modalNewGroupName = val; modalSelectedGroup = null;
                    document.getElementById('ni-new-group-input-row').style.display='none';
                    document.getElementById('ni-new-group-row').style.display='flex';
                    renderGroupOpts();
                }
            });
        }
    } else {
        if (m._niPlaceholder && m._niPlaceholder.parentElement) {
            m._niPlaceholder.parentElement.insertBefore(m, m._niPlaceholder);
            m._niPlaceholder.remove();
            m._niPlaceholder = null;
        }
    }
}

function openTabModal() {
    modalSelectedGroup=null; modalNewGroupName=null;
    document.getElementById('ni-tab-name-input').value='';
    document.getElementById('ni-new-group-input').value='';
    document.getElementById('ni-new-group-input-row').style.display='none';
    document.getElementById('ni-new-group-row').style.display='flex';
    renderGroupOpts();
    _mobilePortal('ni-tab-modal', true);
    document.getElementById('ni-tab-modal').style.display='flex';
}
function closeTabModal() {
    document.getElementById('ni-tab-modal').style.display='none';
    _mobilePortal('ni-tab-modal', false);
}

function renderGroupOpts() {
    const c=document.getElementById('ni-group-opts'); if(!c) return;
    c.innerHTML='';
    currentData.groups.forEach((g,i)=>{
        const opt=document.createElement('div');
        opt.className=`ni-group-opt${modalSelectedGroup===i?' selected':''}`;
        opt.innerHTML=`<div class="ni-group-dot"></div><span class="ni-group-opt-name">${escapeHtml(g.name)}</span><span class="ni-group-ct">${g.tabs.length}개</span>`;
        opt.addEventListener('click',()=>{ modalSelectedGroup=i; modalNewGroupName=null; renderGroupOpts(); });
        c.appendChild(opt);
    });
}

function addTab() {
    const name=document.getElementById('ni-tab-name-input').value.trim();
    if (!name) return;
    const newTab={name,sections:[]};
    let gIdx, tIdx;
    if (modalNewGroupName) {
        currentData.groups.push({name:modalNewGroupName,tabs:[newTab]});
        gIdx=currentData.groups.length-1; tIdx=0;
    } else {
        gIdx=modalSelectedGroup!==null?modalSelectedGroup:(currentData.groups.length?0:-1);
        if (gIdx<0) { currentData.groups.push({name:'기본',tabs:[newTab]}); gIdx=0; tIdx=0; }
        else { currentData.groups[gIdx].tabs.push(newTab); tIdx=currentData.groups[gIdx].tabs.length-1; }
    }
    saveData(); renderSidebar(); closeTabModal(); selectTab(gIdx,tIdx);
}

function openSecModal() {
    document.getElementById('ni-sec-name-input').value='';
    _mobilePortal('ni-sec-modal', true);
    document.getElementById('ni-sec-modal').style.display='flex';
}
function closeSecModal() {
    document.getElementById('ni-sec-modal').style.display='none';
    _mobilePortal('ni-sec-modal', false);
}

function addSection() {
    const name=document.getElementById('ni-sec-name-input').value.trim();
    if (!name) return;
    const tab=getCurrentTab(); if(!tab) return;
    if (!tab.sections) tab.sections=[];
    tab.sections.push({name,content:'',enabled:false,position:'authors_note'});
    const newIdx=tab.sections.length-1;
    saveData(); renderTabBar(tab.sections); renderPages(tab.sections); selectSection(newIdx); closeSecModal();
}

function onChatChanged() {
    const newChar=getCurrentCharacter();
    if (newChar===currentChar) return;
    currentChar=newChar; currentData=loadData(currentChar);
    if (!currentData.ungrouped) currentData.ungrouped = [];
    currentGroupIdx=0; currentTabIdx=0; currentSectionIdx=0;
    selectHome();
    applyInjection();
}

function injectMenuEntry() {
    if ($('#ni-menu-entry').length) return;
    const entry = $(`
        <div id="ni-menu-entry" class="list-group-item" title="Note Injector" style="cursor:pointer; display:flex; align-items:center; gap:8px;">
            <span style="font-size:16px;">📝</span>
            <span>Note Injector</span>
        </div>
    `);
    entry.on('click', (e) => {
        // 매직완드 드롭다운 닫기 (SillyTavern의 #extensionsMenu)
        try { $('#extensionsMenu').fadeOut(150); } catch(_) {}
        panelOpen ? closePanel() : openPanel();
    });
    $('#extensionsMenu').append(entry);
}

async function init() {
    const settingsHtml = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'settings');
    $('#extensions_settings2').append(settingsHtml);
    $('body').append(buildPanelHTML());
    const _p = document.getElementById('ni-panel');
    if (_p) {
        _p.style.display = ''; // 인라인 스타일 없애서 CSS display:none 기본값 적용
        _p.classList.remove('ni-open');
        _p.classList.remove('ni-collapsed');
    }

    if (!extensionSettings[EXTENSION_NAME]) extensionSettings[EXTENSION_NAME]={};
    currentChar=getCurrentCharacter();
    currentData=loadData(currentChar);
    if (!currentData.ungrouped) currentData.ungrouped = [];

    selectHome();
    initHandleDrag();
    initDragDrop();

    // 피치 위스퍼처럼 jQuery로 직접 바인딩
    $('#ni-close-btn').on('click', closePanel);
    $('#ni-open-btn').on('click', () => { panelOpen ? closePanel() : openPanel(); });
    $(document).on('click','#ni-collapse-btn', toggleCollapse);
    $(document).on('click','#ni-add-tab-btn', openTabModal);
    $(document).on('click','#ni-tab-modal-close, #ni-tab-modal-cancel', closeTabModal);
    $(document).on('click','#ni-tab-modal-add', addTab);
    $(document).on('click','#ni-new-group-row', () => {
        document.getElementById('ni-new-group-row').style.display='none';
        document.getElementById('ni-new-group-input-row').style.display='flex';
    });
    $(document).on('click','#ni-new-group-confirm', () => {
        const val=document.getElementById('ni-new-group-input').value.trim(); if(!val) return;
        modalNewGroupName=val; modalSelectedGroup=null;
        document.getElementById('ni-new-group-input-row').style.display='none';
        document.getElementById('ni-new-group-row').style.display='flex';
        renderGroupOpts();
    });
    $(document).on('click','#ni-sec-modal-close, #ni-sec-modal-cancel', closeSecModal);
    $(document).on('click','#ni-sec-modal-add', addSection);
    $(document).on('click','#ni-tab-modal', (e) => { if(e.target.id==='ni-tab-modal') closeTabModal(); });
    $(document).on('click','#ni-sec-modal', (e) => { if(e.target.id==='ni-sec-modal') closeSecModal(); });
    $(document).on('click', (e) => {
        if (!$(e.target).closest('.ni-loc-wrapper').length)
            document.querySelectorAll('.ni-loc-dropdown').forEach(d=>d.style.display='none');
    });

    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    applyInjection();
    injectMenuEntry();

    // 피치 위스퍼처럼 저장된 열림 상태 복원 — 저장된 게 없으면 닫힌 채로 시작
    if (extensionSettings[EXTENSION_NAME]?.__panelOpen === true) {
        openPanel();
    }
}

jQuery(async () => {
    const context = SillyTavern.getContext();
    context.eventSource.on(event_types.APP_READY, async () => { await init(); });
});
