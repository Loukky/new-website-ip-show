var queryIp = '';
var queryDomain = '';
var refreshTimerId = 0;
var refreshCount = 0;
var maxRefresh = 5;   // 增加重试次数，给Service Worker恢复Storage数据留出时间
var activeTabId = 0;
// V3中使用chrome.runtime.getBackgroundPage()已被弃用，改用消息传递
var background = null;
var language = navigator.language;

var clientIP = "";

var ajaxGet = function(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.onerror = function(e){
        callback({
            ret:-1,
            msg:"Network Error"
        });
    };
    xhr.ontimeout = function(e){
        callback({
            ret:-1,
            msg:"Request Timeout"
        });
    };
    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4) {
            try {
                var resp = JSON.parse(xhr.responseText);
                callback(resp);
            } catch (e) {
                callback({
                    ret: 100,
                    msg: "Server Response Error"
                });
            }
        }
    };
    xhr.send();
};

var T = function(id) {
    return document.getElementById(id);
};
var refreshClientIP = function() {
    var year = new Date().getFullYear();
    if (year < 2019) year = 2019;
    T('since_year').innerHTML = year;
    ajaxGet('https://geoip.loukky.com/ip.php', function(info) {
        if (info.status === 'success') {
            clientIP = info.ip;
            T('client_ip').textContent = info.ip + ' ' + info.location;
        } else {
            T('client_ip').textContent = '获取失败';
        }
    });
};

var load = function(ip, domain) {
    var isv6 = false;
    // V3中使用消息传递获取IP数据
    chrome.runtime.sendMessage({action: 'getIPData', ip: ip}, function(response) {
        if (response && response.ipData) {
            $.each(response.dnsData, function(k, v){
                if (v.ip.indexOf(':') > -1) {
                    isv6 = true;
                }
                if (v.ip != ip) {
                    $('#dns').append('<dd data-ip="' + v.ip + '"><span>' + v.ip + '<span><span class="arrows glyphicon glyphicon-triangle-right"></span></dd>')
                }
            });
            render(response.ipData);
            if (!isv6) {
                T('layoutL').style.width = '25%';
                T('layoutR').style.width = '75%';
            }
            return;
        }

        // 如果缓存中没有 browser-side IP 的数据，则优先使用 browser-side IP 查询
        // 如果是本地回环IP，则改用域名查询 server-side IP
        var queryTarget = ip;
        if (ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0" || ip === "localhost") {
            queryTarget = domain;
        }
        ajaxGet("https://geoip.loukky.com/ip.php?ip=" + encodeURIComponent(queryTarget) + "&ecs=" + clientIP, function(info) {
             if (info.status === 'success') {
                // 保存数据到background，以browser-side IP为key
               chrome.runtime.sendMessage({
                    action: 'saveIPData',
                    ip: ip, 
                    ipData: info,
                    dnsData: (info.resolved_ips || []).map(function(i){ return {ip:i}; })
                });
                render(info);
            } else {
                T('load').style.display = '';
            }
        });
    });
};

var render = function(info){
    console.log("render触发:", info);
    T('show_ip').innerHTML = info.ip;
    T('location').innerHTML = info.country + " " + info.province || ""+ " " + info.city || "";
    T('isp').innerHTML = info.isp;
    T('asn').innerHTML = info.asn ? ("AS" + info.asn) : "";
    T('ports').textContent = "";
};

var refresh = function() {
    // V3中使用消息传递获取background数据
    chrome.runtime.sendMessage({action: 'getTabData'}, function(response) {
        if (response) {
            domain_view_v3(response.domainList);
            if (response.tabsIPMap[activeTabId]) {
                queryIp = response.tabsIPMap[activeTabId];
                T('browser_dns_ip').innerHTML = queryIp;
            }
            if (response.tabsDomainMap[activeTabId]) {
                queryDomain = response.tabsDomainMap[activeTabId];
                T('domain').innerHTML = queryDomain;
            }
            if (queryIp != '' && queryDomain != '') {
                clearInterval(refreshTimerId);
                load(queryIp, queryDomain);
            } else {
                if (refreshCount >= maxRefresh) {
                    return;
                }
                chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                    if (tabs.length > 0) {
                        activeTabId = tabs[0].id;
                        refreshCount++;
                        chrome.tabs.reload(activeTabId);
                    }
                });
            }
        }
    });
};

var init = function() {

    $('.ips').delegate('dd', 'click', function(){
        var ip = $(this).text().trim();
        if (ip.indexOf('.') == -1 && ip.indexOf(':') == -1) { //domains
            $('#layoutR').hide();
            $('#layoutR2').show();
            $('.ips dd').removeClass('active');
            $(this).addClass('active');
            return;
        } else { // ips
            $('#layoutR').show();
            $('#layoutR2').hide();
        }
        $('.ips dd').removeClass('active');
        $(this).addClass('active');
        
        // 如果是主IP（browser_dns_ip），直接从缓存获取完整信息
        if (ip == queryIp) {
            chrome.runtime.sendMessage({action: 'getIPData', ip: queryIp}, function(response) {
                if (response && response.ipData) {
                    render(response.ipData);
                }
            });
        } else {
            // 如果是解析出的IP，需要单独查询其地理位置
            ajaxGet("https://geoip.loukky.com/ip.php?ip=" + encodeURIComponent(ip), function(info) {
                if (info.status === 'success') {
                    render(info);
                }
            });
        }
    }); 

    if (language.indexOf('CN') > -1) {
		chrome.action.setTitle({title:"网站IP数据信息"});
	} else {
		chrome.action.setTitle({title:"WebSite IP Information query"});
	}

    refreshClientIP();

    chrome.tabs.query({ active: true,windowId: chrome.windows.WINDOW_ID_CURRENT }, function(tabs) {
        if (tabs.length > 0) {
            activeTabId = tabs[0].id;
            refreshTimerId = setInterval(function() {
               refresh();
            }, 500);

           refresh();
        } else {
            console.log("tabs is not active");
        }
    });

    T("to_ipip").onclick = function() {
        var fip = $('#show_ip').html();
        chrome.tabs.create({ url: "https://geoip.loukky.com/?ip="+fip, selected: false }, function(tab) {
            // chrome.tabs.executeScript(tab.id, {
            //     code: "var input=document.getElementById('ip');input.value='" + fip + "';input.form.submit();"
            // })
        });
        return false;
    };

    $('#copyright').on('click', function(){
        chrome.tabs.create({ url: "https://www.ipip.net/ip.html", selected: true }, function(tab) {

        });
    });
    
    $('#privacy').on('click', function(){
        chrome.tabs.create({ url: this.href, selected: true }, function(tab) {

        });
    });


    domain_view();
    
    c = new ClipboardJS("#copy");
};

function domain_view()
{
    // V3中使用消息传递获取域名列表
    chrome.runtime.sendMessage({action: 'getTabData'}, function(response) {
        if (response && response.domainList) {
            domain_view_v3(response.domainList);
        }
    });
}

function domain_view_v3(domainList)
{
    $('#domain_num').text(domainList.length);
    var ds = [];
    var dhtml = [];
    domainList.sort(function(a, b){
        return b.amount - a.amount;
    });
    domainList.forEach(function(v, k){
        ds.push(v.domain);

        dhtml.push('<dl class="dsl">');
        dhtml.push('<dt>'+ v.domain +'</dt>');
        dhtml.push('<dd>'+ v.amount +'</dd>');
        dhtml.push('</dl>');
    });
    $('#domains').html('<div>'+dhtml.join('')+'</div>');
    $('#copy').attr('data-clipboard-text', ds.join("\n"));
}

init();