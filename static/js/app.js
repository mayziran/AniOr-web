/**
 * AniOr Web - Vue3 前端逻辑
 * 完整复刻 PyQt5 功能
 */
const { createApp, ref, computed, reactive, onMounted, watch, nextTick } = Vue;

const app = createApp({
    setup() {
        // ============ 状态管理 ============

        // 配置
        const config = reactive({
            source_dir: '',
            target_dir: '',
            movie_target_dir: '',
            tmdb_api_key: '',
            move_mode: 'link',
            auto_extras: true,
            embyignore_extras: true,
            scan_unorganized: true
        });

        // 文件夹
        const folders = ref([]);
        const selectedFolder = ref('');

        // 视频
        const videos = ref([]);
        const selectedVideos = ref(new Set());

        // 右键菜单状态
        const videoMenu = reactive({
            show: false,
            x: 0,
            y: 0,
            video: null
        });
        // 文件夹排序
        const folderSortBy = ref('name');
        const folderSortAsc = ref(true);
        // 视频排序
        const videoSortBy = ref('name');
        const videoSortAsc = ref(true);
        // 面板宽度（0 表示使用默认 flex 比例）
        const leftPanelWidth = ref(0);

        // 从 localStorage 加载用户设置
        const loadUserSettings = () => {
            try {
                const settings = JSON.parse(localStorage.getItem('anior_settings') || '{}');
                if (settings.folderSortBy) folderSortBy.value = settings.folderSortBy;
                if (settings.folderSortAsc !== undefined) folderSortAsc.value = settings.folderSortAsc;
                if (settings.videoSortBy) videoSortBy.value = settings.videoSortBy;
                if (settings.videoSortAsc !== undefined) videoSortAsc.value = settings.videoSortAsc;
                // 只有保存过面板宽度时才加载（0 表示使用默认 flex 比例）
                if (settings.leftPanelWidth && settings.leftPanelWidth > 0) {
                    leftPanelWidth.value = settings.leftPanelWidth;
                }
            } catch (e) {
                console.error('加载设置失败:', e);
            }
        };

        // 应用面板宽度（在 DOM 准备好后调用）
        const applyPanelWidth = () => {
            if (leftPanelWidth.value > 0) {
                nextTick(() => {
                    const leftPanel = document.querySelector('.left-panel');
                    if (leftPanel) {
                        leftPanel.style.flex = 'none';
                        leftPanel.style.width = leftPanelWidth.value + 'px';
                    }
                });
            }
        };

        // 保存用户设置到 localStorage
        const saveUserSettings = () => {
            try {
                const settings = {
                    folderSortBy: folderSortBy.value,
                    folderSortAsc: folderSortAsc.value,
                    videoSortBy: videoSortBy.value,
                    videoSortAsc: videoSortAsc.value,
                    leftPanelWidth: leftPanelWidth.value
                };
                localStorage.setItem('anior_settings', JSON.stringify(settings));
            } catch (e) {
                console.error('保存设置失败:', e);
            }
        };

        // 搜索
        const searchQuery = ref('');
        const searchType = ref('tv');
        const searchResults = ref([]);
        const selectedMedia = ref(null);

        // 季度
        const seasons = ref([]);
        const currentSeason = ref(null);
        const currentMovieTab = ref('main');  // 剧场版标签: 'main' 或 'extras'
        const episodes = ref([]);
        const episodesLoading = ref(false);
        const matchMode = ref('batch');

        // 匹配数据 - 每个季度独立保存
        const seasonBatchFiles = reactive({});  // {seasonNum: [files]}
        const seasonMatchedEpisodes = reactive({});  // {seasonNum_E + episodeNum: {path, name}}
        const seasonMatchModes = reactive({});  // {seasonNum: 'batch' | 'single'}
        const seasonEpisodesCache = reactive({});  // {seasonNum: [episodes]} - TMDB 剧集信息缓存
        const seasonFileMappings = reactive({});  // {seasonNum: {path: key}} - 每个季度的文件映射
        const batchFiles = ref([]);
        const movieFiles = ref([]);
        const extrasFiles = ref([]);
        const matchedEpisodes = reactive({});
        const matchedFiles = ref(new Set());

        // 辅助函数：更新当前季度的 file_mappings
        const updateCurrentSeasonFileMapping = () => {
            const sn = Number(currentSeason.value);
            if (isNaN(sn) || typeof currentSeason.value !== 'number') return;

            const mapping = {};
            if (matchMode.value === 'batch' && batchFiles.value.length > 0) {
                batchFiles.value.forEach((f, idx) => {
                    mapping[f.path] = `S${String(sn).padStart(2, '0')}E${String(idx + 1).padStart(2, '0')}`;
                });
            } else if (matchMode.value === 'single') {
                // 只收集当前季度的单集匹配数据
                const seasonPrefix = 'S' + String(sn).padStart(2, '0') + 'E';
                Object.entries(matchedEpisodes).forEach(([key, ep]) => {
                    if (key.startsWith(seasonPrefix) && ep && ep.path) {
                        mapping[ep.path] = key;
                    }
                });
            }
            seasonFileMappings[sn] = mapping;
        };

        // UI状态
        const showConfigModal = ref(false);
        const showResultModal = ref(false);
        const organizeResult = ref({});
        const selectedUnorganized = ref([]);
        const selectAllUnorganized = ref(false);
        const pendingDirField = ref('');
        const statusText = ref('就绪 - 请先配置源目录、目标目录和 TMDB API Key');

        // 文件夹缓存 - 存储扫描结果
        const folderCache = reactive({});

        // 目录浏览
        const showDirPicker = ref(false);
        const dirPickerPath = ref('');
        const dirEntries = ref([]);
        const dirEntriesLoading = ref(false);

        // 登录状态
        const isLoggedIn = ref(true);  // 默认 true，避免不需要登录时闪烁
        const passwordRequired = ref(false);  // 是否需要密码登录
        const loginPassword = ref('');
        const loginError = ref('');

        // ============ 计算属性 ============

        // 扁平化文件夹树（用于渲染）
        const flatFolders = computed(() => {
            const result = [];

            const traverse = (items, depth = 0, parentExpanded = true) => {
                for (const item of items) {
                    // 只有父文件夹展开才显示
                    if (parentExpanded) {
                        result.push({
                            ...item,
                            depth: depth
                        });
                        // 如果展开，递归子文件夹
                        if (item.expanded && item.children && item.children.length > 0) {
                            traverse(item.children, depth + 1, true);
                        }
                    }
                }
            };

            traverse(folders.value);
            return result;
        });

        // 计算每个文件夹的已匹配文件数
        const folderMatchCounts = computed(() => {
            const counts = {};
            const sourceDir = config.source_dir;
            if (!sourceDir) return counts;

            // 标准化源目录
            const normalizedSourceDir = sourceDir.replace(/\\/g, '/').replace(/\/$/, '');

            for (const filePath of matchedFiles.value) {
                try {
                    // 标准化文件路径
                    const normalizedFilePath = filePath.replace(/\\/g, '/');

                    // 获取文件所在文件夹路径
                    const lastSlash = normalizedFilePath.lastIndexOf('/');
                    if (lastSlash > 0) {
                        const fileDir = normalizedFilePath.substring(0, lastSlash);

                        // 检查是否在源目录的子文件夹中
                        if (fileDir.startsWith(normalizedSourceDir)) {
                            // 提取第一级子文件夹名称
                            const relativePath = fileDir.substring(normalizedSourceDir.length);
                            const firstFolder = relativePath.split('/').filter(p => p).shift();

                            if (firstFolder) {
                                // 使用文件夹名称作为key
                                counts[firstFolder] = (counts[firstFolder] || 0) + 1;
                            }
                        }
                    }
                } catch (e) {
                    // 忽略错误
                }
            }
            return counts;
        });

        const moveModeName = computed(() => {
            const names = { link: '硬链接', cut: '剪切', copy: '复制' };
            return names[config.move_mode] || '硬链接';
        });

        const matchedCount = computed(() => {
            let count = batchFiles.value.length + movieFiles.value.length + extrasFiles.value.length;
            count += Object.keys(matchedEpisodes).length;
            return count;
        });

        // 获取指定季度的已匹配数量
        const getSeasonMatchedCount = (seasonNum) => {
            const sn = Number(seasonNum);
            if (isNaN(sn)) return 0;

            // 从 seasonFileMappings 获取该季度的已匹配数量
            const mapping = seasonFileMappings[sn];
            if (!mapping) return 0;
            return Object.keys(mapping).length;
        };

        const canOrganize = computed(() => {
            return matchedCount.value > 0 && config.target_dir;
        });

        // ============ 配置 ============

        const loadConfig = async () => {
            try {
                const res = await fetch('/api/config');
                const data = await res.json();
                if (data.success) {
                    Object.assign(config, data.config);
                }
            } catch (e) {
                console.error('加载配置失败:', e);
            }
        };

        // 卷检测警告
        const volumeWarning = ref('');

        // 检查目录是否在同一卷（仅硬链接需要）
        const checkVolume = async () => {
            if (!config.source_dir || !config.target_dir) {
                volumeWarning.value = '';
                return;
            }

            // 只有硬链接需要检测
            if (config.move_mode !== 'link') {
                volumeWarning.value = '';
                return;
            }

            try {
                const res = await fetch('/api/check-volume?path1=' + encodeURIComponent(config.source_dir) + '&path2=' + encodeURIComponent(config.target_dir) + '&mode=' + config.move_mode);
                const data = await res.json();
                if (data.success && data.warning) {
                    volumeWarning.value = data.warning;
                } else {
                    volumeWarning.value = '';
                }
            } catch (e) {
                // 忽略错误，不影响保存
                volumeWarning.value = '';
            }
        };

        const saveConfig = async (fromCheckbox = false) => {
            try {
                // 先检查卷
                await checkVolume();

                const res = await fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });
                const data = await res.json();
                if (data.success) {
                    if (fromCheckbox !== true) {
                        showConfigModal.value = false;
                        loadFolders();
                    }
                } else {
                    alert('保存配置失败');
                }
            } catch (e) {
                console.error('保存配置失败:', e);
                alert('保存配置失败: ' + e.message);
            }
        };

        // 登录相关
        const checkLogin = async () => {
            try {
                const res = await fetch('/api/check-login');
                const data = await res.json();
                if (data.success) {
                    isLoggedIn.value = data.logged_in;
                    passwordRequired.value = data.password_required || false;
                }
            } catch (e) {
                console.error('检查登录状态失败:', e);
                isLoggedIn.value = true;  // 失败时假设不需要登录
            }
        };

        const doLogin = async () => {
            loginError.value = '';
            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: loginPassword.value })
                });
                const data = await res.json();
                if (data.success) {
                    isLoggedIn.value = true;
                    loginPassword.value = '';
                    loadConfig().then(() => {
                        loadFolders();
                    });
                } else {
                    loginError.value = data.error || '登录失败';
                }
            } catch (e) {
                loginError.value = '登录失败: ' + e.message;
            }
        };

        const doLogout = async () => {
            try {
                await fetch('/api/logout', { method: 'POST' });
                isLoggedIn.value = false;
                // 清空数据
                folders.value = [];
                videos.value = [];
                selectedFolder.value = null;
                selectedVideos.clear();
                searchResults.value = [];
                selectedMedia.value = null;
                batchFiles.value = [];
                movieFiles.value = [];
                extrasFiles.value = [];
            } catch (e) {
                console.error('退出登录失败:', e);
            }
        };

        // 目录选择
        const selectDirectory = (field) => {
            pendingDirField.value = field;
            // 打开目录浏览弹窗
            loadRootDirs();
            showDirPicker.value = true;
        };

        const loadRootDirs = async () => {
            dirEntriesLoading.value = true;
            dirPickerPath.value = '';
            try {
                const res = await fetch('/api/browse-dir?path=');
                const data = await res.json();
                if (data.success) {
                    dirEntries.value = data.entries;
                }
            } catch (e) {
                console.error('加载根目录失败:', e);
                dirEntries.value = [];
            } finally {
                dirEntriesLoading.value = false;
            }
        };

        const loadDirEntries = async () => {
            if (!dirPickerPath.value) {
                loadRootDirs();
                return;
            }
            dirEntriesLoading.value = true;
            try {
                const res = await fetch('/api/browse-dir?path=' + encodeURIComponent(dirPickerPath.value));
                const data = await res.json();
                if (data.success) {
                    dirEntries.value = data.entries;
                } else {
                    alert(data.error || '加载目录失败');
                    dirEntries.value = [];
                }
            } catch (e) {
                console.error('加载目录失败:', e);
                dirEntries.value = [];
            } finally {
                dirEntriesLoading.value = false;
            }
        };

        const selectDirEntry = (entry) => {
            if (entry.is_dir) {
                dirPickerPath.value = entry.path;
                loadDirEntries();
            }
        };

        const confirmDirSelection = () => {
            config[pendingDirField.value] = dirPickerPath.value;
            showDirPicker.value = false;
        };

        const onDirectorySelected = (event) => {
            const files = event.target.files;
            if (files && files.length > 0) {
                // 获取选中的目录路径
                const path = files[0].webkitRelativePath || files[0].name;
                // 从file对象的path属性获取完整路径 (需要浏览器支持)
                let dirPath = files[0].path || '';
                if (!dirPath) {
                    // 尝试从URL获取
                    dirPath = window.URL.createObjectURL(files[0]);
                }
                // 对于webkitdirectory，需要获取文件夹的路径
                const dirInput = document.getElementById('dirPicker');
                if (dirInput.files[0]) {
                    // 使用File API获取目录路径
                    config[pendingDirField.value] = files[0].webkitRelativePath ?
                        files[0].webkitRelativePath.split('/')[0] : '';
                }
            }
            event.target.value = ''; // 重置以便再次选择同一目录
        };

        // ============ 文件夹 ============

        const loadFolders = async (refresh = false) => {
            if (!config.source_dir) {
                folders.value = [];
                statusText.value = '请先配置源目录';
                return;
            }
            // 刷新文件夹时清空扫描缓存
            if (refresh) {
                Object.keys(folderCache).forEach(key => delete folderCache[key]);
                statusText.value = '正在刷新文件夹...';
            }
            try {
                const url = '/api/folders?path=' + encodeURIComponent(config.source_dir);
                const res = await fetch(refresh ? url + '&refresh=true' : url);
                const data = await res.json();
                if (data.success) {
                    // 保留原有的展开状态和子文件夹数据
                    const oldFoldersMap = new Map();
                    folders.value.forEach(f => {
                        oldFoldersMap.set(f.path, f);
                    });

                    folders.value = data.folders.map(f => {
                        const old = oldFoldersMap.get(f.path);
                        return {
                            ...f,
                            expanded: old ? old.expanded : false,
                            children: old ? old.children : [],
                            video_count: old ? old.video_count : null,
                            matched_count: old ? old.matched_count : null
                        };
                    });
                    // 应用保存的排序状态
                    sortFolders(folderSortBy.value, folderSortAsc.value);
                    statusText.value = '已加载 ' + folders.value.length + ' 个文件夹' + (data.cached ? ' (缓存)' : '');
                } else {
                    folders.value = [];
                    statusText.value = '加载失败';
                }
            } catch (e) {
                console.error('加载文件夹失败:', e);
                statusText.value = '加载失败';
                folders.value = [];
            }
        };

        // 扫描文件夹（带缓存）
        const scanFolder = async (folder, options = {}) => {
            const { rootOnly = false } = options;
            // 优先检查精确匹配，没有则检查全量缓存
            const exactKey = folder.path + (rootOnly ? '_root' : '');
            const fullKey = folder.path;
            if (folderCache[exactKey]) {
                return folderCache[exactKey];
            }
            // 如果需要rootOnly但有全量缓存，可以用全量缓存的数据
            if (rootOnly && folderCache[fullKey]) {
                return folderCache[fullKey];
            }
            statusText.value = '正在扫描文件夹...';
            try {
                const matchedStr = Array.from(matchedFiles.value).join(',');
                const rootOnlyParam = rootOnly ? '&root_only=true' : '';
                const res = await fetch('/api/scan-folder?path=' + encodeURIComponent(folder.path) + '&matched_files=' + encodeURIComponent(matchedStr) + rootOnlyParam);
                const data = await res.json();
                if (data.success) {
                    // 保存到精确key的缓存
                    folderCache[exactKey] = data.folder;
                    // 如果是全量扫描，同时保存一份到 fullKey
                    if (!rootOnly) {
                        folderCache[fullKey] = data.folder;
                    }
                    return data.folder;
                }
            } catch (e) {
                console.error('扫描文件夹失败:', e);
            }
            return null;
        };

        // 通过 path 找到原始 folder 对象
        const findFolderByPath = (items, path) => {
            for (const item of items) {
                if (item.path === path) return item;
                if (item.children && item.children.length > 0) {
                    const found = findFolderByPath(item.children, path);
                    if (found) return found;
                }
            }
            return null;
        };

        // 在子文件夹树中查找指定路径的文件夹
        const findSubfolder = (subfolders, path) => {
            for (const sf of subfolders) {
                if (sf.path.replace(/\\/g, '/') === path) return sf;
                if (sf.children && sf.children.length > 0) {
                    const found = findSubfolder(sf.children, path);
                    if (found) return found;
                }
            }
            return null;
        };

        // 展开/折叠文件夹
        const toggleFolder = async (folder) => {
            // 找到原始 folder 对象
            const originalFolder = findFolderByPath(folders.value, folder.path);
            if (!originalFolder) return;

            if (!originalFolder.expanded) {
                // 展开 - 检查缓存或扫描
                const cacheKey = originalFolder.path;
                let result = folderCache[cacheKey];

                if (!result) {
                    // 未扫描过，先扫描
                    // 无论一级文件夹还是子文件夹，都扫描所有视频 + 子文件夹结构
                    result = await scanFolder(originalFolder, { rootOnly: false });
                }

                if (result) {
                    originalFolder.video_count = result.video_count;
                    originalFolder.matched_count = result.matched_count;
                    // 设置是否有子文件夹（用于显示展开箭头）
                    originalFolder.has_subfolders = result.subfolders && result.subfolders.length > 0;
                    // 如果该文件夹有子文件夹，使用返回的subfolders
                    if (result.subfolders && result.subfolders.length > 0) {
                        originalFolder.children = result.subfolders.map(f => ({
                            ...f,
                            expanded: false,
                            children: f.children || [],
                            video_count: f.video_count,
                            matched_count: f.matched_count,
                            has_subfolders: f.has_subfolders
                        }));
                    } else if (originalFolder.children && originalFolder.children.length > 0) {
                        // 如果已有children（从父级继承的），保留但重置expanded状态
                        originalFolder.children = originalFolder.children.map(c => ({ ...c, expanded: false }));
                    }
                }
            } else {
                // 折叠时保留children数据，只是隐藏
            }
            originalFolder.expanded = !originalFolder.expanded;
        };

        // 文件夹排序
        const sortFolders = (field, forceDirection = null) => {
            // forceDirection 为 true 时强制升序，false 强制降序，null 时切换
            if (forceDirection !== null) {
                folderSortAsc.value = forceDirection;
            } else if (folderSortBy.value !== field) {
                folderSortBy.value = field;
                folderSortAsc.value = true;
            } else {
                folderSortAsc.value = !folderSortAsc.value;
            }
            // 重新排序
            const sorted = [...folders.value].sort((a, b) => {
                let valA, valB;
                if (field === 'name') {
                    valA = a.name.toLowerCase();
                    valB = b.name.toLowerCase();
                } else if (field === 'count') {
                    valA = a.video_count || 0;
                    valB = b.video_count || 0;
                } else if (field === 'date') {
                    valA = a.date || '';
                    valB = b.date || '';
                }
                if (valA < valB) return folderSortAsc.value ? -1 : 1;
                if (valA > valB) return folderSortAsc.value ? 1 : -1;
                return 0;
            });
            folders.value = sorted;
            saveUserSettings();
        };

        // 视频排序
        const sortVideos = (field, forceDirection = null) => {
            // forceDirection 为 true 时强制升序，false 强制降序，null 时切换
            if (forceDirection !== null) {
                videoSortAsc.value = forceDirection;
            } else if (videoSortBy.value !== field) {
                videoSortBy.value = field;
                videoSortAsc.value = true;
            } else {
                videoSortAsc.value = !videoSortAsc.value;
            }
            // 重新排序
            const sorted = [...videos.value].sort((a, b) => {
                let valA, valB;
                if (field === 'name') {
                    valA = a.name.toLowerCase();
                    valB = b.name.toLowerCase();
                } else if (field === 'size') {
                    // 解析带单位的大小字符串 (如 "1.5 GB", "500 MB")
                    const parseSize = (s) => {
                        const match = s.match(/([\d.]+)/);
                        if (!match) return 0;
                        const num = parseFloat(match[1]);
                        if (s.includes('GB')) return num * 1024;
                        if (s.includes('MB')) return num;
                        if (s.includes('KB')) return num / 1024;
                        return num / 1024 / 1024;
                    };
                    valA = parseSize(a.size);
                    valB = parseSize(b.size);
                } else if (field === 'date') {
                    valA = a.date || '';
                    valB = b.date || '';
                }
                if (valA < valB) return videoSortAsc.value ? -1 : 1;
                if (valA > valB) return videoSortAsc.value ? 1 : -1;
                return 0;
            });
            videos.value = sorted;
            saveUserSettings();
        };

        const selectFolder = async (folder) => {
            // 找到原始 folder 对象
            const originalFolder = findFolderByPath(folders.value, folder.path);
            const targetFolder = originalFolder || folder;

            selectedFolder.value = targetFolder.path;
            selectedVideos.value.clear();
            statusText.value = '正在加载视频...';

            // 判断是否是一级文件夹（在 folders.value 顶层）
            const isTopLevel = folders.value.some(f => f.path === targetFolder.path);

            if (isTopLevel) {
                // 一级文件夹：扫描所有视频（含子文件夹）+ 子文件夹结构
                const folderData = await scanFolder(targetFolder, { rootOnly: false });

                if (folderData) {
                    // 视频列表只显示当前文件夹根目录的视频（与原版一致）
                    const folderPath = targetFolder.path.replace(/\\/g, '/').replace(/\/$/, '');
                    const rootVideos = (folderData.videos || []).filter(v => {
                        const videoPath = v.path.replace(/\\/g, '/');
                        const videoDir = videoPath.substring(0, videoPath.lastIndexOf('/'));
                        return videoDir === folderPath;
                    });
                    videos.value = rootVideos;
                    // 应用保存的排序状态
                    sortVideos(videoSortBy.value, videoSortAsc.value);

                    // matched_count 统计所有视频（含子文件夹），与原版一致
                    const allVideos = folderData.videos || [];
                    targetFolder.matched_count = allVideos.filter(v => matchedFiles.value.has(v.path)).length;
                    targetFolder.video_count = allVideos.length;

                    // 同时保存完整视频数据到当前文件夹对象
                    targetFolder._allVideos = allVideos;

                    // 更新子文件夹结构
                    if (folderData.subfolders && folderData.subfolders.length > 0) {
                        targetFolder.children = folderData.subfolders.map(f => ({
                            ...f,
                            expanded: false,
                            children: f.children || [],
                            video_count: f.video_count,
                            matched_count: f.matched_count,
                            has_subfolders: f.has_subfolders
                        }));
                        // 更新当前文件夹的 has_subfolders（用于显示展开按钮）
                        targetFolder.has_subfolders = true;
                    }

                    const folderName = targetFolder.name || targetFolder.path.split(/[/\\]/).pop();
                    statusText.value = '已加载 ' + videos.value.length + ' 个视频 - ' + folderName;
                } else {
                    videos.value = [];
                    statusText.value = '加载失败';
                }
            } else {
                // 子文件夹：从父文件夹的全量缓存中提取该子文件夹的所有视频
                let folderData = null;
                
                // 遍历所有缓存，找到包含该子文件夹的父缓存
                for (const [cacheKey, cacheValue] of Object.entries(folderCache)) {
                    // 跳过 root 缓存
                    if (cacheKey.endsWith('_root')) continue;
                    
                    const targetPathNormalized = targetFolder.path.replace(/\\/g, '/');
                    // 检查该缓存是否包含目标子文件夹
                    if (cacheValue.subfolders) {
                        const childInCache = findSubfolder(cacheValue.subfolders, targetPathNormalized);
                        if (childInCache) {
                            // 从该缓存中提取属于这个子文件夹的所有视频
                            const childVideos = (cacheValue.videos || []).filter(v => {
                                const videoPath = v.path.replace(/\\/g, '/');
                                return videoPath.startsWith(targetPathNormalized + '/');
                            });
                            
                            folderData = {
                                ...cacheValue,
                                videos: childVideos,
                                video_count: childVideos.length,
                                matched_count: childVideos.filter(v => matchedFiles.value.has(v.path)).length
                            };
                            break;
                        }
                    }
                }
                
                // 如果缓存中没有，调用 API 扫描
                if (!folderData) {
                    folderData = await scanFolder(targetFolder, { rootOnly: false });
                }

                if (folderData) {
                    // 子文件夹显示该文件夹下的所有视频（包含子文件夹）
                    // 但需要过滤出只属于该子文件夹根目录的视频
                    const targetPathNormalized = targetFolder.path.replace(/\\/g, '/');
                    const rootVideos = (folderData.videos || []).filter(v => {
                        const videoPath = v.path.replace(/\\/g, '/');
                        const videoDir = videoPath.substring(0, videoPath.lastIndexOf('/'));
                        return videoDir === targetPathNormalized;
                    });
                    
                    videos.value = rootVideos;
                    // 应用保存的排序状态
                    sortVideos(videoSortBy.value, videoSortAsc.value);

                    // matched_count 统计
                    targetFolder.matched_count = (folderData.videos || []).filter(v => matchedFiles.value.has(v.path)).length;
                    targetFolder.video_count = folderData.videos ? folderData.videos.length : 0;

                    const folderName = targetFolder.name || targetFolder.path.split(/[/\\]/).pop();
                    statusText.value = '已加载 ' + videos.value.length + ' 个视频 - ' + folderName;
                } else {
                    videos.value = [];
                    statusText.value = '加载失败';
                }
            }
            updateMatchedHighlight();
            refreshVideoHighlight();
        };

        const refreshVideos = async () => {
            if (!selectedFolder.value) return;
            // 清除该文件夹的缓存，强制重新扫描
            delete folderCache[selectedFolder.value];
            delete folderCache[selectedFolder.value + '_root'];
            selectedVideos.value.clear();
            statusText.value = '正在刷新视频...';

            // 判断是否是一级文件夹
            const isTopLevel = folders.value.some(f => f.path === selectedFolder.value);

            if (isTopLevel) {
                // 一级文件夹：重新扫描完整数据
                const folderData = await scanFolder({ path: selectedFolder.value }, { rootOnly: false });

                if (folderData) {
                    // 只显示当前文件夹根目录的视频
                    const folderPath = selectedFolder.value.replace(/\\/g, '/').replace(/\/$/, '');
                    const rootVideos = (folderData.videos || []).filter(v => {
                        const videoPath = v.path.replace(/\\/g, '/');
                        const videoDir = videoPath.substring(0, videoPath.lastIndexOf('/'));
                        return videoDir === folderPath;
                    });
                    videos.value = rootVideos;
                    // 应用保存的排序状态
                    sortVideos(videoSortBy.value, videoSortAsc.value);

                    // 更新 matched_count 统计所有视频（含子文件夹），与原版一致
                    const folder = findFolderByPath(folders.value, selectedFolder.value);
                    if (folder) {
                        const allVideos = folderData.videos || [];
                        folder.matched_count = allVideos.filter(v => matchedFiles.value.has(v.path)).length;
                        folder.video_count = allVideos.length;
                        folder._allVideos = allVideos;
                    }
                    const folderName = selectedFolder.value.split(/[/\\]/).pop();
                    statusText.value = '已刷新 ' + videos.value.length + ' 个视频 - ' + folderName;
                } else {
                    videos.value = [];
                    statusText.value = '刷新失败';
                }
            } else {
                // 子文件夹：从父文件夹缓存中提取视频
                let folderData = null;
                
                // 遍历所有缓存，找到包含该子文件夹的父缓存
                for (const [cacheKey, cacheValue] of Object.entries(folderCache)) {
                    if (cacheKey.endsWith('_root')) continue;
                    
                    const targetPathNormalized = selectedFolder.value.replace(/\\/g, '/');
                    if (cacheValue.subfolders) {
                        const childInCache = findSubfolder(cacheValue.subfolders, targetPathNormalized);
                        if (childInCache) {
                            const childVideos = (cacheValue.videos || []).filter(v => {
                                const videoPath = v.path.replace(/\\/g, '/');
                                return videoPath.startsWith(targetPathNormalized + '/');
                            });
                            
                            folderData = {
                                ...cacheValue,
                                videos: childVideos,
                                video_count: childVideos.length,
                                matched_count: childVideos.filter(v => matchedFiles.value.has(v.path)).length
                            };
                            break;
                        }
                    }
                }
                
                // 如果缓存中没有，调用 API 扫描
                if (!folderData) {
                    folderData = await scanFolder({ path: selectedFolder.value }, { rootOnly: false });
                }

                if (folderData) {
                    // 过滤出根目录视频
                    const targetPathNormalized = selectedFolder.value.replace(/\\/g, '/');
                    const rootVideos = (folderData.videos || []).filter(v => {
                        const videoPath = v.path.replace(/\\/g, '/');
                        const videoDir = videoPath.substring(0, videoPath.lastIndexOf('/'));
                        return videoDir === targetPathNormalized;
                    });
                    
                    videos.value = rootVideos;
                    sortVideos(videoSortBy.value, videoSortAsc.value);

                    const folderName = selectedFolder.value.split(/[/\\]/).pop();
                    statusText.value = '已刷新 ' + videos.value.length + ' 个视频 - ' + folderName;
                } else {
                    videos.value = [];
                    statusText.value = '刷新失败';
                }
            }
            updateMatchedHighlight();
            refreshVideoHighlight();
        };

        // ============ 右键菜单 ============

        const showVideoMenu = (event, video) => {
            videoMenu.show = true;
            videoMenu.x = event.clientX;
            videoMenu.y = event.clientY;
            videoMenu.video = video;
        };

        const hideVideoMenu = () => {
            videoMenu.show = false;
        };

        const copyVideoName = () => {
            if (videoMenu.video) {
                navigator.clipboard.writeText(videoMenu.video.name);
            }
            hideVideoMenu();
        };

        const copyVideoPath = () => {
            if (videoMenu.video) {
                navigator.clipboard.writeText(videoMenu.video.path);
            }
            hideVideoMenu();
        };

        // 点击其他区域隐藏右键菜单
        document.addEventListener('click', hideVideoMenu);

        // ============ 视频选择 ============

        let lastSelectedIndex = -1;

        const handleVideoClick = (video, index, event) => {
            if (event.ctrlKey || event.metaKey) {
                // Ctrl点击：切换选择
                if (selectedVideos.value.has(video.path)) {
                    selectedVideos.value.delete(video.path);
                } else {
                    selectedVideos.value.add(video.path);
                }
            } else if (event.shiftKey && lastSelectedIndex !== -1) {
                // Shift点击：批量选择
                const start = Math.min(lastSelectedIndex, index);
                const end = Math.max(lastSelectedIndex, index);
                for (let i = start; i <= end; i++) {
                    selectedVideos.value.add(videos.value[i].path);
                }
            } else {
                // 普通点击：只选一个
                selectedVideos.value.clear();
                selectedVideos.value.add(video.path);
            }
            selectedVideos.value = new Set(selectedVideos.value);
            lastSelectedIndex = index;
        };

        const selectAllVideos = () => {
            videos.value.forEach(v => selectedVideos.value.add(v.path));
            selectedVideos.value = new Set(selectedVideos.value);
            if (videos.value.length > 0) lastSelectedIndex = 0;
        };

        const deselectAllVideos = () => {
            selectedVideos.value.clear();
            selectedVideos.value = new Set(selectedVideos.value);
            lastSelectedIndex = -1;
        };

        // ============ 拖放 ============

        const onDragStart = (event, video) => {
            // 获取选中的视频路径
            let paths = [];
            if (selectedVideos.value.has(video.path)) {
                // 如果点击的是已选中的，使用所有选中的
                paths = videos.value
                    .filter(v => selectedVideos.value.has(v.path))
                    .map(v => v.path);
            } else {
                // 否则只使用当前视频
                paths = [video.path];
            }

            event.dataTransfer.setData('text/plain', paths.join('\n'));
            event.dataTransfer.setData('application/json', JSON.stringify(video));
            event.dataTransfer.effectAllowed = 'copy';
        };

        const getDragPaths = (event) => {
            const data = event.dataTransfer.getData('text/plain');
            if (!data) return [];
            return data.split('\n').filter(p => p);
        };

        // 检查重复匹配
        const checkDuplicateFiles = (paths) => {
            const duplicates = paths.filter(p => matchedFiles.value.has(p));
            if (duplicates.length > 0) {
                const dupNames = duplicates.map(p => p.split(/[/\\]/).pop()).slice(0, 5).join('\n');
                alert('以下文件已经在其他位置匹配（视频列表中标绿），不能重复添加：\n\n' + dupNames);
                return true;
            }
            return false;
        };

        // 批量模式拖放
        const onBatchDrop = (event, dropType) => {
            const paths = getDragPaths(event);
            if (!paths.length) return;

            // 检测是否已匹配（标绿）
            if (checkDuplicateFiles(paths)) {
                return;
            }

            const newFiles = paths.map(p => {
                const name = p.split(/[/\\]/).pop();
                return { path: p, name: name };
            });

            const existingPaths = new Set(batchFiles.value.map(f => f.path));
            const uniqueFiles = newFiles.filter(f => !existingPaths.has(f.path));

            if (dropType === 'add') {
                batchFiles.value = [...batchFiles.value, ...uniqueFiles].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                statusText.value = '已添加 ' + uniqueFiles.length + ' 个文件到批量匹配';
            } else {
                batchFiles.value = uniqueFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                statusText.value = '已覆盖 ' + uniqueFiles.length + ' 个文件';
            }

            updateCurrentSeasonFileMapping();
            updateMatchedFiles();
        };

        // 单集模式拖放
        const onSingleDrop = (event, epNum) => {
            const paths = getDragPaths(event);
            if (!paths.length) return;

            // 单集模式只能拖一个文件
            if (paths.length > 1) {
                alert('单集模式只能匹配1个文件');
                return;
            }

            const path = paths[0];
            const key = 'S' + String(currentSeason.value).padStart(2, '0') + 'E' + String(epNum).padStart(2, '0');

            // 获取当前行已匹配的文件（允许重新拖放同一文件到当前行）
            const currentEp = matchedEpisodes[key];
            const currentFilePath = currentEp ? currentEp.path : null;

            // 检测是否已匹配（标绿）- 排除当前行已匹配的文件
            if (matchedFiles.value.has(path) && path !== currentFilePath) {
                alert('该文件已经在其他位置匹配，不能重复添加');
                return;
            }

            matchedEpisodes[key] = { path: path, name: path.split(/[/\\]/).pop() };
            statusText.value = 'E' + epNum + ' 已匹配: ' + path.split(/[/\\]/).pop();
            updateCurrentSeasonFileMapping();
            updateMatchedFiles();
        };

        // 剧场版拖放
        const onMovieDrop = (event, dropType) => {
            const paths = getDragPaths(event);
            if (!paths.length) return;

            // 检查重复
            if (checkDuplicateFiles(paths)) {
                return;
            }

            const newFiles = paths.map(p => {
                const name = p.split(/[/\\]/).pop();
                return { path: p, name: name };
            });

            const existingPaths = new Set(movieFiles.value.map(f => f.path));
            const uniqueFiles = newFiles.filter(f => !existingPaths.has(f.path));

            if (dropType === 'add') {
                movieFiles.value = [...movieFiles.value, ...uniqueFiles].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                statusText.value = '已添加 ' + uniqueFiles.length + ' 个剧场版文件';
            } else {
                movieFiles.value = uniqueFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                statusText.value = '已覆盖 ' + uniqueFiles.length + ' 个剧场版文件';
            }

            updateMatchedFiles();
        };

        // 剧场版拖拽排序
        const onMovieItemDragStart = (event, index) => {
            event.dataTransfer.setData('text/plain', index);
        };

        const onMovieItemDrop = (event, toIndex) => {
            const fromIndex = parseInt(event.dataTransfer.getData('text/plain'));
            if (isNaN(fromIndex) || fromIndex === toIndex) return;

            const [moved] = movieFiles.value.splice(fromIndex, 1);
            movieFiles.value.splice(toIndex, 0, moved);
            movieFiles.value = [...movieFiles.value];

            updateMatchedFiles();
        };

        // 排序拖放
        const onMatchItemDragStart = (event, index) => {
            event.dataTransfer.setData('text/plain', index);
        };

        const onMatchItemDrop = (event, toIndex) => {
            const fromIndex = parseInt(event.dataTransfer.getData('text/plain'));
            if (isNaN(fromIndex) || fromIndex === toIndex) return;

            const files = searchType.value === 'movie' ? movieFiles.value : batchFiles.value;
            const [moved] = files.splice(fromIndex, 1);
            files.splice(toIndex, 0, moved);

            if (searchType.value === 'movie') {
                movieFiles.value = [...files];
            } else {
                batchFiles.value = [...files];
                updateCurrentSeasonFileMapping();
            }
            updateMatchedFiles();
        };

        // Extras拖放
        const onExtrasDrop = (event) => {
            const paths = getDragPaths(event);
            if (!paths.length) return;

            // 检查是否已在其他季度/剧场版匹配
            if (checkDuplicateFiles(paths)) {
                return;
            }

            const newFiles = paths.map(p => {
                const name = p.split(/[/\\]/).pop();
                return { path: p, name: name };
            });

            const existingPaths = new Set(extrasFiles.value.map(f => f.path));
            const uniqueFiles = newFiles.filter(f => !existingPaths.has(f.path));

            extrasFiles.value = [...extrasFiles.value, ...uniqueFiles];
            statusText.value = '已添加 ' + uniqueFiles.length + ' 个到 Extras';
            updateMatchedFiles();
        };

        // ============ 移除文件 ============

        const removeBatchFile = (index) => {
            batchFiles.value.splice(index, 1);
            updateCurrentSeasonFileMapping();
            updateMatchedFiles();
        };

        const removeMovieFile = (index) => {
            movieFiles.value.splice(index, 1);
            updateMatchedFiles();
        };

        const clearAllMovieMatches = () => {
            movieFiles.value = [];
            updateMatchedFiles();
            statusText.value = '已清空所有剧场版匹配';
        };

        const getMovieStatusText = () => {
            if (movieFiles.value.length === 0) {
                return '💡 将视频文件拖放到下方匹配区域';
            } else if (movieFiles.value.length === 1) {
                return '✅ 已匹配 1 个文件 - 整理时将直接使用影片名称';
            } else {
                return `✅ 已匹配 ${movieFiles.value.length} 个文件 - 整理时将自动添加 -cd1, -cd2 后缀`;
            }
        };

        const cancelMatch = (epNum) => {
            const key = 'S' + String(currentSeason.value).padStart(2, '0') + 'E' + String(epNum).padStart(2, '0');
            const deletedPath = matchedEpisodes[key]?.path;
            delete matchedEpisodes[key];
            // 如果批量列表中有这个文件，也移除
            if (deletedPath && matchMode.value === 'batch') {
                const idx = batchFiles.value.findIndex(f => f.path === deletedPath);
                if (idx !== -1) {
                    batchFiles.value.splice(idx, 1);
                }
            }
            updateCurrentSeasonFileMapping();
            updateMatchedFiles();
        };

        const removeExtrasFile = (index) => {
            extrasFiles.value.splice(index, 1);
            updateMatchedFiles();
        };

        const clearExtras = () => {
            extrasFiles.value = [];
            updateMatchedFiles();
        };

        const clearSeasonMatches = () => {
            // Extras 标签使用单独的清空
            if (currentSeason.value === 'extras') {
                extrasFiles.value = [];
                updateMatchedFiles();
                return;
            }
            if (matchMode.value === 'batch') {
                batchFiles.value = [];
            } else {
                // 清除当前季度的单集匹配
                const seasonPrefix = 'S' + String(currentSeason.value).padStart(2, '0') + 'E';
                Object.keys(matchedEpisodes).forEach(key => {
                    if (key.startsWith(seasonPrefix)) {
                        delete matchedEpisodes[key];
                    }
                });
            }
            updateCurrentSeasonFileMapping();
            updateMatchedFiles();
        };

        // ============ 更新匹配 ============

        const updateMatchedFiles = () => {
            const set = new Set();

            // 剧场版和 Extras 始终计算
            movieFiles.value.forEach(f => set.add(f.path));
            extrasFiles.value.forEach(f => set.add(f.path));

            // 收集所有季度的 file_mappings（包括批量和单集）
            Object.values(seasonFileMappings).forEach(mapping => {
                if (mapping) {
                    Object.keys(mapping).forEach(path => set.add(path));
                }
            });

            matchedFiles.value = set;

            // 扫描包含已匹配文件的文件夹（未展开的文件夹也需要显示统计）
            scanFoldersWithMatchedFiles(set);

            updateMatchedHighlight();
            refreshVideoHighlight();
        };

        // 刷新文件夹统计信息（包括子文件夹）
        const scanFoldersWithMatchedFiles = async (matchedSet) => {
            if (matchedSet.size === 0) return;

            // 收集所有匹配文件的目录路径
            const matchedDirs = new Set();
            matchedSet.forEach(path => {
                const dir = path.substring(0, path.lastIndexOf('/'));
                if (dir) matchedDirs.add(dir);
            });

            // 递归刷新文件夹（同时更新 folders.value 和 folderCache）
            const refreshFolder = (folderPath, cachedData = null, folderInTree = null) => {
                // 如果没有传入缓存数据，尝试从 folderCache 获取
                const cached = cachedData || folderCache[folderPath];
                if (!cached || !cached.videos) return;

                // 检查是否需要刷新
                let needsRefresh = false;
                for (const dir of matchedDirs) {
                    if (dir.startsWith(folderPath + '/') || dir === folderPath) {
                        needsRefresh = true;
                        break;
                    }
                }

                if (needsRefresh) {
                    const allVideos = cached.videos;
                    const matched = allVideos.filter(v => matchedSet.has(v.path)).length;

                    // 1. 如果传入了 folderInTree，直接更新它
                    if (folderInTree) {
                        folderInTree.video_count = allVideos.length;
                        folderInTree.matched_count = matched;
                    }

                    // 2. 同时从 folders.value 查找并更新
                    const folder = findFolderByPath(folders.value, folderPath);
                    if (folder && folder !== folderInTree) {
                        folder.video_count = allVideos.length;
                        folder.matched_count = matched;
                    }
                }

                // 递归子文件夹
                if (cached.subfolders && cached.subfolders.length > 0) {
                    const childrenArray = folderInTree && folderInTree.children ? folderInTree.children : null;
                    cached.subfolders.forEach((child, index) => {
                        const childInTree = childrenArray ? childrenArray[index] : null;
                        refreshFolder(child.path, child, childInTree);
                    });
                }
            };

            // 从一级文件夹开始刷新
            folders.value.forEach(folder => {
                refreshFolder(folder.path, null, folder);
            });

            // 强制触发响应式更新
            folders.value = [...folders.value];
        };

        // 刷新视频列表标绿
        const refreshVideoHighlight = () => {
            // 重新赋值整个数组，确保触发响应式更新
            videos.value = videos.value.map(video => ({
                ...video,
                isMatched: matchedFiles.value.has(video.path)
            }));
        };

        const updateMatchedHighlight = () => {
            // 从缓存的文件夹数据更新 matched_count
            const updateFolderCounts = (folderItem) => {
                if (!folderItem || !folderItem.path) return;

                // 从缓存获取该文件夹的所有视频
                const cached = folderCache[folderItem.path];
                if (cached && cached.videos) {
                    const allVideos = cached.videos;
                    const matched = allVideos.filter(v => matchedFiles.value.has(v.path)).length;
                    folderItem.video_count = allVideos.length;
                    folderItem.matched_count = matched;
                } else {
                    // 如果没有缓存（子文件夹没有独立 key），从父缓存中查找
                    const folderPathNormalized = folderItem.path.replace(/\\/g, '/');
                    for (const [cacheKey, cacheValue] of Object.entries(folderCache)) {
                        if (cacheKey.endsWith('_root')) continue;
                        if (cacheValue.subfolders) {
                            const childInCache = findSubfolder(cacheValue.subfolders, folderItem.path);
                            if (childInCache) {
                                const allVideos = (cacheValue.videos || []).filter(v => {
                                    const videoPath = v.path.replace(/\\/g, '/');
                                    return videoPath.startsWith(folderPathNormalized + '/');
                                });
                                folderItem.video_count = allVideos.length;
                                folderItem.matched_count = allVideos.filter(v => matchedFiles.value.has(v.path)).length;
                                break;
                            }
                        }
                    }
                }

                // 递归更新子文件夹
                if (folderItem.children) {
                    folderItem.children.forEach(updateFolderCounts);
                }
            };

            // 更新所有一级文件夹及其子文件夹
            folders.value.forEach(updateFolderCounts);

            // 强制触发响应式更新
            folders.value = [...folders.value];
        };

        const hasMatches = computed(() => {
            // Extras 标签使用单独的判断
            if (currentSeason.value === 'extras') {
                return extrasFiles.value.length > 0;
            }
            if (matchMode.value === 'batch') {
                return batchFiles.value.length > 0;
            } else {
                const seasonPrefix = 'S' + String(currentSeason.value).padStart(2, '0') + 'E';
                return Object.keys(matchedEpisodes).some(k => k.startsWith(seasonPrefix));
            }
        });

        // ============ TMDB 搜索 ============

        const searchTmdb = async () => {
            if (!searchQuery.value.trim()) return;
            if (!config.tmdb_api_key) {
                alert('请先配置 TMDB API Key');
                return;
            }

            try {
                const res = await fetch('/api/tmdb/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: searchQuery.value,
                        type: searchType.value
                    })
                });
                const data = await res.json();
                if (data.success) {
                    searchResults.value = data.results;
                    selectedMedia.value = null;
                    seasons.value = [];
                    currentSeason.value = null;
                    episodes.value = [];
                } else {
                    alert(data.error);
                }
            } catch (e) {
                console.error('搜索失败:', e);
            }
        };

        const selectMedia = async (media) => {
            selectedMedia.value = media;
            searchResults.value = [];
            seasons.value = [];
            currentSeason.value = null;
            currentMovieTab.value = 'main';
            episodes.value = [];
            batchFiles.value = [];
            movieFiles.value = [];
            extrasFiles.value = [];
            Object.keys(matchedEpisodes).forEach(key => delete matchedEpisodes[key]);
            Object.keys(seasonEpisodesCache).forEach(key => delete seasonEpisodesCache[key]); // 清空剧集缓存
            // 不清空 folderCache（与原版一致，原版不清空文件夹缓存）
            // 清空所有季度数据
            Object.keys(seasonBatchFiles).forEach(key => delete seasonBatchFiles[key]);
            Object.keys(seasonMatchedEpisodes).forEach(key => delete seasonMatchedEpisodes[key]);
            Object.keys(seasonMatchModes).forEach(key => delete seasonMatchModes[key]);
            Object.keys(seasonFileMappings).forEach(key => delete seasonFileMappings[key]);
            updateMatchedFiles();  // 刷新高亮（与原版 _refresh_all_folders 对应）
            statusText.value = '已选择：' + media.name;

            if (searchType.value === 'tv') {
                try {
                    const res = await fetch(`/api/tmdb/details?id=${media.id}&type=tv`);
                    const data = await res.json();
                    if (data.success) {
                        seasons.value = data.seasons;
                        if (seasons.value.length > 0) {
                            // 默认选择第一个季度
                            selectSeason(seasons.value[0].season_number);
                        }
                    }
                } catch (e) {
                    console.error('获取TV详情失败:', e);
                }
            } else {
                // 电影：获取详情以获取 runtime, vote_average, release_date
                try {
                    const res = await fetch(`/api/tmdb/details?id=${media.id}&type=movie`);
                    const data = await res.json();
                    if (data.success && data.info) {
                        // 合并详情信息到 selectedMedia
                        selectedMedia.value = {
                            ...media,
                            runtime: data.info.runtime,
                            vote_average: data.info.vote_average,
                            release_date: data.info.release_date,
                            overview: data.info.overview || media.overview,
                            poster_path: data.info.poster_path || media.poster_path
                        };
                    }
                } catch (e) {
                    console.error('获取电影详情失败:', e);
                }
            }
        };

        const selectSeason = async (seasonNum) => {
            // 先保存当前季度的数据
            const prevSeason = currentSeason.value;
            // 跳过 null 和 'extras'
            if (prevSeason !== null && prevSeason !== 'extras') {
                // 统一转为数字
                const ps = Number(prevSeason);
                if (!isNaN(ps)) {
                    if (matchMode.value === 'batch') {
                        seasonBatchFiles[ps] = [...batchFiles.value];
                    } else {
                        // 只保存当前季度的单集匹配数据
                        const seasonPrefix = 'S' + String(ps).padStart(2, '0') + 'E';
                        const seasonData = {};
                        Object.entries(matchedEpisodes).forEach(([key, ep]) => {
                            if (key.startsWith(seasonPrefix)) {
                                seasonData[key] = ep;
                            }
                        });
                        seasonMatchedEpisodes[ps] = seasonData;
                    }
                    // 保存当前季度模式
                    seasonMatchModes[ps] = matchMode.value;
                    // 保存当前季度的 file_mappings
                    updateCurrentSeasonFileMapping();
                }
            }

            currentSeason.value = seasonNum;

            // 如果是 Extras 标签，不加载 API
            if (seasonNum === 'extras') {
                episodes.value = [];
                episodesLoading.value = false;
                return;
            }

            episodesLoading.value = true;
            episodes.value = [];

            // 转为数字
            const sn = Number(seasonNum);

            // 清空当前数据，只清空之前季度的数据
            batchFiles.value = [];
            if (prevSeason !== null && prevSeason !== 'extras') {
                const ps = Number(prevSeason);
                if (!isNaN(ps)) {
                    const prevSeasonPrefix = 'S' + String(ps).padStart(2, '0') + 'E';
                    Object.keys(matchedEpisodes).forEach(key => {
                        if (key.startsWith(prevSeasonPrefix)) {
                            delete matchedEpisodes[key];
                        }
                    });
                }
            }

            // 加载该季度的数据
            if (seasonMatchModes[sn]) {
                // 优先恢复模式
                matchMode.value = seasonMatchModes[sn];
                if (seasonMatchModes[sn] === 'batch' && seasonBatchFiles[sn]) {
                    batchFiles.value = [...seasonBatchFiles[sn]];
                } else if (seasonMatchModes[sn] === 'single' && seasonMatchedEpisodes[sn]) {
                    // 只恢复当前季度的数据
                    const seasonPrefix = 'S' + String(sn).padStart(2, '0') + 'E';
                    Object.entries(seasonMatchedEpisodes[sn]).forEach(([key, ep]) => {
                        if (key.startsWith(seasonPrefix)) {
                            matchedEpisodes[key] = ep;
                        }
                    });
                }
            } else if (seasonBatchFiles[sn]) {
                batchFiles.value = [...seasonBatchFiles[sn]];
                matchMode.value = 'batch';
                seasonMatchModes[sn] = 'batch';
            } else if (seasonMatchedEpisodes[sn]) {
                // 只恢复当前季度的数据
                const seasonPrefix = 'S' + String(sn).padStart(2, '0') + 'E';
                Object.entries(seasonMatchedEpisodes[sn]).forEach(([key, ep]) => {
                    if (key.startsWith(seasonPrefix)) {
                        matchedEpisodes[key] = ep;
                    }
                });
                matchMode.value = 'single';
                seasonMatchModes[sn] = 'single';
            } else {
                // S0 默认单集模式，其他默认批量模式
                if (sn === 0) {
                    matchMode.value = 'single';
                    seasonMatchModes[sn] = 'single';
                } else {
                    matchMode.value = 'batch';
                    seasonMatchModes[sn] = 'batch';
                }
            }

            // 恢复后更新 file_mappings
            if (!isNaN(sn)) {
                updateCurrentSeasonFileMapping();
            }

            // 刷新高亮（与原版 _update_status 对应）
            updateMatchedFiles();

            // 检查缓存
            if (seasonEpisodesCache[seasonNum]) {
                episodes.value = seasonEpisodesCache[seasonNum];
                episodesLoading.value = false;
                return;
            }

            try {
                const res = await fetch(`/api/tmdb/details?id=${selectedMedia.value.id}&type=tv&season=${seasonNum}`);
                const data = await res.json();
                if (data.success) {
                    episodes.value = data.episodes;
                    seasonEpisodesCache[seasonNum] = data.episodes; // 缓存
                }
            } catch (e) {
                console.error('获取季度详情失败:', e);
            } finally {
                episodesLoading.value = false;
            }
        };

        const switchToSingleMode = () => {
            // 切换到单集模式：清空批量数据（与原版一致）
            batchFiles.value = [];
            matchMode.value = 'single';
            if (typeof currentSeason.value === 'number') {
                seasonMatchModes[currentSeason.value] = 'single';
            }

            // 重新生成当前季度的 file_mappings（只包含单集匹配数据）
            updateCurrentSeasonFileMapping();

            // 刷新高亮和统计
            updateMatchedFiles();

            if (episodes.value.length === 0 && currentSeason.value !== 'extras') {
                selectSeason(currentSeason.value);
            }
        };

        const switchToBatchMode = () => {
            // 切换到批量模式：清空单集数据（与原版一致）
            // 只清空当前季度的单集匹配
            const seasonPrefix = 'S' + String(currentSeason.value).padStart(2, '0') + 'E';
            Object.keys(matchedEpisodes).forEach(key => {
                if (key.startsWith(seasonPrefix)) {
                    delete matchedEpisodes[key];
                }
            });
            matchMode.value = 'batch';
            if (typeof currentSeason.value === 'number') {
                seasonMatchModes[currentSeason.value] = 'batch';
            }

            // 重新生成当前季度的 file_mappings（只包含批量匹配数据）
            updateCurrentSeasonFileMapping();

            // 刷新高亮和统计
            updateMatchedFiles();
        };

        const clearMedia = () => {
            selectedMedia.value = null;
            seasons.value = [];
            currentSeason.value = null;
            currentMovieTab.value = 'main';
            episodes.value = [];
            batchFiles.value = [];
            movieFiles.value = [];
            extrasFiles.value = [];
            Object.keys(matchedEpisodes).forEach(key => delete matchedEpisodes[key]);
            // 清空所有季度数据
            Object.keys(seasonBatchFiles).forEach(key => delete seasonBatchFiles[key]);
            Object.keys(seasonMatchedEpisodes).forEach(key => delete seasonMatchedEpisodes[key]);
            Object.keys(seasonMatchModes).forEach(key => delete seasonMatchModes[key]);
            Object.keys(seasonFileMappings).forEach(key => delete seasonFileMappings[key]);
            updateMatchedFiles();
        };

        // ============ 整理 ============

        const organize = async () => {
            const fileMappings = {};

            if (searchType.value === 'movie') {
                movieFiles.value.forEach((f, idx) => {
                    fileMappings[f.path] = movieFiles.value.length === 1 ? 'movie' : `movie-cd${idx + 1}`;
                });
            } else {
                // 直接合并所有季度的 file_mappings（每个季度已独立维护）
                Object.entries(seasonFileMappings).forEach(([seasonNum, mapping]) => {
                    if (isNaN(Number(seasonNum))) return;
                    if (mapping) {
                        Object.assign(fileMappings, mapping);
                    }
                });
            }

            extrasFiles.value.forEach(f => {
                fileMappings[f.path] = 'extras';
            });

            if (Object.keys(fileMappings).length === 0) {
                alert('请先拖放文件到季度区域或 extras');
                return;
            }

            if (!config.target_dir) {
                alert('请先在设置中配置目标目录');
                return;
            }

            const data = {
                file_mappings: fileMappings,
                content_type: searchType.value,
                auto_extras: config.auto_extras,
                scan_unorganized: config.scan_unorganized,
                tv_info: searchType.value === 'tv' ? {
                    name: selectedMedia.value.name,
                    first_air_date: selectedMedia.value.year
                } : null,
                movie_info: searchType.value === 'movie' ? {
                    title: selectedMedia.value.title,
                    release_date: selectedMedia.value.year
                } : null
            };

            statusText.value = '正在整理文件...';
            try {
                const res = await fetch('/api/organize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await res.json();
                organizeResult.value = result;
                selectedUnorganized.value = [];
                selectAllUnorganized.value = false;  // 重置全选状态
                showResultModal.value = true;

                if (result.success) {
                    statusText.value = '整理完成！成功 ' + result.success_count + ' 个，失败 ' + result.fail_count + ' 个';
                    loadFolders();
                    updateMatchedFiles();  // 刷新高亮
                }
            } catch (e) {
                console.error('整理失败:', e);
                statusText.value = '整理失败';
                alert('整理失败: ' + e.message);
            }
        };

        // 全选/取消全选未整理文件
        const toggleSelectAllUnorganized = () => {
            if (selectAllUnorganized.value) {
                selectedUnorganized.value = organizeResult.value.unorganized_files?.map(f => f.path) || [];
            } else {
                selectedUnorganized.value = [];
            }
        };

        // 整理选中文件到 extras
        const organizeToExtras = async () => {
            if (selectedUnorganized.value.length === 0) {
                alert('请先勾选要整理的文件');
                return;
            }

            // 将中文 mode 转为英文
            const modeMap = {'硬链接': 'link', '剪切': 'cut', '复制': 'copy'};
            const mode = modeMap[organizeResult.value.mode] || 'link';

            const data = {
                files: selectedUnorganized.value,
                tv_name: organizeResult.value.tv_name,
                year: organizeResult.value.year,
                mode: mode
            };

            try {
                const res = await fetch('/api/organize-extras', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await res.json();
                if (result.success) {
                    alert('已整理 ' + result.count + ' 个文件到 extras 文件夹');
                    showResultModal.value = false;
                    selectedUnorganized.value = [];
                    loadFolders();
                } else {
                    alert('整理失败: ' + result.error);
                }
            } catch (e) {
                console.error('整理到extras失败:', e);
                alert('整理失败: ' + e.message);
            }
        };

        // ============ 监听搜索类型变化 ============

        watch(searchType, () => {
            clearMedia();
            searchResults.value = [];
        });

        // ============ 调整大小 ============
        let isResizingH = false;
        let startY = 0;
        let startHeight = 0;

        const startResizeH = (e) => {
            isResizingH = true;
            startY = e.clientY;
            const folderPanel = document.querySelector('.panel-folder');
            startHeight = folderPanel.offsetHeight;
            document.addEventListener('mousemove', doResizeH);
            document.addEventListener('mouseup', stopResizeH);
            e.preventDefault();
        };

        const doResizeH = (e) => {
            if (!isResizingH) return;
            const deltaY = e.clientY - startY;
            const folderPanel = document.querySelector('.panel-folder');
            const newHeight = Math.max(100, startHeight + deltaY);
            folderPanel.style.flex = 'none';
            folderPanel.style.height = newHeight + 'px';
        };

        const stopResizeH = () => {
            isResizingH = false;
            document.removeEventListener('mousemove', doResizeH);
            document.removeEventListener('mouseup', stopResizeH);
        };

        // 垂直分割器 - 左右面板
        let isResizingV = false;
        let startX = 0;
        let startWidth = 0;

        const startResizeV = (e) => {
            isResizingV = true;
            startX = e.clientX;
            const leftPanel = document.querySelector('.left-panel');
            startWidth = leftPanel.offsetWidth;
            document.addEventListener('mousemove', doResizeV);
            document.addEventListener('mouseup', stopResizeV);
            e.preventDefault();
        };

        const doResizeV = (e) => {
            if (!isResizingV) return;
            const deltaX = e.clientX - startX;
            const leftPanel = document.querySelector('.left-panel');
            const newWidth = Math.max(300, startWidth + deltaX);
            leftPanel.style.flex = 'none';
            leftPanel.style.width = newWidth + 'px';
        };

        const stopResizeV = () => {
            isResizingV = false;
            // 保存面板宽度
            const leftPanel = document.querySelector('.left-panel');
            if (leftPanel) {
                leftPanelWidth.value = leftPanel.offsetWidth;
                saveUserSettings();
            }
            document.removeEventListener('mousemove', doResizeV);
            document.removeEventListener('mouseup', stopResizeV);
        };

        // ============ 初始化 ============

        onMounted(() => {
            // 加载用户设置（排序状态、面板宽度等）
            loadUserSettings();
            // 应用面板宽度
            applyPanelWidth();

            // 先检查登录状态和加载配置
            checkLogin().then(() => {
                if (isLoggedIn.value) {
                    loadConfig().then(() => {
                        // 加载文件夹列表（会使用后端缓存，不会重复扫描）
                        loadFolders();
                    });
                }
            });

            // 监听键盘事件：Ctrl+A 全选视频
            document.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                    // 检查焦点是否在输入框等地方
                    const tag = e.target.tagName.toLowerCase();
                    if (tag === 'input' || tag === 'textarea') {
                        return; // 输入框中不处理
                    }
                    e.preventDefault();
                    selectAllVideos();
                }
            });
        });

        return {
            // 状态
            config,
            folders,
            flatFolders,
            selectedFolder,
            videos,
            selectedVideos,
            videoMenu,
            folderSortBy,
            folderSortAsc,
            videoSortBy,
            videoSortAsc,
            searchQuery,
            searchType,
            searchResults,
            selectedMedia,
            seasons,
            currentSeason,
            currentMovieTab,
            episodes,
            episodesLoading,
            matchMode,
            batchFiles,
            movieFiles,
            extrasFiles,
            matchedEpisodes,
            matchedFiles,
            showConfigModal,
            statusText,
            showResultModal,
            organizeResult,
            selectedUnorganized,
            selectAllUnorganized,
            showDirPicker,
            dirPickerPath,
            dirEntries,
            dirEntriesLoading,

            // 登录状态
            isLoggedIn,
            passwordRequired,
            loginPassword,
            loginError,

            // 计算属性
            folderMatchCounts,
            moveModeName,
            matchedCount,
            canOrganize,
            hasMatches,

            // 方法
            startResizeH,
            startResizeV,
            loadFolders,
            toggleFolder,
            sortFolders,
            sortVideos,
            selectFolder,
            refreshVideos,
            handleVideoClick,
            showVideoMenu,
            copyVideoName,
            copyVideoPath,
            selectAllVideos,
            deselectAllVideos,
            onDragStart,
            onBatchDrop,
            onSingleDrop,
            onMovieDrop,
            onMatchItemDragStart,
            onMatchItemDrop,
            onExtrasDrop,
            removeBatchFile,
            removeMovieFile,
            clearAllMovieMatches,
            getMovieStatusText,
            onMovieItemDragStart,
            onMovieItemDrop,
            cancelMatch,
            removeExtrasFile,
            clearExtras,
            clearSeasonMatches,
            getSeasonMatchedCount,
            searchTmdb,
            selectMedia,
            selectSeason,
            switchToSingleMode,
            switchToBatchMode,
            clearMedia,
            organize,
            toggleSelectAllUnorganized,
            organizeToExtras,
            saveConfig,
            checkVolume,
            volumeWarning,
            selectDirectory,
            onDirectorySelected,
            loadRootDirs,
            loadDirEntries,
            selectDirEntry,
            confirmDirSelection,

            // 登录方法
            checkLogin,
            doLogin,
            doLogout
        };
    }
});

app.mount('#app');
