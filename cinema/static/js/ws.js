/* ===================================
   WebSocket 客户端 + 房间侧栏 + Toast + 同步UI
   v4: library 页 toast fallback
   =================================== */

(function () {
    'use strict';

    const VIDEO = window.CINEMA_VIDEO;
    if (!VIDEO) return;

    // ===== DOM =====
    const roomsBtn = document.getElementById('rooms-btn');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const sidebarClose = document.getElementById('sidebar-close');
    const sidebarRefresh = document.getElementById('sidebar-refresh');
    const sidebarBody = document.getElementById('sidebar-body');
    const sidebarStatus = document.getElementById('sidebar-status');
    const modeBar = document.getElementById('mode-bar');

    // toast: 优先 player-wrapper 内的(全屏可见),fallback 到自建容器挂 body
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.cssText =
            'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;' +
            'display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;';
        document.body.appendChild(toastContainer);
    }

    // pending banner: 可能不存在(library 页)
    const pendingBanner = document.getElementById('sync-pending-banner');

    if (!sidebar || !roomsBtn) return;

    // ===== Toast 动画 CSS(注入一次) =====
    if (!document.getElementById('toast-animations')) {
        const style = document.createElement('style');
        style.id = 'toast-animations';
        style.textContent = `
            @keyframes toast-in {
                from { opacity: 0; transform: translateY(-10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes toast-out {
                from { opacity: 1; transform: translateY(0); }
                to { opacity: 0; transform: translateY(-10px); }
            }
            .toast-item {
                background: rgba(124, 92, 255, 0.95);
                color: white;
                padding: 10px 24px;
                border-radius: 8px;
                font-size: 13px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                pointer-events: auto;
                animation: toast-in 0.25s ease;
                max-width: 80vw;
                text-align: center;
            }
            .toast-item.toast-out {
                animation: toast-out 0.2s ease forwards;
            }
        `;
        document.head.appendChild(style);
    }

    function showToast(message, duration) {
        if (!toastContainer) return;
        duration = duration || 3000;
        const el = document.createElement('div');
        el.className = 'toast-item';
        el.textContent = message;
        toastContainer.appendChild(el);
        setTimeout(() => {
            el.classList.add('toast-out');
            setTimeout(() => el.remove(), 200);
        }, duration);
    }

    // ===== Pending Banner =====
    let pendingTimer = null;
    let currentPendingId = null;

    function showPendingBanner(requestId, initiatorName, action, params, delaySec) {
        if (!pendingBanner) return;
        currentPendingId = requestId;
        const actionText = { seek: '跳转', play: '播放', pause: '暂停' }[action] || action;
        let detail = '';
        if (action === 'seek' && params.time !== undefined) {
            detail = ` 到 ${formatTime(params.time)}`;
        }

        let remaining = delaySec;

        function render() {
            pendingBanner.innerHTML =
                `<span class="pending-text">${escapeHtml(initiatorName)} 发起了 ${actionText}${detail} (${remaining}s)</span>` +
                `<button class="pending-veto-btn" id="veto-btn">否决</button>`;
            pendingBanner.classList.add('visible');

            document.getElementById('veto-btn').addEventListener('click', () => {
                if (ws && ws.readyState === WebSocket.OPEN && currentPendingId) {
                    ws.send(JSON.stringify({
                        type: 'sync_veto',
                        request_id: currentPendingId,
                    }));
                }
                hidePendingBanner();
            });
        }

        render();

        if (pendingTimer) clearInterval(pendingTimer);
        pendingTimer = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                hidePendingBanner();
            } else {
                render();
            }
        }, 1000);
    }

    function hidePendingBanner() {
        if (pendingBanner) pendingBanner.classList.remove('visible');
        currentPendingId = null;
        if (pendingTimer) {
            clearInterval(pendingTimer);
            pendingTimer = null;
        }
    }

    // ===== Opportunity Banner(房主连续操作触发) =====
    let opportunityBanner = null;
    let opportunityTimer = null;

    function ensureOpportunityBanner() {
        if (opportunityBanner) return opportunityBanner;
        const wrapper = document.getElementById('player-wrapper');
        if (!wrapper) return null;
        opportunityBanner = document.createElement('div');
        opportunityBanner.id = 'sync-opportunity-banner';
        opportunityBanner.className = 'player-opportunity-banner';
        wrapper.appendChild(opportunityBanner);
        return opportunityBanner;
    }

    let opportunityCancelled = false;

    function showOpportunityBanner(hostName, delaySec) {
        const banner = ensureOpportunityBanner();
        if (!banner) return;
        let remaining = delaySec;
        opportunityCancelled = false;

        function render() {
            banner.innerHTML =
                `<span class="opportunity-text">房主 ${escapeHtml(hostName)} 多次操作,${remaining}s 后将自动追上房主</span>` +
                `<button class="opportunity-catchup-btn" id="opp-cancel-btn">不追上</button>`;
            banner.classList.add('visible');
            document.getElementById('opp-cancel-btn').addEventListener('click', () => {
                opportunityCancelled = true;
                hideOpportunityBanner();
                showToast('已取消自动追上');
            });
        }

        render();
        if (opportunityTimer) clearInterval(opportunityTimer);
        opportunityTimer = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(opportunityTimer);
                opportunityTimer = null;
                hideOpportunityBanner();
                // 倒计时结束 → 自动追上房主(除非被取消)
                if (!opportunityCancelled && ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'catch_up' }));
                }
            } else {
                render();
            }
        }, 1000);
    }

    function hideOpportunityBanner() {
        if (opportunityBanner) opportunityBanner.classList.remove('visible');
        if (opportunityTimer) {
            clearInterval(opportunityTimer);
            opportunityTimer = null;
        }
    }

    // ===== Follow Banner(成员收到房主切换视频广播) =====
    let followBanner = null;
    let followTimer = null;
    let followAccepted = false;

    function ensureFollowBanner() {
        if (followBanner) return followBanner;
        const wrapper = document.getElementById('player-wrapper');
        if (!wrapper) return null;
        followBanner = document.createElement('div');
        followBanner.id = 'sync-follow-banner';
        followBanner.className = 'player-follow-banner';
        wrapper.appendChild(followBanner);
        return followBanner;
    }

    // 暂存切换信息,供跟随按钮使用
    let pendingSwitchHostSid = null;
    let pendingSwitchVideoId = null;

    function showFollowBanner(hostName, newVideoName, hostSid, newVideoId) {
        const banner = ensureFollowBanner();
        if (!banner) return;
        followAccepted = false;
        pendingSwitchHostSid = hostSid;
        pendingSwitchVideoId = newVideoId;

        banner.innerHTML =
            `<span class="follow-text">房主 ${escapeHtml(hostName)} 切换到了《${escapeHtml(newVideoName)}》</span>` +
            `<button class="follow-btn" id="follow-btn">跟随房主</button>` +
            `<button class="follow-cancel-btn" id="follow-cancel-btn">不跟随</button>`;
        banner.classList.add('visible');

        document.getElementById('follow-btn').addEventListener('click', () => {
            followAccepted = true;
            hideFollowBanner();
            showToast('正在跟随房主...');
            // 跳转到新视频,带 auto_follow 和房主名字,到达后自动搜索房主并加入
            const url = '/cinema/watch?v=' + encodeURIComponent(newVideoId) +
                '&auto_follow=' + encodeURIComponent(hostName);
            setTimeout(() => { window.location.href = url; }, 300);
        });

        document.getElementById('follow-cancel-btn').addEventListener('click', () => {
            hideFollowBanner();
            showToast('房主已切换视频,你选择留在当前视频');
        });

        // 60 秒后自动消失
        if (followTimer) clearTimeout(followTimer);
        followTimer = setTimeout(() => {
            followTimer = null;
            if (!followAccepted) {
                hideFollowBanner();
            }
        }, 60000);
    }

    function updateFollowBannerWaiting() {
        followAccepted = true;
        if (!followBanner) return;
        followBanner.innerHTML =
            `<span class="follow-text">已选择跟随 · 等待房主创建新房间...</span>`;
        followBanner.classList.add('visible');
    }

    function hideFollowBanner() {
        if (followBanner) followBanner.classList.remove('visible');
        followAccepted = false;
        pendingSwitchHostSid = null;
        pendingSwitchVideoId = null;
        if (followTimer) {
            clearTimeout(followTimer);
            followTimer = null;
        }
    }

    // ===== 房主等待切换横幅 =====
    let hostWaitingBanner = null;
    let hostWaitingTimer = null;

    function ensureHostWaitingBanner() {
        if (hostWaitingBanner) return hostWaitingBanner;
        const wrapper = document.getElementById('player-wrapper');
        if (!wrapper) return null;
        hostWaitingBanner = document.createElement('div');
        hostWaitingBanner.id = 'host-waiting-banner';
        hostWaitingBanner.className = 'player-host-waiting-banner';
        wrapper.appendChild(hostWaitingBanner);
        return hostWaitingBanner;
    }

    // ===== 房间丢失横幅(持久,直到用户关闭) =====
    let roomLostBanner = null;

    function ensureRoomLostBanner() {
        if (roomLostBanner) return roomLostBanner;
        const wrapper = document.getElementById('player-wrapper') || document.body;
        roomLostBanner = document.createElement('div');
        roomLostBanner.id = 'room-lost-banner';
        roomLostBanner.style.cssText =
            'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
            'z-index:200;background:rgba(220,80,80,0.97);color:white;' +
            'padding:18px 32px;border-radius:12px;font-size:15px;font-weight:600;' +
            'box-shadow:0 6px 24px rgba(0,0,0,0.6);text-align:center;' +
            'max-width:90%;display:none;border:2px solid #ff6b6b;';
        if (wrapper === document.body) {
            roomLostBanner.style.position = 'fixed';
        }
        wrapper.appendChild(roomLostBanner);
        return roomLostBanner;
    }

    let roomLostHideTimer = null;

    function showRoomLostBanner(message) {
        const banner = ensureRoomLostBanner();
        if (!banner) return;
        banner.innerHTML =
            `<div style="margin-bottom:12px;">${escapeHtml(message)}</div>` +
            `<button id="room-lost-close-btn" style="background:white;color:#a02020;border:none;` +
            `padding:8px 22px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;">知道了</button>`;
        banner.style.display = 'block';
        if (roomLostHideTimer) clearTimeout(roomLostHideTimer);
        // 几秒后自动消失,不挡画面;也可以点「知道了」立即关闭
        roomLostHideTimer = setTimeout(() => {
            roomLostHideTimer = null;
            banner.style.display = 'none';
        }, 6000);
        document.getElementById('room-lost-close-btn').addEventListener('click', () => {
            if (roomLostHideTimer) { clearTimeout(roomLostHideTimer); roomLostHideTimer = null; }
            banner.style.display = 'none';
        });
    }

    // ===== 房主断线等待重连横幅 =====
    let hostReconnectingBanner = null;
    let hostReconnectingTimer = null;
    let disconnectedHostName = null;  // 断线中的房主名,用于 mode bar 显示

    function ensureHostReconnectingBanner() {
        if (hostReconnectingBanner) return hostReconnectingBanner;
        const wrapper = document.getElementById('player-wrapper') || document.body;
        hostReconnectingBanner = document.createElement('div');
        hostReconnectingBanner.id = 'host-reconnecting-banner';
        hostReconnectingBanner.style.cssText =
            'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
            'z-index:200;background:rgba(180,120,20,0.97);color:white;' +
            'padding:18px 32px;border-radius:12px;font-size:15px;font-weight:600;' +
            'box-shadow:0 6px 24px rgba(0,0,0,0.6);text-align:center;' +
            'max-width:90%;display:none;border:2px solid #ffa500;';
        if (wrapper === document.body) {
            hostReconnectingBanner.style.position = 'fixed';
        }
        wrapper.appendChild(hostReconnectingBanner);
        return hostReconnectingBanner;
    }

    function showHostReconnectingBanner(hostName, totalSeconds) {
        const banner = ensureHostReconnectingBanner();
        if (!banner) return;
        let remaining = totalSeconds;

        function render() {
            banner.innerHTML =
                `<div style="margin-bottom:8px;">⏳ 房主 ${escapeHtml(hostName)} 暂时断线</div>` +
                `<div style="font-size:13px;opacity:0.9;">等待重连中... (${remaining}s)</div>`;
            banner.style.display = 'block';
        }

        render();
        if (hostReconnectingTimer) clearInterval(hostReconnectingTimer);
        hostReconnectingTimer = setInterval(() => {
            remaining--;
            if (remaining > 0) {
                render();
            } else {
                clearInterval(hostReconnectingTimer);
                hostReconnectingTimer = null;
            }
        }, 1000);
    }

    function hideHostReconnectingBanner() {
        if (hostReconnectingBanner) hostReconnectingBanner.style.display = 'none';
        if (hostReconnectingTimer) {
            clearInterval(hostReconnectingTimer);
            hostReconnectingTimer = null;
        }
        disconnectedHostName = null;
    }

    function showHostWaitingBanner(delaySec) {
        const banner = ensureHostWaitingBanner();
        if (!banner) return;
        let remaining = delaySec;
        function render() {
            banner.innerHTML = `正在等待成员响应... (${remaining}s)`;
            banner.classList.add('visible');
        }
        render();
        if (hostWaitingTimer) clearInterval(hostWaitingTimer);
        hostWaitingTimer = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(hostWaitingTimer);
                hostWaitingTimer = null;
                if (banner) banner.classList.remove('visible');
            } else {
                render();
            }
        }, 1000);
    }

    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    // ===== 侧栏 =====
    let sidebarOpen = false;

    function toggleSidebar() {
        sidebarOpen = !sidebarOpen;
        sidebar.classList.toggle('open', sidebarOpen);
        if (sidebarOverlay) sidebarOverlay.classList.toggle('open', sidebarOpen);
    }

    roomsBtn.addEventListener('click', toggleSidebar);
    if (sidebarClose) sidebarClose.addEventListener('click', toggleSidebar);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', toggleSidebar);

    if (sidebarRefresh) {
        sidebarRefresh.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'refresh_rooms' }));
                sidebarRefresh.textContent = '⏳';
                setTimeout(() => { sidebarRefresh.textContent = '🔄'; }, 800);
            }
        });
    }

    // ===== 状态 =====
    const watchToken = window.CINEMA_TOKEN || '';
    const userName = window.CINEMA_NAME || '';

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    let ws = null;
    let mySid = null;
    let myHostSid = null;
    let myRoomId = null;          // 当前所在房间(房客身份时用于断线重连)
    let lastKnownRoomId = null;   // 断线前所在的房间,重连时按它找回当前房主
    // 页面刷新时从 sessionStorage 恢复
    try {
        const saved = sessionStorage.getItem('cinema_last_room_id');
        if (saved) {
            lastKnownRoomId = saved;
            sessionStorage.removeItem('cinema_last_room_id');
        }
    } catch (e) {}
    let wsState = 'disconnected';
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let lastRooms = [];
    let roomLocked = false;  // 我所在房间是否被房主锁定了播放控制

    // ===== WebSocket =====
    function connect() {
        if (ws) { try { ws.close(); } catch (e) {} }
        if (!watchToken || !userName) {
            updateStatus('disconnected', '未登录');
            return;
        }

        wsState = 'connecting';
        updateStatus('connecting', '连接中...');

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${location.host}/cinema/ws?token=${encodeURIComponent(watchToken)}`;
        ws = new WebSocket(url);

        ws.onopen = () => {
            console.log('[ws] connected');
            const urlParams = new URLSearchParams(window.location.search);
            const switchFrom = urlParams.get('switch_from') || '';
            const helloMsg = {
                type: 'hello',
                name: userName,
                video_id: VIDEO.id,
            };
            if (switchFrom) helloMsg.switch_from = switchFrom;
            // 重连恢复: 告诉服务端我之前在哪个房间
            if (lastKnownRoomId) {
                helloMsg.previous_room_id = lastKnownRoomId;
            }
            ws.send(JSON.stringify(helloMsg));
        };

        ws.onmessage = (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch (e) { return; }
            handleMessage(data);
        };

        ws.onclose = (event) => {
            wsState = 'disconnected';
            updateStatus('disconnected', '已断开');
            // 如果之前是房客,记下房间号,重连时尝试恢复
            if (myHostSid && myHostSid !== mySid && myRoomId) {
                lastKnownRoomId = myRoomId;
            }
            ws = null;
            mySid = null;
            myHostSid = null;
            myRoomId = null;
            stopHeartbeat();
            hidePendingBanner();
            if (event.code !== 4001 && event.code !== 4002 && event.code !== 4003) {
                showToast('与服务器断开连接,正在重连...', 5000);
                scheduleReconnect();
            }
        };

        ws.onerror = () => {};
    }

    function handleMessage(data) {
        switch (data.type) {
            case 'welcome':
                mySid = data.sid;
                myHostSid = mySid;
                wsState = 'connected';
                updateStatus('connected', '已连接');
                startHeartbeat();
                console.log('[ws] my sid:', mySid);
                // 如果是重连恢复场景,welcome 后服务端会发 joined_room 或 room_lost
                // 不在这里清 lastKnownRoomId,让 joined_room/room_lost 来处理

                // 检查 URL 参数: 是否需要自动加入某个房间
                const joinParams = new URLSearchParams(window.location.search);
                const autoJoinSid = joinParams.get('join');
                if (autoJoinSid) {
                    console.log('[ws] auto-joining room:', autoJoinSid);
                    // 延迟一点,等 room_update 先到
                    setTimeout(() => {
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'join_room',
                                target_sid: autoJoinSid,
                            }));
                        }
                    }, 500);
                    // 清掉 URL 里的 join 参数(避免刷新时重复加入)
                    const cleanUrl = window.location.pathname + '?v=' + joinParams.get('v') +
                        (joinParams.get('t') ? '&t=' + joinParams.get('t') : '');
                    window.history.replaceState(null, '', cleanUrl);
                }
                // 清掉 switch_from 参数(避免刷新时重复处理)
                if (joinParams.get('switch_from')) {
                    const cleanUrl2 = window.location.pathname + '?v=' + joinParams.get('v');
                    window.history.replaceState(null, '', cleanUrl2);
                }

                // auto_follow: 跟随房主切换视频后,自动搜索同视频的房主并加入
                const autoFollowHost = joinParams.get('auto_follow');
                if (autoFollowHost) {
                    // 等 room_update 到达后再搜索(延迟 1.5 秒)
                    setTimeout(() => {
                        if (!ws || ws.readyState !== WebSocket.OPEN) return;
                        // 在 lastRooms 里找同视频的房主
                        let foundHostSid = null;
                        for (const room of lastRooms) {
                            if (room.video_id !== VIDEO.id) continue;
                            for (const v of room.viewers) {
                                if (v.is_host && v.sid !== mySid) {
                                    foundHostSid = v.sid;
                                    break;
                                }
                            }
                            if (foundHostSid) break;
                        }
                        if (foundHostSid) {
                            ws.send(JSON.stringify({
                                type: 'join_room',
                                target_sid: foundHostSid,
                            }));
                        } else {
                            showToast('未找到房主,可能房主还在加载中');
                            // 再试一次(3秒后)
                            setTimeout(() => {
                                if (!ws || ws.readyState !== WebSocket.OPEN) return;
                                let retrySid = null;
                                for (const room of lastRooms) {
                                    if (room.video_id !== VIDEO.id) continue;
                                    for (const v of room.viewers) {
                                        if (v.is_host && v.sid !== mySid) {
                                            retrySid = v.sid;
                                            break;
                                        }
                                    }
                                    if (retrySid) break;
                                }
                                if (retrySid) {
                                    ws.send(JSON.stringify({
                                        type: 'join_room',
                                        target_sid: retrySid,
                                    }));
                                } else {
                                    showToast('房主尚未到达,请手动加入房间');
                                }
                            }, 3000);
                        }
                    }, 1500);
                    // 清掉 URL 参数
                    const cleanUrl3 = window.location.pathname + '?v=' + joinParams.get('v');
                    window.history.replaceState(null, '', cleanUrl3);
                }
                break;

            case 'room_update':
                renderRooms(data.rooms || []);
                updateMyHostFromRooms(data.rooms || []);
                updateModeBar();
                break;

            case 'heartbeat_ack':
                break;

            case 'server_ping':
                // 服务端主动探测,立刻回复证明存活
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'server_pong' }));
                }
                break;

            case 'toast':
                showToast(data.message || '');
                break;

            case 'joined_room':
                myHostSid = data.host_sid;
                if (data.room_id) myRoomId = data.room_id;
                handleJoinedRoom(data);
                updateModeBar();
                break;

            case 'host_disconnected':
                // 房主暂时断线,进入宽限期等待
                disconnectedHostName = data.host_name || '房主';
                showHostReconnectingBanner(disconnectedHostName, data.reconnect_seconds || 60);
                updateModeBar();
                break;

            case 'host_reconnected':
                // 房主在宽限期内重连成功
                hideHostReconnectingBanner();
                myHostSid = data.host_sid;
                showToast(`房主 ${data.host_name || ''} 已重连`);
                updateModeBar();
                break;

            case 'room_dissolved':
                {
                    hideHostReconnectingBanner();
                    const reason = data.reason || '';
                    const hostName = data.host_name || '房主';
                    let msg = `你已离开${hostName ? ' ' + hostName : ''}的房间`;
                    if (reason === 'host_left' || reason === 'host_offline') {
                        msg = `${hostName} 已离线,房间已解散`;
                    } else if (reason === 'host_dissolved') {
                        msg = `房主 ${hostName} 解散了房间,现在各自独立观看`;
                    } else if (reason === 'host_joined_other') {
                        msg = `房主 ${hostName} 去了别的房间,房间已解散,现在各自独立观看`;
                    }
                    showRoomLostBanner(msg);
                }
                myHostSid = mySid;
                myRoomId = null;
                roomLocked = false;
                lastKnownRoomId = null;
                hidePendingBanner();
                hideFollowBanner();
                updateModeBar();
                break;

            case 'host_transferred': {
                const wasHost = myHostSid === mySid;
                myHostSid = data.new_host_sid;
                if (data.room_id) myRoomId = data.room_id;
                roomLocked = false;
                hidePendingBanner();
                hideOpportunityBanner();
                hideHostDialog();
                if (data.new_host_sid === mySid) {
                    showToast(`${data.old_host_name || '房主'} 把房主移交给了你,你现在是房主 👑`, 4000);
                } else if (wasHost) {
                    showToast(`你已把房主移交给 ${data.new_host_name || '新房主'},现在是房客`, 4000);
                } else {
                    showToast(`${data.old_host_name || '房主'} 把房主移交给了 ${data.new_host_name || '新房主'}`, 4000);
                }
                updateModeBar();
                break;
            }

            case 'sync_pending':
                showPendingBanner(
                    data.request_id,
                    data.initiator_name,
                    data.action,
                    data.params || {},
                    data.delay_seconds || 3
                );
                break;

            case 'sync_apply':
                hidePendingBanner();
                if (window.CINEMA_PLAYER) {
                    window.CINEMA_PLAYER.applySyncAction(data.action, data.params || {});
                }
                showToast(`${data.initiator_name || '同步'}: ${
                    {seek: '跳转', play: '播放', pause: '暂停'}[data.action] || data.action
                }`);
                break;

            case 'sync_vetoed':
                hidePendingBanner();
                showToast(`${data.veto_by} 否决了同步操作`);
                break;

            case 'sync_opportunity':
                showOpportunityBanner(data.host_name, data.delay_seconds || 3);
                break;

            case 'host_switched_video':
                // 房主切换视频,成员已被服务端设为独立
                myHostSid = mySid;
                updateModeBar();
                showFollowBanner(data.host_name, data.new_video_name, data.host_sid, data.new_video_id);
                break;

            case 'host_switch_waiting':
                // 已废弃: 房主现在立刻跳转,不再等待
                break;

            case 'host_switch_go':
                // 房主跳转到新视频,URL 带 switch_from
                showToast('切换到新视频...');
                setTimeout(() => {
                    const targetUrl = '/cinema/watch?v=' + encodeURIComponent(data.new_video_id) +
                        '&switch_from=' + encodeURIComponent(mySid);
                    window.location.href = targetUrl;
                }, 200);
                break;

            case 'follow_accepted':
                // 已废弃: 成员现在直接跳转
                break;

            case 'room_lost':
                // 重连后原房间已不存在(已解散或房主已离开)
                showRoomLostBanner('之前的房间已解散,现在独立观看');
                lastKnownRoomId = null;
                myRoomId = null;
                break;

            case 'report_position_request':
                if (window.CINEMA_PLAYER && ws && ws.readyState === WebSocket.OPEN) {
                    const playerEl = document.getElementById('player');
                    ws.send(JSON.stringify({
                        type: 'report_position',
                        request_id: data.request_id || '',
                        position: window.CINEMA_PLAYER.getCurrentTime(),
                        paused: playerEl ? playerEl.paused : false,
                    }));
                }
                break;

            case 'catch_up_result':
                if (window.CINEMA_PLAYER) {
                    const pos = parseFloat(data.position || 0);
                    if (isFinite(pos) && pos > 0) {
                        window.CINEMA_PLAYER.seekTo(pos);
                    }
                    setTimeout(() => {
                        if (!window.CINEMA_PLAYER) return;
                        if (data.paused) {
                            window.CINEMA_PLAYER.suppressedPause();
                        } else {
                            window.CINEMA_PLAYER.suppressedPlay();
                        }
                    }, 300);
                    showToast(data.paused ? '已追上房主(暂停中)' : '已追上房主');
                }
                break;

            default:
                break;
        }
    }

    function updateMyHostFromRooms(rooms) {
        for (const room of rooms) {
            for (const v of room.viewers) {
                if (v.sid === mySid) {
                    myHostSid = v.host_sid;
                    roomLocked = !!v.room_locked;
                    myRoomId = v.room_id || null;
                    return;
                }
            }
        }
    }

    // ===== 加入房间自动追上 + 自动播放 =====
    function handleJoinedRoom(data) {
        if (!data.video_id) return;

        if (data.video_id === VIDEO.id) {
            // 检测是否是重连恢复场景
            if (data.rejoined) {
                showToast(`已重新加入 ${data.host_name} 的房间`);
                lastKnownRoomId = null;
            } else {
                showToast(`已加入 ${data.host_name} 的房间`);
            }
            if (window.CINEMA_PLAYER) {
                const targetTime = parseFloat(data.current_time || 0);
                if (isFinite(targetTime) && targetTime > 0) {
                    window.CINEMA_PLAYER.seekTo(targetTime);
                }
                // 按房主的真实状态决定(如果房主暂停,B 也暂停;房主播放,B 也播放)
                setTimeout(() => {
                    if (!window.CINEMA_PLAYER) return;
                    if (data.paused === true) {
                        window.CINEMA_PLAYER.suppressedPause
                            ? window.CINEMA_PLAYER.suppressedPause()
                            : document.getElementById('player').pause();
                    } else if (data.auto_play) {
                        window.CINEMA_PLAYER.suppressedPlay
                            ? window.CINEMA_PLAYER.suppressedPlay()
                            : document.getElementById('player').play().catch(() => {});
                    }
                }, 300);
            }
            return;
        }

        // 不同视频或在 library 页: 跳转到观看页,带上 join 参数
        showToast(`正在切换到 ${data.host_name} 的视频...`);
        const t = parseFloat(data.current_time || 0);
        let url = '/cinema/watch?v=' + encodeURIComponent(data.video_id);
        if (isFinite(t) && t > 0) {
            url += '&t=' + t.toFixed(1);
        }
        url += '&join=' + encodeURIComponent(data.host_sid);
        setTimeout(() => { window.location.href = url; }, 500);
    }

    function updateModeBar() {
        if (!modeBar) return;
        const wrapper = document.getElementById('player-wrapper');
        const fsRoomBtn = document.getElementById('fs-room-btn');
        const fsRoomLabel = document.getElementById('fs-room-label');

        // 切换按钮控制
        const switchBtnEl = document.getElementById('switch-video-btn');
        if (switchBtnEl) {
            const isHost = !myHostSid || myHostSid === mySid;
            switchBtnEl.style.display = isHost ? 'inline-block' : 'none';
        }

        const fsCatchup = document.getElementById('fs-catchup-btn');
        const fsLeave = document.getElementById('fs-leave-btn');
        const fsTransfer = document.getElementById('fs-transfer-btn');
        const fsDissolve = document.getElementById('fs-dissolve-btn');
        const fsLock = document.getElementById('fs-lock-btn');
        function setFsButtons(asHost) {
            if (fsCatchup) fsCatchup.style.display = asHost ? 'none' : '';
            if (fsLeave) fsLeave.style.display = asHost ? 'none' : '';
            if (fsLock) {
                fsLock.style.display = asHost ? '' : 'none';
                fsLock.textContent = roomLocked ? '🔓 解除锁定' : '🔒 锁定操作';
            }
            if (fsTransfer) fsTransfer.style.display = asHost ? '' : 'none';
            if (fsDissolve) fsDissolve.style.display = asHost ? '' : 'none';
        }

        const amHost = !myHostSid || myHostSid === mySid;
        const myMembers = amHost && mySid ? getMyRoomMembers() : [];

        if (amHost && myMembers.length > 0) {
            // 房主(房间里有房客)
            const videoName = VIDEO.display_name || '';
            modeBar.className = 'mode-bar mode-host';
            modeBar.innerHTML = `
                <span class="host-badge">👑 你是房主</span>
                <span class="host-summary">${myMembers.length} 位房客${videoName ? ' · 《' + escapeHtml(videoName) + '》' : ''}</span>
                <button class="host-lock-btn${roomLocked ? ' locked' : ''}" id="host-lock-btn" type="button"
                    title="${roomLocked ? '点击解除锁定,房客的操作也会同步' : '锁定后只有你的操作会同步,房客的操作只在他们自己那边生效'}">${roomLocked ? '🔒 已锁定' : '🔓 锁定操作'}</button>
                <button class="host-transfer-btn" id="host-transfer-btn" type="button">🔁 移交房主</button>
                <button class="host-dissolve-btn" id="host-dissolve-btn" type="button">解散房间</button>
            `;
            document.getElementById('host-lock-btn').addEventListener('click', toggleRoomLock);
            document.getElementById('host-transfer-btn').addEventListener('click', openTransferDialog);
            document.getElementById('host-dissolve-btn').addEventListener('click', openDissolveDialog);
            if (fsRoomBtn) {
                fsRoomBtn.style.display = 'block';
                fsRoomBtn.classList.add('as-host');
                if (fsRoomLabel) fsRoomLabel.textContent = `👑 房主 · ${myMembers.length} 位房客${roomLocked ? ' · 🔒' : ''}`;
            }
            setFsButtons(true);
        } else if (amHost) {
            hideHostDialog();
            // 独立观看
            modeBar.className = 'mode-bar mode-solo';
            const videoName = VIDEO.display_name || '';
            modeBar.textContent = videoName
                ? `独立观看 · 《${videoName}》`
                : '独立观看';
            // (房间装饰已改为 mode-bar 渐变)
            // 隐藏全屏房间按钮
            if (fsRoomBtn) {
                fsRoomBtn.style.display = 'none';
                fsRoomBtn.classList.remove('as-host');
            }
        } else {
            hideHostDialog();
            if (fsRoomBtn) fsRoomBtn.classList.remove('as-host');
            setFsButtons(false);
            const host = findViewerBySid(myHostSid);
            const hostName = host ? host.name : (disconnectedHostName || '未知');
            // 非全屏 mode-bar
            modeBar.className = 'mode-bar mode-sync';
            modeBar.innerHTML = `
                同步观看 · ${escapeHtml(hostName)} 的房间
                ${roomLocked ? '<span class="room-locked-tag" title="房主锁定了播放控制,你的操作只在自己这边生效">🔒 房主控制中</span>' : ''}
                <button class="catch-up-btn" id="catch-up-btn" title="追上房主">🏃 追上</button>
                <button class="leave-room-btn" id="leave-room-btn">离开房间</button>
            `;
            document.getElementById('leave-room-btn').addEventListener('click', () => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'leave_room' }));
                }
            });
            document.getElementById('catch-up-btn').addEventListener('click', () => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'catch_up' }));
                    showToast('正在追上房主...');
                }
            });
            // (房间装饰通过 mode-bar 渐变体现)
            // 全屏房间按钮
            if (fsRoomBtn) {
                fsRoomBtn.style.display = 'block';
                if (fsRoomLabel) fsRoomLabel.textContent = `${hostName} 的房间${roomLocked ? ' · 🔒' : ''}`;
            }
        }
    }

    // 我房间里(对我可见)的房客,不含自己
    function getMyRoomMembers() {
        const members = [];
        for (const room of lastRooms) {
            for (const v of room.viewers) {
                if (v.host_sid === mySid && v.sid !== mySid) members.push(v);
            }
        }
        return members;
    }

    // ===== 房主操作弹层(挂在 player-wrapper 内,全屏时也可见) =====
    let hostDialog = null;

    function hideHostDialog() {
        if (hostDialog) {
            hostDialog.remove();
            hostDialog = null;
        }
    }

    function showHostDialog(title, bodyHtml, bind) {
        hideHostDialog();
        const fsPanel = document.getElementById('fs-room-panel');
        if (fsPanel) fsPanel.style.display = 'none';
        const wrapper = document.getElementById('player-wrapper') || document.body;
        hostDialog = document.createElement('div');
        hostDialog.className = 'host-dialog-overlay';
        hostDialog.innerHTML =
            `<div class="host-dialog" role="dialog" aria-label="${escapeHtml(title)}">` +
            `<div class="host-dialog-title">${escapeHtml(title)}</div>` +
            bodyHtml +
            `<button class="host-dialog-cancel" type="button" data-act="cancel">取消</button>` +
            `</div>`;
        hostDialog.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.target === hostDialog || (e.target.dataset && e.target.dataset.act === 'cancel')) {
                hideHostDialog();
            }
        });
        wrapper.appendChild(hostDialog);
        if (bind) bind(hostDialog);
    }

    function openTransferDialog() {
        const members = getMyRoomMembers();
        if (members.length === 0) {
            showToast('房间里没有可以移交的房客');
            return;
        }
        const list = members.map(m =>
            `<button class="host-dialog-item" type="button" data-sid="${escapeHtml(m.sid)}">` +
            `${escapeHtml(m.name)}</button>`
        ).join('');
        showHostDialog('把房主移交给谁？',
            `<div class="host-dialog-hint">移交后你会变成房客,继续留在房间里</div>` +
            `<div class="host-dialog-list">${list}</div>`,
            (el) => {
                el.querySelectorAll('.host-dialog-item').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'transfer_host', target_sid: btn.dataset.sid }));
                        }
                        hideHostDialog();
                    });
                });
            });
    }

    function toggleRoomLock() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'set_room_lock', locked: !roomLocked }));
        }
        const fsPanel = document.getElementById('fs-room-panel');
        if (fsPanel) fsPanel.style.display = 'none';
    }

    function openDissolveDialog() {
        const count = getMyRoomMembers().length;
        showHostDialog('解散房间？',
            `<div class="host-dialog-hint">${count} 位房客将停止同步,大家各自独立观看,当前播放不会中断</div>` +
            `<button class="host-dialog-danger" type="button" data-act="dissolve">确认解散</button>`,
            (el) => {
                el.querySelector('[data-act="dissolve"]').addEventListener('click', () => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'dissolve_room' }));
                    }
                    hideHostDialog();
                });
            });
    }

    function findViewerBySid(sid) {
        for (const room of lastRooms) {
            for (const v of room.viewers) {
                if (v.sid === sid) return v;
            }
        }
        return null;
    }

    // ===== 心跳 =====
    function startHeartbeat() {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'heartbeat' }));
            }
        }, 15000);
    }

    function stopHeartbeat() {
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, 3000);
    }

    // ===== 侧栏渲染 =====
    function renderRooms(rooms) {
        lastRooms = rooms;
        if (!rooms || rooms.length === 0) {
            sidebarBody.innerHTML = '<div class="sidebar-empty">暂无其他人在线</div>';
            updateOnlineCount(0);
            return;
        }

        let totalViewers = 0;
        rooms.forEach(r => { totalViewers += r.viewers.length; });
        updateOnlineCount(totalViewers);

        let html = '';

        const watchingRooms = rooms.filter(r => r.video_id && r.video_id !== '_none');
        const idleViewers = [];
        for (const r of rooms) {
            if (!r.video_id || r.video_id === '_none') {
                for (const v of r.viewers) {
                    idleViewers.push(v);
                }
            }
        }

        for (const room of watchingRooms) {
            html += `<div class="room-group">`;
            html += `<div class="room-group-title">《${escapeHtml(room.video_name)}》</div>`;

            const hosts = room.viewers.filter(v => v.is_host);
            const nonHosts = room.viewers.filter(v => !v.is_host);
            const roomHosts = hosts.filter(h => nonHosts.some(nh => nh.host_sid === h.sid));
            const soloHosts = hosts.filter(h => !nonHosts.some(nh => nh.host_sid === h.sid));

            for (const host of roomHosts) {
                const members = nonHosts.filter(nh => nh.host_sid === host.sid);
                html += renderViewer(host, true, true);
                for (const m of members) {
                    html += renderViewer(m, false, true);
                }
            }
            for (const solo of soloHosts) {
                html += renderViewer(solo, true, true);
            }
            html += `</div>`;
        }

        if (idleViewers.length > 0) {
            html += `<div class="room-group">`;
            html += `<div class="room-group-title idle-title">在线 (未观看)</div>`;
            for (const v of idleViewers) {
                html += renderViewer(v, false, false);
            }
            html += `</div>`;
        }

        sidebarBody.innerHTML = html;

        sidebarBody.querySelectorAll('.room-viewer.clickable').forEach(el => {
            el.addEventListener('click', () => {
                const targetSid = el.dataset.sid;
                if (!targetSid || targetSid === mySid) return;
                const targetName = el.querySelector('.room-viewer-name');
                const name = targetName ? targetName.textContent : '该用户';
                if (!confirm(`加入 ${name} 的房间？\n你的视频将切换到对方正在观看的内容。`)) return;
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'join_room', target_sid: targetSid }));
                }
            });
        });
    }

    function renderViewer(viewer, isHost, canJoin) {
        const isMe = viewer.sid === mySid;
        const crown = isHost ? '<span class="crown">👑</span>' : '';
        const youTag = isMe ? '<span class="you-tag">(你)</span>' : '';
        const clickable = (canJoin && !isMe) ? ' clickable' : '';
        const typeLabel = viewer.token_type === 'group' ? '<span class="token-type-tag group">分组</span>'
                        : viewer.token_type === 'full'  ? '<span class="token-type-tag full">完全</span>'
                        : '';
        return `
            <div class="room-viewer${clickable}" data-sid="${escapeHtml(viewer.sid)}">
                ${crown}
                <span class="room-viewer-name">${escapeHtml(viewer.name)}</span>
                ${typeLabel}
                ${youTag}
            </div>
        `;
    }

    function updateOnlineCount(count) {
        if (roomsBtn) roomsBtn.textContent = `👥 ${count > 0 ? count : ''}`;
    }

    function updateStatus(stateVal, text) {
        if (sidebarStatus) {
            sidebarStatus.innerHTML = `<span class="ws-dot ${stateVal}"></span>${escapeHtml(text)}`;
        }
    }

    window.addEventListener('beforeunload', () => {
        // 刷新时保存房间状态,下次加载自动恢复
        try {
            if (myHostSid && myHostSid !== mySid && myRoomId) {
                sessionStorage.setItem('cinema_last_room_id', myRoomId);
            }
        } catch (e) {}
        stopHeartbeat();
        if (ws) { try { ws.close(); } catch (e) {} }
    });

    // ===== 视频选择面板 =====
    const switchBtn = document.getElementById('switch-video-btn');
    const pickerOverlay = document.getElementById('video-picker-overlay');
    const pickerBody = document.getElementById('video-picker-body');
    const pickerClose = document.getElementById('video-picker-close');
    let videoNameTooltip = null;

    function hideVideoNameTooltip() {
        if (!videoNameTooltip) return;
        videoNameTooltip.remove();
        videoNameTooltip = null;
    }

    function positionVideoNameTooltip(e) {
        if (!videoNameTooltip) return;
        const gap = 14;
        const rect = videoNameTooltip.getBoundingClientRect();
        const left = Math.min(e.clientX + gap, window.innerWidth - rect.width - 8);
        const top = Math.min(e.clientY + gap, window.innerHeight - rect.height - 8);
        videoNameTooltip.style.left = `${Math.max(8, left)}px`;
        videoNameTooltip.style.top = `${Math.max(8, top)}px`;
    }

    function attachVideoNameTooltip(card, name) {
        card.setAttribute('aria-label', name);
        // Hover tooltips make no sense on touch screens and get stuck after a tap.
        if (window.matchMedia && !window.matchMedia('(hover: hover)').matches) return;
        card.addEventListener('pointerenter', (e) => {
            hideVideoNameTooltip();
            videoNameTooltip = document.createElement('div');
            videoNameTooltip.className = 'video-name-tooltip';
            videoNameTooltip.textContent = name;
            document.body.appendChild(videoNameTooltip);
            positionVideoNameTooltip(e);
        });
        card.addEventListener('pointermove', positionVideoNameTooltip);
        card.addEventListener('pointerleave', hideVideoNameTooltip);
    }

    window.addEventListener('blur', hideVideoNameTooltip);
    window.addEventListener('scroll', hideVideoNameTooltip, true);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) hideVideoNameTooltip();
    });

    async function openVideoPicker() {
        if (!pickerOverlay) return;
        hideVideoNameTooltip();
        pickerOverlay.style.display = 'flex';
        pickerBody.innerHTML = '<div class="video-picker-loading">加载中...</div>';

        try {
            const res = await fetch('/cinema/api/videos', { credentials: 'same-origin' });
            if (!res.ok) {
                pickerBody.innerHTML = '<div class="video-picker-empty">加载失败</div>';
                return;
            }
            const data = await res.json();
            const videos = (data.videos || []).filter(v => v.id !== VIDEO.id);
            if (videos.length === 0) {
                pickerBody.innerHTML = '<div class="video-picker-empty">没有其他视频</div>';
                return;
            }
            pickerBody.innerHTML = videos.map(v => {
                const cover = v.cover_url
                    ? `style="background-image:url('${v.cover_url}')"`
                    : '';
                const placeholder = v.cover_url ? '' : '🎬';
                return `
                    <div class="picker-card" data-id="${escapeHtml(v.id)}">
                        <div class="thumbnail" ${cover}>${placeholder}</div>
                        <div class="title">${escapeHtml(v.display_name)}</div>
                    </div>
                `;
            }).join('');

            pickerBody.querySelectorAll('.picker-card').forEach(card => {
                const title = card.querySelector('.title');
                if (title) attachVideoNameTooltip(card, title.textContent);
                card.addEventListener('click', () => {
                    hideVideoNameTooltip();
                    const vid = card.dataset.id;
                    if (!vid) return;
                    closeVideoPicker();
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'host_switch_video',
                            new_video_id: vid,
                        }));
                    }
                    if (switchBtn) switchBtn.disabled = true;
                });
            });
        } catch (e) {
            pickerBody.innerHTML = '<div class="video-picker-empty">网络错误</div>';
        }
    }

    function closeVideoPicker() {
        hideVideoNameTooltip();
        if (pickerOverlay) pickerOverlay.style.display = 'none';
    }

    if (switchBtn) {
        switchBtn.addEventListener('click', openVideoPicker);
    }
    if (pickerClose) {
        pickerClose.addEventListener('click', closeVideoPicker);
    }
    if (pickerOverlay) {
        pickerOverlay.addEventListener('click', (e) => {
            if (e.target === pickerOverlay) closeVideoPicker();
        });
    }

    // ===== 全屏房间面板事件 =====
    const fsRoomLabel = document.getElementById('fs-room-label');
    const fsRoomPanel = document.getElementById('fs-room-panel');
    const fsCatchupBtn = document.getElementById('fs-catchup-btn');
    const fsExitFsBtn = document.getElementById('fs-exit-fs-btn');

    if (fsRoomLabel && fsRoomPanel) {
        fsRoomLabel.addEventListener('click', (e) => {
            e.stopPropagation();
            fsRoomPanel.style.display = fsRoomPanel.style.display === 'none' ? 'block' : 'none';
        });
        // 点其他地方关闭面板
        document.addEventListener('click', () => {
            fsRoomPanel.style.display = 'none';
        });
        fsRoomPanel.addEventListener('click', (e) => e.stopPropagation());
    }
    if (fsCatchupBtn) {
        fsCatchupBtn.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'catch_up' }));
                showToast('正在追上房主...');
            }
            if (fsRoomPanel) fsRoomPanel.style.display = 'none';
        });
    }
    const fsLeaveBtn = document.getElementById('fs-leave-btn');
    const fsTransferBtn = document.getElementById('fs-transfer-btn');
    const fsDissolveBtn = document.getElementById('fs-dissolve-btn');
    if (fsLeaveBtn) {
        fsLeaveBtn.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'leave_room' }));
            }
            if (fsRoomPanel) fsRoomPanel.style.display = 'none';
        });
    }
    const fsLockBtn = document.getElementById('fs-lock-btn');
    if (fsLockBtn) fsLockBtn.addEventListener('click', toggleRoomLock);
    if (fsTransferBtn) fsTransferBtn.addEventListener('click', openTransferDialog);
    if (fsDissolveBtn) fsDissolveBtn.addEventListener('click', openDissolveDialog);
    if (fsExitFsBtn) {
        fsExitFsBtn.addEventListener('click', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            }
            if (fsRoomPanel) fsRoomPanel.style.display = 'none';
        });
    }

    window.CINEMA_WS = {
        getSid: () => mySid,
        getHostSid: () => myHostSid,
        // 我是房客且房主锁定了控制: 本地操作不同步
        isControlLocked: () => roomLocked && !!myHostSid && myHostSid !== mySid,
        toast: (msg, duration) => showToast(msg, duration),
        send: (data) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(data));
            }
        },
    };

    connect();
})();
