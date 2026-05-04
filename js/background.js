console.log('🚀 IPIP Extension Service Worker 启动');

// Service Worker 中使用 fetch API 替代 XMLHttpRequest
var ajaxGet = async function(url, callback) {
    console.log('📡 发起API请求:', url);
    try {
        const response = await fetch(url);
        console.log('📡 API响应状态:', response.status, response.statusText);
        if (!response.ok) {
            console.error('❌ API请求失败:', response.status, response.statusText);
            callback({
                ret: -1,
                msg: "Network Error"
            });
            return;
        }
        const resp = await response.json();
        console.log('✅ API响应数据:', resp);
        callback(resp);
    } catch (e) {
        console.error('❌ API请求异常:', e);
        callback({
            ret: 100,
            msg: "Server Response Error"
        });
    }
};

var tabsIPMap = {};
var tabsDomainMap = {};
var ipData = {};
var dnsData = {};
var domainList = [];
var lang = navigator.language;
var clientIP = "";

// ----- Chrome Storage Session 持久化辅助函数 (MV3 Service Worker 生存周期兼容) -----
const STORAGE_KEYS = {
    TABS_IP_MAP: 'persisted_tabsIPMap',
    TABS_DOMAIN_MAP: 'persisted_tabsDomainMap',
    IP_DATA: 'persisted_ipData',
    DNS_DATA: 'persisted_dnsData',
    DOMAIN_LIST: 'persisted_domainList',
};

// 从 chrome.storage.session 恢复数据
async function restoreFromStorage() {
    try {
        const result = await chrome.storage.session.get([
            STORAGE_KEYS.TABS_IP_MAP,
            STORAGE_KEYS.TABS_DOMAIN_MAP,
            STORAGE_KEYS.IP_DATA,
            STORAGE_KEYS.DNS_DATA,
            STORAGE_KEYS.DOMAIN_LIST
        ]);
        if (result[STORAGE_KEYS.TABS_IP_MAP]) {
            tabsIPMap = result[STORAGE_KEYS.TABS_IP_MAP];
            console.log('📦 从Storage恢复 tabsIPMap:', tabsIPMap);
        }
        if (result[STORAGE_KEYS.TABS_DOMAIN_MAP]) {
            tabsDomainMap = result[STORAGE_KEYS.TABS_DOMAIN_MAP];
            console.log('📦 从Storage恢复 tabsDomainMap:', tabsDomainMap);
        }
        if (result[STORAGE_KEYS.IP_DATA]) {
            ipData = result[STORAGE_KEYS.IP_DATA];
            console.log('📦 从Storage恢复 ipData:', ipData);
        }
        if (result[STORAGE_KEYS.DNS_DATA]) {
            dnsData = result[STORAGE_KEYS.DNS_DATA];
            console.log('📦 从Storage恢复 dnsData:', dnsData);
        }
        if (result[STORAGE_KEYS.DOMAIN_LIST]) {
            domainList = result[STORAGE_KEYS.DOMAIN_LIST];
            console.log('📦 从Storage恢复 domainList:', domainList);
        }
    } catch (e) {
        console.warn('⚠️ 从Storage恢复数据失败:', e);
    }
}

// 将数据持久化到 chrome.storage.session
async function persistToStorage() {
    try {
        await chrome.storage.session.set({
            [STORAGE_KEYS.TABS_IP_MAP]: tabsIPMap,
            [STORAGE_KEYS.TABS_DOMAIN_MAP]: tabsDomainMap,
            [STORAGE_KEYS.IP_DATA]: ipData,
            [STORAGE_KEYS.DNS_DATA]: dnsData,
            [STORAGE_KEYS.DOMAIN_LIST]: domainList,
        });
    } catch (e) {
        console.warn('⚠️ 持久化数据到Storage失败:', e);
    }
}

// 存储数据到各 map，并同时持久化
function setTabData(tabId, ip, domain) {
    tabsIPMap[tabId] = ip;
    tabsDomainMap[tabId] = domain;
    persistToStorage();
}

function setIpData(ip, data, dns) {
    ipData[ip] = data;
    dnsData[ip] = dns;
    persistToStorage();
}

// ----- 初始化 & 存储就绪标志 -----
let storageReady = false;  // 标志：Storage数据是否已恢复完成
let pendingActivatedTabId = null;  // 在恢复完成前暂存的激活tabId

