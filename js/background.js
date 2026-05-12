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
    
    storageReady = true;
    
    // 在所有已存在的标签页上应用恢复后的图标状态
    const allTabIds = Object.keys(tabsIPMap).map(Number);
    for (const tabId of allTabIds) {
        const ip = tabsIPMap[tabId];
        const domain = tabsDomainMap[tabId];
        let info = null;
        // 优先用 browser-side IP 的地理数据渲染图标（直连场景）
        if (ip && ipData[ip]) {
            info = ipData[ip];
        }
        // 如果 browser IP 是回环地址（代理），则使用 server-side (domainKey) 数据
        const domainKey = getDomainDataKey(domain);
        if ((!info || ip === "127.0.0.1" || ip === "::1") && domainKey && ipData[domainKey]) {
            info = ipData[domainKey];
        }
        if (info) {
            chrome.action.enable(tabId);
            if (info.code2 && info.code2 !== "zz" && info.code2.length == 2) {
                const iconPath = chrome.runtime.getURL("icons/" + info.code2.toUpperCase() + ".png");
                chrome.action.setIcon({tabId: tabId, path: iconPath});
            } else {
                chrome.action.setIcon({tabId: tabId, path: chrome.runtime.getURL("images/icon_38.png")});
            }
        }
    }
    
    if (pendingActivatedTabId !== null) {
        console.log('🔄 处理恢复期间暂存的标签页激活:', pendingActivatedTabId);
        handleTabActivated(pendingActivatedTabId);
        pendingActivatedTabId = null;
    }
}

function getDomainDataKey(domain) {
    if (!domain) return null;
    return "domain:" + domain;
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

// 渲染图标规则：
// - 直连（browser IP 非回环）：使用 browser-side IP 的地理位置渲染国别图标
// - 代理（browser IP 是回环 127.0.0.1/::1）：使用 server-side 的 IP 地理位置渲染国别图标
var renderIcon = function(info, tabId){
    console.log('🎨 渲染图标，IP信息:', info, 'tabId:', tabId);
    var title = '';
    if (info.location && info.location.length > 0) {
        title = info.location;
        console.log('🏷️ 设置标题:', title);
        if (lang.indexOf('CN') > -1) {
            chrome.action.setTitle({title:"当前网站IP:"+ title});
        } else {
            chrome.action.setTitle({title:"The current site IP:"+ title});
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

console.log('🚀 立即创建右键菜单');
createContextMenu();

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
        
        setTabData(details.tabId, details.ip, domain);

        const isLocalIP = (details.ip === "127.0.0.1" || details.ip === "::1" || details.ip === "0.0.0.0" || details.ip === "localhost");

        // ========== 第一步：始终用域名查询（获取server-side数据 + resolved_ips）==========
        const domainApiUrl = "https://geoip.loukky.com/ip.php?ip=" + encodeURIComponent(domain) + '&ecs=' + clientIP;
        console.log('🔍 [Server-Side] 域名查询:', domainApiUrl);
        ajaxGet(domainApiUrl, function(domainInfo){
            if (domainInfo.status == "success") {
                // 保存 server-side 数据（以 domain 为 key，确保代理场景下各域名数据独立）
                const domainKey = getDomainDataKey(domain);
                setIpData(domainKey, domainInfo, (domainInfo.resolved_ips || []).map(function(ip) {
                    return {ip: ip};
                }));
                // 如果浏览器IP是回环地址（代理场景），使用server-side的数据渲染国别图标
                if (isLocalIP) {
                    renderIcon(domainInfo, details.tabId);
                    chrome.action.enable(details.tabId);
                    console.log('🎯 [代理] 使用server-side IP渲染图标，IP:', domainInfo.ip);
                }
            } else {
                console.warn('⚠️ 域名查询API返回错误:', domainInfo);
            }
        });

        // ========== 第二步：仅直连时查询 browser-side IP ==========
        if (!isLocalIP) {

            const browserApiUrl =
                "https://geoip.loukky.com/ip.php?ip=" +
                encodeURIComponent(details.ip);

            console.log('🔍 [Browser-Side] IP查询:', browserApiUrl);

            ajaxGet(browserApiUrl, function(browserInfo){

                if (browserInfo.status == "success") {

                    // 保存 browser-side 数据
                    setIpData(
                        details.ip,
                        browserInfo,
                        (browserInfo.resolved_ips || []).map(function(ip) {
                            return {ip: ip};
                        })
                    );

                    // 直连：使用 browser-side GEO
                    renderIcon(browserInfo, details.tabId);

                    chrome.action.enable(details.tabId);

                    console.log(
                        '🎯 [直连] 使用browser-side IP渲染图标，IP:',
                        details.ip
                    );

                } else {

                    console.warn(
                        '⚠️ IP查询API返回错误:',
                        browserInfo
                    );

                }

            });
        }
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

function handleTabActivated(tabId) {
    console.log('🔄 处理标签页激活:', tabId);
    const ip = tabsIPMap[tabId];
    const domain = tabsDomainMap[tabId];
    if (ip) {
        console.log('📍 找到已缓存的IP信息:', ip);
        chrome.action.enable(tabId);
        const isLocalIP = (ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0" || ip === "localhost");
        let info = null;
        if (isLocalIP) {
            // 代理：用 server-side (domainKey) 数据渲染图标
            const domainKey = getDomainDataKey(domain);
            if (domainKey && ipData[domainKey]) {
                info = ipData[domainKey];
            }
        } else {
            // 直连：用 browser-side IP 数据渲染图标
            if (ip && ipData[ip]) {
                info = ipData[ip];
            }
        }
        if (info) {
            console.log('🎨 重新渲染图标');
            renderIcon(info, tabId);
        } else {
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
        console.log('⏳ Storage正在恢复，暂存标签页激活:', e.tabId);
        pendingActivatedTabId = e.tabId;
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
    } else if (request.action === 'getDomainIPData') {
        // popup 通过 tabId 和 domain 获取独立的数据
        console.log('📊 请求域名IP数据:', request.tabId, request.domain);
        const ip = tabsIPMap[request.tabId];
        const domainKey = getDomainDataKey(request.domain);
        let data = null;
        let dns = null;
        // 优先找 domainKey（server-side 数据，针对代理和直连都需要展示的 resolved_ips）
        if (domainKey && ipData[domainKey]) {
            data = ipData[domainKey];
            dns = dnsData[domainKey];
        } else if (ip && ipData[ip]) {
            // 直连场景：浏览器IP与服务器IP相同，browser-side数据就是 server-side 数据
            data = ipData[ip];
            dns = dnsData[ip];
        }
        console.log('📤 返回域名IP数据:', {data, dns});
        sendResponse({ipData: data, dnsData: dns});
        return true;
    } else if (request.action === 'saveIPData') {
        console.log('💾 保存IP数据:', request.ip, request.ipData);
        setIpData(request.ip, request.ipData, request.resolved_ips);
        // 如果提供了 domain，同时保存为 domainKey
        if (request.domain) {
            const domainKey = getDomainDataKey(request.domain);
            setIpData(domainKey, request.ipData, request.resolved_ips);
        }
        sendResponse({success: true});
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

init().then(() => {
    console.log('✅ Storage数据恢复完成');
});
initClientIP();

console.log('✅ Service Worker 初始化完成');
