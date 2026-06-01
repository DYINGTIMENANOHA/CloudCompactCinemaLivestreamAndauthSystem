/* ===================================
   聊天室客户端
   独立于观影 WebSocket
   =================================== */
(function () {
    'use strict';

    // 需要 token 和 name
    const watchToken = window.CINEMA_TOKEN || '';
    const userName = window.CINEMA_NAME || '';

    // DOM
    const chatBtn = document.getElementById('chat-btn');
    const chatSidebar = document.getElementById('chat-sidebar');
    const chatOverlay = document.getElementById('chat-overlay');
    const chatClose = document.getElementById('chat-close');
    const chatBody = document.getElementById('chat-body');

    if (!chatBtn || !chatSidebar) return;

    let ws = null;
    let mySid = null;
    let currentRoom = null;  // { id, name, members, ... }
    let chatOpen = false;
    let reconnectTimer = null;
    let unreadCount = 0;

    // ===== 语音相关 =====
    let isVoiceActive = false;
    let localStream = null;
    let peerConnections = {};  // sid -> RTCPeerConnection
    const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

    // ===== 侧边栏开关 =====
    function toggleChat() {
        chatOpen = !chatOpen;
        chatSidebar.classList.toggle('open', chatOpen);
        if (chatOverlay) chatOverlay.classList.toggle('open', chatOpen);
        if (chatOpen) {
            unreadCount = 0;
            updateBadge();
            // 打开时如果没连接就连
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                connect();
            } else if (!currentRoom) {
                // 已连接但不在聊天室 → 刷新大厅列表
                ws.send(JSON.stringify({ type: 'chat_list' }));
            }
            // 滚动到底部
            const msgsEl = document.getElementById('chat-messages');
            if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
        }
    }

    chatBtn.addEventListener('click', toggleChat);
    if (chatClose) chatClose.addEventListener('click', toggleChat);
    if (chatOverlay) chatOverlay.addEventListener('click', () => {
        if (chatOpen) toggleChat();
    });

    // ===== 未读 badge =====
    function updateBadge() {
        const badge = document.getElementById('chat-badge');
        if (!badge) return;
        if (unreadCount > 0 && !chatOpen) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.classList.add('visible');
        } else {
            badge.classList.remove('visible');
        }
    }

    // ===== HTML 转义 =====
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    // ===== WebSocket 连接 =====
    function connect() {
        // 防止重连循环: 先标记正在连接
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (ws) {
            const oldWs = ws;
            ws = null;  // 先清引用,防止 onclose 触发重连
            try { oldWs.close(); } catch (e) {}
        }
        if (!watchToken || !userName) return;

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${location.host}/cinema/chat-ws?token=${encodeURIComponent(watchToken)}`;
        ws = new WebSocket(url);

        const socket = ws;  // 保存引用,防止 onclose 把 ws 置 null 后 onopen 找不到

        socket.onopen = () => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'chat_hello', name: userName }));
            }
        };

        socket.onmessage = (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch (e) { return; }
            handleMessage(data);
        };

        socket.onclose = (event) => {
            if (ws === socket) ws = null;
            mySid = null;
            // 只在侧边栏打开 + 非主动关闭(code != 1000) 时重连
            if (chatOpen && event.code !== 1000) {
                if (!reconnectTimer) {
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
                        if (chatOpen) connect();
                    }, 3000);
                }
            }
        };

        ws.onerror = () => {};
    }

    // ===== 消息处理 =====
    function handleMessage(data) {
        switch (data.type) {
            case 'chat_welcome':
                mySid = data.sid;
                // 页面切换后自动重新加入聊天室
                try {
                    const savedRoomId = sessionStorage.getItem('cinema_chat_room_id');
                    if (savedRoomId && ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'chat_join', room_id: savedRoomId }));
                    }
                } catch (e) {}
                break;

            case 'chat_room_list':
                if (!currentRoom) renderLobby(data.rooms || []);
                break;

            case 'chat_room_joined':
                currentRoom = data.room;
                renderChatRoom(data.room, data.messages || []);
                try { sessionStorage.setItem('cinema_chat_room_id', data.room.id); } catch (e) {}
                break;

            case 'chat_room_left':
                currentRoom = null;
                try { sessionStorage.removeItem('cinema_chat_room_id'); } catch (e) {}
                // 请求房间列表刷新大厅
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'chat_list' }));
                }
                break;

            case 'chat_msg':
                appendMessage(data);
                if (!chatOpen) {
                    unreadCount++;
                    updateBadge();
                }
                break;

            case 'chat_member_joined':
                appendSystemMsg(`${data.name} 加入了聊天室`);
                if (data.room) currentRoom = data.room;
                updateMembersDisplay();
                break;

            case 'chat_member_left':
                appendSystemMsg(`${data.name} 离开了聊天室`);
                if (data.room) currentRoom = data.room;
                updateMembersDisplay();
                break;

            case 'chat_room_dissolved':
                currentRoom = null;
                appendSystemMsg('聊天室已解散');
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'chat_list' }));
                }
                break;

            case 'chat_error':
                try { sessionStorage.removeItem('cinema_chat_room_id'); } catch (e) {}
                // 如果不在聊天室,回到大厅视图
                if (!currentRoom) {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'chat_list' }));
                    }
                } else {
                    appendSystemMsg(data.message || '操作失败');
                }
                break;

            case 'voice_state':
                updateVoiceUI(data.participants || []);
                break;

            case 'voice_signal':
                handleVoiceSignal(data);
                break;

            case 'chat_ping':
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'chat_pong' }));
                }
                break;

            default:
                break;
        }
    }

    // ===== 渲染大厅(未加入聊天室) =====
    function renderLobby(rooms) {
        let html = `
            <div class="chat-lobby">
                <button class="chat-create-btn" id="chat-create-btn">✨ 创建聊天室</button>
        `;

        if (rooms.length > 0) {
            html += `<div class="chat-lobby-title">活跃的聊天室</div>`;
            rooms.forEach(r => {
                html += `
                    <div class="chat-room-card" data-room-id="${escapeHtml(r.id)}">
                        <div class="chat-room-name">${escapeHtml(r.name)}</div>
                        <div class="chat-room-info">${r.member_count} 人 · ${r.members.map(m => escapeHtml(m.name)).join(', ')}</div>
                    </div>
                `;
            });
        } else {
            html += `<div class="chat-lobby-empty">暂无活跃的聊天室<br>点击上方按钮创建一个</div>`;
        }

        html += `</div>`;
        chatBody.innerHTML = html;

        // 绑事件
        document.getElementById('chat-create-btn')?.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'chat_create' }));
            }
        });

        chatBody.querySelectorAll('.chat-room-card').forEach(card => {
            card.addEventListener('click', () => {
                const roomId = card.dataset.roomId;
                if (roomId && ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'chat_join', room_id: roomId }));
                }
            });
        });
    }

    // ===== 渲染聊天室 =====
    function renderChatRoom(room, messages) {
        let html = `
            <div class="chat-room-actions">
                <button class="chat-leave-btn" id="chat-leave-btn">退出聊天室</button>
            </div>
            <div class="chat-members" id="chat-members-display">
                👥 ${room.members.map(m => '<span>' + escapeHtml(m.name) + '</span>').join(', ')}
            </div>
            <div class="chat-messages" id="chat-messages">
        `;

        messages.forEach(msg => {
            html += renderMsgHtml(msg);
        });

        html += `</div>
            <div class="chat-voice-bar" id="chat-voice-bar">
                <button class="chat-voice-btn" id="chat-voice-btn">🎤 开启语音</button>
                <span class="chat-voice-participants" id="chat-voice-participants"></span>
            </div>
            <div class="chat-input-area">
                <textarea class="chat-input" id="chat-input" placeholder="输入消息..." rows="1"></textarea>
                <button class="chat-send-btn" id="chat-send-btn">发送</button>
            </div>
        `;

        chatBody.innerHTML = html;

        // 更新状态栏
        const statusEl = document.getElementById('chat-status-text');
        if (statusEl) {
            statusEl.innerHTML = `<span class="chat-status-room">${escapeHtml(room.name)}</span> · ${room.member_count} 人`;
        }

        // 滚到底
        const msgsEl = document.getElementById('chat-messages');
        if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;

        // 绑事件
        document.getElementById('chat-leave-btn')?.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'chat_leave' }));
            }
        });

        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send-btn');

        sendBtn?.addEventListener('click', sendMessage);
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // 自动调整输入框高度
        input?.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 80) + 'px';
        });

        // 语音按钮
        const voiceBtn = document.getElementById('chat-voice-btn');
        if (voiceBtn) {
            voiceBtn.addEventListener('click', toggleVoice);
            // 恢复语音按钮状态
            if (isVoiceActive) {
                voiceBtn.textContent = '🔴 关闭语音';
                voiceBtn.classList.add('active');
            }
        }
    }

    function sendMessage() {
        const input = document.getElementById('chat-input');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'chat_send', text: text }));
        }
        input.value = '';
        input.style.height = 'auto';
    }

    // ===== 追加消息 =====
    function renderMsgHtml(msg) {
        return `
            <div class="chat-msg">
                <span class="chat-msg-sender">${escapeHtml(msg.sender)}</span>
                <span class="chat-msg-text">${escapeHtml(msg.text)}</span>
                <span class="chat-msg-time">${escapeHtml(msg.time)}</span>
            </div>
        `;
    }

    function appendMessage(msg) {
        const msgsEl = document.getElementById('chat-messages');
        if (!msgsEl) return;
        const div = document.createElement('div');
        div.innerHTML = renderMsgHtml(msg);
        msgsEl.appendChild(div.firstElementChild);
        // 自动滚到底(如果用户没手动上滑)
        const isNearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80;
        if (isNearBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function appendSystemMsg(text) {
        const msgsEl = document.getElementById('chat-messages');
        if (!msgsEl) return;
        const div = document.createElement('div');
        div.className = 'chat-msg-system';
        div.textContent = text;
        msgsEl.appendChild(div);
        msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function updateMembersDisplay() {
        if (!currentRoom) return;
        const el = document.getElementById('chat-members-display');
        if (!el) return;
        el.innerHTML = '👥 ' + currentRoom.members.map(m => '<span>' + escapeHtml(m.name) + '</span>').join(', ');
    }

    // ===== 语音功能 =====
    async function toggleVoice() {
        if (isVoiceActive) {
            stopVoice();
        } else {
            await startVoice();
        }
    }

    async function startVoice() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            isVoiceActive = true;

            const voiceBtn = document.getElementById('chat-voice-btn');
            if (voiceBtn) {
                voiceBtn.textContent = '🔴 关闭语音';
                voiceBtn.classList.add('active');
            }

            // 通知服务端
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'voice_join' }));
            }

            appendSystemMsg('🎤 已开启语音');
        } catch (e) {
            appendSystemMsg('无法访问麦克风,请检查麦克风是否被占用或权限设置');
            console.error('[voice] mic error:', e);
        }
    }

    function stopVoice() {
        isVoiceActive = false;

        // 关闭本地音频
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }

        // 关闭所有 peer connections
        Object.values(peerConnections).forEach(pc => {
            try { pc.close(); } catch (e) {}
        });
        peerConnections = {};

        const voiceBtn = document.getElementById('chat-voice-btn');
        if (voiceBtn) {
            voiceBtn.textContent = '🎤 开启语音';
            voiceBtn.classList.remove('active');
        }

        // 通知服务端
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'voice_leave' }));
        }

        appendSystemMsg('🎤 已关闭语音');
    }

    function updateVoiceUI(participants) {
        const el = document.getElementById('chat-voice-participants');
        if (!el) return;
        if (participants.length === 0) {
            el.textContent = '';
        } else {
            el.textContent = '语音中: ' + participants.map(p => p.name).join(', ');
        }

        // 如果我开了语音,和新加入的人建立连接
        if (isVoiceActive && localStream) {
            participants.forEach(p => {
                if (p.sid !== mySid && !peerConnections[p.sid]) {
                    createPeerConnection(p.sid, true);
                }
            });
            // 清理已离开的人的连接
            Object.keys(peerConnections).forEach(sid => {
                if (!participants.find(p => p.sid === sid)) {
                    peerConnections[sid].close();
                    delete peerConnections[sid];
                }
            });
        }
    }

    function createPeerConnection(remoteSid, isInitiator) {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        peerConnections[remoteSid] = pc;

        // 添加本地音频轨道
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

        // ICE candidate
        pc.onicecandidate = (event) => {
            if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'voice_signal',
                    target: remoteSid,
                    signal_type: 'ice',
                    data: event.candidate.toJSON(),
                }));
            }
        };

        // 收到远端音频
        pc.ontrack = (event) => {
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.play().catch(() => {});
        };

        // 连接状态
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                pc.close();
                delete peerConnections[remoteSid];
            }
        };

        // 发起方创建 offer
        if (isInitiator) {
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'voice_signal',
                            target: remoteSid,
                            signal_type: 'offer',
                            data: pc.localDescription.toJSON(),
                        }));
                    }
                })
                .catch(e => console.error('[voice] offer error:', e));
        }

        return pc;
    }

    async function handleVoiceSignal(data) {
        const fromSid = data.from_sid;
        const signalType = data.signal_type;
        const signalData = data.data;

        if (!isVoiceActive || !localStream) return;

        if (signalType === 'offer') {
            // 收到 offer: 创建连接(如果还没有), 设 remote, 发 answer
            let pc = peerConnections[fromSid];
            if (!pc) {
                pc = createPeerConnection(fromSid, false);
            }
            await pc.setRemoteDescription(new RTCSessionDescription(signalData));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'voice_signal',
                    target: fromSid,
                    signal_type: 'answer',
                    data: pc.localDescription.toJSON(),
                }));
            }
        } else if (signalType === 'answer') {
            const pc = peerConnections[fromSid];
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(signalData));
            }
        } else if (signalType === 'ice') {
            const pc = peerConnections[fromSid];
            if (pc) {
                await pc.addIceCandidate(new RTCIceCandidate(signalData));
            }
        }
    }

    // ===== 页面关闭时断开 =====
    window.addEventListener('beforeunload', () => {
        if (isVoiceActive) stopVoice();
        if (ws) { try { ws.close(); } catch (e) {} }
    });

    // 不自动连接,只在用户打开聊天侧边栏时才建立连接
})();
