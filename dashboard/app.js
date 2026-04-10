    (function() {
      const saved = localStorage.getItem('skiller-theme');
      const theme = saved !== null ? saved : 'clean';
      if (theme) document.documentElement.setAttribute('data-theme', theme);
    })();

    const THEME_ICONS = { '': '🖍️', 'clean': '✨', 'dark': '🌙', 'ocean': '🌊', 'forest': '🌿', 'sunset': '🌅' };
    const THEME_NAMES = { '': '蜡笔小新', 'clean': '简洁', 'dark': '暗黑', 'ocean': '海洋', 'forest': '森林', 'sunset': '日落' };

    function toggleThemePicker() {
      const picker = document.getElementById('themePicker');
      picker.classList.toggle('open');
      updateThemePickerActive();
      if (picker.classList.contains('open')) {
        setTimeout(() => document.addEventListener('click', closePickerOutside, { once: true }), 0);
      }
    }

    function closePickerOutside(e) {
      const picker = document.getElementById('themePicker');
      if (!picker.contains(e.target) && e.target.id !== 'themeToggle') {
        picker.classList.remove('open');
      }
    }

    function setTheme(theme) {
      if (theme) {
        document.documentElement.setAttribute('data-theme', theme);
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      localStorage.setItem('skiller-theme', theme);
      var nameEl = document.getElementById('themeNameDisplay');
      if (nameEl) nameEl.textContent = THEME_NAMES[theme] || '蜡笔小新';
      document.getElementById('themePicker').classList.remove('open');
      updateThemePickerActive();
    }

    function updateThemePickerActive() {
      const current = document.documentElement.getAttribute('data-theme') || '';
      document.querySelectorAll('.theme-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.themeVal === current);
      });
    }

    (function() {
      const saved = localStorage.getItem('skiller-theme');
      const theme = saved !== null ? saved : 'clean';
      var nameEl = document.getElementById('themeNameDisplay');
      if (nameEl) nameEl.textContent = THEME_NAMES[theme] || '蜡笔小新';
    })();

    let allSkills = [];
    let categories = [];
    let userCategories = [];
    let currentView = 'all';
    let currentCategory = null;
    let sseSource = null;
    let lastLogCount = 0;
    let skillSubCounts = {};
    let skillSubSources = {};

    var _apiInflightMap = {};
    async function api(path) {
      if (_apiInflightMap[path]) return _apiInflightMap[path];
      var p = fetch(path).then(function(res) { return res.json(); }).finally(function() { delete _apiInflightMap[path]; });
      _apiInflightMap[path] = p;
      return p;
    }

    async function apiPost(path, body) {
      return fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function(res) { return res.json(); });
    }

    function connectSSE() {
      if (sseSource) sseSource.close();

      sseSource = new EventSource('/api/sse');
      const dot = document.getElementById('liveDot');
      const text = document.getElementById('liveText');

      sseSource.onopen = () => {
        dot.className = 'live-dot connected';
        text.textContent = '实时监听中';
      };

      sseSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'connected') {
            dot.className = 'live-dot connected';
            text.textContent = '实时监听中';
            return;
          }

          if (data.type === 'log_update') {
            dot.className = 'live-dot active';
            text.textContent = `活动: ${data.latest?.tool || '...'}`;
            setTimeout(() => {
              dot.className = 'live-dot connected';
              text.textContent = '实时监听中';
            }, 3000);

            if (data.latest) {
              showToast(data.latest);
            }

            if (currentView === 'log') {
              renderLog();
            }
          }
        } catch {}
      };

      sseSource.onerror = () => {
        dot.className = 'live-dot';
        text.textContent = '已断开，重连中...';
        setTimeout(connectSSE, 5000);
      };
    }

    function showToast(entry) {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.innerHTML = `
        <div><span class="toast-tool">${toolDisplayName(entry.tool)}</span></div>
        <div class="toast-result">${escapeHtml(entry.resultSummary)}</div>
        <div class="toast-time">${formatTime(entry.timestamp)}</div>
      `;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 4500);
    }

    function toolBadgeClass(tool) {
      if (tool.includes('search')) return 'search';
      if (tool.includes('detail')) return 'detail';
      if (tool.includes('stat')) return 'stats';
      if (tool.includes('online') || tool.includes('fetch')) return 'online';
      return 'other';
    }

    function toolDisplayName(tool) {
      const names = {
        'list_categories': '🗂️ 浏览分类',
        'search_skills': '🔍 搜索技能',
        'get_skill_detail': '📖 加载技能',
        'scan_skills': '🔄 重建索引',
        'skill_stats': '📊 查看统计',
        'search_online': '🌐 在线搜索',
        'fetch_online_skill': '⬇️ 获取在线技能',
      };
      return names[tool] || tool;
    }

    async function init() {
      const [skills, cats, stats, trees, ucats] = await Promise.all([
        api('/api/skills'),
        api('/api/categories'),
        api('/api/stats'),
        api('/api/all-trees'),
        api('/api/categories/list'),
      ]);
      allSkills = skills;
      categories = cats;
      userCategories = ucats || [];

      skillSubCounts = {};
      skillSubSources = {};
      for (const t of trees) {
        skillSubCounts[t.name] = t.subSkillCount || 0;
        skillSubSources[t.name] = t.subSkillSource || 'auto';
      }

      document.getElementById('totalCount').textContent = stats.total;
      showView('myrepo');
      connectSSE();
      loadVersionInfo();
      checkFirstVisit();
    }

    function checkFirstVisit() {
      if (localStorage.getItem('skiller_onboarded')) return;
      showOnboarding();
    }

    function showOnboarding() {
      var overlay = document.createElement('div');
      overlay.id = 'onboardingOverlay';
      overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px)';

      var pages = [
        {
          icon: '🎉',
          title: '欢迎使用 Skiller',
          desc: 'AI 技能管理器 — 帮你管理和部署 Cursor AI 的技能与规则',
          detail: '接下来简单了解一下主要功能区域'
        },
        {
          icon: '📁',
          title: '本地 Skill 管理',
          desc: '以项目为中心管理你的 AI 技能',
          detail: '<b>项目网格</b>：查看所有管理的项目<br><b>扫描项目</b>：从 Cursor 历史中导入项目<br><b>项目详情</b>：查看已安装的技能、添加新技能<br><b>分组</b>：按分类整理项目'
        },
        {
          icon: '🧠',
          title: 'Skill 和 Rule 的区别',
          desc: '安装技能时可选择三种模式',
          detail: '<div style="display:grid; gap:8px; margin-top:8px">'
            + '<div style="padding:8px 12px; border-radius:8px; background:rgba(99,102,241,0.06); border-left:3px solid #6366f1"><b>🧠 全局 Skill</b><br><span style="font-size:11px; color:var(--text2)">存放在 ~/.cursor/skills/<br>AI 按需加载，节省 token，所有项目共享</span></div>'
            + '<div style="padding:8px 12px; border-radius:8px; background:rgba(245,158,11,0.06); border-left:3px solid #f59e0b"><b>⚡ 智能 Rule</b><br><span style="font-size:11px; color:var(--text2)">存放在 项目/.cursor/rules/<br>alwaysApply: false，AI 按上下文判断是否使用</span></div>'
            + '<div style="padding:8px 12px; border-radius:8px; background:rgba(239,68,68,0.06); border-left:3px solid #ef4444"><b>📜 常驻 Rule</b><br><span style="font-size:11px; color:var(--text2)">存放在 项目/.cursor/rules/<br>alwaysApply: true，始终注入 AI 上下文</span></div>'
            + '</div>'
        },
        {
          icon: '🌐',
          title: '社区广场',
          desc: '浏览和安装社区分享的技能',
          detail: '<b>订阅源</b>：添加 GitHub 仓库作为技能源<br><b>浏览技能</b>：搜索、筛选、一键安装<br><b>三种安装模式</b>：和本地管理一样的选择'
        }
      ];

      var currentPage = 0;
      function renderPage() {
        var p = pages[currentPage];
        var isLast = currentPage === pages.length - 1;
        overlay.innerHTML = '<div style="background:var(--bg); border-radius:20px; max-width:480px; width:90%; padding:36px 32px; box-shadow:0 20px 60px rgba(0,0,0,0.2); text-align:center; position:relative">'
          + '<div style="font-size:48px; margin-bottom:16px">' + p.icon + '</div>'
          + '<h2 style="font-size:20px; font-weight:700; color:var(--text); font-family:var(--font-display); margin-bottom:8px">' + p.title + '</h2>'
          + '<p style="font-size:14px; color:var(--text); margin-bottom:12px">' + p.desc + '</p>'
          + '<div style="font-size:12px; color:var(--text2); line-height:1.8; text-align:left; max-width:360px; margin:0 auto 20px">' + p.detail + '</div>'
          + '<div style="display:flex; justify-content:center; gap:6px; margin-bottom:16px">'
          +   pages.map(function(_, i) { return '<span style="width:8px; height:8px; border-radius:50%; background:' + (i === currentPage ? 'var(--theme-active)' : 'rgba(0,0,0,0.1)') + '"></span>'; }).join('')
          + '</div>'
          + '<div style="display:flex; gap:10px; justify-content:center">'
          +   (currentPage > 0 ? '<button onclick="onboardPrev()" style="padding:8px 20px; border-radius:10px; border:1.5px solid rgba(0,0,0,0.08); background:white; cursor:pointer; font-size:13px; font-family:var(--font-body)">上一步</button>' : '')
          +   '<button onclick="' + (isLast ? 'finishOnboarding()' : 'onboardNext()') + '" style="padding:8px 24px; border-radius:10px; border:none; background:var(--theme-active); color:white; cursor:pointer; font-size:13px; font-weight:600; font-family:var(--font-body)">' + (isLast ? '开始使用' : '下一步') + '</button>'
          + '</div>'
          + '<button onclick="finishOnboarding()" style="position:absolute; top:12px; right:16px; border:none; background:none; color:var(--text2); cursor:pointer; font-size:14px" title="跳过">✕</button>'
          + '</div>';
      }

      window.onboardNext = function() { currentPage = Math.min(currentPage + 1, pages.length - 1); renderPage(); };
      window.onboardPrev = function() { currentPage = Math.max(currentPage - 1, 0); renderPage(); };
      window.finishOnboarding = function() {
        localStorage.setItem('skiller_onboarded', '1');
        overlay.remove();
      };

      renderPage();
      document.body.appendChild(overlay);
    }

    let versionInfo = null;
    let updateInfo = null;

    async function loadVersionInfo() {
      try {
        versionInfo = await api('/api/version');
        var verEl = document.getElementById('verNum');
        if (verEl) verEl.textContent = versionInfo.version + (versionInfo.commit ? ' (' + versionInfo.commit + ')' : '');
      } catch(e) {}
      checkForUpdates();
    }

    async function checkForUpdates() {
      try {
        updateInfo = await api('/api/check-update');
        var badge = document.getElementById('versionBadge');
        if (badge && updateInfo.hasUpdate) {
          badge.classList.add('has-update');
        }
      } catch(e) {}
    }

    function toggleUpdatePanel() {
      var panel = document.getElementById('updatePanel');
      if (!panel) return;
      if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        return;
      }
      panel.classList.add('open');
      renderUpdatePanel();
    }

    function renderUpdatePanel() {
      var el = document.getElementById('updatePanelContent');
      if (!el) return;
      var html = '<div style="font-family:var(--font-display); font-size:16px; margin-bottom:12px">📦 版本信息</div>';

      if (versionInfo) {
        html += '<div style="display:flex; flex-direction:column; gap:6px; margin-bottom:14px; font-size:12px">'
          + '<div style="display:flex; justify-content:space-between"><span style="color:var(--text2)">当前版本</span><span style="font-weight:600">' + escapeHtml(versionInfo.version) + '</span></div>'
          + '<div style="display:flex; justify-content:space-between"><span style="color:var(--text2)">Commit</span><span style="font-family:monospace">' + escapeHtml(versionInfo.commit || 'N/A') + '</span></div>'
          + '<div style="display:flex; justify-content:space-between"><span style="color:var(--text2)">日期</span><span>' + escapeHtml(versionInfo.commitDate ? versionInfo.commitDate.split(' ')[0] : 'N/A') + '</span></div>'
          + '</div>';
      }

      if (updateInfo) {
        if (updateInfo.networkError) {
          html += '<div style="padding:10px; border-radius:12px; background:#fff3e0; border:1.5px solid var(--orange); font-size:12px; margin-bottom:10px">'
            + '<div style="font-weight:600; color:var(--orange); margin-bottom:4px">🌐 网络不可用</div>'
            + '<div style="color:var(--text2)">' + escapeHtml(updateInfo.errorMsg || '无法访问 GitHub') + '</div>'
            + '</div>';
        } else if (updateInfo.error) {
          html += '<div style="padding:10px; border-radius:12px; background:#fff3e0; color:#e65100; font-size:12px; margin-bottom:10px">⚠️ ' + escapeHtml(updateInfo.error) + '</div>';
        } else if (updateInfo.hasUpdate) {
          html += '<div style="padding:10px; border-radius:12px; background:#e8f5e9; border:1.5px solid var(--green); margin-bottom:10px">'
            + '<div style="font-weight:600; color:var(--green); margin-bottom:6px">🆕 发现新版本！落后 ' + updateInfo.behind + ' 个提交</div>'
            + '<div style="font-size:11px; color:var(--text2)">远程: ' + escapeHtml(updateInfo.remoteCommit || '') + '</div>'
            + '</div>';

          if (updateInfo.changelog) {
            html += '<div style="margin-bottom:10px">'
              + '<div style="font-size:11px; font-weight:600; margin-bottom:4px; color:var(--text2)">更新日志:</div>'
              + '<div style="font-size:11px; font-family:monospace; background:var(--bg2); padding:8px 10px; border-radius:8px; max-height:120px; overflow-y:auto; white-space:pre-wrap; line-height:1.6">' + escapeHtml(updateInfo.changelog) + '</div>'
              + '</div>';
          }

          if (updateInfo.release) {
            html += '<div style="margin-bottom:10px; padding:8px 10px; border-radius:8px; background:var(--bg2); font-size:11px">'
              + '<div style="font-weight:600">📋 Release: ' + escapeHtml(updateInfo.release.name || updateInfo.release.tag) + '</div>'
              + (updateInfo.release.body ? '<div style="color:var(--text2); margin-top:4px">' + escapeHtml(updateInfo.release.body.substring(0, 200)) + '</div>' : '')
              + '</div>';
          }

          html += '<button class="btn btn-green" style="width:100%; text-align:center" onclick="doUpdate()" id="doUpdateBtn">🚀 立即更新</button>';
        } else {
          html += '<div style="padding:10px; border-radius:12px; background:var(--bg2); font-size:12px; color:var(--text2); text-align:center">✅ 已是最新版本</div>';
        }
      } else {
        html += '<div style="text-align:center; padding:10px; color:var(--text2); font-size:12px">正在检查更新...</div>';
      }

      html += '<div style="margin-top:10px; display:flex; gap:6px">'
        + '<button class="btn" style="flex:1; font-size:11px; padding:6px 10px; text-align:center" onclick="recheckUpdate()">🔄 重新检查</button>'
        + '<button class="btn" style="font-size:11px; padding:6px 10px" onclick="document.getElementById(\'updatePanel\').classList.remove(\'open\')">关闭</button>'
        + '</div>';

      el.innerHTML = html;
    }

    async function recheckUpdate() {
      updateInfo = null;
      renderUpdatePanel();
      await checkForUpdates();
      renderUpdatePanel();
    }

    async function doUpdate() {
      var btn = document.getElementById('doUpdateBtn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ 更新中...'; }
      try {
        var result = await api('/api/do-update');
        if (result.success) {
          showToast({ tool: 'update', resultSummary: '更新成功! 新版本: ' + result.newVersion + ' (' + result.newCommit + ')', timestamp: new Date().toISOString() });
          versionInfo = { version: result.newVersion, commit: result.newCommit, commitDate: '' };
          updateInfo = { hasUpdate: false };
          var badge = document.getElementById('versionBadge');
          if (badge) badge.classList.remove('has-update');
          var verEl = document.getElementById('verNum');
          if (verEl) verEl.textContent = result.newVersion + ' (' + result.newCommit + ')';
          renderUpdatePanel();
          if (result.needRestart) {
            var el = document.getElementById('updatePanelContent');
            if (el) {
              el.innerHTML += '<div style="margin-top:10px; padding:10px; border-radius:12px; background:#fff3e0; border:1.5px solid var(--orange); font-size:12px">'
                + '<strong>⚠️ 需要重启</strong><br>'
                + '<span style="color:var(--text2)">请重启 MCP 服务器以使更新生效。</span><br>'
                + '<button class="btn btn-blue" style="margin-top:8px; font-size:11px" onclick="restartDashboard()">🔄 重启服务</button>'
                + '</div>';
            }
          }
        } else {
          showToast({ tool: 'update', resultSummary: '更新失败: ' + (result.message || '未知错误'), timestamp: new Date().toISOString() });
          if (btn) { btn.disabled = false; btn.textContent = '🚀 立即更新'; }
        }
      } catch(e) {
        showToast({ tool: 'update', resultSummary: '更新请求失败', timestamp: new Date().toISOString() });
        if (btn) { btn.disabled = false; btn.textContent = '🚀 立即更新'; }
      }
    }

    async function restartDashboard() {
      showToast({ tool: 'restart', resultSummary: '正在重启服务...', timestamp: new Date().toISOString() });
      try { await api('/api/mcp/restart?name=skiller-dashboard'); } catch(e) {}
      setTimeout(function() { window.location.reload(); }, 3000);
    }

    function showView(view) {
      currentView = view;
      currentCategory = null;

      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      const viewMap = { myrepo: 0, community: 1, mcp: 2, log: 3, help: 4 };
      const idx = viewMap[view];
      if (idx !== undefined) {
        const items = document.querySelectorAll('#sidebar .nav-item');
        if (items[idx]) items[idx].classList.add('active');
      }

      if (view === 'myrepo') {
        if (_dirtyViews.myrepo) { _dirtyViews.myrepo = false; allSkills = []; }
        renderMyRepo();
      } else if (view === 'ghcommunity') {
        communityTab = 'mycommunity';
        if (_dirtyViews.ghcommunity) { _dirtyViews.ghcommunity = false; ghcSkills = []; }
        renderCommunity();
      } else if (view === 'log') {
        renderLog();
      } else if (view === 'community') {
        if (_dirtyViews.community) { _dirtyViews.community = false; communityLoaded = false; communitySkills = []; }
        renderCommunity();
      } else if (view === 'sources') {
        communityTab = 'sources';
        renderCommunity();
      } else if (view === 'help') {
        renderHelpPage();
      } else if (view === 'mcp') {
        renderMcpPanel();
      } else if (view === 'catmgr') {
        showView('myrepo');
        setTimeout(showCatManagerInMyRepo, 100);
        return;
      }
    }

    function getCategoryAndDescendants(catId) {
      const ids = [catId];
      const children = userCategories.filter(c => c.parentId === catId);
      for (const child of children) {
        ids.push(...getCategoryAndDescendants(child.id));
      }
      return ids;
    }

    // ========== 我的本地 Skill 仓库 ==========
    let myrepoSelectedSkill = null;
    let myrepoFilter = 'all';
    let myrepoCatFilter = '';
    let myrepoSearchQuery = '';
    let myrepoScopeFilter = '';
    let recentProjectsCache = [];
    let skillProjectLinks = {};
    let selectedProject = '';
    let myrepoViewMode = 'projects';
    var _collapsedGroups = {};
    let projectGroupsData = { groups: [], assignments: {}, projectOrder: [] };
    var _cachedProjectsWithSkills = {};

    let myrepoBatchMode = false;
    let myrepoBatchSelected = new Set();

    async function renderMyRepo() {
      const content = document.getElementById('content');
      await fetchOwnSkills(false);
      try { projectGroupsData = await api('/api/project-groups'); } catch(e) { projectGroupsData = { groups: [], assignments: {}, projectOrder: [] }; }
      const globalCount = allSkills.filter(function(s) { return s.source !== 'project-rules'; }).length;
      const uncatCount = allSkills.filter(function(s) { return s.categories.length === 0; }).length;

      var managedProjects = projectGroupsData.projectOrder || [];
      var projectSkillCounts = {};
      allSkills.forEach(function(s) {
        if (s.source === 'project-rules' && s.projectName) {
          if (!projectSkillCounts[s.projectName]) projectSkillCounts[s.projectName] = 0;
          projectSkillCounts[s.projectName]++;
        }
      });

      var groups = (projectGroupsData.groups || []).slice().sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
      var assignments = projectGroupsData.assignments || {};

      if (!selectedProject && myrepoViewMode !== 'global') {
        // ===== 项目网格首页 =====
        function buildProjectCard(proj) {
          var count = projectSkillCounts[proj] || 0;
          var shortName = proj.split('/').slice(-2).join('/');
          var eProj = escapeAttr(proj).replace(/'/g, "\\'");
          return '<div class="project-card" draggable="true" data-project="' + escapeAttr(proj) + '" onclick="selectProject(\'' + eProj + '\')" ondragstart="onProjectCardDragStart(event)" ondragend="onProjectCardDragEnd(event)" ondragover="onProjectCardDragOver(event)" ondrop="onProjectCardDrop(event)">'
            + '<div class="project-card-icon">' + (count > 0 ? '📁' : '📂') + '</div>'
            + '<div class="project-card-info">'
            +   '<div class="project-card-name">' + escapeHtml(shortName) + '</div>'
            +   '<div class="project-card-path" title="' + escapeAttr(proj) + '">' + escapeHtml(proj) + '</div>'
            +   '<div class="project-card-count">' + count + ' 个技能</div>'
            + '</div>'
            + '<button class="project-card-remove" onclick="event.stopPropagation(); removeManagedProjectUI(\'' + eProj + '\')" title="从列表移除">✕</button>'
            + '</div>';
        }

        var groupedHtml = '';
        var assignedSet = {};
        groups.forEach(function(g) {
          var gProjects = managedProjects.filter(function(p) { return assignments[p] === g.id; });
          gProjects.forEach(function(p) { assignedSet[p] = true; });
          var eGid = escapeAttr(g.id).replace(/'/g, "\\'");
          var isCollapsed = _collapsedGroups[g.id];
          groupedHtml += '<div class="project-group-section" data-group="' + escapeAttr(g.id) + '" ondragover="onGroupSectionDragOver(event)" ondragleave="onGroupSectionDragLeave(event)" ondrop="onGroupSectionDrop(event, \'' + eGid + '\')">'
            + '<div class="project-group-bar" onclick="toggleGroupCollapse(\'' + eGid + '\')" style="cursor:pointer">'
            +   '<span class="group-bar-toggle">' + (isCollapsed ? '▶' : '▼') + '</span>'
            +   '<span class="group-bar-icon">' + (g.icon || '📁') + '</span>'
            +   '<span class="group-bar-name" ondblclick="event.stopPropagation(); startRenameGroup(\'' + eGid + '\', this)">' + escapeHtml(g.name) + '</span>'
            +   '<span class="group-bar-count">' + gProjects.length + '</span>'
            +   '<button class="group-bar-del" onclick="event.stopPropagation(); deleteGroupInline(\'' + eGid + '\')" title="删除分组">✕</button>'
            + '</div>'
            + '<div class="project-cards-grid group-cards" id="groupCards_' + escapeAttr(g.id) + '" style="' + (isCollapsed ? 'display:none' : '') + '">';
          if (gProjects.length > 0) {
            gProjects.forEach(function(p) { groupedHtml += buildProjectCard(p); });
          } else {
            groupedHtml += '<div class="group-drop-hint">拖入项目到此分组</div>';
          }
          groupedHtml += '</div></div>';
        });

        var ungrouped = managedProjects.filter(function(p) { return !assignedSet[p]; });
        var ungroupedHtml = '';
        if (ungrouped.length > 0 || groups.length === 0) {
          if (groups.length > 0) {
            ungroupedHtml += '<div class="project-group-bar ungrouped-bar" ondragover="onGroupSectionDragOver(event)" ondragleave="onGroupSectionDragLeave(event)" ondrop="onGroupSectionDrop(event, \'\')">'
              + '<span class="group-bar-icon">📂</span><span class="group-bar-name">未分组</span><span class="group-bar-count">' + ungrouped.length + '</span></div>';
          }
          ungroupedHtml += '<div class="project-cards-grid" ondragover="onGroupSectionDragOver(event)" ondragleave="onGroupSectionDragLeave(event)" ondrop="onGroupSectionDrop(event, \'\')">';
          ungrouped.forEach(function(p) { ungroupedHtml += buildProjectCard(p); });
          ungroupedHtml += '</div>';
        }

        var emptyHtml = '';
        if (managedProjects.length === 0) {
          emptyHtml = '<div class="empty-state" style="padding:60px 20px; text-align:center">'
            + '<div style="font-size:48px; margin-bottom:16px">📂</div>'
            + '<p style="font-size:16px; font-weight:600; color:var(--text)">还没有管理的项目</p>'
            + '<p style="font-size:13px; color:var(--text2); margin-top:8px">点击上方 "扫描项目" 从 Cursor 历史中导入，或 "手动添加" 输入路径</p>'
            + '</div>';
        }

        content.innerHTML = '<div class="myrepo-layout view-content">'
          + '<div class="myrepo-toolbar">'
          +   '<div class="myrepo-scope-tabs">'
          +     '<button class="myrepo-scope-tab active">📁 项目管理</button>'
          +     '<button class="myrepo-scope-tab" onclick="myrepoViewMode=\'global\'; renderMyRepo()">📦 本地仓库 <b>' + globalCount + '</b></button>'
          +   '</div>'
          +   '<span style="flex:1"></span>'
          +   '<button class="myrepo-action-btn" onclick="openScanProjectsDrawer()">🔍 扫描项目</button>'
          +   '<button class="myrepo-action-btn" onclick="showAddProjectInput()">＋ 手动添加</button>'
          +   '<button class="myrepo-action-btn" onclick="showInlineGroupInput()">📁 新建分组</button>'
          +   '<button class="myrepo-action-btn" onclick="exportConfig()" title="导出技能配置备份">💾 导出</button>'
          +   '<input class="myrepo-search" id="myrepoSearch" placeholder="搜索项目..." oninput="filterProjectCards(this.value)" style="max-width:200px">'
          + '</div>'
          + '<div style="flex:1; overflow-y:auto; padding:20px">'
          +   groupedHtml + ungroupedHtml + emptyHtml
          + '</div>'
          + '</div>'
          + '<div class="detail-drawer-overlay" id="drawerOverlay" onclick="closeDrawer()"></div>'
          + '<div class="detail-drawer" id="detailDrawer"></div>';

      } else if (selectedProject) {
        // ===== 项目详情页 =====
        var projShort = selectedProject.split('/').slice(-2).join('/');
        var installedSkills = await api('/api/project-skills?projectPath=' + encodeURIComponent(selectedProject));
        if (!Array.isArray(installedSkills)) installedSkills = [];
        var availableSkills = allSkills;
        var installedNames = installedSkills.map(function(s) { return s.name; });

        content.innerHTML = '<div class="myrepo-layout view-content">'
          + '<div class="myrepo-toolbar">'
          +   '<button class="myrepo-back-btn" onclick="selectProject(\'\')" title="返回项目列表">← 返回</button>'
          +   '<div class="myrepo-project-title">'
          +     '<span style="font-size:20px">📁</span>'
          +     '<span>' + escapeHtml(projShort) + '</span>'
          +     '<span class="myrepo-project-count">' + installedSkills.length + ' 个技能</span>'
          +   '</div>'
          +   '<span style="flex:1"></span>'
          +   '<button class="myrepo-filter-btn" onclick="checkProjectUpdates()" title="检查更新" id="checkUpdatesBtn">🔄 检查更新</button>'
          +   '<button class="myrepo-filter-btn" onclick="refreshSkills()" title="刷新">🔄 刷新</button>'
          + '</div>'
          + '<div style="flex:1; overflow-y:auto; padding:20px">'
          +   '<div class="project-detail-section">'
          +     '<div class="section-header">'
          +       '<h3>📋 已安装的技能</h3>'
          +       '<span class="section-count">' + installedSkills.length + '</span>'
          +       '<span style="flex:1"></span>'
          +       (installedSkills.length > 0 ? '<button class="batch-toggle-btn" onclick="toggleBatchMode()" id="batchToggleBtn">☑ 批量管理</button>' : '')
          +     '</div>'
          +     '<div class="batch-bar" id="batchBar" style="display:none">'
          +       '<span id="batchSelectedCount">已选 0 项</span>'
          +       '<button class="batch-action-btn batch-select-all" onclick="batchSelectAll()">全选</button>'
          +       '<button class="batch-action-btn batch-deselect" onclick="batchDeselectAll()">取消全选</button>'
          +       '<button class="batch-action-btn batch-delete-btn" onclick="batchRemoveSelected()">🗑 批量删除</button>'
          +     '</div>'
          +     '<div class="myrepo-grid" id="installedGrid">'
          +       (installedSkills.length > 0
                    ? installedSkills.map(function(s) { return renderProjectSkillCard(s, true); }).join('')
                    : '<div class="empty-msg" style="grid-column:1/-1">此项目还没有安装任何技能</div>')
          +     '</div>'
          +   '</div>'
          +   '<div class="project-detail-section" style="margin-top:28px">'
          +     '<div class="section-header">'
          +       '<h3>📥 本地仓库</h3>'
          +       '<span class="section-count">' + availableSkills.length + '</span>'
          +       '<input type="text" class="section-search" id="availableSearch" placeholder="搜索技能..." oninput="filterAvailableSkills(this.value)">'
          +     '</div>'
          +     '<div class="myrepo-grid" id="availableGrid">'
          +       (availableSkills.length > 0
                    ? availableSkills.map(function(s) {
                        var already = installedNames.indexOf(s.name) >= 0;
                        return renderProjectSkillCard(s, false, already);
                      }).join('')
                    : '<div class="empty-msg" style="grid-column:1/-1">本地仓库为空，请先从社区下载技能</div>')
          +     '</div>'
          +   '</div>'
          + '</div>'
          + '</div>'
          + '<div class="detail-drawer-overlay" id="drawerOverlay" onclick="closeDrawer()"></div>'
          + '<div class="detail-drawer" id="detailDrawer"></div>';

      } else {
        // ===== 本地仓库视图 =====
        content.innerHTML = '<div class="myrepo-layout view-content">'
          + '<div class="myrepo-toolbar">'
          +   '<div class="myrepo-scope-tabs">'
          +     '<button class="myrepo-scope-tab" onclick="myrepoViewMode=\'projects\'; renderMyRepo()">📁 项目管理</button>'
          +     '<button class="myrepo-scope-tab active">📦 本地仓库 <b>' + allSkills.length + '</b></button>'
          +   '</div>'
          +   '<input class="myrepo-search" id="myrepoSearch" placeholder="搜索技能名称、标签..." oninput="debouncedMyRepoSearch(this.value)">'
          +   '<button class="myrepo-filter-btn" onclick="showCatManagerDrawer()" title="分类管理">🏷️ 分类管理</button>'
          +   '<button class="myrepo-filter-btn" onclick="refreshSkills()" title="刷新">🔄 刷新</button>'
          + '</div>'
          + '<div style="flex:1; overflow-y:auto">'
          +   '<div class="myrepo-filter-bar">'
          +     '<select onchange="myrepoCatFilter=this.value; renderMyRepoList()">'
          +       '<option value="">全部分类</option>'
          +       '<option value="__uncategorized__">📭 未分类 (' + uncatCount + ')</option>'
          +       userCategories.map(function(uc) {
                    var cnt = allSkills.filter(function(s) { return s.categories.indexOf(uc.id) >= 0; }).length;
                    return '<option value="' + escapeAttr(uc.id) + '">' + escapeHtml((uc.icon || '') + ' ' + uc.label) + ' (' + cnt + ')</option>';
                  }).join('')
          +     '</select>'
          +     '<span style="flex:1"></span>'
          +     '<span style="font-size:11px; color:var(--text2)" id="myrepoResultCount"></span>'
          +   '</div>'
          +   '<div class="myrepo-grid" id="myrepoGrid"></div>'
          + '</div>'
          + '</div>'
          + '<div class="detail-drawer-overlay" id="drawerOverlay" onclick="closeDrawer()"></div>'
          + '<div class="detail-drawer" id="detailDrawer"></div>';

        renderMyRepoList();
      }
    }

    function setScopeTab(scope) {
      myrepoScopeFilter = scope;
      document.querySelectorAll('.myrepo-scope-tab').forEach(function(el) { el.classList.remove('active'); });
      var tabs = document.querySelectorAll('.myrepo-scope-tab');
      if (scope === '') tabs[0] && tabs[0].classList.add('active');
      else if (scope === 'global') tabs[1] && tabs[1].classList.add('active');
      else if (scope === 'project') tabs[2] && tabs[2].classList.add('active');
      renderMyRepoList();
    }

    function toggleGroupCollapse(groupId) {
      _collapsedGroups[groupId] = !_collapsedGroups[groupId];
      var cards = document.getElementById('groupCards_' + groupId);
      var section = cards ? cards.closest('.project-group-section') : null;
      var toggle = section ? section.querySelector('.group-bar-toggle') : null;
      if (cards) {
        cards.style.display = _collapsedGroups[groupId] ? 'none' : '';
      }
      if (toggle) {
        toggle.textContent = _collapsedGroups[groupId] ? '▶' : '▼';
      }
    }

    function selectProject(proj) {
      selectedProject = proj;
      myrepoViewMode = proj ? 'project-detail' : 'projects';
      renderMyRepo();
    }

    function closeDrawer() {
      var overlay = document.getElementById('drawerOverlay');
      var drawer = document.getElementById('detailDrawer');
      if (overlay) overlay.classList.remove('open');
      if (drawer) { drawer.classList.remove('open', 'drawer-flex'); }
      myrepoSelectedSkill = null;
    }

    async function refreshSkills() {
      try {
        await api('/api/rescan');
        allSkills = await api('/api/skills');
        categories = await api('/api/categories');
        userCategories = await api('/api/categories/list');
        renderMyRepo();
      } catch(e) { alert('刷新失败: ' + e.message); }
    }

    function showCatManagerDrawer() {
      myrepoSelectedSkill = null;
      showView('catmgr');
    }

    async function showCatManagerInMyRepo() {
      myrepoSelectedSkill = null;
      var drawer = document.getElementById('detailDrawer');
      var overlay = document.getElementById('drawerOverlay');
      if (!drawer) return;
      userCategories = await api('/api/categories/list');
      var roots = userCategories.filter(function(c) { return !c.parentId; });

      function renderCatRowInline(cat, indent) {
        indent = indent || 0;
        var children = userCategories.filter(function(c) { return c.parentId === cat.id; });
        var skillCount = allSkills.filter(function(s) { return s.categories.indexOf(cat.id) >= 0; }).length;
        var html = '<div style="display:flex; align-items:center; gap:6px; padding:8px 12px; padding-left:' + (12 + indent * 20) + 'px; border-radius:12px; border:1.5px solid var(--border2); background:var(--bg2); margin-bottom:4px">'
          + '<span style="font-size:16px">' + (cat.icon || '📦') + '</span>'
          + '<span style="flex:1; font-family:var(--font-display); font-size:13px">' + escapeHtml(cat.label) + '</span>'
          + '<span class="count" style="font-size:10px">' + skillCount + '</span>'
          + '<button class="btn" style="padding:3px 8px; font-size:10px" onclick="addSubCategory(\'' + escapeAttr(cat.id) + '\')">➕</button>'
          + '<button class="btn" style="padding:3px 8px; font-size:10px" onclick="renameCategoryPrompt(\'' + escapeAttr(cat.id) + '\', \'' + escapeAttr(cat.label) + '\', \'' + escapeAttr(cat.icon || '') + '\')">✏️</button>'
          + '<button class="btn btn-red" style="padding:3px 8px; font-size:10px" onclick="deleteCategoryConfirm(\'' + escapeAttr(cat.id) + '\')">🗑️</button>'
          + '</div>';
        for (var i = 0; i < children.length; i++) {
          html += renderCatRowInline(children[i], indent + 1);
        }
        return html;
      }

      var html = '<div style="padding:24px; overflow-y:auto; height:100%">'
        + '<div style="font-family:var(--font-display); font-size:18px; margin-bottom:12px">🏷️ 分类管理</div>'
        + '<p style="color:var(--text2); margin-bottom:12px; font-size:12px">创建分类后可在技能详情中为技能添加分类标签。</p>'
        + '<div style="display:flex; gap:6px; margin-bottom:16px; align-items:stretch">'
        + '<input type="text" id="newCatLabel" placeholder="分类名称" style="flex:1; padding:10px 16px; border-radius:24px; border:2px solid var(--border); background:var(--surface); font-size:13px; font-family:var(--font-body); outline:none" onkeydown="if(event.key===\'Enter\') addRootCategoryInMyRepo()">'
        + '<input type="text" id="newCatIcon" placeholder="图标" value="" maxlength="2" style="width:50px; padding:10px; border-radius:24px; border:2px solid var(--border); background:var(--surface); font-size:16px; text-align:center; outline:none">'
        + '<button class="btn btn-green" onclick="addRootCategoryInMyRepo()" style="white-space:nowrap; font-size:12px; padding:8px 14px">➕ 添加</button>'
        + '</div>'
        + '<div id="catListInMyRepo">'
        + (roots.length > 0 ? roots.map(function(c) { return renderCatRowInline(c); }).join('') : '<div class="empty-state" style="padding:20px"><div class="icon">📭</div><p>暂无分类</p></div>')
        + '</div>';

      var uncategorized = allSkills.filter(function(s) { return s.categories.length === 0; });
      if (uncategorized.length > 0) {
        html += '<div style="margin-top:16px; padding-top:12px; border-top:2px dashed var(--border2)">'
          + '<div style="font-family:var(--font-display); font-size:14px; color:var(--orange); margin-bottom:8px">📭 未分类 (' + uncategorized.length + ')</div>'
          + '<div style="display:flex; flex-wrap:wrap; gap:4px">'
          + uncategorized.map(function(s) { return '<span class="tag" style="font-size:11px; padding:3px 10px">' + escapeHtml(s.name) + '</span>'; }).join('')
          + '</div></div>';
      }

      html += '</div>';
      drawer.innerHTML = '<button class="drawer-close" onclick="closeDrawer()" title="关闭">✕</button>' + html;
      drawer.classList.add('open');
      if (overlay) overlay.classList.add('open');
    }

    async function addRootCategoryInMyRepo() {
      var label = document.getElementById('newCatLabel').value.trim();
      var icon = document.getElementById('newCatIcon').value.trim();
      if (!label) return;
      await api('/api/categories/add?label=' + encodeURIComponent(label) + '&icon=' + encodeURIComponent(icon));
      document.getElementById('newCatLabel').value = '';
      document.getElementById('newCatIcon').value = '';
      allSkills = await api('/api/skills');
      categories = await api('/api/categories');
      userCategories = await api('/api/categories/list');
      showCatManagerInMyRepo();
    }

    function getInstallModeBadge(mode) {
      var map = {
        'global-skill': { label: '全局 Skill', cls: 'badge-global-skill', icon: '🌐' },
        'cursorrules': { label: '.cursorrules', cls: 'badge-cursorrules', icon: '📋' },
        'rule-always': { label: 'Always Rule', cls: 'badge-rule-always', icon: '📌' },
        'rule-auto': { label: 'Auto Rule', cls: 'badge-rule-auto', icon: '🎯' },
        'rule-agent': { label: 'Agent Rule', cls: 'badge-rule-agent', icon: '🤖' },
        'rule-manual': { label: 'Manual Rule', cls: 'badge-rule-manual', icon: '✋' },
        'rule-smart': { label: 'Agent Rule', cls: 'badge-rule-agent', icon: '🤖' },
        'project-skill': { label: 'Agent Rule', cls: 'badge-rule-agent', icon: '🤖' }
      };
      var info = map[mode];
      if (!info) return '';
      return '<span class="install-mode-badge ' + info.cls + '">' + info.icon + ' ' + info.label + '</span>';
    }

    function renderProjectSkillCard(s, isInstalled, alreadyInstalled) {
      var showName = s.displayName || s.name;
      var desc = s.customDescription || s.description || '暂无描述';
      if (desc.length > 100) desc = desc.substring(0, 100) + '...';
      var isProject = s.source === 'project-rules';
      var isLocalRepo = s.source === 'local-repo';
      var scopeClass = isProject ? 'scope-project' : (isLocalRepo ? 'scope-local-repo' : 'scope-global');
      var scopeIcon = isProject ? '📁' : (isLocalRepo ? '📥' : '🌐');
      var eName = escapeAttr(s.name).replace(/'/g, "\\'");

      var modeBadge = (isInstalled && s.installMode) ? getInstallModeBadge(s.installMode) : '';

      var actionHtml = '';
      if (isInstalled) {
        actionHtml = '<div class="card-actions" style="display:flex">'
          + '<button class="card-action-btn" onclick="event.stopPropagation(); removeSkillFromProject(\'' + eName + '\')" title="从项目移除" style="background:rgba(229,57,53,0.08)">🗑 移除</button>'
          + '</div>';
      } else if (alreadyInstalled) {
        actionHtml = '<div class="card-installed-badge">✓ 已安装</div>';
      } else {
        actionHtml = '<div class="card-actions" style="display:flex">'
          + '<button class="card-action-btn card-add-btn" onclick="event.stopPropagation(); addSkillToCurrentProject(\'' + eName + '\', this)" title="添加到项目">＋ 添加</button>'
          + '</div>';
      }

      return '<div class="skill-card ' + scopeClass + (alreadyInstalled ? ' already-in-project' : '') + '" data-skill="' + escapeAttr(s.name) + '" onclick="showMyRepoDetail(\'' + eName + '\')">'
        + actionHtml
        + '<div class="card-header">'
        +   '<div class="card-scope">' + scopeIcon + '</div>'
        +   '<div class="card-name">' + escapeHtml(showName) + '</div>'
        + '</div>'
        + (modeBadge ? '<div class="card-mode-row">' + modeBadge + '</div>' : '')
        + '<div class="card-desc">' + escapeHtml(desc) + '</div>'
        + '<div class="card-tags">'
        +   s.categories.map(function(cid) {
              var cat = userCategories.find(function(uc) { return uc.id === cid; });
              return cat ? '<span class="card-tag" style="background:rgba(99,102,241,0.08); color:#6366f1">' + escapeHtml((cat.icon || '') + ' ' + cat.label) + '</span>' : '';
            }).join('')
        + '</div>'
        + '</div>';
    }

    async function showMyRepoDetail(skillName) {
      var drawer = document.getElementById('detailDrawer');
      var overlay = document.getElementById('drawerOverlay');
      if (!drawer || !overlay) return;
      drawer.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:200px; color:var(--text2)"><span style="animation:spin 1s linear infinite; display:inline-block; font-size:24px">⏳</span></div>';
      drawer.classList.add('open', 'drawer-flex');
      overlay.classList.add('open');

      try {
        var data = await api('/api/skill?name=' + encodeURIComponent(skillName));
        if (data.error) {
          drawer.innerHTML = '<div class="drawer-header"><h2>技能详情</h2><button class="drawer-close" onclick="closeDrawer()">✕</button></div>'
            + '<div class="drawer-body" style="padding:24px; text-align:center; color:var(--text2)"><div style="font-size:32px; margin-bottom:12px">❌</div>' + escapeHtml(data.error) + '</div>';
          return;
        }

        var showTitle = data.displayName || data.name;
        var isProject = data.source === 'project-rules';
        var isLocalRepo = data.source === 'local-repo';
        var scopeLabel = isProject ? '📁 项目级' : (isLocalRepo ? '📥 本地仓库' : '🌐 全局');
        var modeBadge = data.installMode ? getInstallModeBadge(data.installMode) : '';
        var eName = escapeAttr(data.name).replace(/'/g, "\\'");

        var contentPreview = data.content || '';
        if (contentPreview.length > 3000) contentPreview = contentPreview.substring(0, 3000) + '\n\n... (内容已截断)';

        var html = '<div class="drawer-header">'
          + '<h2>' + escapeHtml(showTitle) + '</h2>'
          + '<button class="drawer-close" onclick="closeDrawer()">✕</button>'
          + '</div>'
          + '<div class="drawer-body" style="padding:20px; overflow-y:auto">'
          + '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px">'
          +   '<span class="tag" style="background:rgba(34,139,230,0.08); color:#228be6; font-weight:600">' + scopeLabel + '</span>'
          +   '<span class="tag tokens">~' + (data.tokenEstimate || 0) + ' tokens</span>'
          +   modeBadge
          + '</div>'
          + '<p style="color:var(--text2); font-size:13px; line-height:1.6; margin-bottom:12px">' + escapeHtml(data.customDescription || data.description || '暂无描述') + '</p>'
          + '<div style="font-size:11px; color:var(--text2); margin-bottom:16px">📂 ' + escapeHtml(data.path || '') + '</div>';

        if (!isProject && selectedProject) {
          html += '<div style="margin-bottom:16px; padding:12px; background:var(--bg2); border-radius:12px; border:1.5px solid var(--border2)">'
            + '<div style="font-size:13px; font-weight:600; margin-bottom:8px">添加到当前项目</div>'
            + '<button class="btn-install" style="font-size:12px; padding:6px 14px; margin-right:6px" onclick="addSkillToCurrentProject(\'' + eName + '\', this)">＋ 选择模式并添加</button>'
            + '</div>';
        }

        html += '<div style="background:var(--bg2); border:2px solid var(--border2); border-radius:14px; padding:16px">'
          + '<div style="font-size:13px; font-weight:600; margin-bottom:10px">📄 SKILL.md 内容预览</div>'
          + '<pre style="white-space:pre-wrap; word-break:break-word; font-size:12px; line-height:1.6; max-height:50vh; overflow-y:auto; color:var(--text); background:var(--surface); padding:12px; border-radius:10px; border:1px solid var(--border2)">' + escapeHtml(contentPreview) + '</pre>'
          + '</div>'
          + '<div style="margin-top:12px; display:flex; gap:8px">'
          + '<button class="action-btn action-export" onclick="navigator.clipboard.writeText(\'' + escapeAttr(contentPreview).replace(/'/g, "\\'").replace(/\n/g, '\\n') + '\').then(function(){showToast({tool:\'copy\',resultSummary:\'已复制内容\',timestamp:new Date().toISOString()})})"><span class="action-icon">📋</span> 复制全文</button>'
          + '</div></div>';

        drawer.innerHTML = html;
      } catch (e) {
        drawer.innerHTML = '<div class="drawer-header"><h2>错误</h2><button class="drawer-close" onclick="closeDrawer()">✕</button></div>'
          + '<div class="drawer-body" style="padding:24px; color:red">加载失败: ' + escapeHtml(String(e)) + '</div>';
      }
    }

    function filterProjectCards(query) {
      var grid = document.getElementById('projectCardsGrid');
      if (!grid) return;
      var q = query.toLowerCase().trim();
      var cards = grid.querySelectorAll('.project-card');
      cards.forEach(function(card) {
        var name = card.querySelector('.project-card-name').textContent.toLowerCase();
        card.style.display = (!q || name.indexOf(q) >= 0) ? '' : 'none';
      });
    }

    function filterAvailableSkills(query) {
      var grid = document.getElementById('availableGrid');
      if (!grid) return;
      var q = query.toLowerCase().trim();
      var cards = grid.querySelectorAll('.skill-card');
      cards.forEach(function(card) {
        var name = (card.querySelector('.card-name') || {}).textContent || '';
        var desc = (card.querySelector('.card-desc') || {}).textContent || '';
        var match = !q || name.toLowerCase().indexOf(q) >= 0 || desc.toLowerCase().indexOf(q) >= 0;
        card.style.display = match ? '' : 'none';
      });
    }

    function addSkillToCurrentProject(skillName, btnEl) {
      if (!selectedProject) return;
      var existing = allSkills.find(function(s) {
        return s.source === 'project-rules' && s.projectName === selectedProject && s.name === skillName;
      });
      if (existing) {
        var modeLabel = {
          'global-skill': '全局 Skill', 'cursorrules': '.cursorrules',
          'rule-always': 'Always Rule', 'rule-auto': 'Auto Rule',
          'rule-agent': 'Agent Rule', 'rule-manual': 'Manual Rule',
          'rule-smart': 'Agent Rule', 'project-skill': 'Agent Rule'
        }[existing.installMode] || '未知模式';
        if (!confirm('⚠️ "' + skillName + '" 已以「' + modeLabel + '」模式安装在此项目中。\n\n重新安装将覆盖现有文件，是否继续？')) return;
      }
      showAddSkillModeDialog(skillName, btnEl);
    }

    function showAddSkillModeDialog(skillName, btnEl) {
      var overlay = document.getElementById('drawerOverlay');
      var drawer = document.getElementById('detailDrawer');
      if (!overlay || !drawer) return;
      overlay.classList.add('open');
      drawer.classList.add('open', 'drawer-flex');
      var eName = escapeAttr(skillName).replace(/'/g, "\\'");
      drawer.innerHTML = '<div class="drawer-header"><h2>添加 "' + escapeHtml(skillName) + '"</h2><button class="drawer-close" onclick="closeDrawer()">✕</button></div>'
        + '<div class="drawer-body" style="padding:24px">'
        +   '<div class="mode-compare-hint">'
        +     '<div class="compare-row"><span class="compare-label">模式</span><span class="compare-label">存储位置</span><span class="compare-label">触发方式</span><span class="compare-label">Token</span></div>'
        +     '<div class="compare-row"><span>全局 Skill</span><span>~/.cursor/skills/</span><span>Agent 按需</span><span style="color:#22c55e">省</span></div>'
        +     '<div class="compare-row"><span>.cursorrules</span><span>项目根目录</span><span>始终生效</span><span style="color:#ef4444">多</span></div>'
        +     '<div class="compare-row"><span>Always</span><span>.cursor/rules/</span><span>始终注入</span><span style="color:#ef4444">多</span></div>'
        +     '<div class="compare-row"><span>Auto</span><span>.cursor/rules/</span><span>文件匹配</span><span style="color:#f59e0b">中</span></div>'
        +     '<div class="compare-row"><span>Agent</span><span>.cursor/rules/</span><span>Agent 按需</span><span style="color:#22c55e">省</span></div>'
        +     '<div class="compare-row"><span>Manual</span><span>.cursor/rules/</span><span>@引用</span><span style="color:#22c55e">省</span></div>'
        +   '</div>'
        +   '<div class="mode-option" onclick="doAddSkill(\'' + eName + '\', \'global-skill\')">'
        +     '<div class="mode-option-icon">🌐</div>'
        +     '<div class="mode-option-info">'
        +       '<div class="mode-option-title">全局 Skill <span style="font-size:10px; color:white; background:#22c55e; padding:1px 6px; border-radius:10px">推荐</span></div>'
        +       '<div class="mode-option-desc">~/.cursor/skills/，Agent 按需加载，跨项目共享</div>'
        +     '</div>'
        +   '</div>'
        +   '<div class="mode-option" onclick="doAddSkillWithOptions(\'' + eName + '\', \'cursorrules\')">'
        +     '<div class="mode-option-icon">📋</div>'
        +     '<div class="mode-option-info">'
        +       '<div class="mode-option-title">.cursorrules 项目规则</div>'
        +       '<div class="mode-option-desc">项目根目录，始终生效，优先级最高</div>'
        +     '</div>'
        +   '</div>'
        +   '<div class="mode-option" onclick="doAddSkill(\'' + eName + '\', \'rule-always\')">'
        +     '<div class="mode-option-icon">📌</div>'
        +     '<div class="mode-option-info">'
        +       '<div class="mode-option-title">Always Rule</div>'
        +       '<div class="mode-option-desc">.cursor/rules/，始终注入 AI 上下文</div>'
        +     '</div>'
        +   '</div>'
        +   '<div class="mode-option" onclick="doAddSkillWithOptions(\'' + eName + '\', \'rule-auto\')">'
        +     '<div class="mode-option-icon">🎯</div>'
        +     '<div class="mode-option-info">'
        +       '<div class="mode-option-title">Auto Rule</div>'
        +       '<div class="mode-option-desc">.cursor/rules/，匹配文件模式时自动激活</div>'
        +     '</div>'
        +   '</div>'
        +   '<div class="mode-option" onclick="doAddSkill(\'' + eName + '\', \'rule-agent\')">'
        +     '<div class="mode-option-icon">🤖</div>'
        +     '<div class="mode-option-info">'
        +       '<div class="mode-option-title">Agent Rule</div>'
        +       '<div class="mode-option-desc">.cursor/rules/，Agent 根据描述按需加载</div>'
        +     '</div>'
        +   '</div>'
        +   '<div class="mode-option" onclick="doAddSkill(\'' + eName + '\', \'rule-manual\')">'
        +     '<div class="mode-option-icon">✋</div>'
        +     '<div class="mode-option-info">'
        +       '<div class="mode-option-title">Manual Rule</div>'
        +       '<div class="mode-option-desc">.cursor/rules/，用户 @引用时才加载</div>'
        +     '</div>'
        +   '</div>'
        + '</div>';
    }

    function doAddSkillWithOptions(skillName, mode) {
      var body = document.querySelector('.detail-drawer .drawer-body');
      if (!body) return;
      var eName = escapeAttr(skillName).replace(/'/g, "\\'");
      var fields = '';
      if (mode === 'rule-auto') {
        fields = '<div style="margin-bottom:16px">'
          + '<label style="font-size:12px; color:var(--text2); display:block; margin-bottom:6px">Globs 文件匹配模式</label>'
          + '<input type="text" id="addSkillGlobs" placeholder="例如: *.py, *.ts" style="width:100%; padding:8px 12px; border-radius:10px; border:1.5px solid rgba(0,0,0,0.08); font-size:12px; font-family:monospace; outline:none; box-sizing:border-box">'
          + '<div style="display:flex; gap:5px; margin-top:6px; flex-wrap:wrap">'
          + ['*.py','*.ts','*.tsx','*.js','*.java','*.go','*.rs','*.css'].map(function(g) {
              return '<span style="font-size:11px; padding:3px 10px; border-radius:12px; background:var(--bg2,#f5f5f5); border:1px solid var(--border2,#e0e0e0); cursor:pointer; color:var(--text2)" onclick="var i=document.getElementById(\'addSkillGlobs\'); i.value=i.value?(i.value+\','+g+'\'):\''+g+'\'">' + g + '</span>';
            }).join('')
          + '</div></div>';
      }
      if (mode === 'cursorrules') {
        fields = '<div style="margin-bottom:16px">'
          + '<label style="font-size:12px; color:var(--text2); display:block; margin-bottom:6px">写入方式</label>'
          + '<div style="display:flex; gap:12px">'
          + '<label style="font-size:12px; display:flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" name="addSkillWriteMode" value="append" checked> 追加到末尾</label>'
          + '<label style="font-size:12px; display:flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" name="addSkillWriteMode" value="replace"> 替换整个文件</label>'
          + '</div></div>';
      }
      body.innerHTML = '<p style="font-size:14px; font-weight:600; margin-bottom:16px">' + (mode === 'rule-auto' ? 'Auto Rule 配置' : '.cursorrules 配置') + '</p>'
        + fields
        + '<button class="primary-btn" onclick="var extra=\'\'; var gEl=document.getElementById(\'addSkillGlobs\'); if(gEl&&gEl.value.trim()) extra+=\'&globs=\'+encodeURIComponent(gEl.value.trim()); var wmR=document.querySelector(\'input[name=addSkillWriteMode]:checked\'); if(wmR) extra+=\'&writeMode=\'+wmR.value; doAddSkill(\'' + eName + '\', \'' + mode + '\', extra)">确认添加</button>';
    }

    async function doAddSkill(skillName, mode, extraParams) {
      closeDrawer();
      try {
        var result = await api('/api/skill/copy-to-project?name=' + encodeURIComponent(skillName) + '&projectPath=' + encodeURIComponent(selectedProject) + '&mode=' + mode + (extraParams || ''));
        if (result.success) {
          allSkills = await api('/api/skills');
          document.getElementById('totalCount').textContent = allSkills.length;
          renderMyRepo();
        } else {
          alert('添加失败: ' + (result.message || ''));
        }
      } catch(err) {
        alert('添加出错');
      }
    }

    async function removeSkillFromProject(skillName, skipConfirm) {
      if (!selectedProject) return;
      if (!skipConfirm && !confirm('确定从此项目移除 "' + skillName + '" 吗？')) return;
      try {
        var result = await api('/api/skill/delete?name=' + encodeURIComponent(skillName) + '&projectPath=' + encodeURIComponent(selectedProject));
        if (result.success) {
          allSkills = await api('/api/skills');
          document.getElementById('totalCount').textContent = allSkills.length;
          if (!skipConfirm) renderMyRepo();
        } else {
          if (!skipConfirm) alert('移除失败: ' + (result.message || ''));
        }
      } catch(err) {}
    }

    async function openScanProjectsDrawer() {
      var overlay = document.getElementById('drawerOverlay');
      var drawer = document.getElementById('detailDrawer');
      if (!overlay || !drawer) return;
      overlay.classList.add('open');
      drawer.classList.add('open', 'drawer-flex');
      drawer.innerHTML = '<div class="drawer-header"><h2>🔍 扫描项目</h2><button class="drawer-close" onclick="closeDrawer()">✕</button></div>'
        + '<div class="drawer-body"><div style="text-align:center; padding:40px"><div class="spinner"></div><p style="margin-top:12px; color:var(--text2)">正在扫描 Cursor 历史项目...</p></div></div>';
      try {
        var result = await api('/api/managed-projects/scan');
        var allScanned = result.scanned || [];
        var managed = result.managed || [];
        var html = '<div class="drawer-header"><h2>🔍 扫描到的项目</h2><button class="drawer-close" onclick="closeDrawer()">✕</button></div>'
          + '<div class="drawer-body" style="padding:16px">'
          + '<p style="font-size:12px; color:var(--text2); margin-bottom:12px">共扫描到 ' + allScanned.length + ' 个项目，勾选后点击底部按钮添加</p>'
          + '<div id="scanProjectList">';
        allScanned.forEach(function(p) {
          var isManaged = managed.indexOf(p) >= 0;
          var shortName = p.split('/').slice(-2).join('/');
          var ep = escapeAttr(p);
          html += '<label class="scan-project-item' + (isManaged ? ' already-managed' : '') + '">'
            + '<input type="checkbox" value="' + ep + '"' + (isManaged ? ' checked disabled' : '') + '>'
            + '<div class="scan-project-info">'
            +   '<span class="scan-project-name">' + escapeHtml(shortName) + '</span>'
            +   '<span class="scan-project-path">' + escapeHtml(p) + '</span>'
            + '</div>'
            + (isManaged ? '<span class="scan-badge">已添加</span>' : '')
            + '</label>';
        });
        if (allScanned.length === 0) {
          html += '<p style="text-align:center; color:var(--text2); padding:20px">未扫描到项目</p>';
        }
        html += '</div></div>'
          + '<div class="drawer-footer"><button class="primary-btn" onclick="addSelectedScannedProjects()">添加选中的项目</button></div>';
        drawer.innerHTML = html;
      } catch(err) {
        drawer.innerHTML = '<div class="drawer-header"><h2>扫描失败</h2><button class="drawer-close" onclick="closeDrawer()">✕</button></div>'
          + '<div class="drawer-body"><p style="color:red; padding:20px">' + String(err) + '</p></div>';
      }
    }

    async function addSelectedScannedProjects() {
      var checkboxes = document.querySelectorAll('#scanProjectList input[type="checkbox"]:checked:not(:disabled)');
      var count = 0;
      for (var i = 0; i < checkboxes.length; i++) {
        var path = checkboxes[i].value;
        await api('/api/managed-projects/add?path=' + encodeURIComponent(path));
        count++;
      }
      closeDrawer();
      if (count > 0) renderMyRepo();
    }

    async function showAddProjectInput() {
      var existing = document.getElementById('addProjectModal');
      if (existing) { existing.remove(); return; }

      var recent = [];
      try { recent = await api('/api/recent-projects'); } catch {}

      var managedSet = {};
      try { var mp = await api('/api/managed-projects/list'); (mp || []).forEach(function(p) { managedSet[p] = true; }); } catch {}
      var candidates = recent.filter(function(p) { return !managedSet[p]; });

      var modal = document.createElement('div');
      modal.id = 'addProjectModal';
      modal.className = 'add-project-modal-overlay';
      var candHtml = '';
      if (candidates.length > 0) {
        candHtml = '<div class="add-project-recent-title">📂 从 Cursor 历史项目中选择</div>'
          + '<div class="add-project-recent-list">'
          + candidates.map(function(p) {
              var short = p.split('/').slice(-2).join('/');
              return '<div class="add-project-recent-item" onclick="selectRecentProject(this, \'' + escapeAttr(p).replace(/'/g, "\\'") + '\')">'
                + '<span class="add-project-recent-path">' + escapeHtml(short) + '</span>'
                + '<span class="add-project-recent-full">' + escapeHtml(p) + '</span>'
                + '</div>';
            }).join('')
          + '</div>';
      }

      modal.innerHTML = '<div class="add-project-modal">'
        + '<div class="add-project-modal-header">'
        +   '<h3>添加项目</h3>'
        +   '<button class="drawer-close" onclick="document.getElementById(\'addProjectModal\').remove()">✕</button>'
        + '</div>'
        + '<div class="add-project-modal-body">'
        +   '<div class="add-project-input-row">'
        +     '<input type="text" id="addProjectPathInput" class="add-project-path-input" placeholder="/home/user/my-project" list="addProjectDatalist" autocomplete="off">'
        +     '<datalist id="addProjectDatalist">'
        +       candidates.map(function(p) { return '<option value="' + escapeAttr(p) + '">'; }).join('')
        +     '</datalist>'
        +     '<button class="btn-install" id="addProjectConfirmBtn" onclick="confirmAddProject()">添加</button>'
        +   '</div>'
        +   candHtml
        + '</div>'
        + '</div>';
      document.body.appendChild(modal);
      var inp = document.getElementById('addProjectPathInput');
      if (inp) {
        inp.focus();
        inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') confirmAddProject(); if (e.key === 'Escape') modal.remove(); });
      }
    }

    function selectRecentProject(el, path) {
      var inp = document.getElementById('addProjectPathInput');
      if (inp) inp.value = path;
      var items = document.querySelectorAll('.add-project-recent-item');
      items.forEach(function(it) { it.classList.remove('selected'); });
      el.classList.add('selected');
    }

    async function confirmAddProject() {
      var inp = document.getElementById('addProjectPathInput');
      if (!inp) return;
      var path = inp.value.trim();
      if (!path) { inp.classList.add('shake'); setTimeout(function() { inp.classList.remove('shake'); }, 500); return; }
      var btn = document.getElementById('addProjectConfirmBtn');
      if (btn) { btn.disabled = true; btn.textContent = '添加中...'; }
      try {
        await api('/api/managed-projects/add?path=' + encodeURIComponent(path));
        var modal = document.getElementById('addProjectModal');
        if (modal) modal.remove();
        renderMyRepo();
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = '添加'; }
        alert('添加失败: ' + e.message);
      }
    }

    var batchMode = false;
    var batchSelected = new Set();

    function toggleBatchMode() {
      batchMode = !batchMode;
      var btn = document.getElementById('batchToggleBtn');
      var bar = document.getElementById('batchBar');
      var grid = document.getElementById('installedGrid');
      if (btn) btn.classList.toggle('active', batchMode);
      if (bar) bar.style.display = batchMode ? 'flex' : 'none';
      batchSelected.clear();
      updateBatchCount();
      if (grid) {
        var cards = grid.querySelectorAll('.skill-card');
        cards.forEach(function(card) {
          if (batchMode) {
            card.classList.add('batch-mode');
            if (!card.querySelector('.batch-checkbox')) {
              var cb = document.createElement('div');
              cb.className = 'batch-checkbox';
              card.insertBefore(cb, card.firstChild);
            }
            card._origOnclick = card.getAttribute('onclick');
            card.setAttribute('onclick', 'toggleBatchSelect(this)');
          } else {
            card.classList.remove('batch-mode', 'batch-selected');
            var cb = card.querySelector('.batch-checkbox');
            if (cb) cb.remove();
            if (card._origOnclick) card.setAttribute('onclick', card._origOnclick);
          }
        });
      }
    }

    function toggleBatchSelect(card) {
      var name = card.getAttribute('data-skill');
      if (batchSelected.has(name)) {
        batchSelected.delete(name);
        card.classList.remove('batch-selected');
      } else {
        batchSelected.add(name);
        card.classList.add('batch-selected');
      }
      updateBatchCount();
    }

    function updateBatchCount() {
      var el = document.getElementById('batchSelectedCount');
      if (el) el.textContent = '已选 ' + batchSelected.size + ' 项';
    }

    function batchSelectAll() {
      var grid = document.getElementById('installedGrid');
      if (!grid) return;
      grid.querySelectorAll('.skill-card.batch-mode').forEach(function(card) {
        var name = card.getAttribute('data-skill');
        batchSelected.add(name);
        card.classList.add('batch-selected');
      });
      updateBatchCount();
    }

    function batchDeselectAll() {
      batchSelected.clear();
      var grid = document.getElementById('installedGrid');
      if (grid) grid.querySelectorAll('.skill-card.batch-selected').forEach(function(c) { c.classList.remove('batch-selected'); });
      updateBatchCount();
    }

    async function batchRemoveSelected() {
      if (batchSelected.size === 0) return;
      if (!confirm('确定删除选中的 ' + batchSelected.size + ' 个技能？')) return;
      var names = Array.from(batchSelected);
      for (var i = 0; i < names.length; i++) {
        try { await removeSkillFromProject(names[i], true); } catch {}
      }
      batchMode = false;
      batchSelected.clear();
      allSkills = await api('/api/skills');
      renderMyRepo();
    }

    async function checkProjectUpdates() {
      var btn = document.getElementById('checkUpdatesBtn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ 检查中...'; }
      try {
        var result = await api('/api/skill/check-updates');
        var updates = result.updates || [];
        var hasAny = updates.filter(function(u) { return u.hasUpdate; });
        if (hasAny.length > 0) {
          showToast({ tool: 'updates', resultSummary: hasAny.length + ' 个技能有可用更新', timestamp: new Date().toISOString() });
          hasAny.forEach(function(u) {
            var card = document.querySelector('.skill-card[data-skill="' + u.skillName + '"]');
            if (card && !card.querySelector('.update-badge')) {
              var badge = document.createElement('span');
              badge.className = 'update-badge';
              badge.textContent = '🔺 有更新';
              badge.title = '来源: ' + u.sourceUrl + '\n安装于: ' + u.installedAt;
              badge.onclick = function(e) { e.stopPropagation(); updateSingleSkill(u.skillName, u.sourceUrl); };
              card.querySelector('.card-header').appendChild(badge);
            }
          });
        } else {
          showToast({ tool: 'updates', resultSummary: '所有技能已是最新版本 ✅', timestamp: new Date().toISOString() });
        }
      } catch (e) {
        showToast({ tool: 'updates', resultSummary: '检查更新失败: ' + (e.message || e), timestamp: new Date().toISOString() });
      }
      if (btn) { btn.disabled = false; btn.textContent = '🔄 检查更新'; }
    }

    async function updateSingleSkill(name, sourceUrl) {
      if (!confirm('更新 "' + name + '" 到最新版本？')) return;
      try {
        var record = await api('/api/skill/install-registry');
        var rec = (record || []).find(function(r) { return r.skillName === name; });
        if (!rec) { alert('未找到安装记录'); return; }
        var result = await api('/api/community/install?name=' + encodeURIComponent(name) + '&url=' + encodeURIComponent(sourceUrl) + '&mode=' + encodeURIComponent(rec.installMode) + (rec.projectPath ? '&projectPath=' + encodeURIComponent(rec.projectPath) : ''));
        if (result.success) {
          showToast({ tool: 'update', resultSummary: name + ' 已更新 ✅', timestamp: new Date().toISOString() });
          allSkills = await api('/api/skills');
          renderMyRepo();
        } else {
          alert('更新失败: ' + (result.error || '未知错误'));
        }
      } catch (e) {
        alert('更新失败: ' + (e.message || e));
      }
    }

    async function exportConfig() {
      try {
        var data = await api('/api/export-config');
        var json = JSON.stringify(data, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'skiller-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast({ tool: 'export', resultSummary: '配置已导出为 JSON 文件', timestamp: new Date().toISOString() });
      } catch (e) {
        alert('导出失败: ' + (e.message || e));
      }
    }

    async function removeManagedProjectUI(proj) {
      if (!confirm('从管理列表中移除此项目？\n（不会删除项目文件）')) return;
      await api('/api/managed-projects/remove?path=' + encodeURIComponent(proj));
      renderMyRepo();
    }

    var _draggedProjectPath = '';
    var _draggedCardEl = null;
    function onProjectCardDragStart(e) {
      _draggedProjectPath = e.currentTarget.getAttribute('data-project') || '';
      _draggedCardEl = e.currentTarget;
      e.dataTransfer.effectAllowed = 'move';
      e.currentTarget.style.opacity = '0.4';
      e.currentTarget.classList.add('dragging');
    }
    function onProjectCardDragEnd(e) {
      _draggedProjectPath = '';
      _draggedCardEl = null;
      e.currentTarget.style.opacity = '1';
      e.currentTarget.classList.remove('dragging');
      document.querySelectorAll('.drag-over-highlight, .drag-insert-before, .drag-insert-after').forEach(function(el) {
        el.classList.remove('drag-over-highlight', 'drag-insert-before', 'drag-insert-after');
      });
    }
    function onProjectCardDragOver(e) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (!_draggedCardEl || e.currentTarget === _draggedCardEl) return;
      var rect = e.currentTarget.getBoundingClientRect();
      var midX = rect.left + rect.width / 2;
      if (e.clientX < midX) {
        e.currentTarget.classList.add('drag-insert-before');
        e.currentTarget.classList.remove('drag-insert-after');
      } else {
        e.currentTarget.classList.add('drag-insert-after');
        e.currentTarget.classList.remove('drag-insert-before');
      }
    }
    function onProjectCardDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!_draggedCardEl || e.currentTarget === _draggedCardEl) return;
      var target = e.currentTarget;
      var grid = target.parentElement;
      if (!grid) return;
      var rect = target.getBoundingClientRect();
      var midX = rect.left + rect.width / 2;
      if (e.clientX < midX) {
        grid.insertBefore(_draggedCardEl, target);
      } else {
        grid.insertBefore(_draggedCardEl, target.nextSibling);
      }
      target.classList.remove('drag-insert-before', 'drag-insert-after');
      saveProjectOrderFromDOM();
    }
    function saveProjectOrderFromDOM() {
      var allCards = document.querySelectorAll('.project-card[data-project]');
      var order = [];
      allCards.forEach(function(card) {
        var p = card.getAttribute('data-project');
        if (p && order.indexOf(p) < 0) order.push(p);
      });
      if (order.length > 0) {
        api('/api/project-groups/reorder-projects?order=' + order.map(encodeURIComponent).join('|||'));
      }
    }
    function onGroupSectionDragOver(e) {
      if (e.target.closest && e.target.closest('.project-card')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      e.currentTarget.classList.add('drag-over-highlight');
    }
    function onGroupSectionDragLeave(e) {
      e.currentTarget.classList.remove('drag-over-highlight');
    }
    async function onGroupSectionDrop(e, groupId) {
      if (e.target.closest && e.target.closest('.project-card')) return;
      e.preventDefault();
      e.currentTarget.classList.remove('drag-over-highlight');
      if (!_draggedProjectPath) return;
      await api('/api/project-groups/assign?project=' + encodeURIComponent(_draggedProjectPath) + '&group=' + encodeURIComponent(groupId || ''));
      _draggedProjectPath = '';
      renderMyRepo();
    }

    function renderMyRepoList() {
      var q = (myrepoSearchQuery || '').toLowerCase().trim();
      var linkedSkillNames = selectedProject && skillProjectLinks[selectedProject] ? skillProjectLinks[selectedProject] : [];
      var filtered = allSkills.filter(function(s) {
        if (selectedProject) {
          var isNative = s.source === 'project-rules' && s.projectName === selectedProject;
          var isLinked = linkedSkillNames.indexOf(s.name) >= 0;
          if (!isNative && !isLinked) return false;
        }
        if (myrepoScopeFilter === 'global' && s.source === 'project-rules') return false;
        if (myrepoScopeFilter === 'project' && s.source !== 'project-rules') return false;
        if (myrepoCatFilter === '__uncategorized__' && s.categories.length > 0) return false;
        if (myrepoCatFilter && myrepoCatFilter !== '__uncategorized__') {
          var allIds = getCategoryAndDescendants(myrepoCatFilter);
          if (!s.categories.some(function(c) { return allIds.indexOf(c) >= 0; })) return false;
        }
        if (q) {
          var match = s.name.toLowerCase().indexOf(q) >= 0
            || s.description.toLowerCase().indexOf(q) >= 0
            || s.tags.some(function(t) { return t.toLowerCase().indexOf(q) >= 0; })
            || (s.projectName && s.projectName.toLowerCase().indexOf(q) >= 0);
          if (!match) return false;
        }
        return true;
      });

      var gridEl = document.getElementById('myrepoGrid');
      if (!gridEl) return;

      var countEl = document.getElementById('myrepoResultCount');
      if (countEl) countEl.textContent = filtered.length + ' / ' + allSkills.length + ' 个技能';

      if (filtered.length === 0) {
        gridEl.innerHTML = '<div class="empty-msg">没有匹配的技能</div>';
        return;
      }

      gridEl.innerHTML = filtered.map(function(s) {
        var isProject = s.source === 'project-rules';
        var scopeClass = isProject ? 'scope-project' : 'scope-global';
        var scopeIcon = isProject ? '📁' : '🌐';
        var showName = s.displayName || s.name;
        var desc = s.customDescription || s.description || '暂无描述';
        if (desc.length > 100) desc = desc.substring(0, 100) + '...';
        var catLabels = s.categories.slice(0, 2).map(function(c) {
          var cat = userCategories.find(function(uc) { return uc.id === c; });
          return cat ? (cat.icon || '') + cat.label : c;
        });
        var eName = escapeAttr(s.name).replace(/'/g, "\\'");
        var isLinkedToSelected = selectedProject && linkedSkillNames.indexOf(s.name) >= 0;
        var linkBadge = isLinkedToSelected ? '<span class="card-link-badge" title="已关联到此项目">🔗</span>' : '';
        var linkedProjs = getLinkedProjectsForSkill(s.name);
        var linkCount = linkedProjs.length;
        return '<div class="skill-card ' + scopeClass + (isLinkedToSelected ? ' linked' : '') + '" data-skill="' + escapeAttr(s.name) + '" onclick="selectMyRepoSkill(\'' + eName + '\')">'
          + '<div class="card-actions">'
          +   '<button class="card-action-btn" onclick="event.stopPropagation(); myrepoUpload(\'' + eName + '\', this)" title="上传到社区">📤 上传</button>'
          +   '<button class="card-action-btn" onclick="event.stopPropagation(); openLinkToProjectPanel(\'' + eName + '\')" title="关联项目">🔗 关联</button>'
          +   '<button class="card-action-btn" onclick="event.stopPropagation(); exportLocalSkill(\'' + eName + '\')" title="复制内容">📋 复制</button>'
          +   '<button class="card-action-btn danger" onclick="event.stopPropagation(); myrepoDeleteLocal(\'' + eName + '\')" title="删除">🗑️ 删除</button>'
          + '</div>'
          + '<div class="card-header">'
          +   '<div class="card-scope">' + scopeIcon + '</div>'
          +   '<div class="card-name">' + escapeHtml(showName) + '</div>'
          +   linkBadge
          + '</div>'
          + '<div class="card-desc">' + escapeHtml(desc) + '</div>'
          + '<div class="card-tags">'
          +   (isProject && s.projectName ? '<span class="card-tag" style="background:rgba(124,77,255,0.08); color:#7c4dff">' + escapeHtml(s.projectName.split('/').slice(-2).join('/')) + '</span>' : '')
          +   (linkCount > 0 && !isProject ? '<span class="card-tag" style="background:rgba(34,139,230,0.08); color:#228be6">🔗 ' + linkCount + ' 项目</span>' : '')
          +   catLabels.map(function(l) { return '<span class="card-tag" style="background:rgba(99,102,241,0.08); color:#6366f1">' + escapeHtml(l) + '</span>'; }).join('')
          + '</div>'
          + '</div>';
      }).join('');
    }

    // ===== Project Drag & Drop (smooth DOM-based) =====
    var _draggedProject = null;
    var _draggedEl = null;
    var _dropIndicator = null;
    var _dropTarget = null;
    var _dropPos = null;

    function ensureDropIndicator() {
      if (!_dropIndicator) {
        _dropIndicator = document.createElement('div');
        _dropIndicator.className = 'drop-indicator';
      }
      return _dropIndicator;
    }

    function clearDropIndicator() {
      if (_dropIndicator && _dropIndicator.parentNode) _dropIndicator.remove();
      _dropTarget = null;
      _dropPos = null;
      document.querySelectorAll('.project-group.drag-over, .ungrouped.drag-over').forEach(function(g) { g.classList.remove('drag-over'); });
    }

    function onProjectDragStart(e) {
      var el = e.currentTarget;
      _draggedProject = el.getAttribute('data-project');
      _draggedEl = el;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _draggedProject);
    }

    function onProjectDragEnd(e) {
      var el = e.currentTarget;
      el.classList.remove('dragging');
      _draggedProject = null;
      _draggedEl = null;
      clearDropIndicator();
    }

    function onItemDragOver(e) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      var target = e.currentTarget;
      if (target === _draggedEl) return;
      var rect = target.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      var indicator = ensureDropIndicator();
      if (e.clientY < midY) {
        target.parentNode.insertBefore(indicator, target);
        _dropTarget = target;
        _dropPos = 'before';
      } else {
        target.parentNode.insertBefore(indicator, target.nextSibling);
        _dropTarget = target;
        _dropPos = 'after';
      }
    }

    function onItemDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!_draggedEl || !_dropTarget || _draggedEl === _dropTarget) { clearDropIndicator(); return; }
      var targetProject = _dropTarget.getAttribute('data-project');
      if (!targetProject) { clearDropIndicator(); return; }

      var container = _dropTarget.closest('.project-group-items') || _dropTarget.parentNode;
      if (_dropPos === 'before') {
        container.insertBefore(_draggedEl, _dropTarget);
      } else {
        container.insertBefore(_draggedEl, _dropTarget.nextSibling);
      }

      var targetGroup = container.closest('.project-group');
      var groupId = targetGroup ? targetGroup.getAttribute('data-group') : '';
      clearDropIndicator();
      saveSidebarState(groupId);
    }

    function onGroupDragOver(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      e.currentTarget.classList.add('drag-over');
    }

    function onGroupDragLeave(e) {
      e.currentTarget.classList.remove('drag-over');
    }

    function onGroupDrop(e, groupId) {
      e.preventDefault();
      e.currentTarget.classList.remove('drag-over');
      if (!_draggedEl) return;
      var targetContainer = groupId
        ? document.getElementById('groupItems_' + groupId)
        : document.querySelector('.project-group-items.ungrouped');
      if (!targetContainer) { clearDropIndicator(); return; }
      var hint = targetContainer.querySelector('.group-empty-hint');
      if (hint) hint.remove();
      targetContainer.appendChild(_draggedEl);
      clearDropIndicator();
      saveSidebarState(groupId);
    }

    function saveSidebarState(movedToGroupId) {
      var allItems = document.querySelectorAll('.project-sidebar-item[data-project]');
      var order = [];
      allItems.forEach(function(el) {
        var p = el.getAttribute('data-project');
        if (p) order.push(p);
      });
      api('/api/project-groups/reorder-projects?order=' + encodeURIComponent(order.join('|||')));
      if (_draggedProject && movedToGroupId !== undefined) {
        var currentGroup = (projectGroupsData.assignments || {})[_draggedProject] || '';
        if (currentGroup !== movedToGroupId) {
          api('/api/project-groups/assign?project=' + encodeURIComponent(_draggedProject) + '&group=' + encodeURIComponent(movedToGroupId));
          if (movedToGroupId) {
            projectGroupsData.assignments[_draggedProject] = movedToGroupId;
          } else {
            delete projectGroupsData.assignments[_draggedProject];
          }
        }
      }
      projectGroupsData.projectOrder = order;
    }

    function toggleGroup(groupId) {
      var items = document.getElementById('groupItems_' + groupId);
      var toggle = document.getElementById('groupToggle_' + groupId);
      if (items) {
        var hidden = items.style.display === 'none';
        items.style.display = hidden ? 'block' : 'none';
        if (toggle) toggle.textContent = hidden ? '▼' : '▶';
      }
    }

    function showInlineGroupInput() {
      var name = prompt('请输入分组名称：');
      if (!name || !name.trim()) return;
      api('/api/project-groups/add?name=' + encodeURIComponent(name.trim()) + '&icon=' + encodeURIComponent('📁')).then(function() {
        renderMyRepo();
      });
    }

    async function deleteGroupInline(groupId) {
      if (!confirm('确定删除此分组？（项目不会被删除）')) return;
      await api('/api/project-groups/remove?id=' + encodeURIComponent(groupId));
      renderMyRepo();
    }

    function startRenameGroup(groupId, nameEl) {
      var oldName = nameEl.textContent;
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'group-name-input';
      input.value = oldName;
      input.onkeydown = function(ev) {
        if (ev.key === 'Enter') { finishRenameGroup(groupId, input.value.trim(), nameEl, oldName); }
        if (ev.key === 'Escape') { restoreGroupName(nameEl, oldName); }
      };
      input.onblur = function() { finishRenameGroup(groupId, input.value.trim(), nameEl, oldName); };
      nameEl.textContent = '';
      nameEl.appendChild(input);
      input.focus();
      input.select();
    }

    function restoreGroupName(nameEl, oldName) {
      nameEl.textContent = oldName;
    }

    async function finishRenameGroup(groupId, newName, nameEl, oldName) {
      if (!newName || newName === oldName) { restoreGroupName(nameEl, oldName); return; }
      var url = '/api/project-groups/rename?id=' + encodeURIComponent(groupId) + '&name=' + encodeURIComponent(newName);
      await api(url);
      renderMyRepo();
    }

    function updateSidebarOnly() {
      var allProjects = Object.keys(_cachedProjectsWithSkills || {});
      if (projectGroupsData.projectOrder && projectGroupsData.projectOrder.length > 0) {
        var ordered = [];
        projectGroupsData.projectOrder.forEach(function(p) { if (allProjects.indexOf(p) >= 0) ordered.push(p); });
        allProjects.forEach(function(p) { if (ordered.indexOf(p) < 0) ordered.push(p); });
        allProjects = ordered;
      }
      var groups = (projectGroupsData.groups || []).slice().sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
      var assignments = projectGroupsData.assignments || {};
      var projectsWithSkills = _cachedProjectsWithSkills || {};

      var projectSidebarHtml = '<div class="project-sidebar-item' + (selectedProject === '' ? ' active' : '') + '" onclick="selectProject(\'\')">'
        + '<span class="proj-icon">📦</span><span class="proj-name">全部技能</span><span class="proj-count">' + allSkills.length + '</span></div>';

      function renderProjectItemInline(proj) {
        var info = projectsWithSkills[proj] || { native: 0, linked: 0 };
        var total = info.native + info.linked;
        var shortName = proj.split('/').slice(-2).join('/');
        var isActive = selectedProject === proj;
        var eProj = escapeAttr(proj).replace(/'/g, "\\'");
        return '<div class="project-sidebar-item' + (isActive ? ' active' : '') + '" draggable="true" data-project="' + escapeAttr(proj) + '" onclick="selectProject(\'' + eProj + '\')" ondragstart="onProjectDragStart(event)" ondragend="onProjectDragEnd(event)" ondragover="onItemDragOver(event)" ondrop="onItemDrop(event)" title="' + escapeAttr(proj) + '">'
          + '<span class="proj-icon drag-handle" style="cursor:grab">⠿</span>'
          + '<span class="proj-icon">' + (total > 0 ? '📁' : '📂') + '</span>'
          + '<span class="proj-name">' + escapeHtml(shortName) + '</span>'
          + '<span class="proj-count">' + total + '</span>'
          + '</div>';
      }

      groups.forEach(function(g) {
        var groupProjects = allProjects.filter(function(p) { return assignments[p] === g.id; });
        var groupTotal = groupProjects.reduce(function(sum, p) { var i = projectsWithSkills[p] || { native: 0, linked: 0 }; return sum + i.native + i.linked; }, 0);
        var eGid = escapeAttr(g.id).replace(/'/g, "\\'");
        projectSidebarHtml += '<div class="project-group" data-group="' + escapeAttr(g.id) + '" ondragover="onGroupDragOver(event)" ondragleave="onGroupDragLeave(event)" ondrop="onGroupDrop(event, \'' + eGid + '\')">'
          + '<div class="project-group-header" onclick="toggleGroup(\'' + eGid + '\')">'
          +   '<span class="group-icon">' + (g.icon || '📁') + '</span>'
          +   '<span class="group-name" ondblclick="event.stopPropagation(); startRenameGroup(\'' + eGid + '\', this)" title="双击重命名">' + escapeHtml(g.name) + '</span>'
          +   '<span class="proj-count">' + groupTotal + '</span>'
          +   '<button class="group-del-btn" onclick="event.stopPropagation(); deleteGroupInline(\'' + eGid + '\')" title="删除分组">✕</button>'
          +   '<span class="group-toggle" id="groupToggle_' + escapeAttr(g.id) + '">▼</span>'
          + '</div>'
          + '<div class="project-group-items" id="groupItems_' + escapeAttr(g.id) + '">';
        groupProjects.forEach(function(p) { projectSidebarHtml += renderProjectItemInline(p); });
        if (groupProjects.length === 0) {
          projectSidebarHtml += '<div class="group-empty-hint">拖入项目</div>';
        }
        projectSidebarHtml += '</div></div>';
      });

      var ungroupedProjects = allProjects.filter(function(p) { return !assignments[p]; });
      if (ungroupedProjects.length > 0 || groups.length === 0) {
        if (groups.length > 0) {
          projectSidebarHtml += '<div class="project-group-divider">── 未分组 ──</div>';
        }
        projectSidebarHtml += '<div class="project-group-items ungrouped" ondragover="onGroupDragOver(event)" ondragleave="onGroupDragLeave(event)" ondrop="onGroupDrop(event, \'\')">';
        ungroupedProjects.forEach(function(p) { projectSidebarHtml += renderProjectItemInline(p); });
        projectSidebarHtml += '</div>';
      }

      var sidebarList = document.getElementById('projectSidebarList');
      if (sidebarList) sidebarList.innerHTML = projectSidebarHtml;
    }

    function getLinkedProjectsForSkill(skillName) {
      var projects = [];
      Object.keys(skillProjectLinks).forEach(function(proj) {
        if (skillProjectLinks[proj] && skillProjectLinks[proj].indexOf(skillName) >= 0) {
          projects.push(proj);
        }
      });
      return projects;
    }

    var _addSkillSearchQuery = '';

    function openAddSkillToProjectDrawer() {
      var drawer = document.getElementById('detailDrawer');
      var overlay = document.getElementById('drawerOverlay');
      if (!drawer || !overlay || !selectedProject) return;

      var projShort = selectedProject.split('/').slice(-2).join('/');
      var existingInProject = allSkills.filter(function(s) {
        return s.source === 'project-rules' && s.projectName === selectedProject;
      }).map(function(s) { return s.name; });

      var repoSkills = allSkills;

      var html = '<button class="drawer-close" onclick="closeDrawer()" title="关闭">✕</button>'
        + '<h2 style="font-family:var(--font-display); font-size:20px; margin-bottom:4px">📥 从本地仓库添加技能</h2>'
        + '<p style="color:var(--text2); font-size:12px; margin-bottom:12px">选择技能并以合适的模式安装到 <b>' + escapeHtml(projShort) + '</b></p>'
        + '<input type="text" id="addSkillSearch" placeholder="搜索技能..." oninput="filterAddSkillList(this.value)" style="width:100%; padding:10px 14px; border-radius:10px; border:1.5px solid var(--border2); background:var(--bg2); font-size:13px; font-family:var(--font-body); outline:none; margin-bottom:12px">'
        + '<div id="addSkillListContainer" style="max-height:calc(100vh - 280px); overflow-y:auto">';

      html += renderAddSkillList(repoSkills, existingInProject, '');
      html += '</div>';
      html += '<div id="addSkillResult" style="margin-top:12px"></div>';

      drawer.innerHTML = html;
      drawer.classList.add('open');
      overlay.classList.add('open');
      setTimeout(function() { var inp = document.getElementById('addSkillSearch'); if (inp) inp.focus(); }, 100);
    }

    function renderAddSkillList(skills, existingNames, query) {
      var filtered = skills;
      if (query) {
        var q = query.toLowerCase();
        filtered = skills.filter(function(s) {
          return (s.name || '').toLowerCase().indexOf(q) >= 0
            || (s.description || '').toLowerCase().indexOf(q) >= 0
            || (s.displayName || '').toLowerCase().indexOf(q) >= 0
            || (s.tags || []).some(function(t) { return t.toLowerCase().indexOf(q) >= 0; });
        });
      }
      if (filtered.length === 0) {
        return '<div style="text-align:center; color:var(--text2); padding:20px; font-size:13px">' + (query ? '没有匹配的技能' : '没有可添加的技能') + '</div>';
      }
      return filtered.map(function(s) {
        var already = existingNames.indexOf(s.name) >= 0;
        var showName = s.displayName || s.name;
        var desc = s.customDescription || s.description || '';
        if (desc.length > 80) desc = desc.substring(0, 80) + '...';
        var eName = escapeAttr(s.name).replace(/'/g, "\\'");
        return '<div class="add-skill-item' + (already ? ' already-added' : '') + '" onclick="' + (already ? '' : 'copySkillToProject(\'' + eName + '\')') + '">'
          + '<div class="add-skill-info">'
          +   '<div class="add-skill-name">' + escapeHtml(showName) + '</div>'
          +   '<div class="add-skill-desc">' + escapeHtml(desc) + '</div>'
          + '</div>'
          + '<div class="add-skill-action">'
          + (already
            ? '<span style="font-size:11px; color:var(--green); font-weight:600">✓ 已添加</span>'
            : '<button class="btn btn-blue" style="padding:4px 12px; font-size:11px; white-space:nowrap" onclick="event.stopPropagation(); copySkillToProject(\'' + eName + '\', this)">📥 添加</button>')
          + '</div>'
          + '</div>';
      }).join('');
    }

    function filterAddSkillList(query) {
      _addSkillSearchQuery = query;
      var container = document.getElementById('addSkillListContainer');
      if (!container) return;
      var existingInProject = allSkills.filter(function(s) {
        return s.source === 'project-rules' && s.projectName === selectedProject;
      }).map(function(s) { return s.name; });
      container.innerHTML = renderAddSkillList(allSkills, existingInProject, query);
    }

    async function copySkillToProject(skillName, btnEl) {
      if (!selectedProject) return;
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = '添加中...'; }
      var resultEl = document.getElementById('addSkillResult');
      try {
        var result = await api('/api/skill/copy-to-project?name=' + encodeURIComponent(skillName) + '&projectPath=' + encodeURIComponent(selectedProject));
        if (result.success) {
          if (btnEl) {
            var parent = btnEl.closest('.add-skill-item');
            if (parent) {
              parent.classList.add('already-added');
              parent.onclick = null;
            }
            btnEl.outerHTML = '<span style="font-size:11px; color:var(--green); font-weight:600">✓ 已添加</span>';
          }
          if (resultEl) resultEl.innerHTML = '<div style="color:var(--green); font-size:12px">✅ ' + escapeHtml(skillName) + ' 已添加到项目</div>';
          allSkills = await api('/api/skills');
          document.getElementById('totalCount').textContent = allSkills.length;
          renderMyRepoList();
        } else {
          if (btnEl) { btnEl.disabled = false; btnEl.textContent = '📥 添加'; }
          if (resultEl) resultEl.innerHTML = '<div style="color:var(--red); font-size:12px">❌ ' + escapeHtml(result.message || '添加失败') + '</div>';
        }
      } catch(err) {
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = '📥 添加'; }
        if (resultEl) resultEl.innerHTML = '<div style="color:var(--red); font-size:12px">❌ ' + escapeHtml(String(err)) + '</div>';
      }
    }

    async function openLinkToProjectPanel(skillName) {
      var drawer = document.getElementById('detailDrawer');
      var overlay = document.getElementById('drawerOverlay');
      if (!drawer || !overlay) return;

      var linkedProjs = getLinkedProjectsForSkill(skillName);
      var html = '<button class="drawer-close" onclick="closeDrawer()" title="关闭">✕</button>'
        + '<div style="padding:4px 0 16px"><h2 style="font-family:var(--font-display); font-size:20px; margin-bottom:4px">🔗 关联项目</h2>'
        + '<p style="color:var(--text2); font-size:12px; margin-bottom:16px">为「' + escapeHtml(skillName) + '」选择关联的项目（软关联，不复制文件）</p></div>';

      html += '<div style="margin-bottom:12px">';
      var allProjects = recentProjectsCache.slice();
      Object.keys(skillProjectLinks).forEach(function(p) {
        if (allProjects.indexOf(p) < 0) allProjects.push(p);
      });
      allProjects.forEach(function(proj) {
        var checked = linkedProjs.indexOf(proj) >= 0;
        var shortName = proj.split('/').slice(-2).join('/');
        html += '<label class="link-project-row" style="display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius:12px; border:1.5px solid ' + (checked ? 'var(--blue)' : 'var(--border2)') + '; background:' + (checked ? 'rgba(34,139,230,0.04)' : 'var(--surface)') + '; cursor:pointer; margin-bottom:6px; transition:all 0.2s">'
          + '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="toggleSkillProjectLink(\'' + escapeAttr(skillName).replace(/'/g, "\\'") + '\', \'' + escapeAttr(proj).replace(/'/g, "\\'") + '\', this.checked)" style="width:16px; height:16px; accent-color:var(--blue)">'
          + '<span style="flex:1"><span style="font-size:13px; font-weight:600">' + escapeHtml(shortName) + '</span><br><span style="font-size:10px; color:var(--text2)">' + escapeHtml(proj) + '</span></span>'
          + '</label>';
      });
      html += '</div>';

      drawer.innerHTML = html;
      drawer.classList.add('open');
      overlay.classList.add('open');
    }

    async function toggleSkillProjectLink(skillName, projectPath, checked) {
      var endpoint = checked ? '/api/skill-projects/link' : '/api/skill-projects/unlink';
      await api(endpoint + '?skill=' + encodeURIComponent(skillName) + '&project=' + encodeURIComponent(projectPath));
      try { skillProjectLinks = await api('/api/skill-projects'); } catch(e) {}
      var row = event.target.closest('.link-project-row');
      if (row) {
        row.style.borderColor = checked ? 'var(--blue)' : 'var(--border2)';
        row.style.background = checked ? 'rgba(34,139,230,0.04)' : 'var(--surface)';
      }
      renderMyRepoList();
    }

    async function selectMyRepoSkill(name) {
      myrepoSelectedSkill = name;

      var drawer = document.getElementById('detailDrawer');
      var overlay = document.getElementById('drawerOverlay');
      if (!drawer || !overlay) return;
      drawer.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:200px; color:var(--text2)"><span style="animation:spin 1s linear infinite; display:inline-block; font-size:24px">⏳</span></div>';
      drawer.classList.add('open');
      overlay.classList.add('open');

      var data = await api('/api/skill?name=' + encodeURIComponent(name));
      if (data.error) {
        drawer.innerHTML = '<button class="drawer-close" onclick="closeDrawer()" title="关闭">✕</button>'
          + '<div style="text-align:center; padding:40px; color:var(--text2)"><div style="font-size:32px; margin-bottom:12px">❌</div><div>' + escapeHtml(data.error) + '</div></div>';
        return;
      }

      var ownSet = new Set(ownSkillsList.map(function(n) { return n.toLowerCase(); }));
      var isUploaded = ownSet.has(name.toLowerCase());
      var subSkills = data.subSkills || [];
      var subCount = countTreeNodes(subSkills);
      var subSource = data.subSkillSource || 'auto';
      var sourceLabel = subSource === 'declared'
        ? '<span class="source-badge declared">作者声明的子技能</span>'
        : '<span class="source-badge auto">自动解析</span>';

      var skillCats = data.categories || [];

      var isProject = data.source === 'project-rules';
      var projectName = data.projectName || '';
      var html = '';

      var showTitle = data.displayName || data.name;
      var scopeTag = isProject
        ? '<span class="tag" style="background:rgba(124,77,255,0.1); color:#7c4dff; font-weight:600">📁 项目级' + (data.projectName ? ' — ' + escapeHtml(data.projectName) : '') + '</span>'
        : '<span class="tag" style="background:rgba(34,139,230,0.08); color:#228be6; font-weight:600">🌐 全局技能</span>';
      html += '<div style="margin-bottom:16px">'
        + '<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px">'
        + '<h2 style="font-family:var(--font-display); font-size:22px; margin:0; flex:1">' + escapeHtml(showTitle) + '</h2>'
        + '<div style="position:relative; display:inline-block">'
        + '<button class="btn" style="padding:6px 10px; font-size:12px" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'block\'?\'none\':\'block\'">⋯ 更多</button>'
        + '<div style="display:none; position:absolute; right:0; top:100%; margin-top:4px; background:var(--surface); border:1.5px solid var(--border2); border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,0.12); z-index:100; min-width:180px; padding:6px 0">'
        + '<div style="padding:8px 16px; font-size:12px; cursor:pointer; transition:background 0.2s" onmouseover="this.style.background=\'var(--bg2)\'" onmouseout="this.style.background=\'transparent\'" onclick="myrepoUpload(\'' + escapeAttr(data.name).replace(/'/g, "\\'") + '\', this); this.parentNode.style.display=\'none\'">'
        + (isUploaded ? '🔄 更新到社区' : '📤 上传到社区') + '</div>'
        + (isUploaded ? '<div style="padding:8px 16px; font-size:12px; cursor:pointer; color:var(--orange); transition:background 0.2s" onmouseover="this.style.background=\'var(--bg2)\'" onmouseout="this.style.background=\'transparent\'" onclick="myrepoUnpublish(\'' + escapeAttr(data.name).replace(/'/g, "\\'") + '\', this); this.parentNode.style.display=\'none\'">🗑️ 从社区下架</div>' : '')
        + '<div style="padding:8px 16px; font-size:12px; cursor:pointer; transition:background 0.2s" onmouseover="this.style.background=\'var(--bg2)\'" onmouseout="this.style.background=\'transparent\'" onclick="exportLocalSkill(\'' + escapeAttr(data.name).replace(/'/g, "\\'") + '\'); this.parentNode.style.display=\'none\'">📋 复制内容</div>'
        + '<div style="height:1px; background:var(--border2); margin:4px 8px"></div>'
        + '<div style="padding:8px 16px; font-size:12px; cursor:pointer; color:#e53935; transition:background 0.2s" onmouseover="this.style.background=\'rgba(229,57,53,0.05)\'" onmouseout="this.style.background=\'transparent\'" onclick="myrepoDeleteLocal(\'' + escapeAttr(data.name).replace(/'/g, "\\'") + '\'); this.parentNode.style.display=\'none\'">🗑️ 删除本地</div>'
        + '</div></div></div>'
        + (data.displayName ? '<div style="font-size:11px; color:var(--text2); margin-bottom:6px; opacity:0.7">原名: ' + escapeHtml(data.name) + '</div>' : '')
        + '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px">'
        + scopeTag
        + '<span class="tag source">' + escapeHtml(data.source) + '</span>'
        + '<span class="tag tokens">~' + (data.tokenEstimate || 0) + ' tokens</span>'
        + '</div>'
        + '<p style="color:var(--text2); font-size:13px; line-height:1.6; margin-bottom:4px">' + escapeHtml(data.customDescription || data.description) + '</p>'
        + '<div style="font-size:11px; color:var(--text2)">📂 ' + escapeHtml(data.path || '') + '</div>'
        + '</div>';

      // scope info integrated into header tags

      // Category management
      html += '<div class="myrepo-section">'
        + '<div class="myrepo-section-title">🏷️ 分类管理</div>'
        + '<div id="myrepoCatCheckboxes" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px">';
      for (var i = 0; i < userCategories.length; i++) {
        var uc = userCategories[i];
        var checked = skillCats.indexOf(uc.id) >= 0 ? ' checked' : '';
        html += '<label style="display:flex; align-items:center; gap:4px; padding:4px 10px; border-radius:10px; border:2px solid var(--border2); background:var(--surface); cursor:pointer; font-size:12px; transition:all 0.2s">'
          + '<input type="checkbox" value="' + escapeAttr(uc.id) + '"' + checked + ' style="accent-color:var(--red)">'
          + (uc.icon || '') + ' ' + escapeHtml(uc.label)
          + '</label>';
      }
      if (userCategories.length === 0) {
        html += '<span style="color:var(--text2); font-size:12px">暂无分类，请在「分类管理」中创建</span>';
      }
      html += '</div>';
      if (userCategories.length > 0) {
        html += '<button class="btn btn-green" style="padding:5px 14px; font-size:12px" onclick="myrepoSaveCategories(\'' + escapeAttr(data.name).replace(/'/g, "\\'") + '\')">💾 保存分类</button>';
      }
      html += '</div>';

      // Display name and description editor
      html += '<div class="myrepo-section">'
        + '<div class="myrepo-section-title">✏️ 自定义显示</div>'
        + '<div style="margin-bottom:8px">'
        + '<label style="font-size:11px; color:var(--text2); display:block; margin-bottom:4px">显示名称（留空使用原名）</label>'
        + '<input type="text" id="myrepo-displayName" value="' + escapeAttr(data.displayName || '') + '" placeholder="' + escapeAttr(data.name) + '" style="width:100%; padding:8px 12px; border-radius:24px; border:1.5px solid var(--border2); background:var(--bg2); font-size:12px; outline:none; transition:border-color 0.2s" onfocus="this.style.borderColor=\'var(--blue)\'" onblur="this.style.borderColor=\'var(--border2)\'">'
        + '</div>'
        + '<div style="margin-bottom:8px">'
        + '<label style="font-size:11px; color:var(--text2); display:block; margin-bottom:4px">自定义描述（优先显示在卡片上）</label>'
        + '<textarea id="myrepo-customDesc" style="width:100%; min-height:60px; padding:8px 12px; border-radius:12px; border:1.5px solid var(--border2); background:var(--bg2); font-size:12px; font-family:var(--font-body); line-height:1.5; resize:vertical; outline:none; transition:border-color 0.2s" onfocus="this.style.borderColor=\'var(--blue)\'" onblur="this.style.borderColor=\'var(--border2)\'" placeholder="填写技能描述，将优先显示在卡片上...">' + escapeHtml(data.customDescription || '') + '</textarea>'
        + '</div>'
        + '<button class="btn btn-green" style="padding:5px 14px; font-size:12px" onclick="myrepoSaveOverride(\'' + escapeAttr(data.name).replace(/'/g, "\\'") + '\')">💾 保存显示设置</button>'
        + '<div style="font-size:10px; color:var(--text2); margin-top:4px">自定义显示名称和描述仅影响 Dashboard 展示，不修改 SKILL.md 文件</div>'
        + '</div>';

      // Project associations
      var skillLinkedProjs = getLinkedProjectsForSkill(data.name);
      html += '<div class="myrepo-section">'
        + '<div class="myrepo-section-title">🔗 项目关联</div>'
        + '<div style="font-size:11px; color:var(--text2); margin-bottom:8px">软关联到项目后，在项目工作区中可快速查看。不复制文件。</div>'
        + '<div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px">';
      if (skillLinkedProjs.length > 0) {
        skillLinkedProjs.forEach(function(p) {
          html += '<span class="tag" style="background:rgba(34,139,230,0.08); color:#228be6; display:inline-flex; align-items:center; gap:4px">'
            + '📁 ' + escapeHtml(p.split('/').slice(-2).join('/'))
            + ' <span style="cursor:pointer; opacity:0.6" onclick="toggleSkillProjectLink(\'' + escapeAttr(data.name).replace(/'/g, "\\'") + '\', \'' + escapeAttr(p).replace(/'/g, "\\'") + '\', false)" title="取消关联">✕</span>'
            + '</span>';
        });
      } else {
        html += '<span style="color:var(--text2); font-size:12px">暂无关联项目</span>';
      }
      html += '</div>'
        + '<button class="btn" style="padding:6px 14px; font-size:12px" onclick="openLinkToProjectPanel(\'' + escapeAttr(data.name).replace(/'/g, "\\'") + '\')">🔗 管理关联项目</button>'
        + '</div>';

      // Quick actions
      html += '<div class="myrepo-section">'
        + '<div class="myrepo-section-title">⚡ 快捷操作</div>'
        + '<div class="myrepo-actions">';
      if (isProject) {
        html += '<button class="action-btn action-export" onclick="promoteToGlobal(\'' + escapeAttr(data.name).replace(/'/g, "\\'") + '\', false)">'
          + '<span class="action-icon">🌐</span> 复制为全局'
          + '</button>';
      } else {
        html += '<button class="action-btn action-export" onclick="showCopyToProject(\'' + escapeAttr(data.name).replace(/'/g, "\\'") + '\')">'
          + '<span class="action-icon">📁</span> 复制到项目'
          + '</button>';
      }
      html += '<button class="action-btn action-export" onclick="exportLocalSkill(\'' + escapeAttr(data.name).replace(/'/g, "\\'") + '\')">'
        + '<span class="action-icon">📋</span> 复制内容'
        + '</button>';
      html += '</div>'
        + '<div id="copyToProjectPanel" style="display:none"></div>'
        + '</div>';

      // no separate scope migration section - integrated into quick actions

      // Content tabs: sub-skill tree + raw
      html += '<div class="tab-bar" style="margin-top:0">'
        + '<div class="tab-btn active" onclick="myrepoSwitchTab(\'tree\', this)">🌳 子技能树' + (subCount > 0 ? ' (' + subCount + ')' : '') + '</div>'
        + '<div class="tab-btn" onclick="myrepoSwitchTab(\'raw\', this)">📄 原始内容</div>'
        + '</div>';

      html += '<div id="myrepoTabTree" class="tab-content">'
        + sourceLabel;
      if (subSkills.length > 0) {
        html += '<div class="skill-tree">' + renderTree(subSkills) + '</div>';
      } else {
        html += '<div class="empty-state" style="padding:20px"><div class="icon">📭</div><p style="font-size:13px">此技能没有子技能结构</p></div>';
      }
      html += '</div>';
      html += '<div id="myrepoTabRaw" class="tab-content" style="display:none"><pre style="font-size:12px; line-height:1.6; white-space:pre-wrap; word-break:break-word">' + escapeHtml(data.content || 'No content') + '</pre></div>';

      drawer.innerHTML = '<button class="drawer-close" onclick="closeDrawer()" title="关闭">✕</button>' + html;
    }

    function myrepoSwitchTab(tab, el) {
      el.parentNode.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      el.classList.add('active');
      document.getElementById('myrepoTabTree').style.display = tab === 'tree' ? 'block' : 'none';
      document.getElementById('myrepoTabRaw').style.display = tab === 'raw' ? 'block' : 'none';
    }

    async function promoteToGlobal(name, deleteOriginal) {
      var confirmMsg = deleteOriginal
        ? '确定要将「' + name + '」移动为全局技能？原项目文件将被删除。'
        : '确定要将「' + name + '」复制为全局技能？';
      if (!confirm(confirmMsg)) return;
      var url = '/api/skill/promote-to-global?name=' + encodeURIComponent(name)
        + '&deleteOriginal=' + (deleteOriginal ? '1' : '0');
      var result = await api(url);
      if (result.success) {
        showToast({ tool: 'promote', resultSummary: result.message, timestamp: new Date().toISOString() });
        allSkills = await api('/api/skills');
        document.getElementById('totalCount').textContent = allSkills.length;
        myrepoSelectedSkill = null;
        renderMyRepo();
      } else {
        alert('操作失败: ' + (result.message || '未知错误'));
      }
    }

    function showCopyToProject(name) {
      var panel = document.getElementById('copyToProjectPanel');
      if (!panel) return;
      if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
      var projectOptions = '';
      if (recentProjectsCache && recentProjectsCache.length > 0) {
        projectOptions = recentProjectsCache.map(function(p) {
          return '<button class="migrate-btn" style="font-size:11px; padding:5px 10px" onclick="doCopyToProject(\'' + escapeAttr(name).replace(/'/g, "\\'") + '\', \'' + escapeAttr(p).replace(/'/g, "\\'") + '\')">'
            + '📁 ' + escapeHtml(p) + '</button>';
        }).join('');
      }
      panel.innerHTML = '<div style="margin-top:8px">'
        + '<div style="font-size:11px; color:var(--text2); margin-bottom:6px">选择目标项目:</div>'
        + '<div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px">' + projectOptions + '</div>'
        + '<div style="display:flex; gap:6px; align-items:center">'
        + '<input type="text" id="copyProjectPathInput" placeholder="或输入项目路径..." style="flex:1; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border2); background:var(--bg2); font-size:11px; font-family:monospace; outline:none">'
        + '<button class="migrate-btn" style="font-size:11px" onclick="doCopyToProject(\'' + escapeAttr(name).replace(/'/g, "\\'") + '\', document.getElementById(\'copyProjectPathInput\').value)">确认复制</button>'
        + '</div></div>';
      panel.style.display = 'block';
    }

    async function doCopyToProject(name, projectPath) {
      if (!projectPath || !projectPath.trim()) { alert('请输入项目路径'); return; }
      var url = '/api/skill/copy-to-project?name=' + encodeURIComponent(name)
        + '&projectPath=' + encodeURIComponent(projectPath.trim());
      var result = await api(url);
      if (result.success) {
        showToast({ tool: 'copy', resultSummary: result.message, timestamp: new Date().toISOString() });
        allSkills = await api('/api/skills');
        document.getElementById('totalCount').textContent = allSkills.length;
        renderMyRepo();
      } else {
        alert('复制失败: ' + (result.message || '未知错误'));
      }
    }

    async function myrepoSaveCategories(skillName) {
      var checkboxes = document.querySelectorAll('#myrepoCatCheckboxes input[type=checkbox]');
      var selected = [];
      checkboxes.forEach(function(cb) { if (cb.checked) selected.push(cb.value); });
      await api('/api/categories/tag-skill?skill=' + encodeURIComponent(skillName) + '&categories=' + encodeURIComponent(selected.join(',')));
      showToast({ tool: 'tag', resultSummary: '已更新 ' + skillName + ' 的分类', timestamp: new Date().toISOString() });
      allSkills = await api('/api/skills');
      categories = await api('/api/categories');
      userCategories = await api('/api/categories/list');
      renderMyRepoList();
    }

    async function myrepoSaveOverride(skillName) {
      var displayNameEl = document.getElementById('myrepo-displayName');
      var customDescEl = document.getElementById('myrepo-customDesc');
      var displayName = displayNameEl ? displayNameEl.value.trim() : '';
      var description = customDescEl ? customDescEl.value.trim() : '';
      var url = '/api/skill/set-override?name=' + encodeURIComponent(skillName)
        + '&displayName=' + encodeURIComponent(displayName)
        + '&description=' + encodeURIComponent(description);
      var result = await api(url);
      if (result.success) {
        showToast({ tool: 'edit', resultSummary: '已保存「' + skillName + '」的显示设置', timestamp: new Date().toISOString() });
        allSkills = await api('/api/skills');
        renderMyRepoList();
      } else {
        alert('保存失败: ' + (result.message || '未知错误'));
      }
    }

    async function myrepoUpload(name, btn) {
      btn.innerHTML = '<span class="action-icon">⏳</span> 上传中...';
      btn.disabled = true;
      var desc = uploadDescriptions[name] || '';
      var descParam = desc ? '&description=' + encodeURIComponent(desc) : '';
      try {
        var result = await api('/api/community/upload?name=' + encodeURIComponent(name) + descParam);
        if (result.success) {
          btn.innerHTML = '<span class="action-icon">✓</span> 已上传';
          showToast({ tool: 'upload', resultSummary: result.message, timestamp: new Date().toISOString() });
          invalidateAllViews();
          if (ownSkillsList.indexOf(name) < 0) ownSkillsList.push(name);
          ownSkillsCachedAt = 0;
          updateMyRepoItemBadge(name, true);
        } else {
          btn.innerHTML = '<span class="action-icon">❌</span> ' + (result.message || '失败').slice(0, 20);
          btn.disabled = false;
        }
      } catch (e) {
        btn.innerHTML = '<span class="action-icon">❌</span> 网络错误';
        btn.disabled = false;
      }
    }

    async function myrepoUnpublish(name, btn) {
      if (!confirm('确定要从社区下架 "' + name + '" 吗？')) return;
      btn.innerHTML = '<span class="action-icon">⏳</span> 下架中...';
      btn.disabled = true;
      try {
        var result = await api('/api/community/delete?name=' + encodeURIComponent(name));
        if (result.success) {
          showToast({ tool: 'delete', resultSummary: result.message, timestamp: new Date().toISOString() });
          invalidateAllViews();
          ownSkillsList = ownSkillsList.filter(function(n) { return n !== name; });
          ownSkillsCachedAt = 0;
          updateMyRepoItemBadge(name, false);
          selectMyRepoSkill(name);
        } else {
          alert('下架失败: ' + result.message);
          btn.innerHTML = '<span class="action-icon">🗑️</span> 从社区下架';
          btn.disabled = false;
        }
      } catch (e) {
        alert('网络错误');
        btn.innerHTML = '<span class="action-icon">🗑️</span> 从社区下架';
        btn.disabled = false;
      }
    }

    async function myrepoDeleteLocal(name) {
      if (!confirm('确定要删除本地技能 "' + name + '" 吗？此操作不可恢复！')) return;
      var result = await api('/api/skill/delete?name=' + encodeURIComponent(name));
      if (result.success) {
        showToast({ tool: 'delete', resultSummary: result.message, timestamp: new Date().toISOString() });
        invalidateAllViews();
        allSkills = allSkills.filter(function(s) { return s.name !== name; });
        document.getElementById('totalCount').textContent = allSkills.length;
        myrepoSelectedSkill = null;
        removeMyRepoListItem(name);
        closeDrawer();
      } else {
        alert('删除失败: ' + (result.message || '未知错误'));
      }
    }

    function myrepoApplyPreset(name, presetIdx) {
      var safeId = name.replace(/[^a-zA-Z0-9]/g, '_');
      var textarea = document.getElementById('myrepo-desc-' + safeId);
      if (!textarea) return;
      var template = presetIdx >= 0 ? UPLOAD_DESC_PRESETS[presetIdx].template : UPLOAD_DESC_TEMPLATE;
      textarea.value = template;
      uploadDescriptions[name] = template;
    }

    function countTreeNodes(tree) {
      var count = 0;
      for (var i = 0; i < tree.length; i++) {
        count += 1;
        if (tree[i].children) count += countTreeNodes(tree[i].children);
      }
      return count;
    }

    function renderTree(nodes) {
      return nodes.map(function(node) {
        var hasChildren = node.children && node.children.length > 0;
        var hasBullets = node.bulletPoints && node.bulletPoints.length > 0;
        var childCount = hasChildren ? countTreeNodes(node.children) : 0;
        var nodeId = 'tn_' + Math.random().toString(36).slice(2, 8);
        var h = '<div class="tree-node">'
          + '<div class="tree-header" onclick="toggleTreeNode(\'' + nodeId + '\', this)">'
          + '<span class="toggle">' + ((hasChildren || hasBullets) ? '▶' : '•') + '</span>'
          + '<span class="node-title level-' + node.level + '">' + escapeHtml(node.title) + '</span>'
          + (childCount > 0 ? '<span class="child-count">' + childCount + '</span>' : '')
          + '</div>';
        if (node.summary) h += '<div class="tree-summary">' + escapeHtml(node.summary) + '</div>';
        if (hasChildren || hasBullets) {
          h += '<div class="tree-children" id="' + nodeId + '">';
          if (hasBullets) {
            h += '<div class="tree-bullets">' + node.bulletPoints.map(function(b) { return '<div class="tree-bullet">' + escapeHtml(b) + '</div>'; }).join('') + '</div>';
          }
          if (hasChildren) h += renderTree(node.children);
          h += '</div>';
        }
        h += '</div>';
        return h;
      }).join('');
    }

    function toggleTreeNode(nodeId, headerEl) {
      var children = document.getElementById(nodeId);
      if (!children) return;
      children.classList.toggle('visible');
      headerEl.classList.toggle('expanded');
    }

    function closeDetail() {
      document.getElementById('detailPanel').classList.remove('open');
    }

    async function renderLog() {
      const content = document.getElementById('content');
      const log = await api('/api/log');
      lastLogCount = log.length;

      if (log.length === 0) {
        content.innerHTML = `
          <div class="page-title">📋 使用日志 <span class="live-badge">实时更新</span></div>
          <div class="empty-state">
            <div class="icon">💤</div>
            <p>暂无使用记录</p>
            <p style="font-family:var(--font-body); font-size:13px; margin-top:8px; color:var(--text2)">当 AI 通过 Skiller 检索和加载技能时，记录会自动出现在这里</p>
          </div>
        `;
        return;
      }

      var statsHtml = buildUsageStats(log);

      content.innerHTML = `
        <div class="page-title">📋 使用日志 <span class="live-badge">${log.length} 条 · 实时更新</span></div>
        ${statsHtml}
        <div class="log-section" id="logSection">
          ${log.map((entry, i) => renderLogEntry(entry, i === 0)).join('')}
        </div>
      `;
    }

    function buildUsageStats(log) {
      if (log.length < 2) return '';
      var toolCounts = {};
      var skillCounts = {};
      var dailyCounts = {};
      log.forEach(function(e) {
        toolCounts[e.tool] = (toolCounts[e.tool] || 0) + 1;
        if (e.args) {
          var sn = e.args.skillName || e.args.name || e.args.query || '';
          if (sn) skillCounts[sn] = (skillCounts[sn] || 0) + 1;
        }
        var day = (e.timestamp || '').substring(0, 10);
        if (day) dailyCounts[day] = (dailyCounts[day] || 0) + 1;
      });
      var topTools = Object.entries(toolCounts).sort(function(a,b) { return b[1]-a[1]; }).slice(0, 5);
      var topSkills = Object.entries(skillCounts).sort(function(a,b) { return b[1]-a[1]; }).slice(0, 5);
      var days = Object.keys(dailyCounts).sort().slice(-7);

      var html = '<div class="usage-stats-panel">';
      html += '<div class="usage-stats-grid">';

      html += '<div class="usage-stat-card"><div class="usage-stat-number">' + log.length + '</div><div class="usage-stat-label">总调用次数</div></div>';
      html += '<div class="usage-stat-card"><div class="usage-stat-number">' + Object.keys(toolCounts).length + '</div><div class="usage-stat-label">不同工具</div></div>';
      html += '<div class="usage-stat-card"><div class="usage-stat-number">' + Object.keys(skillCounts).length + '</div><div class="usage-stat-label">涉及技能</div></div>';
      html += '<div class="usage-stat-card"><div class="usage-stat-number">' + Object.keys(dailyCounts).length + '</div><div class="usage-stat-label">活跃天数</div></div>';

      html += '</div>';

      if (topTools.length > 0) {
        html += '<div class="usage-stats-row">';
        html += '<div class="usage-stat-section"><div class="usage-stat-section-title">🔧 最常用工具</div>';
        topTools.forEach(function(t) {
          var pct = Math.round(t[1] / log.length * 100);
          html += '<div class="usage-bar-row"><span class="usage-bar-label">' + escapeHtml(t[0]) + '</span><div class="usage-bar-bg"><div class="usage-bar-fill" style="width:' + pct + '%"></div></div><span class="usage-bar-val">' + t[1] + '</span></div>';
        });
        html += '</div>';

        if (topSkills.length > 0) {
          html += '<div class="usage-stat-section"><div class="usage-stat-section-title">⭐ 最常用技能</div>';
          topSkills.forEach(function(s) {
            var pct = Math.round(s[1] / log.length * 100);
            html += '<div class="usage-bar-row"><span class="usage-bar-label">' + escapeHtml(s[0]) + '</span><div class="usage-bar-bg"><div class="usage-bar-fill usage-bar-fill-skill" style="width:' + pct + '%"></div></div><span class="usage-bar-val">' + s[1] + '</span></div>';
          });
          html += '</div>';
        }
        html += '</div>';
      }

      if (days.length > 1) {
        var maxDay = Math.max.apply(null, days.map(function(d) { return dailyCounts[d]; }));
        html += '<div class="usage-stat-section"><div class="usage-stat-section-title">📅 最近 7 天活跃度</div>';
        html += '<div class="usage-mini-chart">';
        days.forEach(function(d) {
          var h = maxDay > 0 ? Math.round(dailyCounts[d] / maxDay * 40) : 0;
          html += '<div class="usage-mini-bar-col"><div class="usage-mini-bar" style="height:' + Math.max(h, 3) + 'px"></div><div class="usage-mini-day">' + d.substring(5) + '</div></div>';
        });
        html += '</div></div>';
      }

      html += '</div>';
      return html;
    }

    function renderLogEntry(entry, isNew) {
      const badgeClass = toolBadgeClass(entry.tool);
      const displayName = toolDisplayName(entry.tool);
      const argsStr = Object.entries(entry.args || {})
        .filter(([_, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ');

      return `
        <div class="log-entry ${isNew ? 'new-entry' : ''}">
          <div style="flex:1">
            <span class="tool-badge ${badgeClass}">${displayName}</span>
            <span class="tool-name">${entry.tool}</span>
            ${argsStr ? `<div style="color:var(--text2); font-size:12px; margin-top:4px; font-family:monospace; background:var(--bg); padding:4px 8px; border-radius:8px; display:inline-block">${escapeHtml(argsStr)}</div>` : ''}
            <div class="summary">${escapeHtml(entry.resultSummary)}</div>
          </div>
          <span class="time">${formatTime(entry.timestamp)}</span>
        </div>
      `;
    }

    // ========== 分类管理 ==========

    async function deleteLocalSkill(name) {
      if (!confirm('确定要删除本地技能 "' + name + '" 吗？此操作不可恢复！')) return;
      try {
        var result = await api('/api/skill/delete?name=' + encodeURIComponent(name));
        if (result.success) {
          showToast({ tool: 'delete', resultSummary: result.message, timestamp: new Date().toISOString() });
          allSkills = await api('/api/skills');
          document.getElementById('totalCount').textContent = allSkills.length;
          if (currentView === 'myrepo') renderMyRepo();
        } else {
          alert('删除失败: ' + result.message);
        }
      } catch { alert('网络错误'); }
    }

    async function exportLocalSkill(name) {
      try {
        const data = await api(`/api/skill/export?name=${encodeURIComponent(name)}`);
        if (data.content) {
          await navigator.clipboard.writeText(data.content);
          showToast({ tool: 'export', resultSummary: `"${name}" 内容已复制到剪贴板`, timestamp: new Date().toISOString() });
        } else {
          alert('导出失败');
        }
      } catch { alert('操作失败'); }
    }

    async function renderCategoryManager() {
      const content = document.getElementById('content');
      userCategories = await api('/api/categories/list');
      const roots = userCategories.filter(c => !c.parentId);

      function renderCatRow(cat, indent = 0) {
        const children = userCategories.filter(c => c.parentId === cat.id);
        const skillCount = allSkills.filter(s => s.categories.includes(cat.id)).length;
        let html = `
          <div style="display:flex; align-items:center; gap:8px; padding:10px 14px; padding-left:${14 + indent * 24}px; border-radius:12px; border:2px solid var(--border2); background:var(--bg2); margin-bottom:6px; transition:all 0.2s"
               onmouseenter="this.style.borderColor='var(--blue)'" onmouseleave="this.style.borderColor='var(--border2)'">
            <span style="font-size:18px">${cat.icon || '📦'}</span>
            <span style="flex:1; font-family:var(--font-display); font-size:15px">${escapeHtml(cat.label)}</span>
            <span style="font-size:12px; color:var(--text2); font-family:monospace">${escapeHtml(cat.id)}</span>
            <span class="count">${skillCount}</span>
            <button class="btn" style="padding:4px 10px; font-size:11px" onclick="addSubCategory('${escapeAttr(cat.id)}')">➕ 子分类</button>
            <button class="btn" style="padding:4px 10px; font-size:11px" onclick="renameCategoryPrompt('${escapeAttr(cat.id)}', '${escapeAttr(cat.label)}', '${escapeAttr(cat.icon || '')}')">✏️</button>
            <button class="btn btn-red" style="padding:4px 10px; font-size:11px" onclick="deleteCategoryConfirm('${escapeAttr(cat.id)}')">🗑️</button>
          </div>
        `;
        for (const child of children) {
          html += renderCatRow(child, indent + 1);
        }
        return html;
      }

      content.innerHTML = `
        <div class="page-title">⚙️ 分类管理</div>
        <p style="color:var(--text2); margin-bottom:16px; font-size:14px">
          创建自定义分类，然后在技能详情中为技能添加分类标签。每个技能可以属于多个分类。
        </p>

        <div style="display:flex; gap:8px; margin-bottom:20px; align-items:stretch">
          <input type="text" id="newCatLabel" placeholder="分类名称（如：前端开发）"
            style="flex:1; padding:12px 18px; border-radius:24px; border:3px solid var(--border); background:var(--surface); font-size:14px; font-family:var(--font-body); outline:none; box-shadow:var(--crayon-shadow)"
            onkeydown="if(event.key==='Enter') addRootCategory()">
          <input type="text" id="newCatIcon" placeholder="图标" value="" maxlength="2"
            style="width:60px; padding:12px; border-radius:24px; border:3px solid var(--border); background:var(--surface); font-size:18px; text-align:center; outline:none; box-shadow:var(--crayon-shadow)">
          <button class="btn btn-green" onclick="addRootCategory()" style="white-space:nowrap">➕ 添加分类</button>
        </div>

        <div id="catList">
          ${roots.length > 0
            ? roots.map(c => renderCatRow(c)).join('')
            : '<div class="empty-state"><div class="icon">📭</div><p>暂无分类，在上方创建你的第一个分类吧！</p></div>'
          }
        </div>

        ${allSkills.filter(s => s.categories.length === 0).length > 0 ? `
          <div style="margin-top:24px; padding-top:16px; border-top:3px dashed var(--border2)">
            <div style="font-family:var(--font-display); font-size:17px; color:var(--orange); margin-bottom:12px">
              📭 未分类的技能 (${allSkills.filter(s => s.categories.length === 0).length})
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px">
              ${allSkills.filter(s => s.categories.length === 0).map(s => '<span class="tag" style="font-size:12px; padding:4px 12px">' + escapeHtml(s.name) + '</span>').join('')}
            </div>
            <div style="margin-top:10px; font-size:12px; color:var(--text2)">前往「📦 我的本地仓库」管理分类</div>
          </div>
        ` : ''}
      `;
    }

    async function addRootCategory() {
      const label = document.getElementById('newCatLabel').value.trim();
      const icon = document.getElementById('newCatIcon').value.trim();
      if (!label) return;

      await api(`/api/categories/add?label=${encodeURIComponent(label)}&icon=${encodeURIComponent(icon)}`);
      document.getElementById('newCatLabel').value = '';
      document.getElementById('newCatIcon').value = '';
      showToast({ tool: 'category', resultSummary: `已添加分类: ${label}`, timestamp: new Date().toISOString() });

      allSkills = await api('/api/skills');
      categories = await api('/api/categories');
      userCategories = await api('/api/categories/list');
      renderCategoryManager();
    }

    async function refreshCatView() {
      allSkills = await api('/api/skills');
      categories = await api('/api/categories');
      userCategories = await api('/api/categories/list');
      if (currentView === 'myrepo' && document.getElementById('catListInMyRepo')) {
        showCatManagerInMyRepo();
      } else {
        renderCategoryManager();
      }
    }

    async function addSubCategory(parentId) {
      const label = prompt('输入子分类名称:');
      if (!label) return;
      const icon = prompt('输入图标 (可选):', '') || '';

      await api(`/api/categories/add?label=${encodeURIComponent(label)}&parentId=${encodeURIComponent(parentId)}&icon=${encodeURIComponent(icon)}`);
      showToast({ tool: 'category', resultSummary: `已添加子分类: ${label}`, timestamp: new Date().toISOString() });
      await refreshCatView();
    }

    async function renameCategoryPrompt(id, oldLabel, oldIcon) {
      const newLabel = prompt('新分类名称:', oldLabel);
      if (!newLabel || newLabel === oldLabel) return;
      const newIcon = prompt('新图标 (可选):', oldIcon) || '';

      await api(`/api/categories/rename?id=${encodeURIComponent(id)}&label=${encodeURIComponent(newLabel)}&icon=${encodeURIComponent(newIcon)}`);
      showToast({ tool: 'category', resultSummary: `已重命名为: ${newLabel}`, timestamp: new Date().toISOString() });
      await refreshCatView();
    }

    async function deleteCategoryConfirm(id) {
      if (!confirm(`确定要删除分类 "${id}" 及其所有子分类吗？\n（技能本身不会被删除，只会变成未分类）`)) return;

      await api(`/api/categories/remove?id=${encodeURIComponent(id)}`);
      showToast({ tool: 'category', resultSummary: `已删除分类: ${id}`, timestamp: new Date().toISOString() });
      await refreshCatView();
    }

    // ========== 我的 GitHub 社区 ==========

    let ghcSelectedSkill = null;
    let ghcSelectedSourceId = '';
    let ghcSkills = [];
    let ghcSearchQuery = '';
    let ghcRepoCategories = [];
    let ghcSkillCategories = {};
    let ghcCategoriesSha = null;
    let ghcCatFilter = '';

    async function renderGhCommunity(targetEl) {
      var content = targetEl || document.getElementById('communityBody') || document.getElementById('content');
      if (!communityConfig || !communityConfig.sources) {
        try { communityConfig = await api('/api/community/config'); } catch(e) { communityConfig = { sources: [] }; }
      }
      var allSources = (communityConfig.sources || []).filter(function(s) { return s.writable; });

      if (allSources.length === 0) {
        content.innerHTML = '<div class="ghc-layout">'
          + '<div style="display:flex; align-items:center; justify-content:center; height:100%; width:100%">'
          + '<div class="empty-state" style="max-width:400px; text-align:center">'
          + '<div class="icon" style="font-size:48px">🔗</div>'
          + '<h3 style="margin:12px 0 8px">尚未配置 GitHub 社区仓库</h3>'
          + '<p style="color:var(--text2); font-size:13px; margin-bottom:16px">请先点击下方按钮配置您的 GitHub 仓库。</p>'
          + '<button class="btn btn-blue" onclick="showGhcSettingsFullPage()">⚙️ 去配置</button>'
          + '</div></div></div>';
        return;
      }

      if (!ghcSelectedSourceId && allSources.length > 0) {
        ghcSelectedSourceId = allSources[0].id;
      }

      content.innerHTML = '<div class="myrepo-layout view-content">'
        + '<div class="myrepo-toolbar">'
        +   '<select style="padding:8px 14px; border-radius:10px; border:1.5px solid rgba(0,0,0,0.08); background:rgba(255,255,255,0.7); font-size:13px; font-family:var(--font-body); cursor:pointer; outline:none; font-weight:600; color:var(--text)" id="ghcSourceSelect" onchange="ghcSelectedSourceId=this.value; ghcSkills=[]; ghcSelectedSkill=null; loadGhcSkills()">'
        +     allSources.map(function(s) {
                var label = s.label || s.repo;
                return '<option value="' + escapeAttr(s.id) + '"' + (ghcSelectedSourceId === s.id ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
              }).join('')
        +   '</select>'
        +   '<input class="myrepo-search" id="ghcSearch" placeholder="搜索技能名称、作者..." oninput="debouncedGhcSearch(this.value)">'
        +   '<button class="myrepo-filter-btn" onclick="ghcSkills=[]; loadGhcSkills(true)" title="刷新">🔄 刷新</button>'
        +   '<button class="myrepo-filter-btn" onclick="showGhcImportPanel()" title="从 GitHub 导入">📥 导入</button>'
        +   '<button class="myrepo-filter-btn" onclick="showGhcAddRepoPanel()" title="添加仓库">➕ 添加仓库</button>'
        +   '<button class="myrepo-filter-btn" onclick="showGhcCatManager()" title="分类管理">🏷️ 分类</button>'
        +   '<button class="myrepo-filter-btn" onclick="showGhcSettings()" title="配置">⚙️ 配置</button>'
        + '</div>'
        + '<div class="myrepo-filter-bar">'
        +   '<select id="ghcCatSelect" onchange="ghcCatFilter=this.value; renderGhcList()">'
        +     '<option value="">全部分类</option>'
        +     '<option value="__uncategorized__">未分类</option>'
        +   '</select>'
        +   '<div class="myrepo-stats" id="ghcStats" style="display:flex; gap:12px; border:none; background:none">'
        +     '<span style="font-size:11px; color:var(--text2)">仓库: <b style="color:var(--blue)">-</b></span>'
        +     '<span style="font-size:11px; color:var(--text2)">已安装: <b style="color:var(--green)">-</b></span>'
        +   '</div>'
        +   '<span style="flex:1"></span>'
        +   '<span style="font-size:11px; color:var(--text2)" id="ghcResultCount"></span>'
        + '</div>'
        + '<div id="ghcImportPanel" style="display:none; padding:12px 20px; border-bottom:1px solid rgba(0,0,0,0.06); background:rgba(255,255,255,0.3)"></div>'
        + '<div id="ghcAddRepoPanel" style="display:none; padding:12px 20px; border-bottom:1px solid rgba(0,0,0,0.06); background:rgba(255,255,255,0.3)"></div>'
        + '<div class="community-grid" id="ghcList" style="padding:16px 20px; flex:1; overflow-y:auto; align-content:start"></div>'
        + '</div>'
        + '<div class="detail-drawer-overlay" id="ghcDrawerOverlay" onclick="closeGhcDrawer()"></div>'
        + '<div class="detail-drawer" id="ghcDrawer"></div>';

      loadGhcSkills();
    }

    async function loadGhcSkills(forceRefresh) {
      var listEl = document.getElementById('ghcList');
      var sourceId = ghcSelectedSourceId;

      if (!forceRefresh && ghcSkills.length === 0 && listEl) {
        listEl.innerHTML = skeletonList(5);
      }

      var skillsUrl = '/api/community/source-skills?sourceId=' + encodeURIComponent(sourceId);
      if (forceRefresh) skillsUrl += '&force=1';
      var catUrl = '/api/community/repo-categories?sourceId=' + encodeURIComponent(sourceId);
      if (forceRefresh) catUrl += '&force=1';

      var [skillResult, catResult] = await Promise.all([
        api(skillsUrl).catch(function() { return { skills: [] }; }),
        api(catUrl).catch(function() { return { categories: [], skillCategories: {}, sha: null }; })
      ]);

      ghcSkills = skillResult.skills || skillResult;
      ghcRepoCategories = catResult.categories || [];
      ghcSkillCategories = catResult.skillCategories || {};
      ghcCategoriesSha = catResult.sha || null;

      updateGhcStats();
      updateGhcCatSelect();
      renderGhcList();

      var isStale = skillResult.stale;
      if (isStale && !forceRefresh) {
        var staleEl = document.getElementById('ghcStaleHint');
        if (!staleEl) {
          var hintDiv = document.createElement('div');
          hintDiv.id = 'ghcStaleHint';
          hintDiv.style.cssText = 'position:absolute; top:4px; right:4px; font-size:10px; color:var(--text2); background:var(--bg2); padding:2px 8px; border-radius:12px; z-index:5';
          hintDiv.innerHTML = '⏳ 正在获取最新数据...';
          var listParent = listEl ? listEl.parentNode : null;
          if (listParent) { listParent.style.position = 'relative'; listParent.appendChild(hintDiv); }
        }

        try {
          var freshUrl = '/api/community/source-skills?sourceId=' + encodeURIComponent(sourceId) + '&force=1';
          var freshResult = await api(freshUrl);
          ghcSkills = freshResult.skills || freshResult;
          updateGhcStats();
          renderGhcList();
        } catch(e) {}

        var hintEl = document.getElementById('ghcStaleHint');
        if (hintEl) hintEl.remove();
      }

    }

    function removeGhcListItem(name) {
      var el = document.querySelector('#ghcList .community-card[data-skill="' + CSS.escape(name) + '"]');
      if (el) {
        el.style.transition = 'opacity 0.2s, transform 0.2s';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.95)';
        setTimeout(function() { el.remove(); }, 200);
      }
    }

    function removeMyRepoListItem(name) {
      var el = document.querySelector('#myrepoGrid .skill-card[data-skill="' + CSS.escape(name) + '"]');
      if (el) {
        el.style.transition = 'opacity 0.2s, transform 0.2s';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.95)';
        setTimeout(function() { el.remove(); }, 200);
      }
    }

    function updateMyRepoItemBadge(name, isUploaded) {
      // no-op: card grid doesn't show upload badges inline
    }

    function updateGhcStats() {
      var writableSources = (communityConfig.sources || []).filter(function(s) { return s.writable; });
      var installedCount = ghcSkills.filter(function(s) { return s.installed; }).length;
      var statsEl = document.getElementById('ghcStats');
      if (statsEl) {
        statsEl.innerHTML = '<span style="font-size:11px; color:var(--text2)">仓库: <b style="color:var(--blue)">' + ghcSkills.length + '</b></span>'
          + '<span style="font-size:11px; color:var(--text2)">已安装: <b style="color:var(--green)">' + installedCount + '</b></span>';
      }
    }

    function updateGhcCatSelect() {
      var sel = document.getElementById('ghcCatSelect');
      if (!sel) return;
      var html = '<option value="">全部分类</option><option value="__uncategorized__">未分类</option>';
      for (var i = 0; i < ghcRepoCategories.length; i++) {
        var c = ghcRepoCategories[i];
        html += '<option value="' + escapeAttr(c.id) + '"' + (ghcCatFilter === c.id ? ' selected' : '') + '>' + escapeHtml((c.icon || '') + ' ' + c.label) + '</option>';
      }
      sel.innerHTML = html;
    }

    function getGhcSkillCats(name) {
      return ghcSkillCategories[name] || [];
    }

    function renderGhcList() {
      var gridEl = document.getElementById('ghcList');
      if (!gridEl) return;
      var q = (ghcSearchQuery || '').toLowerCase().trim();
      var filtered = ghcSkills.filter(function(s) {
        if (ghcCatFilter === '__uncategorized__' && getGhcSkillCats(s.name).length > 0) return false;
        if (ghcCatFilter && ghcCatFilter !== '__uncategorized__' && getGhcSkillCats(s.name).indexOf(ghcCatFilter) < 0) return false;
        if (!q) return true;
        return s.name.toLowerCase().indexOf(q) >= 0
          || (s.description || '').toLowerCase().indexOf(q) >= 0
          || (s.author || '').toLowerCase().indexOf(q) >= 0;
      });

      var countEl = document.getElementById('ghcResultCount');
      if (countEl) countEl.textContent = filtered.length + ' / ' + ghcSkills.length + ' 个技能';

      if (filtered.length === 0) {
        gridEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1; padding:40px"><div class="icon">' + (ghcSkills.length === 0 ? '🌱' : '🔍') + '</div><p>' + (ghcSkills.length === 0 ? '此仓库暂无技能' : '没有匹配的技能') + '</p></div>';
        return;
      }

      gridEl.innerHTML = filtered.map(function(s) {
        var installed = s.installed;
        var desc = s.description || '暂无描述';
        if (desc.length > 120) desc = desc.substring(0, 120) + '...';
        var cats = getGhcSkillCats(s.name);
        var catLabels = cats.slice(0, 2).map(function(cid) {
          var cat = ghcRepoCategories.find(function(c) { return c.id === cid; });
          return cat ? (cat.icon || '') + ' ' + cat.label : cid;
        });
        var eName = escapeAttr(s.name).replace(/'/g, "\\'");
        var eUrl = escapeAttr(s.rawUrl || '').replace(/'/g, "\\'");
        return '<div class="community-card" data-skill="' + escapeAttr(s.name) + '">'
          + '<div style="display:flex; justify-content:space-between; align-items:flex-start; cursor:pointer" onclick="selectGhcSkill(\'' + eName + '\')">'
          +   '<div class="plaza-name">' + escapeHtml(s.name) + '</div>'
          +   (installed ? '<span class="tag" style="font-size:10px; background:var(--green-light,#e8f5e9); color:var(--green,#4caf50)">已安装</span>' : '')
          + '</div>'
          + '<div style="display:flex; gap:8px; align-items:center; margin-bottom:4px">'
          +   (s.author ? '<span class="author">by ' + escapeHtml(s.author) + '</span>' : '')
          +   catLabels.map(function(l) { return '<span class="tag" style="font-size:10px">' + escapeHtml(l) + '</span>'; }).join('')
          + '</div>'
          + '<div class="plaza-desc" style="margin-top:6px">' + escapeHtml(desc) + '</div>'
          + '<div class="plaza-actions" style="margin-top:12px">'
          +   (installed
            ? '<button class="btn-install installed" disabled>✓ 已安装</button>'
            : '<button class="btn-install" onclick="event.stopPropagation(); ghcInstallSkill(\'' + eName + '\', \'' + eUrl + '\', this)">⬇️ 安装</button>')
          +   '<button class="btn-preview" onclick="event.stopPropagation(); selectGhcSkill(\'' + eName + '\')">📄 查看详情</button>'
          +   '<button class="btn-preview" onclick="event.stopPropagation(); ghcCopyContent(\'' + eName + '\')">📋 复制</button>'
          + '</div>'
          + '</div>';
      }).join('');
    }

    function closeGhcDrawer() {
      var overlay = document.getElementById('ghcDrawerOverlay');
      var drawer = document.getElementById('ghcDrawer');
      if (overlay) overlay.classList.remove('open');
      if (drawer) drawer.classList.remove('open');
      ghcSelectedSkill = null;
    }

    async function selectGhcSkill(name) {
      ghcSelectedSkill = name;

      var drawer = document.getElementById('ghcDrawer');
      var overlay = document.getElementById('ghcDrawerOverlay');
      if (!drawer || !overlay) return;
      drawer.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:200px; color:var(--text2)"><span style="animation:spin 1s linear infinite; display:inline-block; font-size:24px">⏳</span></div>';
      drawer.classList.add('open');
      overlay.classList.add('open');

      var skill = ghcSkills.find(function(s) { return s.name === name; });
      if (!skill) {
        drawer.innerHTML = '<button class="drawer-close" onclick="closeGhcDrawer()" title="关闭">✕</button>'
          + '<div style="text-align:center; padding:40px; color:var(--text2)"><div style="font-size:32px; margin-bottom:12px">❌</div><div>未找到</div></div>';
        return;
      }

      var rawContent = '';
      try {
        var sourceParam = ghcSelectedSourceId ? '&sourceId=' + encodeURIComponent(ghcSelectedSourceId) : '';
        var proxyRes = await api('/api/community/fetch-content?url=' + encodeURIComponent(skill.rawUrl) + sourceParam);
        if (proxyRes.content) rawContent = proxyRes.content;
      } catch(e) {}

      var currentSource = (communityConfig.sources || []).find(function(s) { return s.id === ghcSelectedSourceId; });
      var isWritable = currentSource && currentSource.writable;
      var shareUrl = skill.htmlUrl || '';

      var html = '';
      html += '<div style="margin-bottom:16px">';
      html += '<h2 style="font-family:var(--font-display); font-size:22px; margin-bottom:8px">' + escapeHtml(skill.name) + '</h2>';
      html += '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px">';
      html += (skill.installed ? '<span class="tag" style="background:#e8f5e9; color:#2e7d32; font-weight:600">已安装本地</span>' : '<span class="tag" style="background:#fff3e0; color:#e65100; font-weight:600">未安装</span>');
      if (skill.author) html += '<span class="tag source">作者: ' + escapeHtml(skill.author) + '</span>';
      html += '<span class="tag tokens">' + (skill.size ? Math.round(skill.size/1024) + ' KB' : '') + '</span>';
      html += '<span class="tag" style="background:var(--bg2)">' + escapeHtml(skill.sourceLabel || '') + '</span>';
      html += '</div>';
      html += '<p style="color:var(--text2); font-size:13px; line-height:1.6; margin-bottom:4px">' + escapeHtml(skill.description || '无描述') + '</p>';
      html += '</div>';

      if (isWritable) {
        html += '<div class="myrepo-section">';
        html += '<div class="myrepo-section-title">✏️ 编辑信息</div>';
        html += '<div style="margin-bottom:8px">'
          + '<label style="font-size:11px; color:var(--text2); display:block; margin-bottom:4px">技能名称（重命名将在 GitHub 仓库中移动文件夹）</label>'
          + '<div style="display:flex; gap:6px; align-items:center">'
          + '<input type="text" id="ghcEditName" value="' + escapeAttr(skill.name) + '" style="flex:1; padding:8px 12px; border-radius:24px; border:1.5px solid var(--border2); background:var(--bg2); font-size:12px; font-family:monospace; outline:none; transition:border-color 0.2s" onfocus="this.style.borderColor=\'var(--blue)\'" onblur="this.style.borderColor=\'var(--border2)\'">'
          + '<button class="btn btn-blue" style="padding:5px 14px; font-size:12px; white-space:nowrap" onclick="ghcRenameSkill(\'' + escapeAttr(skill.name).replace(/'/g, "\\'") + '\')">重命名</button>'
          + '</div>'
          + '</div>';
        html += '<div style="margin-bottom:8px">'
          + '<label style="font-size:11px; color:var(--text2); display:block; margin-bottom:4px">技能描述（将保存为 DESCRIPTION.md，优先显示在卡片上）</label>'
          + '<textarea id="ghcEditDesc" style="width:100%; min-height:80px; padding:8px 12px; border-radius:12px; border:1.5px solid var(--border2); background:var(--bg2); font-size:12px; font-family:var(--font-body); line-height:1.5; resize:vertical; outline:none; transition:border-color 0.2s" onfocus="this.style.borderColor=\'var(--blue)\'" onblur="this.style.borderColor=\'var(--border2)\'" placeholder="为这个技能写一段描述...">' + escapeHtml(skill.description || '') + '</textarea>'
          + '</div>';
        html += '<button class="btn btn-green" style="padding:5px 14px; font-size:12px" onclick="ghcSaveDescription(\'' + escapeAttr(skill.name).replace(/'/g, "\\'") + '\')">💾 保存描述</button>';
        html += '<div style="font-size:10px; color:var(--text2); margin-top:4px">描述保存为 DESCRIPTION.md，独立于 SKILL.md</div>';
        html += '</div>';
      }

      // Category management for this skill
      var skillCatIds = getGhcSkillCats(skill.name);
      html += '<div class="myrepo-section">';
      html += '<div class="myrepo-section-title">🏷️ 分类</div>';
      if (ghcRepoCategories.length > 0) {
        html += '<div id="ghcSkillCatCheckboxes" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px">';
        for (var ci = 0; ci < ghcRepoCategories.length; ci++) {
          var gc = ghcRepoCategories[ci];
          var gcChecked = skillCatIds.indexOf(gc.id) >= 0 ? ' checked' : '';
          html += '<label style="display:flex; align-items:center; gap:4px; padding:3px 8px; border-radius:8px; border:1.5px solid var(--border2); background:var(--surface); cursor:pointer; font-size:11px; transition:all 0.2s">'
            + '<input type="checkbox" value="' + escapeAttr(gc.id) + '"' + gcChecked + ' style="accent-color:var(--red)">'
            + (gc.icon || '') + ' ' + escapeHtml(gc.label) + '</label>';
        }
        html += '</div>';
        if (isWritable) {
          html += '<button class="btn btn-green" style="padding:4px 12px; font-size:11px" onclick="saveGhcSkillCategories(\'' + escapeAttr(skill.name).replace(/'/g, "\\'") + '\')">💾 保存分类</button>';
        }
      } else {
        html += '<div style="font-size:12px; color:var(--text2)">此仓库暂无分类。' + (isWritable ? '点击左侧「🏷️ 分类」按钮创建。' : '') + '</div>';
      }
      html += '</div>';

      html += '<div class="myrepo-section">';
      html += '<div class="myrepo-section-title">⚡ 操作</div>';
      html += '<div class="myrepo-actions">';
      html += '<button class="action-btn action-export" onclick="ghcInstallSkill(\'' + escapeAttr(skill.name).replace(/'/g, "\\'") + '\', \'' + escapeAttr(skill.rawUrl).replace(/'/g, "\\'") + '\', this)"><span class="action-icon">📥</span> 安装到本地</button>';
      if (isWritable) {
        html += '<button class="action-btn action-delete" onclick="ghcDeleteSkill(\'' + escapeAttr(skill.name).replace(/'/g, "\\'") + '\', this)"><span class="action-icon">🗑️</span> 从仓库删除</button>';
      }
      html += '<button class="action-btn action-export" onclick="ghcCopyContent(\'' + escapeAttr(skill.name).replace(/'/g, "\\'") + '\')"><span class="action-icon">📋</span> 复制内容</button>';
      html += '</div></div>';

      if (shareUrl) {
        html += '<div class="myrepo-section">';
        html += '<div class="myrepo-section-title">🔗 分享</div>';
        html += '<div style="display:flex; gap:6px; align-items:center">';
        html += '<input type="text" readonly value="' + escapeAttr(shareUrl) + '" style="flex:1; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border2); background:var(--bg2); font-size:11px; font-family:monospace" onclick="this.select()">';
        html += '<button class="btn" style="font-size:11px; padding:5px 10px" onclick="navigator.clipboard.writeText(\'' + escapeAttr(shareUrl).replace(/'/g, "\\'") + '\'); showToast({tool:\'copy\', resultSummary:\'已复制分享链接\', timestamp:new Date().toISOString()})">📋 复制</button>';
        html += '</div>';
        html += '<div style="font-size:10px; color:var(--text2); margin-top:6px">其他用户可通过「📡 订阅外部GitHub仓库」添加仓库 <code>' + escapeHtml(currentSource ? currentSource.repo : '') + '</code> 来订阅所有技能</div>';
        html += '</div>';
      }

      html += '<div class="tab-bar" style="margin-top:0">';
      html += '<div class="tab-btn active" onclick="ghcSwitchTab(\'content\', this)">📄 内容预览</div>';
      html += '</div>';
      html += '<div id="ghcTabContent" class="tab-content"><pre style="font-size:12px; line-height:1.6; white-space:pre-wrap; word-break:break-word">' + escapeHtml(rawContent || '无法加载内容') + '</pre></div>';

      drawer.innerHTML = '<button class="drawer-close" onclick="closeGhcDrawer()" title="关闭">✕</button>' + html;
    }

    function ghcSwitchTab(tab, el) {
      el.parentNode.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      el.classList.add('active');
    }

    function ghcInstallSkill(name, rawUrl, btn) {
      var card = btn.closest('.community-card');
      if (card) {
        showInstallDialog(name, rawUrl, btn);
      } else {
        showInstallDrawer(name, rawUrl);
      }
    }

    function showInstallDrawer(name, rawUrl) {
      var overlay = document.getElementById('drawerOverlay');
      var drawer = document.getElementById('detailDrawer');
      if (!overlay || !drawer) return;
      overlay.classList.add('open');
      drawer.classList.add('open', 'drawer-flex');
      var eName = escapeAttr(name).replace(/'/g, "\\'");
      var eUrl = escapeAttr(rawUrl).replace(/'/g, "\\'");
      drawer.innerHTML = '<div class="drawer-header"><h2>安装 "' + escapeHtml(name) + '"</h2><button class="drawer-close" onclick="closeDrawer()">✕</button></div>'
        + '<div class="drawer-body" style="padding:24px">'
        +   '<p style="font-size:13px; color:var(--text2); margin-bottom:20px">选择安装方式：</p>'
        +   '<div class="mode-option" onclick="doCommunityInstallFromDrawer(\'' + eName + '\', \'' + eUrl + '\', \'local-repo\')">'
        +     '<div class="mode-option-icon">📥</div>'
        +     '<div class="mode-option-info">'
        +       '<div class="mode-option-title">下载到本地仓库 <span style="font-size:11px; color:#22c55e; font-weight:500">推荐</span></div>'
        +       '<div class="mode-option-desc">保存到本地技能库，稍后可给任意项目配置不同模式</div>'
        +     '</div>'
        +   '</div>'
        +   '<div class="mode-option" onclick="doCommunityInstallFromDrawer(\'' + eName + '\', \'' + eUrl + '\', \'global-skill\')">'
        +     '<div class="mode-option-icon">🌐</div>'
        +     '<div class="mode-option-info">'
        +       '<div class="mode-option-title">安装为全局 Skill</div>'
        +       '<div class="mode-option-desc">直接安装到 ~/.cursor/skills/，Agent 按需加载，所有项目共享</div>'
        +     '</div>'
        +   '</div>'
        +   '<div style="margin-top:16px; padding:12px; background:var(--bg2); border-radius:10px; font-size:12px; color:var(--text2); line-height:1.6">'
        +     '<b>💡 提示</b>：下载到本地仓库后，在「本地 Skill 管理」中可以给项目配置 6 种安装模式（Always / Auto / Agent / Manual / .cursorrules / 全局 Skill）'
        +   '</div>'
        + '</div>';
    }

    function showDrawerProjectPicker(name, rawUrl, mode) {
      var body = document.querySelector('.detail-drawer .drawer-body');
      if (!body) return;
      var projOptions = recentProjects.map(function(p) {
        return '<option value="' + escapeAttr(p) + '">' + escapeHtml(p.split('/').slice(-2).join('/')) + '</option>';
      }).join('');
      var extraFields = '';
      if (mode === 'rule-auto') {
        extraFields = '<div style="margin-bottom:16px">'
          + '<label style="font-size:12px; color:var(--text2); display:block; margin-bottom:6px">Globs 文件匹配模式</label>'
          + '<input type="text" id="drawerGlobs" placeholder="例如: *.py, *.ts, src/**/*.java" style="width:100%; padding:8px 12px; border-radius:10px; border:1.5px solid rgba(0,0,0,0.08); font-size:12px; font-family:monospace; outline:none; box-sizing:border-box">'
          + '<div style="display:flex; gap:5px; margin-top:6px; flex-wrap:wrap">'
          + ['*.py','*.ts','*.tsx','*.js','*.java','*.go','*.rs','*.css'].map(function(g) {
              return '<span style="font-size:11px; padding:3px 10px; border-radius:12px; background:var(--bg2,#f5f5f5); border:1px solid var(--border2,#e0e0e0); cursor:pointer; color:var(--text2)" onclick="var i=document.getElementById(\'drawerGlobs\'); i.value=i.value?(i.value+\','+g+'\'):\''+g+'\'">' + g + '</span>';
            }).join('')
          + '</div></div>';
      }
      if (mode === 'cursorrules') {
        extraFields = '<div style="margin-bottom:16px">'
          + '<label style="font-size:12px; color:var(--text2); display:block; margin-bottom:6px">写入方式</label>'
          + '<div style="display:flex; gap:12px">'
          + '<label style="font-size:12px; display:flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" name="drawerWriteMode" value="append" checked> 追加到末尾</label>'
          + '<label style="font-size:12px; display:flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" name="drawerWriteMode" value="replace"> 替换整个文件</label>'
          + '</div></div>';
      }
      body.innerHTML = '<p style="font-size:13px; font-weight:600; margin-bottom:12px">选择目标项目</p>'
        + '<div style="display:flex; gap:8px; margin-bottom:16px">'
        +   '<input type="text" id="drawerProjectPath" placeholder="项目路径..." style="flex:1; padding:8px 12px; border-radius:10px; border:1.5px solid rgba(0,0,0,0.08); font-size:13px; font-family:monospace; outline:none" value="' + escapeAttr(installProjectPath) + '">'
        +   (projOptions ? '<select style="padding:6px; border-radius:10px; border:1.5px solid rgba(0,0,0,0.08); font-size:12px; max-width:150px" onchange="if(this.value){document.getElementById(\'drawerProjectPath\').value=this.value}"><option value="">最近项目...</option>' + projOptions + '</select>' : '')
        + '</div>'
        + extraFields
        + '<button class="primary-btn" onclick="var p=document.getElementById(\'drawerProjectPath\').value.trim(); if(!p){alert(\'请输入项目路径\');return;} doCommunityInstallFromDrawer(\'' + escapeAttr(name).replace(/'/g, "\\'") + '\', \'' + escapeAttr(rawUrl).replace(/'/g, "\\'") + '\', \'' + mode + '\', p)">确认安装</button>';
    }

    async function doCommunityInstallFromDrawer(name, rawUrl, mode, projectPath) {
      var body = document.querySelector('.detail-drawer .drawer-body');
      if (body) body.innerHTML = '<div style="text-align:center; padding:40px"><div class="spinner"></div><p style="margin-top:12px; color:var(--text2)">正在安装...</p></div>';
      try {
        var params = '&mode=' + encodeURIComponent(mode);
        if (projectPath) params += '&projectPath=' + encodeURIComponent(projectPath);
        var globsEl = document.getElementById('drawerGlobs');
        if (globsEl && globsEl.value.trim()) params += '&globs=' + encodeURIComponent(globsEl.value.trim());
        var wmRadio = document.querySelector('input[name="drawerWriteMode"]:checked');
        if (wmRadio) params += '&writeMode=' + encodeURIComponent(wmRadio.value);
        var result = await api('/api/community/install?name=' + encodeURIComponent(name) + '&url=' + encodeURIComponent(rawUrl) + params);
        if (result.success) {
          if (body) body.innerHTML = '<div style="text-align:center; padding:40px"><div style="font-size:36px; margin-bottom:12px">✅</div><p style="font-size:15px; font-weight:600; color:var(--text)">安装成功！</p><p style="font-size:12px; color:var(--text2); margin-top:8px">' + escapeHtml(result.modeLabel || mode) + '</p><p style="font-size:11px; color:var(--text2); margin-top:4px; word-break:break-all">' + escapeHtml(result.path || '') + '</p></div>';
          allSkills = await api('/api/skills');
          document.getElementById('totalCount').textContent = allSkills.length;
          ghcSkills = ghcSkills.map(function(s) { return s.name === name ? Object.assign({}, s, {installed: true}) : s; });
          setTimeout(function() { closeDrawer(); renderGhcList(); }, 1500);
        } else {
          if (body) body.innerHTML = '<div style="text-align:center; padding:40px; color:red"><p>❌ ' + escapeHtml(result.error || '安装失败') + '</p></div>';
        }
      } catch(e) {
        if (body) body.innerHTML = '<div style="text-align:center; padding:40px; color:red"><p>❌ 网络错误</p></div>';
      }
    }

    async function ghcRenameSkill(oldName) {
      var nameEl = document.getElementById('ghcEditName');
      var newName = nameEl ? nameEl.value.trim() : '';
      if (!newName || newName === oldName) { alert('请输入一个不同的名称'); return; }
      var safeName = newName.replace(/[^a-zA-Z0-9_-]/g, '-');
      if (safeName !== newName) {
        if (!confirm('名称将被规范化为: ' + safeName + '\n是否继续？')) return;
      }
      if (!confirm('确定要将「' + oldName + '」重命名为「' + safeName + '」？\n此操作会在 GitHub 仓库中移动文件。')) return;

      showToast({ tool: 'rename', resultSummary: '正在重命名...', timestamp: new Date().toISOString() });
      try {
        var result = await api('/api/community/rename-skill?sourceId=' + encodeURIComponent(ghcSelectedSourceId)
          + '&oldName=' + encodeURIComponent(oldName)
          + '&newName=' + encodeURIComponent(safeName));
        if (result.success) {
          showToast({ tool: 'rename', resultSummary: '已重命名为 ' + safeName, timestamp: new Date().toISOString() });
          invalidateAllViews();
          ghcSkills = ghcSkills.map(function(s) {
            if (s.name === oldName) {
              s.name = safeName;
              s.htmlUrl = s.htmlUrl ? s.htmlUrl.replace('/' + oldName, '/' + safeName) : '';
              s.rawUrl = s.rawUrl ? s.rawUrl.replace('/' + oldName + '/', '/' + safeName + '/') : '';
            }
            return s;
          });
          if (ghcSkillCategories[oldName]) {
            ghcSkillCategories[safeName] = ghcSkillCategories[oldName];
            delete ghcSkillCategories[oldName];
            await saveGhcCategoriesData();
          }
          ghcSelectedSkill = safeName;
          renderGhcList();
          selectGhcSkill(safeName);
        } else {
          alert('重命名失败: ' + (result.message || '未知错误'));
        }
      } catch(e) {
        alert('请求失败');
      }
    }

    async function ghcSaveDescription(skillName) {
      var descEl = document.getElementById('ghcEditDesc');
      var description = descEl ? descEl.value.trim() : '';
      if (!description) { alert('请输入描述内容'); return; }
      try {
        var result = await apiPost('/api/community/upload-description', { sourceId: ghcSelectedSourceId, name: skillName, description: description });
        if (result.success) {
          showToast({ tool: 'edit', resultSummary: '已保存「' + skillName + '」的描述', timestamp: new Date().toISOString() });
          var skill = ghcSkills.find(function(s) { return s.name === skillName; });
          if (skill) skill.description = description;
          renderGhcList();
        } else {
          alert('保存失败: ' + (result.message || '未知错误'));
        }
      } catch(e) {
        alert('请求失败');
      }
    }

    async function ghcDeleteSkill(name, btn) {
      if (!confirm('确定要从仓库中删除「' + name + '」？')) return;
      var origText = btn.innerHTML;
      btn.innerHTML = '<span class="action-icon" style="animation:spin 1s linear infinite">⏳</span> 删除中...';
      btn.disabled = true;
      try {
        var result = await api('/api/community/delete?name=' + encodeURIComponent(name) + '&sourceId=' + encodeURIComponent(ghcSelectedSourceId));
        if (result.success) {
          showToast({ tool: 'delete', resultSummary: '已从仓库删除 ' + name, timestamp: new Date().toISOString() });
          invalidateAllViews();
          ghcSkills = ghcSkills.filter(function(s) { return s.name !== name; });
          ghcSelectedSkill = null;
          removeGhcListItem(name);
          updateGhcStats();
          closeGhcDrawer();
        } else {
          btn.innerHTML = '<span class="action-icon">❌</span> ' + (result.message || '失败').slice(0, 20);
        }
      } catch(e) {
        btn.innerHTML = '<span class="action-icon">❌</span> 失败';
      }
      btn.disabled = false;
      setTimeout(function() { btn.innerHTML = origText; }, 3000);
    }

    function ghcCopyContent(name) {
      var skill = ghcSkills.find(function(s) { return s.name === name; });
      if (!skill) return;
      fetch(skill.rawUrl, { signal: AbortSignal.timeout(10000) })
        .then(function(r) { return r.text(); })
        .then(function(text) {
          navigator.clipboard.writeText(text);
          showToast({ tool: 'copy', resultSummary: '已复制 ' + name + ' 的内容', timestamp: new Date().toISOString() });
        }).catch(function() { alert('复制失败'); });
    }

    function showGhcImportPanel() {
      var panel = document.getElementById('ghcImportPanel');
      if (!panel) return;
      if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }

      var writableSources = (communityConfig.sources || []).filter(function(s) { return s.writable; });
      if (writableSources.length === 0) {
        panel.innerHTML = '<div style="color:var(--orange); font-size:12px">⚠️ 没有可写仓库。请先点击右上方「⚙️ 配置」按钮设置 GitHub Token 和仓库。</div>';
        panel.style.display = 'block';
        return;
      }

      var targetOptions = writableSources.map(function(s) {
        return '<option value="' + escapeAttr(s.id) + '">' + escapeHtml(s.label || s.repo) + '</option>';
      }).join('');

      var catCheckboxes = '';
      if (ghcRepoCategories.length > 0) {
        catCheckboxes = '<div style="margin-bottom:6px">'
          + '<div style="font-size:11px; color:var(--text2); margin-bottom:4px">选择分类（可多选）:</div>'
          + '<div id="ghcImportCatList" style="display:flex; flex-wrap:wrap; gap:4px">';
        for (var ci = 0; ci < ghcRepoCategories.length; ci++) {
          var c = ghcRepoCategories[ci];
          catCheckboxes += '<label style="display:inline-flex; align-items:center; gap:3px; font-size:11px; padding:3px 8px; border-radius:24px; border:1px solid var(--border2); cursor:pointer; background:var(--surface)">'
            + '<input type="checkbox" value="' + escapeAttr(c.id) + '" style="margin:0">'
            + '<span>' + escapeHtml((c.icon || '') + ' ' + c.label) + '</span></label>';
        }
        catCheckboxes += '</div></div>';
      }

      panel.innerHTML = '<div style="font-size:12px; font-weight:600; margin-bottom:8px">📥 从 GitHub 链接导入技能</div>'
        + '<div style="font-size:11px; color:var(--text2); margin-bottom:8px">导入后会自动标注原作者</div>'
        + '<input type="text" id="ghcImportUrl" placeholder="GitHub 链接 (如 github.com/user/repo/blob/main/skills/xxx)" style="width:100%; padding:6px 10px; border-radius:24px; border:1.5px solid var(--border2); background:var(--surface); font-size:11px; font-family:monospace; outline:none; margin-bottom:6px">'
        + '<input type="text" id="ghcImportName" placeholder="（可选）自定义技能名称" style="width:100%; padding:6px 10px; border-radius:24px; border:1.5px solid var(--border2); background:var(--surface); font-size:11px; outline:none; margin-bottom:6px">'
        + catCheckboxes
        + '<div style="display:flex; gap:6px; align-items:center">'
        + '<span style="font-size:11px; color:var(--text2)">目标仓库:</span>'
        + '<select id="ghcImportTarget" style="flex:1; padding:4px 8px; border-radius:24px; border:1px solid var(--border2); font-size:11px; background:var(--surface)">' + targetOptions + '</select>'
        + '<button class="btn btn-green" style="font-size:11px; padding:5px 12px" onclick="doGhcImport()">导入</button>'
        + '</div>'
        + '<div id="ghcImportResult" style="margin-top:6px; font-size:11px"></div>';
      panel.style.display = 'block';
    }

    async function doGhcImport() {
      var url = document.getElementById('ghcImportUrl').value.trim();
      var name = document.getElementById('ghcImportName').value.trim();
      var sourceId = document.getElementById('ghcImportTarget').value;
      var resultEl = document.getElementById('ghcImportResult');
      if (!url) { if (resultEl) resultEl.innerHTML = '<span style="color:var(--red)">请输入 GitHub 链接</span>'; return; }

      var selectedCats = [];
      var catCheckboxes = document.querySelectorAll('#ghcImportCatList input[type=checkbox]');
      catCheckboxes.forEach(function(cb) { if (cb.checked) selectedCats.push(cb.value); });

      if (resultEl) resultEl.innerHTML = '<span style="animation:spin 1s linear infinite; display:inline-block">⏳</span> 导入中...';

      try {
        var apiUrl = '/api/community/import-url?url=' + encodeURIComponent(url) + '&sourceId=' + encodeURIComponent(sourceId);
        if (name) apiUrl += '&name=' + encodeURIComponent(name);
        var result = await api(apiUrl);
        if (result.success) {
          if (resultEl) resultEl.innerHTML = '<span style="color:var(--green)">✅ ' + escapeHtml(result.message) + '</span>';
          showToast({ tool: 'import', resultSummary: result.message, timestamp: new Date().toISOString() });
          invalidateAllViews();

          if (selectedCats.length > 0 && result.name) {
            ghcSkillCategories[result.name] = selectedCats;
            await saveGhcCategoriesData();
          }

          if (result.skill) {
            var exists = ghcSkills.some(function(s) { return s.name === result.skill.name; });
            if (!exists) {
              ghcSkills.push(result.skill);
            } else {
              ghcSkills = ghcSkills.map(function(s) { return s.name === result.skill.name ? result.skill : s; });
            }
            updateGhcStats();
            renderGhcList();
          }
          api('/api/community/refresh').catch(function() {});

          var urlInput = document.getElementById('ghcImportUrl');
          var nameInput = document.getElementById('ghcImportName');
          if (urlInput) urlInput.value = '';
          if (nameInput) nameInput.value = '';
        } else {
          if (resultEl) resultEl.innerHTML = '<span style="color:var(--red)">❌ ' + escapeHtml(result.message) + '</span>';
        }
      } catch(e) {
        if (resultEl) resultEl.innerHTML = '<span style="color:var(--red)">❌ 请求失败</span>';
      }
    }

    function showGhcAddRepoPanel() {
      var panel = document.getElementById('ghcAddRepoPanel');
      if (!panel) return;
      if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }

      panel.innerHTML = '<div style="font-size:12px; font-weight:600; margin-bottom:8px">➕ 添加我的 GitHub 仓库</div>'
        + '<input type="text" id="ghcNewRepo" placeholder="owner/repo (如 myname/my-skills)" style="width:100%; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border2); background:var(--surface); font-size:11px; font-family:monospace; outline:none; margin-bottom:6px">'
        + '<input type="text" id="ghcNewLabel" placeholder="显示名称" style="width:100%; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border2); background:var(--surface); font-size:11px; outline:none; margin-bottom:6px">'
        + '<div style="display:flex; gap:6px; align-items:center; margin-bottom:6px">'
        + '<input type="text" id="ghcNewBranch" placeholder="分支 (默认 main)" value="main" style="flex:1; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border2); background:var(--surface); font-size:11px; outline:none">'
        + '<input type="text" id="ghcNewPath" placeholder="技能目录 (默认 skills)" value="skills" style="flex:1; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border2); background:var(--surface); font-size:11px; outline:none">'
        + '</div>'
        + '<div style="margin-bottom:6px">'
        + '<input type="text" id="ghcNewToken" placeholder="GitHub Token（必填，用于读写仓库）" style="width:100%; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border2); background:var(--surface); font-size:11px; font-family:monospace; outline:none">'
        + '</div>'
        + '<div style="display:flex; gap:6px">'
        + '<button class="btn btn-green" style="font-size:11px; padding:5px 12px" onclick="doGhcAddRepo()">添加</button>'
        + '<button class="btn" style="font-size:11px; padding:5px 12px" onclick="document.getElementById(\'ghcAddRepoPanel\').style.display=\'none\'">取消</button>'
        + '</div>'
        + '<div id="ghcAddRepoResult" style="margin-top:6px; font-size:11px"></div>';
      panel.style.display = 'block';
    }

    async function doGhcAddRepo() {
      var repo = document.getElementById('ghcNewRepo').value.trim();
      var label = document.getElementById('ghcNewLabel').value.trim() || repo;
      var branch = document.getElementById('ghcNewBranch').value.trim() || 'main';
      var skillsPath = document.getElementById('ghcNewPath').value.trim() || 'skills';
      var token = document.getElementById('ghcNewToken').value.trim();
      var writable = true;
      var resultEl = document.getElementById('ghcAddRepoResult');

      if (!repo) { if (resultEl) resultEl.innerHTML = '<span style="color:var(--red)">请输入仓库地址</span>'; return; }

      if (resultEl) resultEl.innerHTML = '<span style="animation:spin 1s linear infinite; display:inline-block">⏳</span> 添加中...';

      try {
        var result = await apiPost('/api/community/add-source', { repo: repo, label: label, branch: branch, skillsPath: skillsPath, writable: writable ? 'true' : 'false', token: token || undefined });
        if (result.success) {
          showToast({ tool: 'source', resultSummary: '已添加仓库 ' + repo, timestamp: new Date().toISOString() });
          communityConfig = await api('/api/community/config');
          communityLoaded = false;
          ghcSelectedSourceId = repo.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
          renderGhCommunity();
        } else {
          if (resultEl) resultEl.innerHTML = '<span style="color:var(--red)">❌ ' + escapeHtml(result.error || '失败') + '</span>';
        }
      } catch(e) {
        if (resultEl) resultEl.innerHTML = '<span style="color:var(--red)">❌ 请求失败</span>';
      }
    }

    async function saveGhcSkillCategories(skillName) {
      var checkboxes = document.querySelectorAll('#ghcSkillCatCheckboxes input[type=checkbox]');
      var selected = [];
      checkboxes.forEach(function(cb) { if (cb.checked) selected.push(cb.value); });
      ghcSkillCategories[skillName] = selected;
      await saveGhcCategoriesData();
      showToast({ tool: 'tag', resultSummary: '已更新 ' + skillName + ' 的分类', timestamp: new Date().toISOString() });
      renderGhcList();
    }

    async function saveGhcCategoriesData() {
      var data = JSON.stringify({ categories: ghcRepoCategories, skillCategories: ghcSkillCategories }, null, 2);
      var result = await apiPost('/api/community/save-repo-categories', { sourceId: ghcSelectedSourceId, data: data, sha: ghcCategoriesSha || undefined });
      if (result.success) {
        ghcCategoriesSha = result.sha;
      } else {
        alert('保存分类失败: ' + (result.message || '未知错误'));
      }
      return result;
    }

    function showGhcCatManager() {
      var right = document.getElementById('ghcDrawer');
      var overlay = document.getElementById('ghcDrawerOverlay');
      if (!right) return;
      if (overlay) overlay.classList.add('open');
      right.classList.add('open');
      var currentSource = (communityConfig.sources || []).find(function(s) { return s.id === ghcSelectedSourceId; });
      var isWritable = currentSource && currentSource.writable;

      var html = '<div style="padding:4px 0">';
      html += '<h2 style="font-family:var(--font-display); font-size:20px; margin-bottom:16px">🏷️ 仓库分类管理</h2>';
      html += '<div style="font-size:12px; color:var(--text2); margin-bottom:16px">管理此仓库的分类体系，分类数据存储在仓库的 categories.json 中。</div>';

      html += '<div class="myrepo-section">';
      html += '<div class="myrepo-section-title">现有分类 (' + ghcRepoCategories.length + ')</div>';
      if (ghcRepoCategories.length === 0) {
        html += '<div style="font-size:12px; color:var(--text2); padding:10px 0">暂无分类</div>';
      } else {
        html += '<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px">';
        for (var ci = 0; ci < ghcRepoCategories.length; ci++) {
          var c = ghcRepoCategories[ci];
          var count = 0;
          for (var sk in ghcSkillCategories) { if (ghcSkillCategories[sk] && ghcSkillCategories[sk].indexOf(c.id) >= 0) count++; }
          html += '<div style="display:flex; align-items:center; gap:6px; padding:6px 12px; border-radius:8px; border:1.5px solid var(--border2); background:var(--surface); font-size:12px">'
            + '<span>' + (c.icon || '📁') + ' ' + escapeHtml(c.label) + '</span>'
            + '<span style="color:var(--text2); font-size:10px">(' + count + ')</span>';
          if (isWritable) {
            html += '<button style="background:none; border:none; cursor:pointer; font-size:12px; color:var(--red); padding:0 2px" onclick="ghcRemoveCategory(\'' + escapeAttr(c.id) + '\')">✕</button>';
          }
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';

      if (isWritable) {
        html += '<div class="myrepo-section">';
        html += '<div class="myrepo-section-title">➕ 添加分类</div>';
        html += '<div style="display:flex; gap:6px; align-items:center">';
        html += '<input type="text" id="ghcNewCatIcon" placeholder="图标" style="width:50px; padding:6px; border-radius:8px; border:1.5px solid var(--border2); background:var(--bg2); font-size:14px; text-align:center; outline:none" value="📁">';
        html += '<input type="text" id="ghcNewCatLabel" placeholder="分类名称" style="flex:1; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border2); background:var(--bg2); font-size:12px; outline:none">';
        html += '<button class="btn btn-green" style="font-size:11px; padding:5px 12px" onclick="ghcAddCategory()">添加</button>';
        html += '</div></div>';
      }
      html += '</div>';

      right.innerHTML = '<button class="drawer-close" onclick="closeGhcDrawer()" title="关闭">✕</button>' + html;
    }

    async function ghcAddCategory() {
      var icon = document.getElementById('ghcNewCatIcon').value.trim() || '📁';
      var label = document.getElementById('ghcNewCatLabel').value.trim();
      if (!label) { alert('请输入分类名称'); return; }
      var id = label.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-').toLowerCase();
      if (ghcRepoCategories.find(function(c) { return c.id === id; })) { alert('分类已存在'); return; }
      ghcRepoCategories.push({ id: id, label: label, icon: icon });
      var result = await saveGhcCategoriesData();
      if (result.success) {
        showToast({ tool: 'category', resultSummary: '已添加分类: ' + label, timestamp: new Date().toISOString() });
        updateGhcCatSelect();
        showGhcCatManager();
      }
    }

    async function ghcRemoveCategory(catId) {
      if (!confirm('确定删除此分类？')) return;
      ghcRepoCategories = ghcRepoCategories.filter(function(c) { return c.id !== catId; });
      for (var sk in ghcSkillCategories) {
        if (ghcSkillCategories[sk]) {
          ghcSkillCategories[sk] = ghcSkillCategories[sk].filter(function(c) { return c !== catId; });
        }
      }
      var result = await saveGhcCategoriesData();
      if (result.success) {
        showToast({ tool: 'category', resultSummary: '已删除分类', timestamp: new Date().toISOString() });
        updateGhcCatSelect();
        showGhcCatManager();
      }
    }

    function showGhcSettingsFullPage() {
      var content = document.getElementById('content');
      var cfg = communityConfig || {};
      content.innerHTML = '<div style="max-width:560px; margin:40px auto; padding:24px">'
        + '<div class="page-title" style="font-size:20px; margin-bottom:20px">⚙️ 配置我的私人 GitHub 在线社区</div>'
        + '<div class="community-config">'
        + '<h3 style="font-size:14px; margin-bottom:8px">🔗 我的社区仓库</h3>'
        + '<p style="font-size:12px; color:var(--text2); margin-bottom:12px">这是你自己的社区仓库，你有写权限可以直接上传技能。</p>'
        + '<div class="config-field"><label>社区仓库 (owner/repo)</label>'
        + '<input type="text" id="cfgRepo" value="' + escapeAttr(cfg.repo || '') + '" placeholder="例如: your-team/skill-community"></div>'
        + '<div class="config-field"><label>分支</label>'
        + '<input type="text" id="cfgBranch" value="' + escapeAttr(cfg.branch || 'main') + '" placeholder="main"></div>'
        + '<div class="config-field"><label>技能目录</label>'
        + '<input type="text" id="cfgPath" value="' + escapeAttr(cfg.skillsPath || 'skills') + '" placeholder="skills"></div>'
        + '<div class="config-field"><label>GitHub Token</label>'
        + '<input type="password" id="cfgToken" value="' + escapeAttr(cfg.githubToken || '') + '" placeholder="ghp_xxxx...">'
        + '<div class="hint">Personal Access Token，需要 repo 权限。<a href="https://github.com/settings/tokens/new" target="_blank" style="color:var(--blue)">去创建</a></div></div>'
        + '<div class="config-field"><label>作者名称</label>'
        + '<input type="text" id="cfgAuthor" value="' + escapeAttr(cfg.authorName || '') + '" placeholder="你的名字或团队名"></div>'
        + '<div style="display:flex; gap:8px; margin-top:20px">'
        + '<button class="btn btn-green" onclick="saveCommunityConfigAndReturn()">💾 保存配置</button>'
        + '</div></div></div>';
    }

    function showGhcSettings() {
      var right = document.getElementById('ghcDrawer');
      var overlay = document.getElementById('ghcDrawerOverlay');
      if (!right) return;
      if (overlay) overlay.classList.add('open');
      right.classList.add('open');
      var cfg = communityConfig || {};
      right.innerHTML = '<button class="drawer-close" onclick="closeGhcDrawer()" title="关闭">✕</button><div style="padding:4px 0">'
        + '<div class="page-title" style="font-size:18px; margin-bottom:16px">⚙️ 配置我的私人 GitHub 在线社区</div>'
        + '<div class="community-config">'
        + '<h3 style="font-size:14px; margin-bottom:8px">🔗 我的社区仓库</h3>'
        + '<p style="font-size:12px; color:var(--text2); margin-bottom:12px">这是你自己的社区仓库，你有写权限可以直接上传技能。</p>'
        + '<div class="config-field"><label>社区仓库 (owner/repo)</label>'
        + '<input type="text" id="cfgRepo" value="' + escapeAttr(cfg.repo || '') + '" placeholder="例如: your-team/skill-community"></div>'
        + '<div class="config-field"><label>分支</label>'
        + '<input type="text" id="cfgBranch" value="' + escapeAttr(cfg.branch || 'main') + '" placeholder="main"></div>'
        + '<div class="config-field"><label>技能目录</label>'
        + '<input type="text" id="cfgPath" value="' + escapeAttr(cfg.skillsPath || 'skills') + '" placeholder="skills"></div>'
        + '<div class="config-field"><label>GitHub Token</label>'
        + '<input type="password" id="cfgToken" value="' + escapeAttr(cfg.githubToken || '') + '" placeholder="ghp_xxxx...">'
        + '<div class="hint">Personal Access Token，需要 repo 权限。<a href="https://github.com/settings/tokens/new" target="_blank" style="color:var(--blue)">去创建</a></div></div>'
        + '<div class="config-field"><label>作者名称</label>'
        + '<input type="text" id="cfgAuthor" value="' + escapeAttr(cfg.authorName || '') + '" placeholder="你的名字或团队名"></div>'
        + '<div style="display:flex; gap:8px; margin-top:20px">'
        + '<button class="btn btn-green" onclick="saveCommunityConfigAndReturn()">💾 保存配置</button>'
        + '</div></div></div>';
    }

    async function saveCommunityConfigAndReturn() {
      var repo = document.getElementById('cfgRepo').value.trim();
      var branch = document.getElementById('cfgBranch').value.trim() || 'main';
      var skillsPath = document.getElementById('cfgPath').value.trim() || 'skills';
      var token = document.getElementById('cfgToken').value.trim();
      var author = document.getElementById('cfgAuthor').value.trim();
      communityConfig = await apiPost('/api/community/save-config', { repo: repo, branch: branch, skillsPath: skillsPath, token: token, author: author });
      communityLoaded = false;
      showToast({ tool: 'config', resultSummary: '社区配置已保存', timestamp: new Date().toISOString() });
      renderGhCommunity();
    }

    var _dirtyViews = { community: false, ghcommunity: false, myrepo: false };
    var _prefetchInFlight = {};

    function prefetchView(view) {
      if (currentView === view) return;
      if (_prefetchInFlight[view]) return;
      _prefetchInFlight[view] = true;

      if (view === 'community' && _dirtyViews.community) {
        api('/api/community/skills?light=1').then(function(r) { communitySkills = r; }).catch(function() {});
      }
      if (view === 'ghcommunity' && _dirtyViews.ghcommunity && ghcSelectedSourceId) {
        api('/api/community/source-skills?sourceId=' + encodeURIComponent(ghcSelectedSourceId)).then(function(r) { ghcSkills = r.skills || r; }).catch(function() {});
      }
      if (view === 'myrepo' && _dirtyViews.myrepo) {
        api('/api/skills').then(function(r) { allSkills = r; }).catch(function() {});
      }

      setTimeout(function() { _prefetchInFlight[view] = false; }, 5000);
    }

    function invalidateAllViews() {
      _dirtyViews.community = true;
      _dirtyViews.ghcommunity = true;
      _dirtyViews.myrepo = true;
    }

    function markViewClean(view) {
      _dirtyViews[view] = false;
    }

    // ========== 社区 ==========

    let communitySkills = [];
    let communityConfig = {};
    let communityLoaded = false;
    let communityTab = 'browse';

    async function renderCommunity() {
      const content = document.getElementById('content');

      if (!communityLoaded) {
        communityConfig = await api('/api/community/config');
        communityLoaded = true;
      }

      const hasRepo = !!communityConfig.repo;
      const sources = communityConfig.sources || [];

      content.innerHTML = `
        <div class="view-content">
        <div class="page-title">🌍 社区</div>

        <div class="tab-bar" style="margin-bottom:20px">
          <div class="tab-btn ${communityTab==='browse'?'active':''}" onclick="communityTab='browse'; renderCommunity()">🌐 浏览技能</div>
          <div class="tab-btn ${communityTab==='sources'?'active':''}" onclick="communityTab='sources'; renderCommunity()">📡 订阅源管理</div>
          <div class="tab-btn ${communityTab==='mycommunity'?'active':''}" onclick="communityTab='mycommunity'; renderCommunity()">🔗 我的 GitHub 社区</div>
        </div>

        <div id="communityBody"></div>
        </div>
      `;

      const body = document.getElementById('communityBody');

      if (!hasRepo && communityTab === 'submissions') {
        communityTab = 'browse';
      }
      if (communityTab === 'help') communityTab = 'browse';

      if (communityTab === 'submissions' || communityTab === 'linkinstall') communityTab = 'browse';

      switch (communityTab) {
        case 'browse': renderCommunityBrowse(body); break;
        case 'sources': renderCommunitySources(body); break;
        case 'settings': renderCommunitySettings(body); break;
        case 'mycommunity': renderGhCommunity(); break;
      }
    }

    async function renderCommunityBrowse(container) {
      const sources = communityConfig.sources || [];
      const hasRepo = !!communityConfig.repo;
      const hasAnySources = hasRepo || sources.length > 0;

      if (!hasAnySources) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="icon">🌐</div>
            <p>还没有订阅任何技能源</p>
            <p style="font-family:var(--font-body); font-size:13px; margin-top:8px; color:var(--text2)">
              点击「📡 订阅源管理」添加仓库地址，即可浏览和安装技能！
            </p>
            <button class="btn btn-blue" style="margin-top:16px" onclick="communityTab='sources'; renderCommunity()">📡 去订阅</button>
          </div>
        `;
        return;
      }

      const repoLabel = hasRepo ? communityConfig.repo : `${sources.length} 个订阅源`;
      container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
          <h3 style="font-family:var(--font-display); color:var(--pink); font-size:17px">
            🌐 全部社区技能
            <span style="font-size:13px; color:var(--text2); font-family:var(--font-body)">${escapeHtml(repoLabel)}</span>
          </h3>
          <button class="btn" onclick="refreshCommunity()">🔄 刷新</button>
        </div>
        <div id="communityList">
          <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px">
            ${Array.from({length:8}, () => '<div class="skeleton-item" style="height:140px"></div>').join('')}
          </div>
        </div>
      `;
      loadCommunitySkills();
    }

    let communityPage = 0;
    const COMMUNITY_PAGE_SIZE = 30;
    let communityLoadingMore = false;
    let communityEnrichedUpTo = 0;
    let communityEnriching = false;
    let communityFilterSource = 'all';
    let communitySearchTerm = '';

    function getFilteredCommunity() {
      let list = communitySkills;
      if (communityFilterSource !== 'all') {
        list = list.filter(s => s.sourceLabel === communityFilterSource);
      }
      if (communitySearchTerm) {
        const q = communitySearchTerm.toLowerCase();
        list = list.filter(s => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q));
      }
      return list;
    }

    function renderCommunityList() {
      const filtered = getFilteredCommunity();
      const visibleEnd = (communityPage + 1) * COMMUNITY_PAGE_SIZE;
      const visible = filtered.slice(0, visibleEnd);
      const remaining = filtered.length - visible.length;

      const grid = document.getElementById('communityGrid');
      if (grid) grid.innerHTML = visible.map(renderCommunityCard).join('');

      const loadMoreEl = document.getElementById('communityLoadMore');
      if (loadMoreEl) {
        if (remaining > 0) {
          loadMoreEl.innerHTML = `<button class="btn btn-blue" onclick="loadMoreCommunitySkills()">加载更多 (${remaining} 剩余)</button>`;
        } else if (filtered.length > 0) {
          loadMoreEl.innerHTML = '<span style="color:var(--text2); font-size:13px">已显示全部</span>';
        } else {
          loadMoreEl.innerHTML = '';
        }
      }
    }

    async function loadCommunitySkills() {
      communityPage = 0;
      communitySkills = [];
      communityEnrichedUpTo = 0;
      communityFilterSource = 'all';
      communitySearchTerm = '';

      const listEl = document.getElementById('communityList');
      if (!listEl) return;
      listEl.innerHTML = '<div class="empty-state"><div class="icon" style="animation:spin 1s linear infinite">⏳</div><p>正在加载技能列表...</p></div>';

      const t0 = performance.now();
      try {
        var rawResult = await api('/api/community/skills?light=1');
        if (rawResult && rawResult._errors) {
          var errMsgs = rawResult._errors.map(function(e) { return e.repo + ': ' + e.error; }).join('\n');
          showToast({ tool: 'community', resultSummary: '⚠️ 部分源加载失败: ' + rawResult._errors.length + ' 个', timestamp: new Date().toISOString() });
          communitySkills = rawResult.skills || rawResult;
        } else {
          communitySkills = Array.isArray(rawResult) ? rawResult : (rawResult.skills || []);
        }
        const loadMs = Math.round(performance.now() - t0);
        const isFast = loadMs < 500;

        if (communitySkills.length === 0) {
          listEl.innerHTML = '<div class="empty-state"><div class="icon">🌱</div><p>社区还没有技能，成为第一个上传者吧！</p></div>';
          return;
        }

        const hasDesc = communitySkills.some(s => s.description && s.description !== s.name + ' skill');
        if (hasDesc) {
          communityEnrichedUpTo = communitySkills.length;
        }

        const sources = [...new Set(communitySkills.map(s => s.sourceLabel).filter(Boolean))];
        var cacheHint = isFast ? `<span style="font-size:11px; color:var(--accent); margin-left:4px" title="从缓存加载">⚡ 缓存 ${loadMs}ms</span>` : '';
        try {
          var cacheStatus = await api('/api/community/cache-status');
          if (cacheStatus.cached && cacheStatus.entries) {
            var lightEntry = cacheStatus.entries['all-light'] || cacheStatus.entries['all'];
            if (lightEntry) cacheHint += `<span style="font-size:10px; color:var(--text2); margin-left:6px" title="缓存更新时间">🕐 ${lightEntry.age}更新</span>`;
          }
        } catch {}
        const enrichHint = hasDesc ? '描述已就绪' : '加载描述中...';

        listEl.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; flex-wrap:wrap; gap:8px">
            <span style="font-size:13px; color:var(--text2)">共 ${communitySkills.length} 个技能${cacheHint}</span>
            <div style="display:flex; gap:8px; align-items:center">
              <input type="text" id="communitySearchInput" placeholder="搜索技能..." oninput="onCommunitySearch(this.value)"
                style="padding:4px 10px; border:1px solid var(--border); border-radius:6px; font-size:12px; background:var(--bg2); color:var(--text); width:160px">
              <span style="font-size:12px; color:var(--text2)" id="communityEnrichStatus">${enrichHint}</span>
              <button onclick="refreshCommunitySkills()" title="强制刷新（清除缓存）"
                style="background:none; border:none; cursor:pointer; font-size:14px; padding:2px 6px; border-radius:4px; color:var(--text2)"
                onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background='none'">🔄</button>
            </div>
          </div>
          ${sources.length > 1 ? `
            <div class="plaza-filters" style="margin-bottom:16px">
              <div class="filter-btn active" onclick="filterCommunitySource('all', this)">全部 (${communitySkills.length})</div>
              ${sources.map(s => {
                const cnt = communitySkills.filter(sk => sk.sourceLabel === s).length;
                return `<div class="filter-btn" onclick="filterCommunitySource('${escapeAttr(s)}', this)">📡 ${escapeHtml(s)} (${cnt})</div>`;
              }).join('')}
            </div>
          ` : ''}
          <div class="community-grid" id="communityGrid">
            ${communitySkills.slice(0, COMMUNITY_PAGE_SIZE).map(renderCommunityCard).join('')}
          </div>
          <div id="communityLoadMore" style="text-align:center; padding:20px">
            ${communitySkills.length > COMMUNITY_PAGE_SIZE ?
              `<button class="btn btn-blue" onclick="loadMoreCommunitySkills()">加载更多 (${communitySkills.length - COMMUNITY_PAGE_SIZE} 剩余)</button>` : ''}
          </div>
        `;

        if (!hasDesc) enrichVisibleCommunity();
      } catch (e) {
        listEl.innerHTML = '<div class="empty-state"><div class="icon">😵</div><p>加载失败，请检查网络和仓库配置</p></div>';
      }
    }

    async function refreshCommunitySkills() {
      const statusEl = document.getElementById('communityEnrichStatus');
      if (statusEl) statusEl.textContent = '正在刷新...';
      try {
        await api('/api/community/refresh');
      } catch {}
      invalidateAllViews();
      loadCommunitySkills();
    }

    var _communitySearchTimer;
    function onCommunitySearch(val) {
      clearTimeout(_communitySearchTimer);
      _communitySearchTimer = setTimeout(function() {
        communitySearchTerm = val.trim();
        communityPage = 0;
        renderCommunityList();
      }, 150);
    }

    function loadMoreCommunitySkills() {
      if (communityLoadingMore) return;
      communityLoadingMore = true;
      communityPage++;
      renderCommunityList();
      communityLoadingMore = false;

      const visibleEnd = (communityPage + 1) * COMMUNITY_PAGE_SIZE;
      if (visibleEnd > communityEnrichedUpTo) {
        enrichVisibleCommunity();
      }
    }

    async function enrichVisibleCommunity() {
      if (communityEnriching) return;
      communityEnriching = true;

      const visibleEnd = Math.min(
        (communityPage + 2) * COMMUNITY_PAGE_SIZE,
        communitySkills.length
      );

      const BATCH = 20;
      while (communityEnrichedUpTo < visibleEnd) {
        const start = communityEnrichedUpTo;
        const count = Math.min(BATCH, visibleEnd - start);
        try {
          const enriched = await api(`/api/community/skills/enrich?start=${start}&count=${count}`);
          for (const s of enriched) {
            const idx = communitySkills.findIndex(cs => cs.name === s.name && cs.sourceId === s.sourceId);
            if (idx >= 0) {
              communitySkills[idx].description = s.description;
              communitySkills[idx].author = s.author;
            }
          }
          communityEnrichedUpTo = start + enriched.length;
          renderCommunityList();
        } catch { break; }

        const statusEl = document.getElementById('communityEnrichStatus');
        if (statusEl) {
          if (communityEnrichedUpTo >= communitySkills.length) {
            statusEl.textContent = '描述加载完成';
          } else {
            statusEl.textContent = `已加载 ${communityEnrichedUpTo}/${communitySkills.length} 描述`;
          }
        }
      }
      communityEnriching = false;
    }

    function filterCommunitySource(source, el) {
      document.querySelectorAll('#communityList .filter-btn').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      communityFilterSource = source;
      communityPage = 0;
      renderCommunityList();
    }

    function renderCommunityCard(skill) {
      const writableIds = new Set(['primary', ...(communityConfig.sources || []).filter(s => s.writable).map(s => s.id)]);
      const isOwn = writableIds.has(skill.sourceId);
      const desc = skill.description || '';
      const truncDesc = desc.length > 100 ? desc.slice(0, 100) + '...' : desc;
      return `
        <div class="community-card" data-name="${escapeAttr(skill.name)}" data-url="${escapeAttr(skill.rawUrl)}" data-source="${escapeAttr(skill.sourceId || '')}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; cursor:pointer"
               onclick="previewSkill('${escapeAttr(skill.name)}', '${escapeAttr(skill.rawUrl)}')">
            <div class="plaza-name">${escapeHtml(skill.name)}</div>
            ${isOwn ? '<span class="tag" style="font-size:10px; background:var(--green-light,#e8f5e9); color:var(--green,#4caf50)">我的</span>' : ''}
          </div>
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:4px">
            <span class="author">by ${escapeHtml(skill.author)}</span>
            ${skill.sourceLabel ? `<span class="tag" style="font-size:10px">📡 ${escapeHtml(skill.sourceLabel)}</span>` : ''}
          </div>
          <div class="plaza-desc" style="margin-top:6px; font-size:13px; color:var(--text2); line-height:1.5">${escapeHtml(truncDesc)}</div>
          <div style="font-size:10px; color:var(--text3,#999); margin-top:4px; font-style:italic">点击名称查看 SKILL.md 全文</div>
          <div class="plaza-actions" style="margin-top:12px">
            ${skill.installed
              ? '<button class="btn-install installed" disabled>✓ 已安装</button>'
              : `<button class="btn-install" onclick="event.stopPropagation(); showInstallDialog(this.closest('.community-card').dataset.name, this.closest('.community-card').dataset.url, this)">⬇️ 安装</button>`
            }
            <button class="btn-preview" onclick="event.stopPropagation(); previewSkill(this.closest('.community-card').dataset.name, this.closest('.community-card').dataset.url)">📄 查看全文</button>
            <a href="${escapeAttr(skill.htmlUrl)}" target="_blank" class="btn-preview" style="text-decoration:none" onclick="event.stopPropagation()">🔗 GitHub</a>
            ${isOwn ? `<button class="btn-preview" style="color:var(--red,#e53935); border-color:var(--red,#e53935)"
              onclick="event.stopPropagation(); deleteFromCommunityBrowse('${escapeAttr(skill.name)}', '${escapeAttr(skill.sourceId || 'primary')}', this)">🗑️ 下架</button>` : ''}
          </div>
        </div>
      `;
    }

    async function deleteFromCommunityBrowse(skillName, sourceId, btn) {
      if (!confirm('确定要从社区下架 "' + skillName + '" 吗？\\n\\n这会从你的仓库中删除该技能。')) return;
      const origText = btn.textContent;
      btn.textContent = '⏳ 下架中...';
      btn.disabled = true;
      try {
        const result = await api('/api/community/delete?name=' + encodeURIComponent(skillName) + '&sourceId=' + encodeURIComponent(sourceId || 'primary'));
        if (result.success) {
          showToast({ tool: 'delete', resultSummary: result.message, timestamp: new Date().toISOString() });
          invalidateAllViews();
          communitySkills = communitySkills.filter(s => !(s.name === skillName && s.sourceId === sourceId));
          ownSkillsList = ownSkillsList.filter(n => n !== skillName);
          renderCommunityList();
        } else {
          alert('下架失败: ' + result.message);
          btn.textContent = origText;
          btn.disabled = false;
        }
      } catch {
        alert('网络错误');
        btn.textContent = origText;
        btn.disabled = false;
      }
    }

    async function previewSkill(name, rawUrl) {
      const panel = document.getElementById('detailPanel');
      const title = document.getElementById('detailTitle');
      const body = document.getElementById('detailBody');
      title.textContent = name;
      body.innerHTML = '<div class="empty-state"><div class="icon" style="animation:wobble 1s infinite">⏳</div><p>正在从 GitHub 加载 SKILL.md 全文...</p></div>';
      panel.classList.add('open');
      try {
        const proxyResult = await api('/api/community/fetch-content?url=' + encodeURIComponent(rawUrl));
        if (proxyResult.error && !proxyResult.content) throw new Error(proxyResult.error);
        const text = proxyResult.content || '';
        let ghLink = rawUrl;
        try {
          const u = new URL(rawUrl);
          if (u.hostname === 'raw.githubusercontent.com') {
            const segs = u.pathname.split('/').filter(Boolean);
            if (segs.length >= 3) {
              const [owner, repo, branch, ...rest] = segs;
              const dir = rest.length > 1 ? rest.slice(0, -1).join('/') : rest.join('/');
              ghLink = `https://github.com/${owner}/${repo}/tree/${branch}/${dir}`;
            }
          }
        } catch (_) {}
        const tokenEst = Math.round(text.length / 4);
        body.innerHTML = '<div style="margin-bottom:12px; display:flex; gap:8px; flex-wrap:wrap">'
          + '<span class="tag source">社区技能</span>'
          + '<span class="tag tokens">~' + tokenEst + ' tokens</span>'
          + '</div>'
          + '<div style="background:var(--bg2); border:2px solid var(--border2); border-radius:14px; padding:16px; margin-bottom:16px">'
          + '<div style="font-family:var(--font-display); font-size:14px; color:var(--text); margin-bottom:10px">📄 SKILL.md 完整内容</div>'
          + '<pre style="white-space:pre-wrap; word-break:break-word; font-size:12px; line-height:1.6; max-height:60vh; overflow-y:auto; color:var(--text); background:var(--surface); padding:12px; border-radius:10px; border:1px solid var(--border2)">' + escapeHtml(text) + '</pre>'
          + '</div>'
          + '<div style="display:flex; gap:8px; flex-wrap:wrap">'
          + '<button class="action-btn action-export" onclick="navigator.clipboard.writeText(document.querySelector(\'#detailBody pre\').textContent).then(function(){showToast({tool:\'copy\',resultSummary:\'已复制 SKILL.md 内容\',timestamp:new Date().toISOString()})})"><span class="action-icon">📋</span> 复制全文</button>'
          + '<a href="' + escapeAttr(ghLink) + '" target="_blank" class="action-btn" style="text-decoration:none; color:var(--text)"><span class="action-icon">🔗</span> GitHub</a>'
          + '</div>';
      } catch (e) {
        body.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>加载失败: ' + escapeHtml(String(e)) + '</p></div>';
      }
    }

    // ========== 安装作用域选择 ==========
    let installScope = localStorage.getItem('skiller_install_scope') || 'global';
    let installProjectPath = localStorage.getItem('skiller_install_project') || '';
    let recentProjects = [];

    async function loadRecentProjects() {
      try { recentProjects = await api('/api/recent-projects'); } catch { recentProjects = []; }
    }

    var installMode = localStorage.getItem('skiller_install_mode') || 'local-repo';

    function getInstallScopeParams() {
      return '&mode=' + encodeURIComponent(installMode);
    }

    var LINK_INSTALL_MODES = [
      { id: 'local-repo', icon: '📥', label: '下载到本地仓库', hint: '保存到本地，稍后给项目配置' },
      { id: 'global-skill', icon: '🌐', label: '安装为全局 Skill', hint: '~/.cursor/skills/，跨项目共享' }
    ];

    function renderScopeSelector(containerId) {
      var el = document.getElementById(containerId);
      if (!el) return;
      var html = '<div style="margin-bottom:8px"><span style="font-size:12px; color:var(--text2); display:block; margin-bottom:6px">安装方式:</span>'
        + '<div style="display:flex; gap:6px; flex-wrap:wrap">';
      for (var mi = 0; mi < LINK_INSTALL_MODES.length; mi++) {
        var m = LINK_INSTALL_MODES[mi];
        html += '<button class="myrepo-filter-btn' + (installMode === m.id ? ' active' : '') + '" '
          + 'onclick="setInstallMode(\'' + m.id + '\', \'' + containerId + '\')" '
          + 'style="font-size:12px; padding:8px 14px" title="' + escapeAttr(m.hint) + '">'
          + m.icon + ' ' + m.label + '</button>';
      }
      html += '</div></div>';
      var curMode = LINK_INSTALL_MODES.find(function(x) { return x.id === installMode; });
      html += '<div style="font-size:11px; color:var(--text2); margin-bottom:4px">' + (curMode ? curMode.hint : '') + '</div>';
      el.innerHTML = html;
    }

    function setInstallMode(mode, containerId) {
      installMode = mode;
      localStorage.setItem('skiller_install_mode', mode);
      renderScopeSelector(containerId);
    }

    const UPLOAD_DESC_TEMPLATE = `## 使用场景

### 适用场景
- 

### 典型用户
- 

### 使用示例
1. 

### 关键能力
- 

### 注意事项
- `;

    const UPLOAD_DESC_PRESETS = [
      { label: '开发工具', template: `## 使用场景\n\n### 适用场景\n- 项目开发中需要自动化某些流程时\n- 需要快速搭建特定技术栈的项目时\n\n### 典型用户\n- 前端/后端/全栈开发者\n- DevOps 工程师\n\n### 使用示例\n1. 在 Cursor 中对话时，AI 会自动加载此技能\n2. 输入相关指令，技能会指导 AI 完成任务\n\n### 关键能力\n- \n\n### 注意事项\n- 需要相关开发环境已配置` },
      { label: 'AI/Agent', template: `## 使用场景\n\n### 适用场景\n- 需要 AI Agent 完成复杂多步骤任务时\n- 需要特定的 Prompt 工程或对话策略时\n\n### 典型用户\n- AI 应用开发者\n- Prompt 工程师\n\n### 使用示例\n1. 当用户提出需要多步推理的问题时触发\n2. AI 按照技能中定义的流程逐步执行\n\n### 关键能力\n- \n\n### 注意事项\n- 可能需要较大的上下文窗口` },
      { label: '工作流', template: `## 使用场景\n\n### 适用场景\n- 日常工作中重复性任务的自动化\n- 团队协作流程的标准化\n\n### 典型用户\n- 需要提升工作效率的个人\n- 需要规范化流程的团队\n\n### 使用示例\n1. 描述你要完成的任务\n2. AI 按照技能定义的最佳实践执行\n\n### 关键能力\n- \n\n### 注意事项\n- 建议根据团队实际情况调整` },
      { label: '创意/设计', template: `## 使用场景\n\n### 适用场景\n- 需要创意灵感或设计方案时\n- 需要生成可视化内容时\n\n### 典型用户\n- UI/UX 设计师\n- 创意工作者\n\n### 使用示例\n1. 提供设计需求描述\n2. AI 根据技能中的设计规范给出方案\n\n### 关键能力\n- \n\n### 注意事项\n- 生成结果可能需要人工微调` },
    ];

    let uploadDescriptions = {};

    let ownSkillsList = [];
    let ownSkillsCachedAt = 0;
    const OWN_CACHE_TTL = 5 * 60 * 1000;

    async function fetchOwnSkills(force) {
      if (!force && ownSkillsList.length > 0 && Date.now() - ownSkillsCachedAt < OWN_CACHE_TTL) return;
      try { ownSkillsList = await api('/api/community/own-skills'); ownSkillsCachedAt = Date.now(); } catch { ownSkillsList = []; }
    }

    const RECOMMENDED_SOURCES = [
      { repo: 'zhangziyana007-sudo/skiller-community', label: 'Skiller 官方社区', desc: 'Skiller 官方技能共享社区' },
    ];

    async function renderSourcesPage() {
      const content = document.getElementById('content');
      if (!communityLoaded) {
        communityConfig = await api('/api/community/config');
        communityLoaded = true;
      }
      content.innerHTML = '<div class="page-title">📡 订阅外部GitHub仓库</div><div id="sourcesBody"></div>';
      renderCommunitySources(document.getElementById('sourcesBody'));
    }

    function renderCommunitySources(container) {
      const sources = communityConfig.sources || [];
      const subscribedRepos = new Set(sources.map(s => s.repo));

      container.innerHTML = `
        <div class="community-config">
          <h3>⚡ 一键订阅</h3>
          <p style="font-size:13px; color:var(--text2); margin-bottom:16px">
            粘贴 GitHub 链接，自动识别仓库地址！支持格式：<br>
            <code>https://github.com/owner/repo</code> 或 <code>owner/repo</code>
          </p>

          <div style="display:flex; gap:8px; align-items:stretch">
            <input type="text" id="quickSubscribeInput"
              placeholder="粘贴 GitHub 链接或输入 owner/repo..."
              style="flex:1; padding:14px 20px; border-radius:24px; border:3px solid var(--blue); background:var(--surface); font-size:15px; font-family:var(--font-body); outline:none; box-shadow:var(--crayon-shadow)"
              oninput="parseSubscribeInput(this.value)"
              onkeydown="if(event.key==='Enter') quickSubscribe()">
            <button class="btn btn-green" onclick="quickSubscribe()" style="white-space:nowrap; font-size:15px; padding:14px 24px">
              ➕ 订阅
            </button>
          </div>
          <div id="quickSubscribeParsed" style="margin-top:8px; font-size:13px; color:var(--text2)"></div>
          <details style="margin-top:10px">
            <summary style="cursor:pointer; font-size:13px; color:var(--text2); user-select:none">🔐 私有仓库？点击填写授权 Token</summary>
            <div style="margin-top:8px; padding:12px; background:var(--bg2); border-radius:12px; border:1.5px solid var(--border2)">
              <input type="password" id="quickSubscribeToken"
                placeholder="ghp_xxxxx（源主提供的只读 Token，公开仓库无需填写）"
                style="width:100%; padding:10px 14px; border-radius:10px; border:1.5px solid var(--border2); background:var(--surface); font-size:13px; font-family:monospace; outline:none">
              <div style="font-size:11px; color:var(--text2); margin-top:6px; line-height:1.8">
                💡 私有仓库需要源主生成 <strong>Fine-grained PAT</strong>（只读权限），分享给你填入此处。<br>
                公开仓库无需填写，留空即可。Token 仅存储在本地，不会上传。
              </div>
            </div>
          </details>
          <div id="quickSubscribeResult" style="margin-top:8px"></div>
        </div>

        ${RECOMMENDED_SOURCES.length > 0 ? `
          <div class="community-config" style="border-color:var(--green); margin-top:16px">
            <h3 style="color:var(--green)">⭐ 推荐订阅</h3>
            <div style="display:grid; gap:10px; margin-top:12px">
              ${RECOMMENDED_SOURCES.map(r => {
                const isSubscribed = subscribedRepos.has(r.repo);
                return `
                  <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-radius:16px; border:2px solid ${isSubscribed ? 'var(--green)' : 'var(--border2)'}; background:${isSubscribed ? 'var(--green-light)' : 'var(--bg2)'}; transition:all 0.2s">
                    <div>
                      <div style="font-family:var(--font-display); font-size:15px">${escapeHtml(r.label)}</div>
                      <div style="font-size:12px; color:var(--text2); margin-top:2px">${escapeHtml(r.desc)}</div>
                      <div style="font-size:11px; color:var(--text2); margin-top:2px; font-family:monospace">${escapeHtml(r.repo)}</div>
                    </div>
                    ${isSubscribed
                      ? '<span style="font-family:var(--font-display); font-size:13px; color:var(--green)">✅ 已订阅</span>'
                      : `<button class="btn btn-green" style="font-size:13px" data-repo="${escapeAttr(r.repo)}" data-label="${escapeAttr(r.label)}" onclick="quickSubscribeRepo(this.dataset.repo, this.dataset.label, this)">➕ 一键订阅</button>`
                    }
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        ${sources.length > 0 ? `
          <div class="community-config" style="margin-top:16px">
            <h3>📡 我的订阅源 (${sources.length})</h3>
            <div style="display:grid; gap:10px; margin-top:12px">
              ${sources.map(s => `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-radius:14px; border:2px solid var(--border2); background:var(--bg2); transition:all 0.2s"
                     onmouseenter="this.style.borderColor='var(--blue)'" onmouseleave="this.style.borderColor='var(--border2)'">
                  <div>
                    <div style="display:flex; align-items:center; gap:8px">
                      <span style="font-family:var(--font-display); font-size:15px; color:var(--text)">${escapeHtml(s.label)}</span>
                      ${s.token ? '<span class="tag" style="font-size:10px; background:#e8f5e9; color:#43a047">🔐 专用Token</span>' : ''}
                      ${s.writable ? '<span class="tag" style="font-size:10px; background:#fff3e0; color:#ef6c00">✏️ 可写</span>' : ''}
                    </div>
                    <div style="font-size:12px; color:var(--text2); margin-top:2px; font-family:monospace">${escapeHtml(s.repo)}</div>
                  </div>
                  <div style="display:flex; gap:6px; align-items:center">
                    <button class="btn" style="padding:4px 10px; font-size:11px" onclick="editSourceToken('${escapeAttr(s.id)}', '${escapeAttr(s.repo)}', '${escapeAttr(s.label)}')">🔑 Token</button>
                    <button class="btn" style="padding:4px 12px; font-size:11px; color:var(--red,#e53935); border-color:var(--red,#e53935)" data-id="${escapeAttr(s.id)}" onclick="removeCommunitySource(this.dataset.id)">✕ 取消</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="community-config" style="border-color:var(--purple); margin-top:16px">
          <h3 style="color:var(--purple)">💡 怎么获取订阅地址？</h3>
          <div style="font-size:13px; color:var(--text2); line-height:2.2">
            <p>1️⃣ 让技能分享者告诉你他的仓库地址（如 <code>someone/skill-community</code>）</p>
            <p>2️⃣ 或者直接复制 GitHub 页面的网址（如 <code>https://github.com/someone/skill-community</code>）</p>
            <p>3️⃣ 粘贴到上面的输入框，点击「订阅」就完成了！</p>
          </div>
        </div>
      `;
    }

    function parseSubscribeInput(value) {
      const parsed = parseGitHubUrl(value);
      const el = document.getElementById('quickSubscribeParsed');
      if (parsed) {
        el.innerHTML = `<span style="color:var(--green)">✅ 识别到仓库: <strong>${escapeHtml(parsed)}</strong></span>`;
      } else if (value.trim()) {
        el.innerHTML = `<span style="color:var(--orange)">🤔 请输入 GitHub 仓库地址</span>`;
      } else {
        el.innerHTML = '';
      }
    }

    function parseGitHubUrl(input) {
      const trimmed = input.trim().replace(/\/+$/, '');
      const urlMatch = trimmed.match(/github\.com\/([^/]+\/[^/]+)/);
      if (urlMatch) return urlMatch[1];
      const repoMatch = trimmed.match(/^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)$/);
      if (repoMatch) return repoMatch[1];
      return null;
    }

    async function quickSubscribe() {
      const input = document.getElementById('quickSubscribeInput').value;
      const repo = parseGitHubUrl(input);
      const resultEl = document.getElementById('quickSubscribeResult');
      const tokenEl = document.getElementById('quickSubscribeToken');
      const token = tokenEl ? tokenEl.value.trim() : '';

      if (!repo) {
        resultEl.innerHTML = '<span style="color:var(--red)">❌ 无法识别仓库地址，请检查格式</span>';
        return;
      }

      const label = repo.split('/').pop() || repo;
      await doSubscribe(repo, label, resultEl, token);
    }

    async function quickSubscribeRepo(repo, label, btn) {
      btn.textContent = '⏳ 订阅中...';
      btn.disabled = true;
      await doSubscribe(repo, label, null, '');
      btn.textContent = '✅ 已订阅';
    }

    async function doSubscribe(repo, label, resultEl, token) {
      try {
        const result = await apiPost('/api/community/add-source', { repo, label, branch: 'main', skillsPath: 'skills', token: token || undefined });
        if (result.success) {
          communityConfig.sources = result.sources;
          communityLoaded = false;
          communitySkills = [];
          invalidateAllViews();
          showToast({ tool: 'source', resultSummary: `已订阅: ${label}`, timestamp: new Date().toISOString() });
          communityTab = 'sources'; renderCommunity();
        } else {
          if (resultEl) resultEl.innerHTML = `<span style="color:var(--red)">❌ ${escapeHtml(result.error || '订阅失败')}</span>`;
        }
      } catch {
        if (resultEl) resultEl.innerHTML = '<span style="color:var(--red)">❌ 网络错误</span>';
      }
    }

    async function removeCommunitySource(sourceId) {
      try {
        const result = await api(`/api/community/remove-source?id=${encodeURIComponent(sourceId)}`);
        if (result.success) {
          communityConfig.sources = result.sources;
          communityLoaded = false;
          communitySkills = [];
          invalidateAllViews();
          showToast({ tool: 'source', resultSummary: '已移除订阅源', timestamp: new Date().toISOString() });
          communityTab = 'sources'; renderCommunity();
        }
      } catch (e) {
        showToast({ tool: 'source', resultSummary: '移除失败: ' + (e.message || e), timestamp: new Date().toISOString() });
      }
    }

    async function editSourceToken(sourceId, repo, label) {
      const source = (communityConfig.sources || []).find(s => s.id === sourceId);
      const maskedToken = source?.token || '';
      const hasToken = maskedToken && maskedToken.includes('••');

      const newToken = prompt(
        `${hasToken ? '当前已配置专用 Token。' : '当前无专用 Token（使用全局 Token）。'}\n\n` +
        `为 "${label}" (${repo}) 设置专用授权 Token：\n\n` +
        `• 输入新 Token 替换现有配置\n` +
        `• 留空并确认 = 保持不变\n` +
        `• 输入 "clear" 清除已有 Token`,
        ''
      );

      if (newToken === null) return;
      var body = { repo, label, branch: source?.branch || 'main', skillsPath: source?.skillsPath || 'skills' };
      if (newToken === 'clear') {
        body.token = '';
      } else if (newToken.trim()) {
        body.token = newToken.trim();
      }

      try {
        const result = await apiPost('/api/community/add-source', body);
        if (result.sources) {
          communityConfig.sources = result.sources;
          communityLoaded = false;
          var msg = newToken === 'clear' ? `已清除 ${label} 的 Token` : (newToken.trim() ? `已为 ${label} 设置专用 Token` : `${label} Token 保持不变`);
          showToast({ tool: 'token', resultSummary: msg, timestamp: new Date().toISOString() });
          renderCommunity();
        }
      } catch { alert('操作失败'); }
    }

    let submissionsCache = [];
    let submissionsCachedAt = 0;

    async function renderCommunitySubmissions(container) {
      container.innerHTML = '<div class="plaza-loading"><span class="spinner">📝</span><p>加载投稿列表...</p></div>';

      try {
        const useCache = submissionsCache.length > 0 && Date.now() - submissionsCachedAt < 5 * 60 * 1000;
        const submissions = useCache ? submissionsCache : await api('/api/community/submissions');
        if (!useCache) { submissionsCache = submissions; submissionsCachedAt = Date.now(); }

        if (submissions.length === 0) {
          container.innerHTML = `
            <div class="empty-state">
              <div class="icon">📝</div>
              <p>暂无投稿</p>
              <p style="font-family:var(--font-body); font-size:13px; margin-top:8px; color:var(--text2)">通过「上传/投稿」标签页提交你的技能</p>
            </div>
          `;
          return;
        }

        const statusCfg = {
          open:     { label: '待审核', bg: 'linear-gradient(135deg,#fff8e1,#fff3c4)', border: '#ffd54f', color: '#f9a825', icon: '⏳' },
          approved: { label: '已通过', bg: 'linear-gradient(135deg,#e8f5e9,#c8e6c9)', border: '#66bb6a', color: '#2e7d32', icon: '✅' },
          rejected: { label: '已拒绝', bg: 'linear-gradient(135deg,#ffebee,#ffcdd2)', border: '#ef5350', color: '#c62828', icon: '❌' },
        };

        container.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
            <span style="font-size:13px; color:var(--text2)">${submissions.length} 条投稿${useCache ? ' (缓存)' : ''}</span>
            <button class="btn-preview" style="font-size:11px; padding:5px 12px" onclick="submissionsCachedAt=0; renderCommunitySubmissions(this.closest('#communityBody'))">🔄 刷新</button>
          </div>
          <div style="display:grid; gap:12px">
            ${submissions.map(s => {
              const cfg = statusCfg[s.status] || statusCfg.open;
              return `
                <div style="background:var(--surface); border:2px solid var(--border2); border-radius:14px; padding:18px; transition:all 0.2s; box-shadow:0 1px 4px rgba(0,0,0,0.04)"
                  onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'"
                  onmouseleave="this.style.transform='';this.style.boxShadow='0 1px 4px rgba(0,0,0,0.04)'">
                  <div style="display:flex; justify-content:space-between; align-items:center">
                    <div style="display:flex; align-items:center; gap:8px">
                      <span style="font-family:var(--font-display); font-size:16px">${escapeHtml(s.skillName)}</span>
                      <span class="author">by ${escapeHtml(s.author)}</span>
                    </div>
                    <span style="display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:600; padding:4px 12px; border-radius:8px; background:${cfg.bg}; color:${cfg.color}; border:1px solid ${cfg.border}">${cfg.icon} ${cfg.label}</span>
                  </div>
                  ${s.description ? `<p style="font-size:13px; color:var(--text2); margin-top:8px; line-height:1.6">${escapeHtml(s.description)}</p>` : ''}
                  ${s.issueUrl ? `<a href="${escapeAttr(s.issueUrl)}" target="_blank" class="btn-preview" style="text-decoration:none; font-size:11px; padding:5px 12px; margin-top:10px; display:inline-flex">🔗 查看 Issue</a>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        `;
      } catch {
        container.innerHTML = '<div class="empty-state"><div class="icon">😵</div><p>加载失败</p></div>';
      }
    }

    function renderLinkInstall(container) {
      container.innerHTML = `
        <div class="community-config" style="border-color:var(--blue,#1e88e5)">
          <h3 style="color:var(--blue,#1e88e5); font-size:18px; margin-bottom:16px">🔗 通过 GitHub 链接安装技能</h3>
          <p style="font-size:14px; color:var(--text2); margin-bottom:20px; line-height:1.8">
            粘贴任何 GitHub 上的 SKILL.md 文件链接，一键安装到本地。<br>
            支持格式：<code style="padding:2px 8px; border-radius:6px; background:var(--bg2)">https://github.com/owner/repo/blob/main/skills/my-skill/SKILL.md</code><br>
            也可以粘贴目录链接（自动查找 SKILL.md）：<code style="padding:2px 8px; border-radius:6px; background:var(--bg2)">https://github.com/owner/repo/tree/main/skills/my-skill</code>
          </p>

          <div style="display:flex; gap:10px; align-items:stretch">
            <input type="text" id="linkInstallUrl"
              placeholder="粘贴 GitHub 链接..."
              style="flex:1; padding:14px 20px; border-radius:14px; border:2px solid var(--border2); background:var(--surface); font-size:15px; font-family:var(--font-body); outline:none; transition:border-color 0.2s"
              onfocus="this.style.borderColor='var(--blue,#42a5f5)'"
              onblur="this.style.borderColor='var(--border2)'"
              oninput="parseLinkInstallUrl()"
              onkeydown="if(event.key==='Enter') doLinkInstall()">
            <button class="btn-install" onclick="doLinkInstall()" id="linkInstallBtn" style="white-space:nowrap; font-size:15px; padding:14px 24px">
              ⬇️ 安装
            </button>
          </div>

          <div id="linkInstallParsed" style="margin-top:10px; font-size:13px; color:var(--text2)"></div>

          <div style="margin-top:12px">
            <label style="font-size:13px; color:var(--text2)">自定义技能名（可选）</label>
            <input type="text" id="linkInstallName"
              placeholder="留空自动从路径提取..."
              style="width:100%; padding:10px 14px; border-radius:10px; border:1.5px solid var(--border2); background:var(--bg2); font-size:13px; font-family:monospace; outline:none; margin-top:4px; transition:border-color 0.2s"
              onfocus="this.style.borderColor='var(--blue,#42a5f5)'"
              onblur="this.style.borderColor='var(--border2)'">
          </div>

          <div style="margin-top:14px; padding:12px; background:var(--bg2); border-radius:12px; border:1.5px solid var(--border2)" id="linkScopeSelect"></div>

          <div id="linkInstallResult" style="margin-top:16px"></div>
        </div>

        <div class="community-config" style="border-color:var(--green,#43a047); margin-top:20px">
          <h3 style="color:var(--green,#43a047); margin-bottom:12px">📋 最近安装</h3>
          <div id="recentInstalls" style="font-size:13px; color:var(--text2)">暂无安装记录</div>
        </div>

        <div class="community-config" style="border-color:var(--purple,#7e57c2); margin-top:20px">
          <h3 style="color:var(--purple,#7e57c2); margin-bottom:12px">💡 使用提示</h3>
          <div style="font-size:14px; color:var(--text); line-height:2.2">
            <div style="display:flex; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid var(--border2)">
              <span style="background:var(--blue,#1e88e5); color:white; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:14px; font-weight:600">1</span>
              <span>在 GitHub 上找到你想安装的 Skill，复制页面链接</span>
            </div>
            <div style="display:flex; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid var(--border2)">
              <span style="background:var(--blue,#1e88e5); color:white; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:14px; font-weight:600">2</span>
              <span>粘贴到输入框，自动识别仓库/分支/路径</span>
            </div>
            <div style="display:flex; align-items:flex-start; gap:12px; padding:8px 0">
              <span style="background:var(--blue,#1e88e5); color:white; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:14px; font-weight:600">3</span>
              <span>点击安装，技能下载到 <code style="padding:2px 6px; border-radius:4px; background:var(--bg2)">~/.cursor/skills/</code> 即刻可用</span>
            </div>
          </div>
        </div>
      `;

      loadRecentInstalls();
      loadRecentProjects().then(function() { renderScopeSelector('linkScopeSelect'); });
    }

    let recentInstallList = JSON.parse(localStorage.getItem('skiller_recent_installs') || '[]');

    function parseLinkInstallUrl() {
      const url = document.getElementById('linkInstallUrl').value.trim();
      const parsed = document.getElementById('linkInstallParsed');
      if (!url) { parsed.innerHTML = ''; return; }

      const m = url.match(/github\.com\/([^/]+\/[^/]+)\/(?:blob|tree)\/([^/]+)\/(.+)/);
      if (m) {
        const [, repo, branch, path] = m;
        const name = path.split('/').filter(Boolean).pop()?.replace(/\.md$/i, '') || 'unknown';
        parsed.innerHTML = `
          <span style="color:var(--green,#43a047)">✅ 已识别</span>
          &nbsp;仓库: <strong>${escapeHtml(repo)}</strong>
          &nbsp;分支: <code>${escapeHtml(branch)}</code>
          &nbsp;路径: <code>${escapeHtml(path)}</code>
          &nbsp;技能名: <strong>${escapeHtml(name)}</strong>
        `;
      } else if (url.includes('github.com')) {
        parsed.innerHTML = '<span style="color:var(--yellow,#f9a825)">⚠️ 请确保链接包含 /blob/ 或 /tree/ 路径</span>';
      } else {
        parsed.innerHTML = '<span style="color:var(--red,#e53935)">❌ 不是有效的 GitHub 链接</span>';
      }
    }

    async function doLinkInstall() {
      const url = document.getElementById('linkInstallUrl').value.trim();
      const customName = document.getElementById('linkInstallName').value.trim();
      const btn = document.getElementById('linkInstallBtn');
      const result = document.getElementById('linkInstallResult');

      if (!url) { result.innerHTML = '<span style="color:var(--red)">❌ 请输入链接</span>'; return; }

      btn.textContent = '⏳ 安装中...';
      btn.disabled = true;

      if (installMode !== 'global-skill' && installMode !== 'local-repo' && !installProjectPath) {
        result.innerHTML = '<span style="color:var(--red)">❌ 非全局/本地模式需要选择项目路径</span>';
        btn.textContent = '⬇️ 安装';
        btn.disabled = false;
        return;
      }

      try {
        let apiUrl = `/api/community/install-url?url=${encodeURIComponent(url)}`;
        if (customName) apiUrl += `&name=${encodeURIComponent(customName)}`;
        apiUrl += getInstallScopeParams();

        const data = await api(apiUrl);
        if (data.success) {
          result.innerHTML = `
            <div style="padding:16px; background:#e8f5e9; border:1.5px solid #66bb6a; border-radius:12px">
              <div style="font-size:16px; font-weight:600; color:#2e7d32">✅ 安装成功！</div>
              <div style="font-size:13px; color:#388e3c; margin-top:6px">
                技能 <strong>${escapeHtml(data.name)}</strong> 已保存到 <code>${escapeHtml(data.path)}</code><br>
                模式: ${escapeHtml(data.modeLabel || installMode)} · 当前共 ${data.totalSkills} 个本地技能
              </div>
            </div>
          `;
          btn.textContent = '✓ 已安装';

          recentInstallList.unshift({ name: data.name, url, time: new Date().toISOString() });
          if (recentInstallList.length > 20) recentInstallList = recentInstallList.slice(0, 20);
          localStorage.setItem('skiller_recent_installs', JSON.stringify(recentInstallList));
          loadRecentInstalls();

          allSkills = await api('/api/skills');

          setTimeout(() => { btn.textContent = '⬇️ 安装'; btn.disabled = false; }, 3000);
        } else {
          result.innerHTML = `<div style="padding:12px; background:#ffebee; border:1.5px solid #ef5350; border-radius:12px; color:#c62828">❌ ${escapeHtml(data.error || '安装失败')}</div>`;
          btn.textContent = '⬇️ 安装';
          btn.disabled = false;
        }
      } catch (e) {
        result.innerHTML = '<div style="padding:12px; background:#ffebee; border:1.5px solid #ef5350; border-radius:12px; color:#c62828">❌ 网络请求失败</div>';
        btn.textContent = '⬇️ 安装';
        btn.disabled = false;
      }
    }

    function loadRecentInstalls() {
      const el = document.getElementById('recentInstalls');
      if (!el) return;
      if (recentInstallList.length === 0) { el.innerHTML = '暂无安装记录'; return; }
      el.innerHTML = recentInstallList.slice(0, 10).map(r => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-radius:10px; border:1px solid var(--border2); margin-bottom:6px; transition:all 0.15s"
          onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background=''">
          <div>
            <span style="font-weight:600">${escapeHtml(r.name)}</span>
            <span style="font-size:11px; color:var(--text2); margin-left:8px">${new Date(r.time).toLocaleString()}</span>
          </div>
          <a href="${escapeAttr(r.url)}" target="_blank" class="btn-preview" style="text-decoration:none; font-size:11px; padding:3px 10px">🔗 GitHub</a>
        </div>
      `).join('');
    }

    async function renderHelpPage() {
      const content = document.getElementById('content');
      if (!communityLoaded) {
        communityConfig = await api('/api/community/config');
        communityLoaded = true;
      }
      content.innerHTML = '<div class="page-title">❓ 帮助指南</div><div id="helpBody"></div>';
      renderCommunityHelp(document.getElementById('helpBody'));
    }

    function renderCommunityHelp(container) {
      container.innerHTML = `
        <div style="display:grid; gap:20px">

          <div class="community-config" style="border-color:var(--blue)">
            <h3 style="color:var(--blue); font-size:18px">🌐 浏览与安装技能</h3>
            <div style="font-size:14px; color:var(--text); line-height:2.2; margin-top:12px">
              <div style="display:flex; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid var(--border2)">
                <span style="background:var(--blue); color:white; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:14px">1</span>
                <span>在左侧导航点击 <strong>📡 订阅外部GitHub仓库</strong>，添加仓库地址</span>
              </div>
              <div style="display:flex; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid var(--border2)">
                <span style="background:var(--blue); color:white; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:14px">2</span>
                <span>进入 <strong>🌍 社区广场</strong>，浏览所有订阅源的技能</span>
              </div>
              <div style="display:flex; align-items:flex-start; gap:12px; padding:8px 0">
                <span style="background:var(--green); color:white; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:14px">✓</span>
                <span>点击技能卡片上的「安装」按钮即可一键安装到本地</span>
              </div>
              <div style="background:var(--green-light); border:1.5px solid var(--green); border-radius:10px; padding:10px 14px; margin-top:10px; font-size:12px; color:#2E7D32">
                💡 浏览和安装公开仓库的技能不需要 Token，完全免费！
              </div>
            </div>
          </div>

          <div class="community-config" style="border-color:var(--pink)">
            <h3 style="color:var(--pink); font-size:18px">🏗️ 创建自己的技能社区</h3>
            <div style="font-size:14px; color:var(--text); line-height:2.2; margin-top:12px">
              <div style="display:flex; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid var(--border2)">
                <span style="background:var(--pink); color:white; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:14px">1</span>
                <div>
                  <strong>创建 GitHub 仓库</strong><br>
                  <span style="font-size:12px; color:var(--text2)"><a href="https://github.com/new" target="_blank" style="color:var(--blue)">github.com/new</a> → 仓库名 skill-community → Public → ✅ Add README → Create</span>
                </div>
              </div>
              <div style="display:flex; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid var(--border2)">
                <span style="background:var(--pink); color:white; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:14px">2</span>
                <div>
                  <strong>创建 skills 目录 + GitHub Token</strong><br>
                  <span style="font-size:12px; color:var(--text2)">仓库中创建 <code>skills/.gitkeep</code>，再到 <a href="https://github.com/settings/tokens/new" target="_blank" style="color:var(--blue)">Token 页面</a> 创建带 repo 权限的 Token</span>
                </div>
              </div>
              <div style="display:flex; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid var(--border2)">
                <span style="background:var(--pink); color:white; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:14px">3</span>
                <div>
                  <strong>在 Dashboard 中配置</strong><br>
                  <span style="font-size:12px; color:var(--text2)">导航到 <strong>🔗 我的 GitHub 社区 → ⚙️ 配置</strong> → 填写仓库和 Token → 保存</span>
                </div>
              </div>
              <div style="display:flex; align-items:flex-start; gap:12px; padding:8px 0">
                <span style="background:var(--green); color:white; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:14px">✓</span>
                <div>
                  <strong>开始使用！</strong><br>
                  <span style="font-size:12px; color:var(--text2)">在「我的本地仓库」上传技能到社区，或在「我的 GitHub 社区」中从链接导入</span>
                </div>
              </div>
            </div>
          </div>

          <div class="community-config" style="border-color:var(--purple)">
            <h3 style="color:var(--purple); font-size:18px">📢 分享你的技能库</h3>
            <div style="font-size:13px; color:var(--text); line-height:1.8; margin-top:12px">
              <p>把仓库地址分享给其他人即可：</p>
              <div style="background:var(--bg); border:1.5px solid var(--border2); border-radius:10px; padding:14px; margin:10px 0; font-size:14px; text-align:center">
                💬 "订阅我的技能库：<strong>你的用户名/skill-community</strong>"
              </div>
              <p>他们在 <strong>📡 订阅外部GitHub仓库</strong> 中粘贴地址就能看到所有技能。</p>
            </div>
          </div>

          <div class="community-config" style="border-color:var(--orange)">
            <h3 style="color:var(--orange); font-size:18px">💡 功能导航</h3>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:12px; font-size:12px">
              <div style="padding:10px; border-radius:8px; background:var(--bg2)">
                <strong>📦 我的本地仓库</strong>
                <div style="color:var(--text2); margin-top:4px">管理本地技能，上传到社区，迁移全局/项目</div>
              </div>
              <div style="padding:10px; border-radius:8px; background:var(--bg2)">
                <strong>🔗 我的 GitHub 社区</strong>
                <div style="color:var(--text2); margin-top:4px">管理 GitHub 仓库中的技能，从链接导入</div>
              </div>
              <div style="padding:10px; border-radius:8px; background:var(--bg2)">
                <strong>🌍 社区广场</strong>
                <div style="color:var(--text2); margin-top:4px">浏览所有订阅源的技能并安装</div>
              </div>
              <div style="padding:10px; border-radius:8px; background:var(--bg2)">
                <strong>📡 订阅外部GitHub仓库</strong>
                <div style="color:var(--text2); margin-top:4px">添加/移除外部 GitHub 仓库订阅</div>
              </div>
              <div style="padding:10px; border-radius:8px; background:var(--bg2)">
                <strong>🏷️ 分类管理</strong>
                <div style="color:var(--text2); margin-top:4px">创建分类并给技能打标签</div>
              </div>
              <div style="padding:10px; border-radius:8px; background:var(--bg2)">
                <strong>⚙️ MCP 管理</strong>
                <div style="color:var(--text2); margin-top:4px">查看和管理 MCP 服务器状态</div>
              </div>
            </div>
          </div>

          <div class="community-config" style="border-color:var(--text2)">
            <h3 style="color:var(--text2); font-size:18px">❓ 常见问题</h3>
            <div style="font-size:13px; color:var(--text); margin-top:12px">
              <details style="margin-bottom:6px; padding:8px 10px; border-radius:8px; background:var(--bg2)">
                <summary style="cursor:pointer; font-weight:600">只想看别人技能，需要创建仓库吗？</summary>
                <p style="margin-top:6px; color:var(--text2)">不需要。在「📡 订阅外部GitHub仓库」添加仓库地址即可浏览，无需 Token。</p>
              </details>
              <details style="margin-bottom:6px; padding:8px 10px; border-radius:8px; background:var(--bg2)">
                <summary style="cursor:pointer; font-weight:600">安装的技能存在哪里？</summary>
                <p style="margin-top:6px; color:var(--text2)">全局技能在 <code>~/.cursor/skills/技能名/SKILL.md</code>，项目技能在 <code>项目/.cursor/rules/技能名.mdc</code>。</p>
              </details>
              <details style="margin-bottom:6px; padding:8px 10px; border-radius:8px; background:var(--bg2)">
                <summary style="cursor:pointer; font-weight:600">Token 安全吗？</summary>
                <p style="margin-top:6px; color:var(--text2)">Token 只保存在本地 <code>~/.cursor/skiller/data/</code>，不会上传到任何地方。</p>
              </details>
              <details style="margin-bottom:6px; padding:8px 10px; border-radius:8px; background:var(--bg2)">
                <summary style="cursor:pointer; font-weight:600">从链接导入的技能如何标注作者？</summary>
                <p style="margin-top:6px; color:var(--text2)">系统会自动在 frontmatter 中添加 <code>original_author</code> 和 <code>source_repo</code> 字段。</p>
              </details>
              <details style="margin-bottom:6px; padding:8px 10px; border-radius:8px; background:var(--bg2)">
                <summary style="cursor:pointer; font-weight:600">全局技能和项目技能有什么区别？</summary>
                <p style="margin-top:6px; color:var(--text2)">全局技能对所有项目生效，项目技能只在特定项目的 <code>.cursor/rules/</code> 中有效。</p>
              </details>
            </div>
          </div>

          <div style="text-align:center; padding:12px">
            <a href="https://github.com/zhangziyana007-sudo/skiller-mcp/blob/main/docs/community-guide.md" target="_blank" class="btn btn-blue" style="text-decoration:none; display:inline-block">📖 完整文档</a>
            <a href="https://github.com/zhangziyana007-sudo/skiller-mcp/blob/main/docs/create-your-community.md" target="_blank" class="btn" style="text-decoration:none; display:inline-block; margin-left:8px">🏗️ 搭建教程</a>
          </div>
        </div>
      `;
    }

    function renderCommunitySettings(container) {
      showView('ghcommunity');
      setTimeout(showGhcSettingsFullPage, 100);
    }

    function showInstallDialog(name, rawUrl, btn) {
      var card = btn.closest('.community-card');
      var existingDialog = card.querySelector('.install-scope-dialog');
      if (existingDialog) { existingDialog.remove(); return; }

      var eName = escapeAttr(name).replace(/'/g, "\\'");
      var eUrl = escapeAttr(rawUrl).replace(/'/g, "\\'");
      var dialog = document.createElement('div');
      dialog.className = 'install-scope-dialog';
      dialog.style.cssText = 'margin-top:10px; padding:14px; background:var(--surface); border:2px solid var(--blue); border-radius:14px;';
      dialog.innerHTML = '<div style="font-size:12px; font-weight:600; color:var(--text); margin-bottom:10px">选择安装方式</div>'
        + '<div class="install-mode-options">'
        +   '<div class="install-mode-opt" onclick="doInstallCommunitySkill(\'' + eName + '\', \'' + eUrl + '\', \'local-repo\', this)">'
        +     '<span>📥</span><div><b>下载到本地仓库</b><br><small style="color:var(--text2)">保存到本地，稍后给项目配置</small></div>'
        +   '</div>'
        +   '<div class="install-mode-opt" onclick="doInstallCommunitySkill(\'' + eName + '\', \'' + eUrl + '\', \'global-skill\', this)">'
        +     '<span>🌐</span><div><b>安装为全局 Skill</b><br><small style="color:var(--text2)">Agent 按需加载，跨项目共享</small></div>'
        +   '</div>'
        + '</div>'
        + '<button class="btn-preview" style="margin-top:8px; font-size:11px" onclick="this.closest(\'.install-scope-dialog\').remove()">取消</button>';
      card.appendChild(dialog);
    }

    function showProjectInputThenInstall(name, rawUrl, mode, el) {
      var dialog = el.closest('.install-scope-dialog');
      if (!dialog) return;
      loadRecentProjects();
      var projOptions = recentProjects.map(function(p) {
        return '<option value="' + escapeAttr(p) + '">' + escapeHtml(p.split('/').slice(-2).join('/')) + '</option>';
      }).join('');
      var extraFields = '';
      if (mode === 'rule-auto') {
        extraFields = '<div style="margin-bottom:8px">'
          + '<label style="font-size:11px; color:var(--text2); display:block; margin-bottom:4px">Globs 文件匹配模式</label>'
          + '<input type="text" id="communityInstallGlobs" placeholder="例如: *.py, *.ts, src/**/*.java" style="width:100%; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border2); background:var(--bg2); font-size:11px; font-family:monospace; outline:none; box-sizing:border-box">'
          + '<div style="display:flex; gap:4px; margin-top:4px; flex-wrap:wrap">'
          + ['*.py','*.ts','*.tsx','*.js','*.java','*.go','*.rs','*.css'].map(function(g) {
              return '<span style="font-size:10px; padding:2px 8px; border-radius:10px; background:var(--bg2); border:1px solid var(--border2); cursor:pointer; color:var(--text2)" onclick="var i=document.getElementById(\'communityInstallGlobs\'); i.value=i.value?(i.value+\','+g+'\'):\''+g+'\'">' + g + '</span>';
            }).join('')
          + '</div></div>';
      }
      if (mode === 'cursorrules') {
        extraFields = '<div style="margin-bottom:8px">'
          + '<label style="font-size:11px; color:var(--text2); display:block; margin-bottom:4px">写入方式</label>'
          + '<div style="display:flex; gap:6px">'
          + '<label style="font-size:11px; display:flex; align-items:center; gap:4px; cursor:pointer"><input type="radio" name="crWriteMode" value="append" checked> 追加到末尾</label>'
          + '<label style="font-size:11px; display:flex; align-items:center; gap:4px; cursor:pointer"><input type="radio" name="crWriteMode" value="replace"> 替换整个文件</label>'
          + '</div></div>';
      }
      dialog.innerHTML = '<div style="font-size:12px; font-weight:600; margin-bottom:8px">选择项目</div>'
        + '<div style="display:flex; gap:6px; margin-bottom:8px">'
        +   '<input type="text" id="communityInstallProjectPath" placeholder="项目路径..." style="flex:1; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border2); background:var(--bg2); font-size:11px; font-family:monospace; outline:none" value="' + escapeAttr(installProjectPath) + '">'
        +   (projOptions ? '<select style="padding:5px; border-radius:8px; border:1.5px solid var(--border2); background:var(--bg2); font-size:10px; max-width:120px" onchange="if(this.value){document.getElementById(\'communityInstallProjectPath\').value=this.value}"><option value="">最近项目...</option>' + projOptions + '</select>' : '')
        + '</div>'
        + extraFields
        + '<div style="display:flex; gap:6px">'
        +   '<button class="btn-install" onclick="var p=document.getElementById(\'communityInstallProjectPath\').value.trim(); if(!p){alert(\'请输入项目路径\');return;} doInstallCommunitySkill(\'' + escapeAttr(name).replace(/'/g, "\\'") + '\', \'' + escapeAttr(rawUrl).replace(/'/g, "\\'") + '\', \'' + mode + '\', this, p)">确认安装</button>'
        +   '<button class="btn-preview" onclick="this.closest(\'.install-scope-dialog\').remove()">取消</button>'
        + '</div>';
    }

    async function doInstallCommunitySkill(name, rawUrl, mode, btn, projectPath) {
      btn.textContent = '⏳ 安装中...';
      btn.disabled = true;

      try {
        var params = '&mode=' + encodeURIComponent(mode);
        if (projectPath) params += '&projectPath=' + encodeURIComponent(projectPath);
        var globsEl = document.getElementById('communityInstallGlobs');
        if (globsEl && globsEl.value.trim()) params += '&globs=' + encodeURIComponent(globsEl.value.trim());
        var wmRadio = document.querySelector('input[name="crWriteMode"]:checked');
        if (wmRadio) params += '&writeMode=' + encodeURIComponent(wmRadio.value);
        var result = await api('/api/community/install?name=' + encodeURIComponent(name) + '&url=' + encodeURIComponent(rawUrl) + params);
        if (result.success) {
          var label = result.modeLabel || mode;
          showToast({ tool: 'install', resultSummary: '已安装 ' + name + ' (' + label + ')', timestamp: new Date().toISOString() });
          var dialog = btn.closest('.install-scope-dialog');
          if (dialog) {
            dialog.innerHTML = '<div style="color:var(--green); font-weight:600; padding:8px">✅ ' + escapeHtml(label) + (result.path ? ' → ' + escapeHtml(result.path) : '') + '</div>';
          }
          allSkills = await api('/api/skills');
        } else {
          btn.textContent = '❌ ' + (result.error || '失败');
          btn.disabled = false;
        }
      } catch (e) {
        btn.textContent = '❌ 网络错误';
        btn.disabled = false;
      }
    }

    async function refreshCommunity() {
      try {
        await api('/api/community/refresh');
        communityLoaded = false;
        showToast({ tool: 'refresh', resultSummary: '社区缓存已刷新', timestamp: new Date().toISOString() });
        renderCommunity();
      } catch (e) {
        showToast({ tool: 'refresh', resultSummary: '刷新失败: ' + (e.message || e), timestamp: new Date().toISOString() });
      }
    }

    function renderCommunitySetup() {
      const content = document.getElementById('content');
      const cfg = communityConfig || {};

      content.innerHTML = `
        <div class="page-title">⚙️ 配置我的私人 GitHub 在线社区</div>

        <div class="community-config">
          <h3>🔗 我的社区仓库</h3>
          <p style="font-size:13px; color:var(--text2); margin-bottom:12px">这是你自己的社区仓库，你有写权限可以直接上传技能。</p>
          <div class="config-field">
            <label>社区仓库 (owner/repo)</label>
            <input type="text" id="cfgRepo" value="${escapeAttr(cfg.repo || '')}" placeholder="例如: your-team/skill-community">
          </div>
          <div class="config-field">
            <label>分支</label>
            <input type="text" id="cfgBranch" value="${escapeAttr(cfg.branch || 'main')}" placeholder="main">
          </div>
          <div class="config-field">
            <label>技能目录</label>
            <input type="text" id="cfgPath" value="${escapeAttr(cfg.skillsPath || 'skills')}" placeholder="skills">
          </div>
          <div class="config-field">
            <label>GitHub Token</label>
            <input type="password" id="cfgToken" value="${escapeAttr(cfg.githubToken || '')}" placeholder="ghp_xxxx...">
            <div class="hint">Personal Access Token，需要 repo 权限。<a href="https://github.com/settings/tokens/new" target="_blank" style="color:var(--blue)">去创建</a></div>
          </div>
          <div class="config-field">
            <label>作者名称</label>
            <input type="text" id="cfgAuthor" value="${escapeAttr(cfg.authorName || '')}" placeholder="你的名字或团队名">
          </div>

          <div style="display:flex; gap:8px; margin-top:20px">
            <button class="btn btn-green" onclick="saveCommunityConfig()">💾 保存配置</button>
            ${cfg.repo ? '<button class="btn" onclick="communityTab=\'browse\'; renderCommunity()">← 返回社区</button>' : ''}
          </div>
        </div>
      `;
    }

    async function saveCommunityConfig() {
      const repo = document.getElementById('cfgRepo').value.trim();
      const branch = document.getElementById('cfgBranch').value.trim() || 'main';
      const skillsPath = document.getElementById('cfgPath').value.trim() || 'skills';
      const token = document.getElementById('cfgToken').value.trim();
      const author = document.getElementById('cfgAuthor').value.trim();

      communityConfig = await apiPost('/api/community/save-config', { repo, branch, skillsPath, token, author });
      communityLoaded = false;
      showToast({ tool: 'config', resultSummary: '社区配置已保存', timestamp: new Date().toISOString() });

      if (repo) {
        showView('ghcommunity');
      }
    }

    // ========== MCP 管理面板 ==========

    async function renderMcpPanel() {
      const content = document.getElementById('content');
      content.innerHTML = `
        <div class="page-title">🔌 MCP Server 管理</div>
        <div style="margin-top:20px" id="mcpStatusArea">
          <div class="empty-state"><div class="icon" style="animation:spin 1s linear infinite">⏳</div><p>正在检查 MCP 服务器状态...</p></div>
        </div>
      `;

      try {
        const status = await api('/api/mcp/status');
        const mcpConfig = await api('/api/mcp/config');
        renderMcpContent(status, mcpConfig);
      } catch (e) {
        document.getElementById('mcpStatusArea').innerHTML = `
          <div class="empty-state"><div class="icon">😵</div><p>获取 MCP 状态失败</p></div>
        `;
      }
    }

    function renderMcpContent(status, mcpConfig) {
      const area = document.getElementById('mcpStatusArea');

      area.innerHTML = `
        <div style="display:grid; gap:16px">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px">
            <span style="font-size:14px; color:var(--text2)">${status.servers.length} 个 MCP 服务器 · 配置文件: <code style="padding:2px 8px; border-radius:6px; background:var(--bg2)">${escapeHtml(status.path)}</code></span>
            <button class="btn-preview" onclick="renderMcpPanel()" style="font-size:12px">🔄 刷新状态</button>
          </div>

          ${status.servers.map(s => {
            const statusColor = s.running ? '#43a047' : '#e53935';
            const statusBg = s.running ? '#e8f5e9' : '#ffebee';
            const statusText = s.running ? '运行中' : '已停止';
            const statusIcon = s.running ? '🟢' : '🔴';
            return `
              <div class="community-config" style="border-color:${statusColor}; border-width:2px; transition:all 0.2s" id="mcp-card-${escapeAttr(s.name)}">
                <div style="display:flex; align-items:center; justify-content:space-between">
                  <div style="display:flex; align-items:center; gap:12px">
                    <span style="font-size:20px">${statusIcon}</span>
                    <div>
                      <div style="font-family:var(--font-display); font-size:18px; color:var(--text)">${escapeHtml(s.name)}</div>
                      <div style="font-size:12px; color:var(--text2); margin-top:2px; font-family:monospace">${escapeHtml(s.command.split('/').pop() || s.command)}</div>
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; gap:8px">
                    <span style="display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:600; padding:5px 14px; border-radius:8px; background:${statusBg}; color:${statusColor}">${statusText}</span>
                    ${s.running ? `<button class="btn-preview" style="font-size:12px; padding:5px 12px; color:#e53935; border-color:rgba(229,57,53,0.3)" onmouseover="this.style.background='#ffebee'" onmouseout="this.style.background=''" onclick="restartMcpServer('${escapeAttr(s.name)}')">🔄 重启</button>` : ''}
                  </div>
                </div>

                <div style="margin-top:14px">
                  <details>
                    <summary style="cursor:pointer; font-size:13px; color:var(--text2); user-select:none">📋 详细信息</summary>
                    <div style="margin-top:10px; padding:12px; background:var(--bg2); border-radius:10px; font-size:12px; line-height:2">
                      <div><strong>命令:</strong> <code>${escapeHtml(s.command)}</code></div>
                      <div><strong>参数:</strong> <code>${escapeHtml(s.args.join(' '))}</code></div>
                      <div><strong>进程数:</strong> ${s.pids.length}</div>
                      ${s.pids.length > 0 ? `<div><strong>PID:</strong> ${s.pids.join(', ')}</div>` : ''}
                    </div>
                  </details>
                </div>
              </div>
            `;
          }).join('')}

          <details style="margin-top:16px">
            <summary style="cursor:pointer; font-size:14px; color:var(--text2); user-select:none; font-weight:600">📄 mcp.json 原始配置</summary>
            <div style="margin-top:10px">
              <pre style="background:var(--bg2); padding:16px; border-radius:12px; font-size:13px; line-height:1.6; overflow-x:auto; border:1.5px solid var(--border2)">${mcpConfig.content ? escapeHtml(mcpConfig.content) : '无法读取'}</pre>
            </div>
          </details>

          <div class="community-config" style="border-color:var(--purple,#7e57c2); margin-top:8px">
            <h3 style="color:var(--purple,#7e57c2); margin-bottom:12px">💡 MCP 连接排查</h3>
            <div style="font-size:14px; color:var(--text); line-height:2.2">
              <div style="padding:6px 0; border-bottom:1px solid var(--border2)">
                <strong>连接失败？</strong> 点击对应服务器的「🔄 重启」按钮终止进程，Cursor 会自动重连。
              </div>
              <div style="padding:6px 0; border-bottom:1px solid var(--border2)">
                <strong>多次重启无效？</strong> 尝试重启 Cursor 编辑器（<code>Ctrl+Shift+P</code> → Reload Window）。
              </div>
              <div style="padding:6px 0; border-bottom:1px solid var(--border2)">
                <strong>进程堆积？</strong> 如果看到多个进程数（如 PID: 20+），说明有僵尸进程。点击重启会一次性清理。
              </div>
              <div style="padding:6px 0">
                <strong>配置修改？</strong> 直接编辑 <code>${escapeHtml(status.path)}</code> 然后重启 Cursor。
              </div>
            </div>
          </div>
        </div>
      `;
    }

    async function restartMcpServer(name) {
      const card = document.getElementById('mcp-card-' + name);
      if (card) card.style.opacity = '0.5';

      try {
        const result = await api('/api/mcp/restart?name=' + encodeURIComponent(name));
        if (result.success) {
          showToast({ tool: 'mcp', resultSummary: result.message, timestamp: new Date().toISOString() });
          setTimeout(() => renderMcpPanel(), 2000);
        } else {
          alert('重启失败: ' + (result.error || '未知错误'));
          if (card) card.style.opacity = '1';
        }
      } catch {
        alert('网络错误');
        if (card) card.style.opacity = '1';
      }
    }

    async function rescan() {
      const data = await api('/api/rescan');
      showToast({ tool: 'scan_skills', resultSummary: `索引重建完成！技能总数: ${data.total}`, timestamp: new Date().toISOString() });
      init();
    }

    function formatTime(ts) {
      const d = new Date(ts);
      const now = new Date();
      const diffMs = now - d;
      if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}秒前`;
      if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}分钟前`;
      if (diffMs < 86400000) return d.toLocaleTimeString('zh-CN', { hour12: false });
      return d.toLocaleString('zh-CN', { hour12: false });
    }

    function escapeHtml(text) {
      if (!text) return '';
      return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function escapeAttr(text) {
      if (!text) return '';
      return text.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function skeletonList(count) {
      var html = '';
      for (var i = 0; i < count; i++) html += '<div class="skeleton-item"></div>';
      return html;
    }

    function debounce(fn, delay) {
      var timer;
      return function() {
        var args = arguments, ctx = this;
        clearTimeout(timer);
        timer = setTimeout(function() { fn.apply(ctx, args); }, delay);
      };
    }

    var debouncedMyRepoSearch = debounce(function(val) {
      myrepoSearchQuery = val;
      renderMyRepoList();
    }, 150);

    var debouncedGhcSearch = debounce(function(val) {
      ghcSearchQuery = val;
      renderGhcList();
    }, 150);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeDetail();
    });

    init();
