const EXTENSION_NAME = 'note-injector';

import { event_types } from '../../../events.js';

const {
    renderExtensionTemplateAsync,
    extensionSettings,
    saveSettingsDebounced,
    eventSource,
    setExtensionPrompt,
    extension_prompt_types,
    getContext,
} = SillyTavern.getContext();

const INJECT_POSITION = {
    'authors_note': extension_prompt_types.AFTER_PROMPT,
    'before_system': extension_prompt_types.BEFORE_PROMPT,
    'after_system': extension_prompt_types.IN_PROMPT,
    'chat_start': extension_prompt_types.AFTER_PROMPT,
};
const POSITION_DEPTH = { 'authors_note': 2, 'before_system': 0, 'after_system': 0, 'chat_start': 100 };
const POSITION_LABELS = { 'authors_note': "Author's Note", 'before_system': 'System 앞', 'after_system': 'System 뒤', 'chat_start': '채팅 맨 앞' };
const POSITION_DESCS = { 'authors_note': '권장 · 최근 맥락에 강함', 'before_system': '가장 강력', 'after_system': '강력', 'chat_start': '약함' };
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
let panelOpen = false;
let panelCollapsed = false;
let modalSelectedGroup = null;
let modalNewGroupName = null;

function getDefaultData() { return { groups: [] }; }

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
        <span class="ni-sb-title">Note Injector</span>
        <button class="ni-icon-btn" id="ni-collapse-btn" title="접기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      <div class="ni-sb-list" id="ni-sb-list"></div>
      <button class="ni-sb-add-btn" id="ni-add-tab-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M12 5v14M5 12h14"/></svg>
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

<div class="ni-modal-overlay" id="ni-tab-modal" style="display:none;">
  <div class="ni-modal">
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
</div>`;
}

// ===== 렌더링 =====
function renderSidebar() {
    const list = document.getElementById('ni-sb-list');
    if (!list) return;
    list.innerHTML = '';
    if (!currentData.groups?.length) {
        list.innerHTML = '<div class="ni-sb-empty">탭을 추가해보세요</div>';
        return;
    }
    currentData.groups.forEach((group, gIdx) => {
        const lbl = document.createElement('div');
        lbl.className = 'ni-sb-sec-lbl';
        lbl.textContent = group.name;
        list.appendChild(lbl);
        (group.tabs || []).forEach((tab, tIdx) => {
            const row = document.createElement('div');
            row.className = `ni-sb-row${gIdx === currentGroupIdx && tIdx === currentTabIdx ? ' active' : ''}`;
            row.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="15" height="15"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                <span class="ni-sb-row-name">${escapeHtml(tab.name)}</span>
                <span class="ni-sb-row-ct">${(tab.sections||[]).length}</span>`;
            row.addEventListener('click', () => selectTab(gIdx, tIdx));
            list.appendChild(row);
        });
        const div = document.createElement('div');
        div.className = 'ni-sb-div';
        list.appendChild(div);
    });
}

