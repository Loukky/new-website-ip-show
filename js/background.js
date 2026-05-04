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

async function initClientIP() {
    try {
        const res = await fetch("https://geoip.loukky.com/myip.php");
        clientIP = (await res.text()).trim();
        console.log("🌍 本机IP:", clientIP);
    } catch (e) {
        console.warn("❌ 获取本机IP失败", e);
    }
}
initClientIP();

var renderIcon = function(info){
    console.log('🎨 渲染图标，IP信息:', info);
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
        chrome.action.setIcon({path: iconPath});
    } else {
        const defaultIconPath = chrome.runtime.getURL("Q.png");
        console.log('🏳️ 设置默认图标:', defaultIconPath);
        chrome.action.setIcon({path: defaultIconPath});
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
// 恢复原有的IP获取逻辑，但移除blocking功能
console.log('🔧 注册webRequest.onCompleted监听器');
chrome.webRequest.onCompleted.addListener(function(details) {
    console.log('🌐 WebRequest完成:', details.url, 'IP:', details.ip, 'TabId:', details.tabId);
    
    if (details.ip && details.tabId >= 0) {
        var domain = new URL(details.url).hostname;
        console.log('📍 获取到真实IP:', details.ip, '域名:', domain);
        
        tabsDomainMap[details.tabId] = domain;
        tabsIPMap[details.tabId] = details.ip;

        // 使用真实IP查询地理位置信息
        const apiUrl = "https://geoip.loukky.com/ip.php?ip=" + domain + '&ecs=' + clientIP;
        console.log('🔍 查询IP地理位置信息:', details.ip);
        console.log('🔍 请求URL:', apiUrl);
        
        ajaxGet(apiUrl, function(info){
            console.log('📊 地理位置API返回结果:', info);
            if (info.status == "success") {
                // 存储完整的IP信息对象，供renderIcon和popup使用
                ipData[details.ip] = info;
                // 将resolved_ips字符串数组转换为对象数组，与popup.js期望的格式一致
                dnsData[details.ip] = (info.resolved_ips || []).map(function(ip) {
                    return {ip: ip};
                });
                renderIcon(info);
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
    chrome.action.setIcon({path: chrome.runtime.getURL("images/icon_gray_38.png")});
    console.log('🔒 扩展已禁用，设置灰色图标');
});

chrome.tabs.onActivated.addListener(function(e){
    console.log('🔄 标签页激活:', e.tabId);
    if (tabsIPMap[e.tabId]) {
        console.log('📍 找到已缓存的IP信息:', tabsIPMap[e.tabId]);
        chrome.action.setIcon({path: chrome.runtime.getURL("images/icon_38.png")});
        chrome.action.enable(e.tabId);
        if (ipData[tabsIPMap[e.tabId]]) {
            console.log('🎨 重新渲染图标');
            renderIcon(ipData[tabsIPMap[e.tabId]]);
        }
    } else {
        console.log('❓ 未找到该标签页的IP信息');
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
        ipData[request.ip] = request.ipData;
        dnsData[request.ip] = request.resolved_ips;
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
        sendResponse({success: true});
        return true;
    }
    
    console.warn('❓ 未知消息类型:', request);
    return false;
});

console.log('✅ Service Worker 初始化完成');
