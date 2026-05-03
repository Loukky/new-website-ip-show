console.log('🔍 IPIP Content Script 开始分析页面域名');
var domains = {};

$('img').each(function(k, v){
    var match = v.src.match(/:?\/\/(.*?)\//);
    if (match) {
        if (psl.isValid(match[1])) {
            if (domains[match[1]]) {
                domains[match[1]] += 1;
            } else {
                domains[match[1]] = 1;
            }
        }
    }
});
console.log('🖼️ 分析图片域名完成，找到:', Object.keys(domains).length, '个域名');

$('a').each(function(k, v){
    var match = v.href.match(/:?\/\/(.*?)\//);
    if (match) {
        if (psl.isValid(match[1])) {
            if (domains[match[1]]) {
                domains[match[1]] += 1;
            } else {
                domains[match[1]] = 1;
            }
        }
    }
});

$('script').each(function(k, v){
    var match = v.src.match(/:?\/\/(.*?)\//);
    if (match) {
        if (psl.isValid(match[1])) {
            if (domains[match[1]]) {
                domains[match[1]] += 1;
            } else {
                domains[match[1]] = 1;
            }
        }
    }
});

$('link').each(function(k, v){
    var match = v.href.match(/:?\/\/(.*?)\//);
    if (match) {
        if (psl.isValid(match[1])) {
            if (domains[match[1]]) {
                domains[match[1]] += 1;
            } else {
                domains[match[1]] = 1;
            }
        }
    }
});
console.log('📊 域名分析完成，总计:', Object.keys(domains).length, '个域名');
console.log('🌐 域名列表:', domains);
console.log('🏠 当前页面域名:', location.host);

// V3中移除外部脚本加载，改用fetch方式或移除此功能
// $.getScript('https://ajs.ipip.net/chrome.js');
chrome.runtime.sendMessage({ds:domains,d:location.host}, function(response) {
    console.log('✅ 域名数据已发送到background，响应:', response);
});