// ClipToManual Client-Side Application

let currentRawTranscript = '';
let currentVideoUrl = '';
let currentMarkdownOutput = '';
let allLoadedManuals = [];
let selectedCategory = 'all';
let lastErrorPayload = null;
let activityLogs = [];
let stepperTimer = null;
let stepperStartTime = 0;

function initApp() {
  fetchDashboardStats();
  loadManualsLibrary();
  const savedKey = localStorage.getItem('gemini_api_key');
  if (savedKey) {
    const inputEl = document.getElementById('gemini-key-input');
    if (inputEl) inputEl.value = savedKey;
  }

  const urlInput = document.getElementById('yt-url-input');
  if (urlInput) {
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        generateManualAction();
      }
    });
  }
  logEvent('info', 'ClipToManual UI Initialized');
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

function logEvent(type, message, details) {
  const now = new Date().toTimeString().slice(0, 8);
  const logItem = { time: now, type, message, details };
  activityLogs.push(logItem);

  const countEl = document.getElementById('log-count');
  if (countEl) countEl.textContent = activityLogs.length;

  const container = document.getElementById('terminal-log-container');
  if (container) {
    const color = type === 'error' ? 'text-rose-400' : (type === 'success' ? 'text-emerald-400' : 'text-slate-300');
    const icon = type === 'error' ? '❌' : (type === 'success' ? '✅' : '🔹');
    const entry = document.createElement('div');
    entry.className = 'flex items-start gap-1.5 ' + color;
    entry.innerHTML = '<span class="text-slate-600 shrink-0">[' + now + ']</span><span>' + icon + ' ' + escapeHtml(message) + '</span>';
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  }
}

function toggleTerminalLogs() {
  const container = document.getElementById('terminal-log-container');
  const arrow = document.getElementById('log-toggle-arrow');
  if (container) {
    container.classList.toggle('hidden');
    if (arrow) arrow.textContent = container.classList.contains('hidden') ? '▼' : '▲';
  }
}

function copyTerminalLogs() {
  if (activityLogs.length === 0) return;
  const text = activityLogs.map(l => '[' + l.time + '] [' + l.type.toUpperCase() + '] ' + l.message + (l.details ? ' -> ' + JSON.stringify(l.details) : '')).join('\n');
  navigator.clipboard.writeText(text);
  showAlert('คัดลอก Logs ทั้งหมดลงคลิปบอร์ดแล้ว', 'success');
}

function fillDemoUrl() {
  const demoUrl = 'https://www.youtube.com/watch?v=kqtD5dpn9C8';
  const inputEl = document.getElementById('yt-url-input');
  if (inputEl) inputEl.value = demoUrl;
  switchInputTab('yt');
  logEvent('info', 'โหลดลิงก์ตัวอย่าง Python Tutorial สำเร็จ');
  showAlert('ใส่ลิงก์คลิปตัวอย่างเรียบร้อยแล้ว กดปุ่ม "สร้างคู่มือการใช้งาน" ได้ทันทีครับ', 'success');
}

function startStepper() {
  const box = document.getElementById('progress-stepper-box');
  if (box) box.classList.remove('hidden');
  stepperStartTime = Date.now();
  
  const timeEl = document.getElementById('stepper-elapsed-time');
  if (stepperTimer) clearInterval(stepperTimer);
  stepperTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - stepperStartTime) / 1000);
    if (timeEl) timeEl.textContent = sec + 's';
  }, 500);
  
  setStepActive(1);
}

function stopStepper() {
  if (stepperTimer) {
    clearInterval(stepperTimer);
    stepperTimer = null;
  }
  const box = document.getElementById('progress-stepper-box');
  if (box) box.classList.add('hidden');
}

function setStepActive(stepNum, statusText) {
  const mainStatus = document.getElementById('stepper-main-status');
  if (mainStatus && statusText) mainStatus.textContent = statusText;

  for (let i = 1; i <= 3; i++) {
    const node = document.getElementById('step-node-' + i);
    const icon = document.getElementById('step-icon-' + i);
    if (!node || !icon) continue;

    if (i < stepNum) {
      node.className = 'bg-emerald-950/60 border border-emerald-800/80 rounded-xl p-3 flex items-center gap-3 transition';
      icon.className = 'h-7 w-7 rounded-lg bg-emerald-900 text-emerald-300 flex items-center justify-center text-xs font-bold';
      icon.innerHTML = '✓';
    } else if (i === stepNum) {
      node.className = 'bg-indigo-950/80 border border-indigo-500 rounded-xl p-3 flex items-center gap-3 transition shadow-lg shadow-indigo-500/20 pulse-step';
      icon.className = 'h-7 w-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs font-bold animate-spin';
      icon.innerHTML = '🌀';
    } else {
      node.className = 'bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3 transition opacity-50';
      icon.className = 'h-7 w-7 rounded-lg bg-slate-800 text-slate-500 flex items-center justify-center text-xs font-bold';
      icon.innerHTML = i;
    }
  }
}

