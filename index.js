import { globalContext, extensionSettings, saveSettingsDebounced, renderExtensionTemplateAsync } from '../../../../script.js';
import { eventSource, event_types } from '../../../../script.js';
import { setExtensionPrompt, extension_prompt_types } from '../../../extensions.js';
import { getCharacterName } from '../../../../script.js';

const EXTENSION_NAME = 'note-injector';
const PANEL_ID = 'note-injector-panel';

// 주입 위치 매핑
const INJECT_POSITION = {
    'before_system': extension_prompt_types.BEFORE_PROMPT,
    'after_system': extension_prompt_types.IN_PROMPT,
    'authors_note': extension_prompt_types.AFTER_PROMPT,
    'chat_start': extension_prompt_types.AFTER_PROMPT,
};

const POSITION_DEPTH = {
    'before_system': 0,
    'after_system': 0,
    'authors_note': 2,
    'chat_start': 100,
};

const POSITION_LABELS = {
    'authors_note': "Author's Note — 권장",
    'before_system': 'System 앞 — 강력',
    'after_system': 'System 뒤',
    'chat_start': '채팅 맨 앞',
};

const POSITION_ICONS = {
    'authors_note': `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    'before_system': `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    'after_system': `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    'chat_start': `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
};

const POSITION_ICON_CLASS = {
    'authors_note': 'ni-icon-an',
    'before_system': 'ni-icon-sp',
    'after_system': 'ni-icon-sa',
    'chat_start': 'ni-icon-cf',
};

// 기본 데이터 구조
function getDefaultData() {
    return { groups: [] };
}

// 현재 캐릭터 이름 가져오기
function getCurrentCharacter() {
    try {
        return getCharacterName() || '__global__';
    } catch {
        return '__global__';
    }
}

// 저장/로드
function saveData(charName, data) {
    if (!extensionSettings[EXTENSION_NAME]) extensionSettings[EXTENSION_NAME] = {};
    extensionSettings[EXTENSION_NAME][charName] = data;
    saveSettingsDebounced();
}

function loadData(charName) {
    if (!extensionSettings[EXTENSION_NAME]) return getDefaultData();
    return extensionSettings[EXTENSION_NAME][charName] || getDefaultData();
}

// 현재 데이터
let currentChar = '__global__';
let currentData = getDefaultData();
let currentGroupIdx = 0;
let currentSectionIdx = 0;
let panelOpen = false;
let panelCollapsed = false;

// 패널 HTML 생성
function buildPanelHTML() {
    return `
<div id="${PANEL_ID}" class="ni-panel ni-hidden">
    <div class="ni-panel-inner">
        <div class="ni-sidebar">
            <div class="ni-sb-head">
                <span class="ni-sb-title">Note Injector</span>
                <div class="ni-sb-actions">
                    <button class="ni-icon-btn" id="ni-collapse-btn" title="접기">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
                    </button>
                </div>
            </div>
            <div class="ni-sb-list" id="ni-sb-list"></div>
            <button class="ni-sb-add-btn" id="ni-add-tab-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                탭 추가
            </button>
        </div>
        <div class="ni-main">
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
</div>

<!-- 탭 추가 모달 -->
<div class="ni-modal-overlay ni-hidden" id="ni-modal-overlay">
    <div class="ni-modal">
        <div class="ni-modal-head">
            <span class="ni-modal-title">탭 추가</span>
            <button class="ni-modal-x" id="ni-modal-close">✕</button>
        </div>
        <div class="ni-modal-body">
            <div class="ni-field">
                <label class="ni-field-label">탭 이름</label>
                <input class="ni-field-input" id="ni-tab-name-input" placeholder="예: Ghost, 내 페르소나..." />
            </div>
            <div class="ni-field">
                <label class="ni-field-label">그룹</label>
                <div class="ni-group-options" id="ni-group-options"></div>
                <div class="ni-new-group-row" id="ni-new-group-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M12 5v14M5 12h14"/></svg>
                    <span>새 그룹 만들기</span>
                </div>
                <div class="ni-new-group-input-row ni-hidden" id="ni-new-group-input-row">
                    <input class="ni-new-group-input" id="ni-new-group-input" placeholder="그룹 이름..." />
                    <button class="ni-new-group-confirm" id="ni-new-group-confirm">확인</button>
                </div>
            </div>
        </div>
        <div class="ni-modal-footer">
            <button class="ni-btn-cancel" id="ni-modal-cancel">취소</button>
            <button class="ni-btn-confirm" id="ni-modal-add">추가</button>
        </div>
    </div>
</div>

<!-- 섹션 추가 모달 -->
<div class="ni-modal-overlay ni-hidden" id="ni-sec-modal-overlay">
    <div class="ni-modal">
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
`;
}