async function init() {
    await restoreFromStorage();
    console.log('🔄 恢复后的 tabsIPMap:', tabsIPMap);
    console.log('🔄 恢复后的 ipData:', ipData);
    
    // 标记Storage已就绪
    storageReady = true;
    
    // 在所有已存在的标签页上应用恢复后的图标状态（使用国家图标或默认图标）
    const allTabIds = Object.keys(tabsIPMap).map(Number);
    for (const tabId of allTabIds) {
        const ip = tabsIPMap[tabId];
        if (ip && ipData[ip]) {
            chrome.action.enable(tabId);
            const info = ipData[ip];
            if (info.code2 && info.code2 !== "zz" && info.code2.length == 2) {
                const iconPath = chrome.runtime.getURL("icons/" + info.code2.toUpperCase() + ".png");
                chrome.action.setIcon({tabId: tabId, path: iconPath});
            } else {
                chrome.action.setIcon({tabId: tabId, path: chrome.runtime.getURL("images/icon_38.png")});
            }
        }
    }
    
    // 最后处理在恢复过程中暂存的标签页激活事件（确保覆盖 init 中设置的图标）
    if (pendingActivatedTabId !== null) {
        console.log('🔄 处理恢复期间暂存的标签页激活:', pendingActivatedTabId);
        handleTabActivated(pendingActivatedTabId);
        pendingActivatedTabId = null;
    }
}

async function initClientIP() {
    try {
        const res = await fetch("https://geoip.loukky.com/myip.php");
        clientIP = (await res.text()).trim();
        console.log("🌍 本机IP:", clientIP);
    } catch (e) {
        console.warn("❌ 获取本机IP失败", e);
    }
}

// tabId 参数可选：如果传入了 tabId，则为指定标签页设置图标（覆盖全局默认图标）
var renderIcon = function(info, tabId){
    console.log('🎨 渲染图标，IP信息:', info, 'tabId:', tabId);
    var title = '';
    if (info.country && info.country.length > 0) {
        title = info.country;
        console.log('🏷️ 设置标题:', title);
        if (lang.indexOf('CN') > -1) {
            chrome.action.setTitle({title:"当前网站的IP地址为："+ title +"\n"+ "IP数据信息"});
        } else {
            chrome.action.setTitle({title:"The current site IP GeoLocation："+ title +"\n"+ "IP Info"});
        }
    }
    if (info.code2 && info.code2 !== "zz" && info.code2.length == 2) {
        const iconPath = chrome.runtime.getURL("icons/" + info.code2.toUpperCase() + ".png");
        console.log('🏳️ 设置国家图标:', info.code2, iconPath);
        if (tabId !== undefined) {
            chrome.action.setIcon({tabId: tabId, path: iconPath});
        } else {
            chrome.action.setIcon({path: iconPath});
        }
    } else {
        const defaultIconPath = chrome.runtime.getURL("Q.png");
        console.log('🏳️ 设置默认图标:', defaultIconPath);
        if (tabId !== undefined) {
            chrome.action.setIcon({tabId: tabId, path: defaultIconPath});
        } else {
            chrome.action.setIcon({path: defaultIconPath});
        }
    }
};

var getSelection = function(info, tab) {
    console.log('🔍 右键搜索:', info.selectionText);
    var url = "https://geoip.loukky.com/?ip=" + info.selectionText;
    chrome.tabs.create({url: url});
};

// 在Service Worker启动时创建contextMenu
chrome.runtime.onStartup.addListener(() => {
    console.log('🔄 Service Worker onStartup');
    createContextMenu();
});
chrome.runtime.onInstalled.addListener(() => {
    console.log('📦 Extension onInstalled');
    createContextMenu();
});

function createContextMenu() {
    console.log('🔧 创建右键菜单');
    chrome.contextMenus.removeAll(() => {
        if (lang.indexOf('zh') > -1) {
            chrome.contextMenus.create({
                id: "ipip",
                contexts: ["selection"],
                title: "使用IPIP.NET搜索 \"%s\""
            }, () => {
                console.log('✅ 中文右键菜单创建完成');
            });
        } else {
            chrome.contextMenus.create({
                id: "ipip",
                contexts: ["selection"],
                title: "Search \"%s\" To IPIP.net"
            }, () => {
                console.log('✅ 英文右键菜单创建完成');
            });
        }
    });
}

// 立即创建contextMenu
console.log('🚀 立即创建右键菜单');
createContextMenu();

// V3中使用onClicked事件监听器
chrome.contextMenus.onClicked.addListener(function(info, tab) {
    console.log('🖱️ 右键菜单点击:', info.menuItemId, info.selectionText);
    if (info.menuItemId === "ipip") {
        getSelection(info, tab);
    }
});