function renderTabBar(sections) {
    const bar = document.getElementById('ni-sec-tabbar');
    if (!bar) return;
    bar.innerHTML = '';
    (sections || []).forEach((sec, sIdx) => {
        const t = document.createElement('div');
        t.className = `ni-sec-tab${sIdx === currentSectionIdx ? ' active' : ''}${sec.enabled ? ' injecting' : ''}`;
        t.innerHTML = `<span class="ni-tab-dot"></span>${escapeHtml(sec.name)}`;
        t.addEventListener('click', () => selectSection(sIdx));
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

function selectTab(gIdx, tIdx) {
    currentGroupIdx=gIdx; currentTabIdx=tIdx; currentSectionIdx=0;
    renderSidebar();
    const tab = currentData.groups[gIdx]?.tabs[tIdx];
    if (!tab) return;
    document.getElementById('ni-main-title').textContent = tab.name;
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

function openPanel() { const p=document.getElementById('ni-panel'); if(!p) return; p.classList.add('ni-open'); panelOpen=true; }
function closePanel() { const p=document.getElementById('ni-panel'); if(!p) return; p.classList.remove('ni-open'); panelOpen=false; }
function toggleCollapse() { const p=document.getElementById('ni-panel'); if(!p) return; panelCollapsed=!panelCollapsed; p.classList.toggle('ni-collapsed',panelCollapsed); }

function openTabModal() {
    modalSelectedGroup=null; modalNewGroupName=null;
    document.getElementById('ni-tab-name-input').value='';
    document.getElementById('ni-new-group-input').value='';
    document.getElementById('ni-new-group-input-row').style.display='none';
    document.getElementById('ni-new-group-row').style.display='flex';
    renderGroupOpts();
    document.getElementById('ni-tab-modal').style.display='flex';
}
function closeTabModal() { document.getElementById('ni-tab-modal').style.display='none'; }

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

function openSecModal() { document.getElementById('ni-sec-name-input').value=''; document.getElementById('ni-sec-modal').style.display='flex'; }
function closeSecModal() { document.getElementById('ni-sec-modal').style.display='none'; }

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
    currentGroupIdx=0; currentTabIdx=0; currentSectionIdx=0;
    renderSidebar();
    const firstTab=currentData.groups?.[0]?.tabs?.[0];
    if (firstTab) {
        document.getElementById('ni-main-title').textContent=firstTab.name;
        renderTabBar(firstTab.sections||[]); renderPages(firstTab.sections||[]);
    } else {
        document.getElementById('ni-main-title').textContent='-';
        document.getElementById('ni-sec-tabbar').innerHTML='';
        document.getElementById('ni-pages').innerHTML='';
    }
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
    entry.on('click', () => { panelOpen ? closePanel() : openPanel(); });
    $('#extensionsMenu').append(entry);
}

async function init() {
    const settingsHtml = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'settings');
    $('#extensions_settings2').append(settingsHtml);
    $('body').append(buildPanelHTML());

    if (!extensionSettings[EXTENSION_NAME]) extensionSettings[EXTENSION_NAME]={};
    currentChar=getCurrentCharacter();
    currentData=loadData(currentChar);

    renderSidebar();
    const firstTab=currentData.groups?.[0]?.tabs?.[0];
    if (firstTab) {
        document.getElementById('ni-main-title').textContent=firstTab.name;
        renderTabBar(firstTab.sections||[]); renderPages(firstTab.sections||[]);
    }

    $(document).on('click','#ni-open-btn',()=>{ panelOpen?closePanel():openPanel(); });
    $(document).on('click','#ni-collapse-btn',toggleCollapse);
    $(document).on('click','#ni-add-tab-btn',openTabModal);
    $(document).on('click','#ni-tab-modal-close, #ni-tab-modal-cancel',closeTabModal);
    $(document).on('click','#ni-tab-modal-add',addTab);
    $(document).on('click','#ni-new-group-row',()=>{ document.getElementById('ni-new-group-row').style.display='none'; document.getElementById('ni-new-group-input-row').style.display='flex'; });
    $(document).on('click','#ni-new-group-confirm',()=>{
        const val=document.getElementById('ni-new-group-input').value.trim(); if(!val) return;
        modalNewGroupName=val; modalSelectedGroup=null;
        document.getElementById('ni-new-group-input-row').style.display='none';
        document.getElementById('ni-new-group-row').style.display='flex';
        renderGroupOpts();
    });
    $(document).on('click','#ni-add-sec-btn',openSecModal);
    $(document).on('click','#ni-sec-modal-close, #ni-sec-modal-cancel',closeSecModal);
    $(document).on('click','#ni-sec-modal-add',addSection);
    $(document).on('click','#ni-tab-modal',(e)=>{ if(e.target.id==='ni-tab-modal') closeTabModal(); });
    $(document).on('click','#ni-sec-modal',(e)=>{ if(e.target.id==='ni-sec-modal') closeSecModal(); });
    $(document).on('click',(e)=>{ if(!$(e.target).closest('.ni-loc-wrapper').length) document.querySelectorAll('.ni-loc-dropdown').forEach(d=>d.style.display='none'); });

    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    applyInjection();
    injectMenuEntry();
}

jQuery(async () => {
    const context = SillyTavern.getContext();
    context.eventSource.on(event_types.APP_READY, async () => { await init(); });
});