function showErrorDiagnostic(title, message, errorObject) {
  hideAlert();
  lastErrorPayload = {
    timestamp: new Date().toISOString(),
    title,
    message,
    url: currentVideoUrl || (document.getElementById('yt-url-input')?.value || ''),
    rawError: errorObject || message,
    system: {
      userAgent: navigator.userAgent,
      localStorageKeyConfigured: Boolean(localStorage.getItem('gemini_api_key'))
    }
  };

  logEvent('error', title + ': ' + message, lastErrorPayload);

  const errBox = document.getElementById('error-diagnostic-box');
  const titleEl = document.getElementById('error-title-text');
  const msgEl = document.getElementById('error-summary-msg');
  const stackEl = document.getElementById('error-raw-stack');

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (stackEl) stackEl.textContent = typeof errorObject === 'object' ? JSON.stringify(errorObject, null, 2) : String(errorObject || message);
  if (errBox) {
    errBox.classList.remove('hidden');
    errBox.scrollIntoView({ behavior: 'smooth' });
  }
}

function hideErrorDiagnostic() {
  const errBox = document.getElementById('error-diagnostic-box');
  if (errBox) errBox.classList.add('hidden');
}

function copyErrorDiagnostics() {
  if (!lastErrorPayload) return;
  const text = '```json\n' + JSON.stringify(lastErrorPayload, null, 2) + '\n```';
  navigator.clipboard.writeText(text);
  const btnText = document.getElementById('copy-err-btn-text');
  if (btnText) {
    btnText.textContent = '✅ คัดลอกสำเร็จแล้ว!';
    setTimeout(() => { btnText.textContent = 'คัดลอก Error ทั้งหมดไปให้ AI ดู'; }, 3000);
  }
}

async function fetchDashboardStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();

    if (data.status === 'ok') {
      // Key status
      const keyBadge = document.getElementById('dash-key-badge');
      const keyMasked = document.getElementById('dash-key-masked');
      const browserKey = localStorage.getItem('gemini_api_key');

      if (data.apiKeyStatus && data.apiKeyStatus.configured) {
        if (keyBadge) {
          keyBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800';
          keyBadge.textContent = 'AI Key (.env)';
        }
        if (keyMasked) keyMasked.textContent = data.apiKeyStatus.masked || 'Active in .env';
      } else if (browserKey && browserKey.length > 5) {
        if (keyBadge) {
          keyBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800';
          keyBadge.textContent = 'AI Key (Browser)';
        }
        if (keyMasked) keyMasked.textContent = browserKey.slice(0, 6) + '••••••••' + browserKey.slice(-4);
      } else {
        if (keyBadge) {
          keyBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800';
          keyBadge.textContent = 'Free Local Engine';
        }
        if (keyMasked) keyMasked.textContent = 'โหมดในตัว (กด ⚙️ ใส่คีย์ AI ได้)';
      }

      // Hardware
      if (data.engine && data.engine.hardware) {
        const engineDesc = document.getElementById('dash-engine-desc');
        if (engineDesc) {
          engineDesc.textContent = data.engine.hardware;
          engineDesc.title = data.engine.hardware;
        }
      }

      // Quota
      if (data.quota) {
        const quotaUsed = document.getElementById('dash-quota-used');
        if (quotaUsed) quotaUsed.textContent = data.quota.requestsToday;
        const pct = Math.min(100, Math.max(1, (data.quota.requestsToday / data.quota.dailyLimit) * 100));
        const quotaBar = document.getElementById('dash-quota-bar');
        if (quotaBar) quotaBar.style.width = pct + '%';
      }

      // Manuals
      const dashCount = document.getElementById('dash-manuals-count');
      const navCount = document.getElementById('nav-manuals-count');
      if (dashCount) dashCount.textContent = data.manualsCount;
      if (navCount) navCount.textContent = data.manualsCount;
    }
  } catch (err) {
    console.warn('Failed to load stats:', err);
  }
}

async function loadManualsLibrary() {
  const container = document.getElementById('manuals-grid-container');
  if (!container) return;

  try {
    const res = await fetch('/api/manuals');
    const data = await res.json();
    if (data.success && data.manuals) {
      allLoadedManuals = data.manuals;
      renderCategoryTabs();
      filterManualsGrid();
    }
  } catch (err) {
    container.innerHTML = '<div class="col-span-full text-center py-8 text-xs text-rose-400">เกิดข้อผิดพลาด: ' + err.message + '</div>';
  }
}