// V3中使用webRequest API（只观察模式，不阻塞）
console.log('🔧 注册webRequest.onCompleted监听器');
chrome.webRequest.onCompleted.addListener(function(details) {
    console.log('🌐 WebRequest完成:', details.url, 'IP:', details.ip, 'TabId:', details.tabId);
    
    if (details.ip && details.tabId >= 0) {
        var domain = new URL(details.url).hostname;
        console.log('📍 获取到真实IP:', details.ip, '域名:', domain);
        
        // 使用持久化存储
        setTabData(details.tabId, details.ip, domain);

        // 优先使用浏览器实际连接的IP查询地理位置（browser-side IP）
        // 如果是本地回环IP（127.0.0.1, ::1 等），则改用域名查询（server-side IP）
        const lookupTarget = (details.ip === "127.0.0.1" || details.ip === "::1" || details.ip === "0.0.0.0" || details.ip === "localhost")
            ? domain
            : details.ip;
        const apiUrl = "https://geoip.loukky.com/ip.php?ip=" + encodeURIComponent(lookupTarget) + '&ecs=' + clientIP;
        console.log('🔍 查询IP地理位置信息:', details.ip, '查询目标:', lookupTarget);
        console.log('🔍 请求URL:', apiUrl);
        
        ajaxGet(apiUrl, function(info){
            console.log('📊 地理位置API返回结果:', info);
            if (info.status == "success") {
                // 存储完整的IP信息对象，供renderIcon和popup使用
                setIpData(details.ip, info, (info.resolved_ips || []).map(function(ip) {
                    return {ip: ip};
                }));
                // 为当前标签页设置 per-tab 图标
                renderIcon(info, details.tabId);
                chrome.action.enable(details.tabId);
                console.log('🎯 扩展已启用，IP:', details.ip);
            } else {
                console.warn('⚠️ 地理位置API返回错误:', info);
                chrome.action.disable(details.tabId);
            }
        });
    }
}, {
    urls: ["http://*/*", "https://*/*"],
    types: ["main_frame"]
});

chrome.tabs.onCreated.addListener(function(tab){
    console.log('🆕 新标签页创建:', tab.tabId);
    chrome.action.disable(tab.tabId);
    chrome.action.setIcon({tabId: tab.tabId, path: chrome.runtime.getURL("images/icon_gray_38.png")});
    console.log('🔒 扩展已禁用，设置灰色图标');
});

// 提取标签页激活处理为单独函数，用于直接在onActivated和恢复后延迟调用
function handleTabActivated(tabId) {
    console.log('🔄 处理标签页激活:', tabId);
    if (tabsIPMap[tabId]) {
        console.log('📍 找到已缓存的IP信息:', tabsIPMap[tabId]);
        chrome.action.enable(tabId);
        if (ipData[tabsIPMap[tabId]]) {
            console.log('🎨 重新渲染图标');
            // 传入 tabId 确保图标正确设置到该标签页
            renderIcon(ipData[tabsIPMap[tabId]], tabId);
        } else {
            // 有IP缓存但没有地理位置数据时使用默认图标
            chrome.action.setIcon({tabId: tabId, path: chrome.runtime.getURL("images/icon_38.png")});
        }
    } else {
        console.log('❓ 未找到该标签页的IP信息:', tabId);
        chrome.action.disable(tabId);
        chrome.action.setIcon({tabId: tabId, path: chrome.runtime.getURL("images/icon_gray_38.png")});
    }
}

chrome.tabs.onActivated.addListener(function(e){
    console.log('🔄 标签页激活事件:', e.tabId);
    if (!storageReady) {
        // 如果Storage数据还在恢复中，暂存此tabId，待恢复完成后处理
        console.log('⏳ Storage正在恢复，暂存标签页激活:', e.tabId);
        pendingActivatedTabId = e.tabId;
        // 先设置灰色图标，避免显示错误图标
        chrome.action.disable(e.tabId);
        chrome.action.setIcon({tabId: e.tabId, path: chrome.runtime.getURL("images/icon_gray_38.png")});
    } else {
        handleTabActivated(e.tabId);
    }
});

chrome.action.onClicked.addListener(function(tab) {
    chrome.action.setPopup({popup:"popup.html"})
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse){
    console.log('💬 收到消息:', request);
    
    if (request.action === 'getIPData') {
        console.log('📊 请求IP数据:', request.ip);
        const response = {
            ipData: ipData[request.ip],
            dnsData: dnsData[request.ip]
        };
        console.log('📤 返回IP数据:', response);
        sendResponse(response);
        return true;
    } else if (request.action === 'saveIPData') {
        console.log('💾 保存IP数据:', request.ip, request.ipData);
        setIpData(request.ip, request.ipData, request.resolved_ips);
        sendResponse({success: true});
        return true;
    } else if (request.action === 'getTabData') {
        console.log('📋 请求标签页数据');
        const response = {
            tabsIPMap: tabsIPMap,
            tabsDomainMap: tabsDomainMap,
            domainList: domainList
        };
        console.log('📤 返回标签页数据:', response);
        sendResponse(response);
        return true;
    } else if (request.ds) {
        console.log('🌐 处理域名列表:', request.ds);
        domainList = [];
        for (var p in request.ds) {
            domainList.push({
                "domain" : p,
                "amount" : request.ds[p],
            });
        }
        console.log('✅ 域名列表已更新:', domainList);
        persistToStorage();
        sendResponse({success: true});
        return true;
    }
    
    console.warn('❓ 未知消息类型:', request);
    return false;
});

// 初始化：先恢复Storage中的数据，然后获取本机IP
init().then(() => {
    console.log('✅ Storage数据恢复完成');
});
initClientIP();

console.log('✅ Service Worker 初始化完成');