// 위치 선택 드롭다운 HTML
function buildLocSelector(sectionId, currentPos) {
    const options = Object.entries(POSITION_LABELS).map(([key, label]) => {
        const selected = key === currentPos ? 'selected' : '';
        return `<option value="${key}" ${selected}>${label}</option>`;
    }).join('');
    return `
    <div class="ni-loc-wrapper">
        <div class="ni-loc-btn" data-secid="${sectionId}">
            <div class="ni-loc-icon ${POSITION_ICON_CLASS[currentPos]}">${POSITION_ICONS[currentPos]}</div>
            <span class="ni-loc-text">${POSITION_LABELS[currentPos]}</span>
            <span class="ni-loc-chevron">⌄</span>
        </div>
        <div class="ni-loc-dropdown ni-hidden" data-secid="${sectionId}">
            ${Object.entries(POSITION_LABELS).map(([key, label]) => `
            <div class="ni-loc-opt ${key === currentPos ? 'ni-loc-opt-selected' : ''}" data-pos="${key}" data-secid="${sectionId}">
                <div class="ni-loc-icon ${POSITION_ICON_CLASS[key]}">${POSITION_ICONS[key]}</div>
                <div class="ni-loc-opt-text">
                    <span class="ni-loc-opt-name">${label.split('—')[0].trim()}</span>
                    <span class="ni-loc-opt-sub">${label.includes('—') ? label.split('—')[1].trim() : ''}</span>
                </div>
                ${key === currentPos ? '<span class="ni-loc-check">✓</span>' : ''}
            </div>`).join('')}
        </div>
    </div>`;
}

// 페이지 HTML 생성
function buildPageHTML(section, groupIdx, secIdx) {
    const secId = `${groupIdx}-${secIdx}`;
    const isOn = section.enabled;
    return `
<div class="ni-page ${isOn ? 'ni-page-active' : ''}" id="ni-page-${secId}" data-gidx="${groupIdx}" data-sidx="${secIdx}">
    <div class="ni-page-controls">
        <div class="ni-ctrl-left">
            <span class="ni-ctrl-lbl">주입</span>
            <span class="ni-badge ${isOn ? 'ni-badge-on' : 'ni-badge-off'}" id="ni-badge-${secId}">${isOn ? '켜짐' : '꺼짐'}</span>
        </div>
        <div class="ni-ctrl-right">
            ${buildLocSelector(secId, section.position || 'authors_note')}
            <button class="ni-tog ${isOn ? 'ni-tog-on' : ''}" id="ni-tog-${secId}" data-secid="${secId}"></button>
        </div>
    </div>
    <textarea class="ni-page-ta" id="ni-ta-${secId}" data-secid="${secId}" placeholder="내용을 입력하세요...">${section.content || ''}</textarea>
    <div class="ni-page-footer">
        <span class="ni-hint" id="ni-hint-${secId}">${getHintText(section)}</span>
        <span class="ni-count" id="ni-count-${secId}">${(section.content || '').length}자</span>
    </div>
</div>`;
}

function getHintText(section) {
    if (!section.enabled) return '주입 꺼짐';
    const pos = section.position || 'authors_note';
    return `${POSITION_LABELS[pos].split('—')[0].trim()} 위치로 주입 중`;
}