function renderCategoryTabs() {
  const tabsContainer = document.getElementById('manual-category-tabs');
  if (!tabsContainer) return;
  const categories = Array.from(new Set(allLoadedManuals.map(m => m.topic || 'ทั่วไป')));
  
  let html = '<button onclick="selectCategory(\'all\')" class="px-3 py-1 rounded-lg text-xs font-semibold transition ' + (selectedCategory === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200') + '">ทั้งหมด (' + allLoadedManuals.length + ')</button>';
  
  for (const cat of categories) {
    const count = allLoadedManuals.filter(m => m.topic === cat).length;
    const active = selectedCategory === cat;
    html += '<button onclick="selectCategory(\'' + escapeHtml(cat) + '\')" class="px-3 py-1 rounded-lg text-xs font-semibold transition ' + (active ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200') + '">' + escapeHtml(cat) + ' (' + count + ')</button>';
  }

  tabsContainer.innerHTML = html;
}

function selectCategory(cat) {
  selectedCategory = cat;
  renderCategoryTabs();
  filterManualsGrid();
}

function filterManualsGrid() {
  const inputEl = document.getElementById('manual-search-input');
  const query = (inputEl ? inputEl.value : '').toLowerCase().trim();
  const container = document.getElementById('manuals-grid-container');
  if (!container) return;

  const filtered = allLoadedManuals.filter(m => {
    const matchesCategory = selectedCategory === 'all' || m.topic === selectedCategory;
    const matchesQuery = !query || m.title.toLowerCase().includes(query) || (m.topic || '').toLowerCase().includes(query) || m.fileName.toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="col-span-full text-center py-12 text-xs text-slate-500 bg-slate-950/40 rounded-2xl border border-slate-800/80">ไม่พบคู่มือในหมวดหมู่นี้ คุณสามารถวางลิงก์ YouTube ด้านบนเพื่อสร้างคู่มือใหม่ได้ครับ</div>';
    return;
  }

  container.innerHTML = filtered.map(m => {
    const badgeColor = m.isMaster ? 'bg-amber-950 text-amber-300 border-amber-800' : 'bg-indigo-950 text-indigo-300 border-indigo-800';
    const encFile = encodeURIComponent(m.fileName);
    return '<div class="bg-slate-950/90 border border-slate-800 hover:border-indigo-500/60 rounded-2xl overflow-hidden shadow-xl hover:shadow-2xl transition flex flex-col group cursor-pointer" onclick="openManualDetails(\'' + encFile + '\')">' +
      '<div class="relative aspect-video w-full overflow-hidden bg-slate-900">' +
        '<img src="' + escapeHtml(m.thumbnailUrl) + '" alt="' + escapeHtml(m.title) + '" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.src=\'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80\'">' +
        '<div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition flex items-end p-3">' +
          '<span class="text-[11px] font-bold text-white flex items-center gap-1">🔍 คลิกดูรายละเอียด & สารบัญ</span>' +
        '</div>' +
        '<div class="absolute top-2 left-2 flex gap-1.5">' +
          '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold border backdrop-blur-md ' + badgeColor + '">' + escapeHtml(m.episode) + '</span>' +
          '<span class="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-900/80 text-slate-300 border border-slate-700 backdrop-blur-md">' + escapeHtml(m.topic) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="p-4 flex-1 flex flex-col justify-between space-y-3">' +
        '<div>' +
          '<h3 class="text-xs font-bold text-slate-100 line-clamp-2 leading-snug group-hover:text-indigo-400 transition" title="' + escapeHtml(m.title) + '">' + escapeHtml(m.title) + '</h3>' +
          '<div class="text-[11px] text-slate-500 mt-1.5 font-mono flex items-center justify-between">' +
            '<span>' + m.createdAt.slice(0, 10) + '</span>' +
            '<span class="text-slate-400 font-sans">' + (m.stepsCount ? m.stepsCount + ' ขั้นตอน' : 'ฉบับเต็ม') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2" onclick="event.stopPropagation()">' +
          '<button onclick="openManualDetails(\'' + encFile + '\')" class="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg font-semibold text-xs transition flex items-center justify-center gap-1 shadow">' +
            '<span>🔍 ดูรายละเอียด</span>' +
          '</button>' +
          '<button onclick="viewSavedManual(\'' + encFile + '\')" class="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-xs transition flex items-center justify-center gap-1 shadow-md">' +
            '<span>📖 อ่านเลย</span>' +
          '</button>' +
          (m.videoId ? '<a href="https://www.youtube.com/watch?v=' + m.videoId + '" target="_blank" class="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition" title="ดูวิดีโอบน YouTube">🎥</a>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function openManualDetails(encodedFileName) {
  const fileName = decodeURIComponent(encodedFileName);
  const manual = allLoadedManuals.find(m => m.fileName === fileName);
  if (!manual) return;

  try {
    const res = await fetch('/api/manuals/' + encodedFileName);
    const mdText = await res.text();

    const titleEl = document.getElementById('modal-manual-title');
    const epBadge = document.getElementById('modal-episode-badge');
    const topicBadge = document.getElementById('modal-topic-badge');
    const createdBadge = document.getElementById('modal-created-badge');
    const thumbEl = document.getElementById('modal-thumbnail');
    const overviewEl = document.getElementById('modal-overview-text');
    const stepsCountEl = document.getElementById('modal-steps-count');
    const readTimeEl = document.getElementById('modal-read-time');
    const fileSizeEl = document.getElementById('modal-file-size');
    const filePathEl = document.getElementById('modal-file-path');
    const ytContainer = document.getElementById('modal-yt-btn-container');
    const tocContainer = document.getElementById('modal-toc-container');
    const openFullBtn = document.getElementById('modal-open-full-btn');

    if (titleEl) titleEl.textContent = manual.title;
    if (epBadge) epBadge.textContent = manual.episode;
    if (topicBadge) topicBadge.textContent = manual.topic;
    if (createdBadge) createdBadge.textContent = '📅 บันทึกเมื่อ ' + manual.createdAt;
    if (thumbEl) thumbEl.src = manual.thumbnailUrl;
    
    // Overview
    const overview = manual.overview || 'คู่มือนี้ถูกสังเคราะห์และรวบรวมจากวิดีโอ เพื่อให้ผู้ใช้สามารถปฏิบัติตามขั้นตอนได้อย่างเป็นระบบ';
    if (overviewEl) overviewEl.textContent = overview;

    // Steps & TOC
    const stepLines = mdText.split('\n').filter(l => l.startsWith('### Step') || l.startsWith('## ') || l.startsWith('### '));
    const stepOnly = mdText.split('\n').filter(l => l.startsWith('### Step'));
    if (stepsCountEl) stepsCountEl.textContent = stepOnly.length || (manual.stepsCount || 'หลาย');
    if (readTimeEl) readTimeEl.textContent = '~' + Math.max(2, Math.round(mdText.length / 500)) + ' นาที';
    if (fileSizeEl) fileSizeEl.textContent = (manual.sizeBytes ? (manual.sizeBytes / 1024).toFixed(1) : (mdText.length / 1024).toFixed(1)) + ' KB';
    if (filePathEl) filePathEl.textContent = '📂 /manuals/' + manual.fileName;

    // YouTube Button
    if (ytContainer) {
      if (manual.videoId) {
        ytContainer.innerHTML = '<a href="https://www.youtube.com/watch?v=' + manual.videoId + '" target="_blank" class="w-full py-2 bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow">' +
          '<span>🎥</span> <span>ดูคลิปต้นฉบับบน YouTube</span>' +
        '</a>';
      } else {
        ytContainer.innerHTML = '';
      }
    }

    // TOC
    if (tocContainer) {
      if (stepLines.length > 0) {
        tocContainer.innerHTML = stepLines.slice(0, 15).map(s => {
          const clean = escapeHtml(s.replace(/^#+\s*/, '').replace(/^[🌟🧩🚀⌨️⚠️❓🎯]\s*/, ''));
          const isMain = s.startsWith('## ');
          return '<div class="flex items-center justify-between p-2 rounded-lg ' + (isMain ? 'bg-slate-950/80 text-indigo-300 font-bold' : 'bg-slate-950/40 text-slate-300') + ' text-xs border border-slate-800/60">' +
            '<span>' + clean + '</span>' +
            '<span class="text-[10px] text-slate-500 font-mono">Step</span>' +
          '</div>';
        }).join('');
      } else {
        tocContainer.innerHTML = '<div class="text-xs text-slate-500 italic p-2">ไม่มีสารบัญย่อย</div>';
      }
    }

    // Open Full Button Action
    if (openFullBtn) {
      openFullBtn.onclick = () => {
        closeManualDetailsModal();
        viewSavedManual(encodedFileName);
      };
    }

    const modal = document.getElementById('manual-details-modal');
    if (modal) modal.classList.remove('hidden');
    logEvent('info', 'เปิดดูรายละเอียด: ' + manual.title);
  } catch (err) {
    showErrorDiagnostic('โหลดรายละเอียดคู่มือไม่สำเร็จ', err.message, err);
  }
}

function closeManualDetailsModal() {
  const modal = document.getElementById('manual-details-modal');
  if (modal) modal.classList.add('hidden');
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToBottom() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function openManualsLibrary() {
  const section = document.getElementById('manuals-library-section');
  if (section) section.scrollIntoView({ behavior: 'smooth' });
}

function closeManualView() {
  const outContainer = document.getElementById('output-container');
  if (outContainer) outContainer.classList.add('hidden');
  const section = document.getElementById('manuals-library-section');
  if (section) section.scrollIntoView({ behavior: 'smooth' });
}

async function viewSavedManual(encodedFileName) {
  try {
    const res = await fetch('/api/manuals/' + encodedFileName);
    const mdText = await res.text();
    currentMarkdownOutput = mdText;
    
    const firstLine = mdText.split('\n')[0]?.replace(/^#\s*📖?\s*/, '') || 'คู่มือการใช้งาน';
    const titleEl = document.getElementById('reading-manual-title');
    if (titleEl) titleEl.textContent = firstLine;

    const renderedHtml = renderMarkdownToHtml(mdText);
    const manualView = document.getElementById('manual-view');
    if (manualView) manualView.innerHTML = renderedHtml;

    const outContainer = document.getElementById('output-container');
    if (outContainer) {
      outContainer.classList.remove('hidden');
      outContainer.scrollIntoView({ behavior: 'smooth' });
    }
  } catch (err) {
    showErrorDiagnostic('เปิดไฟล์คู่มือไม่สำเร็จ', err.message, err);
  }
}

function renderMarkdownToHtml(md) {
  let html = md;
  html = escapeHtml(html);

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" class="text-indigo-400 hover:text-indigo-300 underline font-medium">$1</a>');

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3 class="text-base font-bold text-indigo-300 mt-6 mb-2 flex items-center gap-2">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 class="text-xl font-extrabold text-white mt-8 mb-3 pb-2 border-b border-slate-800 flex items-center gap-2">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 class="text-2xl sm:text-3xl font-extrabold text-white mb-4 tracking-tight">$1</h1>');

  // Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-white">$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em class="text-slate-300">$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-slate-950 px-1.5 py-0.5 rounded text-indigo-300 font-mono text-[11px] border border-slate-800">$1</code>');

  // Blockquotes & Alerts
  html = html.replace(/^> \[!TIP\]\s*(.*$)/gim, '<div class="p-3.5 my-3 rounded-xl border bg-emerald-950/40 border-emerald-800/60 text-emerald-200 text-xs flex items-start gap-2"><span>💡</span><span>$1</span></div>');
  html = html.replace(/^> \[!WARNING\]\s*(.*$)/gim, '<div class="p-3.5 my-3 rounded-xl border bg-amber-950/40 border-amber-800/60 text-amber-200 text-xs flex items-start gap-2"><span>⚠️</span><span>$1</span></div>');
  html = html.replace(/^> (.*$)/gim, '<blockquote class="border-l-4 border-indigo-500/80 pl-3.5 py-1 text-slate-300 text-xs my-2 italic">$1</blockquote>');

  // HR
  html = html.replace(/^---$/gim, '<hr class="border-slate-800 my-6">');

  return '<div class="text-xs sm:text-sm text-slate-300 leading-relaxed space-y-2">' + html.replace(/\n/g, '<br>') + '</div>';
}

function toggleSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.toggle('hidden');
}

function saveSettings() {
  const inputEl = document.getElementById('gemini-key-input');
  const key = inputEl ? inputEl.value.trim() : '';
  if (key) {
    localStorage.setItem('gemini_api_key', key);
  } else {
    localStorage.removeItem('gemini_api_key');
  }
  toggleSettingsModal();
  fetchDashboardStats();
  showAlert('บันทึกการตั้งค่า API Key เรียบร้อยแล้ว', 'success');
}

async function testTelegramNotification() {
  const btn = document.getElementById('tg-test-btn');
  if (btn) btn.innerHTML = '<span>⏳</span> <span>กำลังส่งข้อความ...</span>';
  try {
    const res = await fetch('/api/telegram/test', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showAlert('ส่งข้อความทดสอบไปยัง Telegram เรียบร้อยแล้ว! ✈️', 'success');
      logEvent('success', 'ส่ง Telegram Test Message สำเร็จ');
    } else {
      showAlert('ส่งข้อความ Telegram ไม่สำเร็จ กรุณาตรวจ Token & Chat ID', 'error');
      logEvent('error', 'ส่ง Telegram Test Message ไม่สำเร็จ');
    }
  } catch (err) {
    showAlert('เกิดข้อผิดพลาดในการเชื่อมต่อ Telegram: ' + err.message, 'error');
  } finally {
    if (btn) btn.innerHTML = '<span>✈️</span> <span>ส่งข้อความทดสอบไปยัง Telegram</span>';
  }
}

function switchInputTab(tab) {
  const ytBtn = document.getElementById('tab-yt-btn');
  const subBtn = document.getElementById('tab-sub-btn');
  const ytContent = document.getElementById('tab-yt-content');
  const subContent = document.getElementById('tab-sub-content');

  if (tab === 'yt') {
    if (ytBtn) ytBtn.className = 'pb-2 text-sm font-semibold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2';
    if (subBtn) subBtn.className = 'pb-2 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2';
    if (ytContent) ytContent.classList.remove('hidden');
    if (subContent) subContent.classList.add('hidden');
  } else {
    if (subBtn) subBtn.className = 'pb-2 text-sm font-semibold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2';
    if (ytBtn) ytBtn.className = 'pb-2 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2';
    if (subContent) subContent.classList.remove('hidden');
    if (ytContent) ytContent.classList.add('hidden');
  }
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    const subArea = document.getElementById('subtitle-textarea');
    if (subArea) subArea.value = text;
    await parseUploadedSubtitle(text);
  };
  reader.readAsText(file);
}

async function parseUploadedSubtitle(content) {
  try {
    logEvent('info', 'กำลังแปลงข้อความ Subtitle ที่อัปโหลด...');
    const res = await fetch('/api/parse-subtitle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const data = await res.json();
    if (data.success) {
      currentRawTranscript = data.fullText;
      showTranscriptPreview(data.segments, data.count + ' รายการเวลา');
      showAlert('นำเข้าซับไตเติลสำเร็จ ' + data.count + ' ข้อความ', 'success');
      logEvent('success', 'แปลง Subtitle สำเร็จ ' + data.count + ' ข้อความ');
    } else {
      showErrorDiagnostic('การแปลง Subtitle ผิดพลาด', data.error, data);
    }
  } catch (err) {
    showErrorDiagnostic('ข้อผิดพลาดเครือข่าย', err.message, err);
  }
}

async function fetchYouTubeTranscript() {
  hideErrorDiagnostic();
  const inputEl = document.getElementById('yt-url-input');
  const url = inputEl ? inputEl.value.trim() : '';
  if (!url) {
    showAlert('กรุณากรอกหรือวาง YouTube URL', 'error');
    return false;
  }

  currentVideoUrl = url;
  logEvent('info', 'กำลังดึง Transcript จาก URL: ' + url);
  setLoading(true, 'กำลังดึงซับไตเติลผ่าน yt-dlp...');
  setStepActive(1, '[1/3] กำลังดึงข้อมูลและ Subtitle จาก YouTube...');

  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();

    if (data.success && data.segments && data.segments.length > 0) {
      currentRawTranscript = data.fullText;
      showTranscriptPreview(data.segments, (data.metadata?.title || 'คลิปวิดีโอ') + ' (' + data.segments.length + ' รายการ)');
      showAlert('ดึงซับไตเติลสำเร็จ (' + data.segments.length + ' ข้อความ)', 'success');
      logEvent('success', 'ดึง Transcript สำเร็จ: ' + (data.metadata?.title || '') + ' (' + data.segments.length + ' ตอน)');
      return true;
    } else {
      showErrorDiagnostic(
        'ไม่พบ Transcript หรือซับไตเติลของคลิปนี้',
        data.error || 'คลิปนี้อาจไม่มีซับไตเติลอัตโนมัติ หรือ YouTube บล็อกคำขอ คุณสามารถเลือกแท็บ Subtitle ด้านบนเพื่อวางข้อความเองได้ครับ',
        data
      );
      return false;
    }
  } catch (err) {
    showErrorDiagnostic('ข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', err.message, err);
    return false;
  } finally {
    setLoading(false);
  }
}

function showTranscriptPreview(segments, label) {
  const box = document.getElementById('transcript-preview-box');
  const labelEl = document.getElementById('transcript-status-label');
  const contentEl = document.getElementById('transcript-raw-content');

  if (labelEl) labelEl.textContent = label;
  if (contentEl) {
    contentEl.innerHTML = segments.slice(0, 150).map(s => '<div class="flex gap-2"><span class="text-indigo-400 shrink-0">[' + s.formattedTime + ']</span><span>' + escapeHtml(s.text) + '</span></div>').join('');
  }
  if (box) box.classList.remove('hidden');
}

function toggleTranscriptView() {
  const el = document.getElementById('transcript-raw-content');
  if (el) el.classList.toggle('hidden');
}

async function generateManualAction() {
  hideErrorDiagnostic();
  hideAlert();

  let transcript = currentRawTranscript;
  const urlInput = document.getElementById('yt-url-input');
  const urlVal = urlInput ? urlInput.value.trim() : '';
  const subArea = document.getElementById('subtitle-textarea');
  const subText = subArea ? subArea.value.trim() : '';

  startStepper();

  // If transcript not yet extracted, but YouTube URL is provided: Auto 1-Click Pull!
  if (!transcript && urlVal) {
    setLoading(true, '[1/3] 📥 กำลังดึงซับไตเติล...');
    setStepActive(1, '[1/3] 📥 กำลังดึงข้อมูลและ Subtitle จาก YouTube...');
    const fetched = await fetchYouTubeTranscript();
    if (fetched) {
      transcript = currentRawTranscript;
    } else {
      stopStepper();
      setLoading(false);
      return;
    }
  } else if (!transcript && subText) {
    transcript = subText;
  }

  if (!transcript) {
    stopStepper();
    showErrorDiagnostic('ยังไม่มีข้อมูลสำหรับสร้างคู่มือ', 'กรุณาวาง YouTube URL หรือข้อความ Subtitle ก่อนกดสร้างคู่มือครับ');
    return;
  }

  const langSelect = document.getElementById('lang-select');
  const lang = langSelect ? langSelect.value : 'th';
  const apiKey = localStorage.getItem('gemini_api_key') || '';

  setLoading(true, '[2/3] ✨ AI กำลังวิเคราะห์และเรียบเรียงคู่มือ...');
  setStepActive(2, '[2/3] ✨ AI กำลังวิเคราะห์ฟังก์ชันและจัดทำ Step-by-Step...');
  logEvent('info', 'เริ่มประมวลผลสร้างคู่มือ (ภาษา: ' + lang + ', โหมด: ' + (apiKey ? 'Gemini AI' : 'Local Deterministic') + ')');

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        youtubeUrl: currentVideoUrl || urlVal,
        rawTranscript: transcript,
        language: lang,
        apiKey: apiKey
      })
    });

    const data = await res.json();
    if (data.success && data.manual) {
      setStepActive(3, '[3/3] 💾 บันทึกคู่มือและสร้างคลังเสร็จสมบูรณ์!');
      logEvent('success', 'สร้างคู่มือสำเร็จ: ' + data.manual.title);
      currentMarkdownOutput = data.markdown || '';
      renderManualUi(data.manual);
      
      setTimeout(() => {
        stopStepper();
        const outContainer = document.getElementById('output-container');
        if (outContainer) {
          outContainer.classList.remove('hidden');
          outContainer.scrollIntoView({ behavior: 'smooth' });
        }
      }, 800);

      fetchDashboardStats();
      loadManualsLibrary();
      showAlert('🎉 สร้างคู่มือการใช้งานสำเร็จและบันทึกลงคลังเรียบร้อย!', 'success');
    } else {
      stopStepper();
      showErrorDiagnostic('เกิดข้อผิดพลาดในการสร้างคู่มือ', data.error || 'เซิร์ฟเวอร์ไม่สามารถสังเคราะห์คู่มือได้', data);
    }
  } catch (err) {
    stopStepper();
    showErrorDiagnostic('ข้อผิดพลาดการเชื่อมต่อ API /generate', err.message, err);
  } finally {
    setLoading(false);
  }
}

function renderManualUi(m) {
  const view = document.getElementById('manual-view');
  if (!view) return;
  const isThai = m.language === 'th';

  let html = '';

  // Header Banner
  html += '<div class="border-b border-slate-800 pb-6">';
  html += '<div class="flex flex-wrap items-center gap-2 mb-2">';
  html += '<span class="px-3 py-1 bg-indigo-950 text-indigo-300 border border-indigo-800/60 rounded-lg text-xs font-bold uppercase tracking-wider">' + escapeHtml(m.programName) + '</span>';
  html += '<span class="px-3 py-1 bg-slate-800 text-slate-300 rounded-lg text-xs font-medium">🎯 ' + escapeHtml(m.targetAudience) + '</span>';
  html += '</div>';
  html += '<h1 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">' + escapeHtml(m.title) + '</h1>';
  html += '<p class="text-slate-400 text-sm mt-3 leading-relaxed">' + escapeHtml(m.overview) + '</p>';
  html += '</div>';

  // Core Capabilities
  if (m.coreCapabilities && m.coreCapabilities.length > 0) {
    html += '<div class="space-y-3">';
    html += '<h3 class="text-base font-bold text-white flex items-center gap-2"><span>🌟</span> ' + (isThai ? 'ความสามารถหลัก' : 'Core Capabilities') + '</h3>';
    html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">';
    for (const cap of m.coreCapabilities) {
      html += '<div class="flex items-start gap-2 bg-slate-950/60 border border-slate-800 p-3 rounded-xl text-xs text-slate-200">';
      html += '<span class="text-emerald-400 mt-0.5">✅</span><span>' + escapeHtml(cap) + '</span>';
      html += '</div>';
    }
    html += '</div></div>';
  }

  // Features Table
  if (m.features && m.features.length > 0) {
    html += '<div class="space-y-3">';
    html += '<h3 class="text-base font-bold text-white flex items-center gap-2"><span>🧩</span> ' + (isThai ? 'รายการฟังก์ชันและการทำงาน' : 'Feature Breakdown') + '</h3>';
    html += '<div class="overflow-x-auto border border-slate-800 rounded-xl">';
    html += '<table class="w-full text-left text-xs">';
    html += '<thead class="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold"><tr><th class="p-3.5">ฟังก์ชัน</th><th class="p-3.5">รายละเอียด</th><th class="p-3.5">ประโยชน์</th></tr></thead>';
    html += '<tbody class="divide-y divide-slate-800/60">';
    for (const f of m.features) {
      html += '<tr class="hover:bg-slate-800/30 transition"><td class="p-3.5 font-bold text-indigo-300">' + escapeHtml(f.name) + '</td><td class="p-3.5 text-slate-300">' + escapeHtml(f.description) + '</td><td class="p-3.5 text-slate-400">' + escapeHtml(f.purpose) + '</td></tr>';
    }
    html += '</tbody></table></div></div>';
  }

  // Step-by-Step Guide
  if (m.stepByStepGuide && m.stepByStepGuide.length > 0) {
    html += '<div class="space-y-4">';
    html += '<h3 class="text-base font-bold text-white flex items-center gap-2"><span>🚀</span> ' + (isThai ? 'ขั้นตอนการใช้งานทีละ Step' : 'Step-by-Step User Guide') + '</h3>';
    
    for (const section of m.stepByStepGuide) {
      html += '<div class="bg-slate-950/80 border border-slate-800/90 rounded-xl p-5 space-y-4">';
      html += '<h4 class="text-sm font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2"><span>📂</span> ' + escapeHtml(section.sectionName) + '</h4>';
      html += '<div class="space-y-3">';

      for (const s of section.steps) {
        let timeBtn = '';
        if (s.timestamp) {
          const href = m.sourceVideoUrl ? makeYtLink(m.sourceVideoUrl, s.timestamp) : '#';
          timeBtn = '<a href="' + href + '" target="_blank" class="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/80 text-[11px] font-mono hover:bg-indigo-900 transition ml-2">⏱️ ' + escapeHtml(s.timestamp) + '</a>';
        }

        html += '<div class="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-2">';
        html += '<div class="flex items-center justify-between">';
        html += '<span class="text-xs font-bold text-white flex items-center">Step ' + s.stepNumber + ': ' + escapeHtml(s.title) + timeBtn + '</span>';
        html += '<span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 uppercase font-semibold">' + escapeHtml(s.actionType) + '</span>';
        html += '</div>';
        html += '<p class="text-xs text-slate-300 leading-relaxed">' + escapeHtml(s.description) + '</p>';
        if (s.codeSnippet) {
          html += '<pre class="bg-slate-950 p-2.5 rounded-lg text-xs text-emerald-400 overflow-x-auto border border-slate-800"><code>' + escapeHtml(s.codeSnippet) + '</code></pre>';
        }
        html += '</div>';
      }

      html += '</div></div>';
    }

    html += '</div>';
  }

  // Shortcuts & Configs
  if (m.shortcutsAndConfigs && m.shortcutsAndConfigs.length > 0) {
    html += '<div class="space-y-3">';
    html += '<h3 class="text-base font-bold text-white flex items-center gap-2"><span>⌨️</span> ' + (isThai ? 'คีย์ลัดและการตั้งค่าสำคัญ' : 'Shortcuts & Configurations') + '</h3>';
    html += '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">';
    for (const sc of m.shortcutsAndConfigs) {
      html += '<div class="bg-slate-950/60 border border-slate-800 p-3 rounded-xl flex items-center justify-between text-xs">';
      html += '<code class="bg-slate-800 px-2 py-1 rounded text-indigo-300 font-bold">' + escapeHtml(sc.key) + '</code>';
      html += '<span class="text-slate-300">' + escapeHtml(sc.action) + '</span>';
      html += '</div>';
    }
    html += '</div></div>';
  }

  // Tips & Warnings
  if (m.tipsAndWarnings && m.tipsAndWarnings.length > 0) {
    html += '<div class="space-y-3">';
    html += '<h3 class="text-base font-bold text-white flex items-center gap-2"><span>⚠️</span> ' + (isThai ? 'ข้อควรระวังและเทคนิคแนะนำ' : 'Tips & Warnings') + '</h3>';
    for (const tw of m.tipsAndWarnings) {
      const isWarn = tw.type === 'warning' || tw.type === 'gotcha';
      const bg = isWarn ? 'bg-amber-950/40 border-amber-800/60 text-amber-200' : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200';
      const icon = isWarn ? '⚠️' : '💡';
      html += '<div class="p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ' + bg + '">';
      html += '<span>' + icon + '</span><span>' + escapeHtml(tw.message) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  // FAQ
  if (m.faq && m.faq.length > 0) {
    html += '<div class="space-y-3">';
    html += '<h3 class="text-base font-bold text-white flex items-center gap-2"><span>❓</span> ' + (isThai ? 'คำถามที่พบบ่อย (FAQ)' : 'FAQ') + '</h3>';
    html += '<div class="space-y-2">';
    for (const q of m.faq) {
      html += '<details class="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 text-xs group">';
      html += '<summary class="font-bold text-slate-200 cursor-pointer list-none flex justify-between items-center"><span>Q: ' + escapeHtml(q.question) + '</span><span class="text-indigo-400 group-open:rotate-180 transition">▼</span></summary>';
      html += '<p class="mt-2 text-slate-400 pt-2 border-t border-slate-800/60 leading-relaxed">A: ' + escapeHtml(q.answer) + '</p>';
      html += '</details>';
    }
    html += '</div></div>';
  }

  view.innerHTML = html;
}

function makeYtLink(url, timestamp) {
  const parts = timestamp.split(':').map(Number);
  let sec = 0;
  if (parts.length === 2) sec = parts[0] * 60 + parts[1];
  if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  try {
    const u = new URL(url);
    u.searchParams.set('t', sec + 's');
    return u.toString();
  } catch {
    return url + '&t=' + sec + 's';
  }
}

function copyMarkdown() {
  if (!currentMarkdownOutput) return;
  navigator.clipboard.writeText(currentMarkdownOutput);
  showAlert('คัดลอก Markdown ลงคลิปบอร์ดแล้ว!', 'success');
}

function downloadMarkdown() {
  if (!currentMarkdownOutput) return;
  const blob = new Blob([currentMarkdownOutput], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'software-manual.md';
  a.click();
  URL.revokeObjectURL(url);
}

function showAlert(msg, type) {
  const el = document.getElementById('status-alert');
  if (!el) return;
  el.className = 'p-4 rounded-xl text-xs font-medium border ' + (type === 'success' ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200' : 'bg-rose-950/60 border-rose-800 text-rose-200');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideAlert() {
  const el = document.getElementById('status-alert');
  if (el) el.classList.add('hidden');
}

function setLoading(isLoading, text = '') {
  const btn = document.getElementById('generate-btn');
  const btnText = document.getElementById('generate-btn-text');
  if (btn) btn.disabled = isLoading;
  if (btnText) {
    btnText.textContent = isLoading ? (text || 'กำลังประมวลผล...') : 'สร้างคู่มือการใช้งาน (1-Click Generate)';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let uiTagsVisible = true;

function toggleUiTags() {
  uiTagsVisible = !uiTagsVisible;
  const tags = document.querySelectorAll('.ui-tag');
  tags.forEach(t => {
    if (uiTagsVisible) {
      t.classList.remove('hidden');
    } else {
      t.classList.add('hidden');
    }
  });

  const btnText = document.getElementById('uitags-btn-text');
  if (btnText) {
    btnText.textContent = uiTagsVisible ? 'ป้ายชื่อ UI (เปิดอยู่)' : 'ป้ายชื่อ UI (ปิดอยู่)';
  }
  showToast(uiTagsVisible ? '🏷️ เปิดการแสดงป้ายชื่อชิ้นส่วน UI แล้ว' : '🏷️ ปิดการแสดงป้ายชื่อชิ้นส่วนแล้ว');
}

function copyUiTag(tagName) {
  navigator.clipboard.writeText(tagName);
  showToast('📋 คัดลอก "' + tagName + '" เรียบร้อย! นำไปบอก AI ได้เลย');
  logEvent('info', 'คัดลอกชื่อชิ้นส่วน UI: ' + tagName);
}

function toggleUiGlossaryModal() {
  const modal = document.getElementById('glossary-modal');
  if (modal) modal.classList.toggle('hidden');
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('ui-toast');
  const msgEl = document.getElementById('ui-toast-msg');
  if (!toast || !msgEl) return;

  msgEl.textContent = msg;
  toast.classList.remove('hidden');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

// Expose functions globally for HTML onclick handlers
Object.assign(window, {
  initApp,
  toggleTerminalLogs,
  copyTerminalLogs,
  fillDemoUrl,
  startStepper,
  stopStepper,
  setStepActive,
  showErrorDiagnostic,
  hideErrorDiagnostic,
  copyErrorDiagnostics,
  fetchDashboardStats,
  loadManualsLibrary,
  selectCategory,
  filterManualsGrid,
  openManualsLibrary,
  closeManualView,
  viewSavedManual,
  toggleSettingsModal,
  saveSettings,
  testTelegramNotification,
  switchInputTab,
  handleFileUpload,
  parseUploadedSubtitle,
  fetchYouTubeTranscript,
  toggleTranscriptView,
  generateManualAction,
  copyMarkdown,
  downloadMarkdown,
  toggleUiTags,
  copyUiTag,
  toggleUiGlossaryModal,
  showToast,
  openManualDetails,
  closeManualDetailsModal,
  scrollToTop,
  scrollToBottom
});
