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

var renderIcon = function(info){
    console.log('🎨 渲染图标，IP信息:', info);
    var title = '';
    if (info.country && info.country.length > 0) {
        if (info.country_code == 'HK' || info.country_code == 'MO' || info.country_code == 'TW') {
            title = info.country + ' ' + info.province;
        } else {
            title = info.country;
        }
        console.log('🏷️ 设置标题:', title);
        if (lang.indexOf('CN') > -1) {
            chrome.action.setTitle({title:"当前网站的IP地址为："+ title +"\n"+ "IP数据信息 Powered by IPIP.net"});
        } else {
            chrome.action.setTitle({title:"The current site IP GeoLocation："+ title +"\n"+ "IP Info Powered by IPIP.net"});
        }
    }
    if (info.country_code && info.country_code.length == 2) {
        const iconPath = chrome.runtime.getURL("icons/" + info.country_code + ".png");
        console.log('🏳️ 设置国家图标:', info.country_code, iconPath);
        chrome.action.setIcon({path: iconPath});
    } else {
        const defaultIconPath = chrome.runtime.getURL("Q.png");
        console.log('🏳️ 设置默认图标:', defaultIconPath);
        chrome.action.setIcon({path: defaultIconPath});
    }
};

var getSelection = function(info, tab) {
    console.log('🔍 右键搜索:', info.selectionText);
    var url = "https://www.ipip.net/ip/" + info.selectionText + ".html";
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
        const apiUrl = "https://clientapi.ipip.net/browser/chrome?ip=" + details.ip + '&l=' + navigator.language + '&domain=' + domain;
        console.log('🔍 查询IP地理位置信息:', details.ip);
        console.log('🔍 请求URL:', apiUrl);
        
        ajaxGet(apiUrl, function(info){
            console.log('📊 地理位置API返回结果:', info);
            if (info.ret == 0) {
                ipData[details.ip] = info.data;
                dnsData[details.ip] = info.dns;
                renderIcon(info.data);
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
        dnsData[request.ip] = request.dnsData;
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
        for (p in request.ds) {
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