// 사이드바 렌더링
function renderSidebar() {
    const list = document.getElementById('ni-sb-list');
    if (!list) return;
    list.innerHTML = '';

    if (!currentData.groups || currentData.groups.length === 0) {
        list.innerHTML = '<div class="ni-sb-empty">탭을 추가해보세요</div>';
        return;
    }

    currentData.groups.forEach((group, gIdx) => {
        const label = document.createElement('div');
        label.className = 'ni-sb-sec-lbl';
        label.textContent = group.name;
        list.appendChild(label);

        group.tabs.forEach((tab, tIdx) => {
            const row = document.createElement('div');
            row.className = `ni-sb-row ${gIdx === currentGroupIdx && tIdx === 0 ? 'active' : ''}`;
            const enabledCount = (tab.sections || []).filter(s => s.enabled).length;
            row.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="15" height="15"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                <span class="ni-sb-row-name">${tab.name}</span>
                <span class="ni-sb-row-ct">${(tab.sections || []).length}</span>
            `;
            row.addEventListener('click', () => selectTab(gIdx, tIdx));
            list.appendChild(row);
        });

        const div = document.createElement('div');
        div.className = 'ni-sb-div';
        list.appendChild(div);
    });
}

// 탭 선택
function selectTab(gIdx, tIdx) {
    currentGroupIdx = gIdx;
    document.querySelectorAll('.ni-sb-row').forEach(r => r.classList.remove('active'));

    const rows = document.querySelectorAll('.ni-sb-row');
    let count = 0;
    currentData.groups.forEach((g, gi) => {
        g.tabs.forEach((t, ti) => {
            if (gi === gIdx && ti === tIdx) {
                rows[count]?.classList.add('active');
            }
            count++;
        });
    });

    const tab = currentData.groups[gIdx]?.tabs[tIdx];
    if (!tab) return;

    document.getElementById('ni-main-title').textContent = tab.name;
    renderTabBar(tab, gIdx);
    renderPages(tab, gIdx);
    selectSection(0);
}

// 탭바 렌더링
function renderTabBar(tab, gIdx) {
    const bar = document.getElementById('ni-sec-tabbar');
    if (!bar) return;
    bar.innerHTML = '';

    (tab.sections || []).forEach((sec, sIdx) => {
        const t = document.createElement('div');
        t.className = `ni-sec-tab ${sIdx === currentSectionIdx ? 'active' : ''} ${sec.enabled ? 'injecting' : ''}`;
        t.innerHTML = `<span class="ni-tab-dot"></span>${sec.name}`;
        t.addEventListener('click', () => selectSection(sIdx));
        bar.appendChild(t);
    });

    const add = document.createElement('div');
    add.className = 'ni-sec-tab-add';
    add.textContent = '+';
    add.addEventListener('click', () => openSecModal());
    bar.appendChild(add);
}

// 페이지 렌더링
function renderPages(tab, gIdx) {
    const pages = document.getElementById('ni-pages');
    if (!pages) return;
    pages.innerHTML = '';
    (tab.sections || []).forEach((sec, sIdx) => {
        pages.innerHTML += buildPageHTML(sec, gIdx, sIdx);
    });
    bindPageEvents(tab, gIdx);
}

// 섹션 선택
function selectSection(sIdx) {
    currentSectionIdx = sIdx;
    document.querySelectorAll('.ni-sec-tab').forEach((t, i) => {
        t.classList.toggle('active', i === sIdx);
    });
    document.querySelectorAll('.ni-page').forEach((p, i) => {
        p.classList.toggle('ni-page-active', i === sIdx);
    });
}

// 페이지 이벤트 바인딩
function bindPageEvents(tab, gIdx) {
    // 토글
    document.querySelectorAll('.ni-tog').forEach(btn => {
        btn.addEventListener('click', () => {
            const secId = btn.dataset.secid;
            const [gi, si] = secId.split('-').map(Number);
            const sec = currentData.groups[gi]?.tabs.find((_, ti) => ti === 0)?.sections?.[si]
                || getSection(gi, si);
            if (!sec) return;
            sec.enabled = !sec.enabled;
            btn.classList.toggle('ni-tog-on', sec.enabled);
            const badge = document.getElementById(`ni-badge-${secId}`);
            if (badge) {
                badge.className = `ni-badge ${sec.enabled ? 'ni-badge-on' : 'ni-badge-off'}`;
                badge.textContent = sec.enabled ? '켜짐' : '꺼짐';
            }
            updateHint(secId, sec);
            updateTabDot(si, sec.enabled);
            applyInjection();
            saveCurrentData();
        });
    });

    // 텍스트에어리어
    document.querySelectorAll('.ni-page-ta').forEach(ta => {
        ta.addEventListener('input', () => {
            const secId = ta.dataset.secid;
            const [gi, si] = secId.split('-').map(Number);
            const sec = getSection(gi, si);
            if (!sec) return;
            sec.content = ta.value;
            const count = document.getElementById(`ni-count-${secId}`);
            if (count) count.textContent = ta.value.length + '자';
            applyInjection();
            saveCurrentData();
        });
    });

    // 위치 드롭다운
    document.querySelectorAll('.ni-loc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const secId = btn.dataset.secid;
            const dd = document.querySelector(`.ni-loc-dropdown[data-secid="${secId}"]`);
            document.querySelectorAll('.ni-loc-dropdown').forEach(d => {
                if (d !== dd) d.classList.add('ni-hidden');
            });
            dd?.classList.toggle('ni-hidden');
        });
    });

    document.querySelectorAll('.ni-loc-opt').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const secId = opt.dataset.secid;
            const pos = opt.dataset.pos;
            const [gi, si] = secId.split('-').map(Number);
            const sec = getSection(gi, si);
            if (!sec) return;
            sec.position = pos;

            // 버튼 업데이트
            const btn = document.querySelector(`.ni-loc-btn[data-secid="${secId}"]`);
            if (btn) {
                btn.querySelector('.ni-loc-icon').className = `ni-loc-icon ${POSITION_ICON_CLASS[pos]}`;
                btn.querySelector('.ni-loc-icon').innerHTML = POSITION_ICONS[pos];
                btn.querySelector('.ni-loc-text').textContent = POSITION_LABELS[pos];
            }

            // 드롭다운 체크마크 업데이트
            const dd = document.querySelector(`.ni-loc-dropdown[data-secid="${secId}"]`);
            dd?.querySelectorAll('.ni-loc-opt').forEach(o => {
                o.classList.toggle('ni-loc-opt-selected', o.dataset.pos === pos);
                const check = o.querySelector('.ni-loc-check');
                if (o.dataset.pos === pos && !check) {
                    o.innerHTML += '<span class="ni-loc-check">✓</span>';
                } else if (o.dataset.pos !== pos && check) {
                    check.remove();
                }
            });
            dd?.classList.add('ni-hidden');

            updateHint(secId, sec);
            applyInjection();
            saveCurrentData();
        });
    });
}

function getSection(gi, si) {
    const group = currentData.groups[gi];
    if (!group) return null;
    // 현재 선택된 탭 찾기
    let tabIdx = 0;
    // 간단하게 첫 번째 탭 기준으로 (추후 currentTabIdx 관리 가능)
    return group.tabs[tabIdx]?.sections?.[si] || null;
}

function updateHint(secId, sec) {
    const hint = document.getElementById(`ni-hint-${secId}`);
    if (hint) hint.textContent = getHintText(sec);
}

function updateTabDot(sIdx, enabled) {
    const tabs = document.querySelectorAll('.ni-sec-tab');
    tabs[sIdx]?.classList.toggle('injecting', enabled);
}

// 주입 실행
function applyInjection() {
    // 이전 주입 초기화
    Object.keys(INJECT_POSITION).forEach(pos => {
        setExtensionPrompt(`${EXTENSION_NAME}_${pos}`, '', INJECT_POSITION[pos], POSITION_DEPTH[pos]);
    });

    const collected = {};
    currentData.groups.forEach(group => {
        group.tabs.forEach(tab => {
            (tab.sections || []).forEach(sec => {
                if (!sec.enabled || !sec.content?.trim()) return;
                const pos = sec.position || 'authors_note';
                if (!collected[pos]) collected[pos] = [];
                collected[pos].push(`[${sec.name}]\n${sec.content.trim()}`);
            });
        });
    });

    Object.entries(collected).forEach(([pos, texts]) => {
        setExtensionPrompt(
            `${EXTENSION_NAME}_${pos}`,
            texts.join('\n\n'),
            INJECT_POSITION[pos],
            POSITION_DEPTH[pos]
        );
    });

    updateActiveCount();
}

function updateActiveCount() {
    let total = 0;
    currentData.groups.forEach(g => g.tabs.forEach(t => {
        total += (t.sections || []).filter(s => s.enabled && s.content?.trim()).length;
    }));
    const badge = document.getElementById('noteInjectorActiveCount');
    if (!badge) return;
    if (total > 0) {
        badge.style.display = 'inline-flex';
        badge.textContent = total;
    } else {
        badge.style.display = 'none';
    }
}

function saveCurrentData() {
    saveData(currentChar, currentData);
}

// 탭 추가 모달
let selectedGroupForModal = null;
let newGroupNameForModal = null;

function openTabModal() {
    selectedGroupForModal = null;
    newGroupNameForModal = null;
    document.getElementById('ni-tab-name-input').value = '';
    document.getElementById('ni-new-group-input').value = '';
    document.getElementById('ni-new-group-input-row').classList.add('ni-hidden');
    document.getElementById('ni-new-group-row').classList.remove('ni-hidden');
    renderGroupOptions();
    document.getElementById('ni-modal-overlay').classList.remove('ni-hidden');
}

function renderGroupOptions() {
    const container = document.getElementById('ni-group-options');
    container.innerHTML = '';
    currentData.groups.forEach((g, i) => {
        const opt = document.createElement('div');
        opt.className = `ni-group-opt ${selectedGroupForModal === i ? 'selected' : ''}`;
        opt.innerHTML = `
            <div class="ni-group-dot"></div>
            <span class="ni-group-opt-name">${g.name}</span>
            <span class="ni-group-ct">${g.tabs.length}개</span>
        `;
        opt.addEventListener('click', () => {
            selectedGroupForModal = i;
            newGroupNameForModal = null;
            renderGroupOptions();
        });
        container.appendChild(opt);
    });
}

function closeTabModal() {
    document.getElementById('ni-modal-overlay').classList.add('ni-hidden');
}

function addTab() {
    const name = document.getElementById('ni-tab-name-input').value.trim();
    if (!name) return;

    const newTab = { name, sections: [] };

    if (newGroupNameForModal) {
        currentData.groups.push({ name: newGroupNameForModal, tabs: [newTab] });
    } else if (selectedGroupForModal !== null) {
        currentData.groups[selectedGroupForModal].tabs.push(newTab);
    } else if (currentData.groups.length === 0) {
        currentData.groups.push({ name: '기본', tabs: [newTab] });
    } else {
        currentData.groups[0].tabs.push(newTab);
    }

    saveCurrentData();
    renderSidebar();
    closeTabModal();
    selectTab(
        newGroupNameForModal ? currentData.groups.length - 1 : (selectedGroupForModal ?? 0),
        newGroupNameForModal ? 0 : currentData.groups[selectedGroupForModal ?? 0].tabs.length - 1
    );
}

// 섹션 추가 모달
function openSecModal() {
    document.getElementById('ni-sec-name-input').value = '';
    document.getElementById('ni-sec-modal-overlay').classList.remove('ni-hidden');
}

function closeSecModal() {
    document.getElementById('ni-sec-modal-overlay').classList.add('ni-hidden');
}

function addSection() {
    const name = document.getElementById('ni-sec-name-input').value.trim();
    if (!name) return;

    const group = currentData.groups[currentGroupIdx];
    if (!group) return;
    const tab = group.tabs[0];
    if (!tab) return;

    if (!tab.sections) tab.sections = [];
    tab.sections.push({ name, content: '', enabled: false, position: 'authors_note' });

    saveCurrentData();
    renderTabBar(tab, currentGroupIdx);
    renderPages(tab, currentGroupIdx);
    selectSection(tab.sections.length - 1);
    closeSecModal();
}

// 패널 열기/닫기
function openPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.remove('ni-hidden');
    panel.classList.remove('ni-collapsed');
    setTimeout(() => panel.classList.add('ni-open'), 10);
    panelOpen = true;
    panelCollapsed = false;
}

function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.remove('ni-open');
    setTimeout(() => panel.classList.add('ni-hidden'), 360);
    panelOpen = false;
}

function collapsePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    if (panelCollapsed) {
        panel.classList.remove('ni-collapsed');
        panelCollapsed = false;
    } else {
        panel.classList.add('ni-collapsed');
        panelCollapsed = true;
    }
}

// 캐릭터 전환
function onCharacterChanged() {
    const newChar = getCurrentCharacter();
    if (newChar === currentChar) return;
    currentChar = newChar;
    currentData = loadData(currentChar);
    currentGroupIdx = 0;
    currentSectionIdx = 0;
    renderSidebar();

    const firstGroup = currentData.groups[0];
    const firstTab = firstGroup?.tabs[0];
    if (firstTab) {
        document.getElementById('ni-main-title').textContent = firstTab.name;
        renderTabBar(firstTab, 0);
        renderPages(firstTab, 0);
        selectSection(0);
    } else {
        document.getElementById('ni-main-title').textContent = '-';
        document.getElementById('ni-sec-tabbar').innerHTML = '';
        document.getElementById('ni-pages').innerHTML = '';
    }
    applyInjection();
}

// 초기화
async function init() {
    const settingsHtml = await renderExtensionTemplateAsync(
        `third-party/${EXTENSION_NAME}`, 'settings',
    );
    $('#extensions_settings2').append(settingsHtml);

    // 패널을 body에 추가
    $('body').append(buildPanelHTML());

    // 초기 데이터 로드
    currentChar = getCurrentCharacter();
    currentData = loadData(currentChar);

    // 사이드바 렌더링
    renderSidebar();
    const firstGroup = currentData.groups[0];
    const firstTab = firstGroup?.tabs[0];
    if (firstTab) {
        document.getElementById('ni-main-title').textContent = firstTab.name;
        renderTabBar(firstTab, 0);
        renderPages(firstTab, 0);
        selectSection(0);
    }

    // 트리거 버튼
    $(document).on('click', '#noteInjectorOpenBtn', () => {
        if (panelOpen) closePanel();
        else openPanel();
    });

    // 접기 버튼
    $(document).on('click', '#ni-collapse-btn', collapsePanel);

    // 탭 추가
    $(document).on('click', '#ni-add-tab-btn', openTabModal);
    $(document).on('click', '#ni-modal-close', closeTabModal);
    $(document).on('click', '#ni-modal-cancel', closeTabModal);
    $(document).on('click', '#ni-modal-add', addTab);

    // 새 그룹 만들기
    $(document).on('click', '#ni-new-group-row', () => {
        document.getElementById('ni-new-group-row').classList.add('ni-hidden');
        document.getElementById('ni-new-group-input-row').classList.remove('ni-hidden');
    });
    $(document).on('click', '#ni-new-group-confirm', () => {
        const val = document.getElementById('ni-new-group-input').value.trim();
        if (!val) return;
        newGroupNameForModal = val;
        selectedGroupForModal = null;
        document.getElementById('ni-new-group-input-row').classList.add('ni-hidden');
        document.getElementById('ni-new-group-row').classList.remove('ni-hidden');
        renderGroupOptions();
    });

    // 섹션 추가
    $(document).on('click', '#ni-add-sec-btn', openSecModal);
    $(document).on('click', '#ni-sec-modal-close', closeSecModal);
    $(document).on('click', '#ni-sec-modal-cancel', closeSecModal);
    $(document).on('click', '#ni-sec-modal-add', addSection);

    // 드롭다운 외부 클릭 닫기
    $(document).on('click', (e) => {
        if (!$(e.target).closest('.ni-loc-wrapper').length) {
            document.querySelectorAll('.ni-loc-dropdown').forEach(d => d.classList.add('ni-hidden'));
        }
    });

    // 모달 오버레이 클릭 닫기
    $(document).on('click', '#ni-modal-overlay', (e) => {
        if (e.target.id === 'ni-modal-overlay') closeTabModal();
    });
    $(document).on('click', '#ni-sec-modal-overlay', (e) => {
        if (e.target.id === 'ni-sec-modal-overlay') closeSecModal();
    });

    // 캐릭터 전환 감지
    eventSource.on(event_types.CHAT_CHANGED, onCharacterChanged);

    applyInjection();
}

jQuery(async () => {
    await init();
});
