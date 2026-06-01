/**
 * 评论模块 - 评论加载、发送、回复
 * 依赖：全局变量(TOKEN, API_PREFIX, REPLAY_SESSION)
 */

let replyingTo = null;

/**
 * 加载评论列表
 */
function loadComments(sessionId = '') {
    const url = sessionId ? 
        API_PREFIX + '/comments?session_id=' + sessionId : 
        API_PREFIX + '/comments';
    
    fetch(url)
        .then(r => r.json())
        .then(comments => {
            const list = document.getElementById('commentsList');
            list.innerHTML = '';
            
            const mainComments = comments.filter(c => !c.parent_id);
            const repliesMap = {};
            
            comments.filter(c => c.parent_id).forEach(r => {
                if (!repliesMap[r.parent_id]) repliesMap[r.parent_id] = [];
                repliesMap[r.parent_id].push(r);
            });
            
            mainComments.forEach(comment => {
                const item = createCommentElement(comment, false);
                list.appendChild(item);
                
                if (repliesMap[comment.id]) {
                    repliesMap[comment.id].forEach(reply => {
                        const replyItem = createCommentElement(reply, true);
                        list.appendChild(replyItem);
                    });
                }
            });
        })
        .catch(e => console.error('加载评论失败:', e));
}

/**
 * 创建评论元素
 */
function createCommentElement(comment, isReply) {
    const item = document.createElement('div');
    item.className = 'comment-item';
    
    if (isReply) {
        item.style.marginLeft = '30px';
        item.style.borderLeftColor = '#888';
    }
    
    if (comment.is_pinned) item.classList.add('comment-pinned');
    if (comment.is_admin) item.classList.add('comment-admin');
    
    let badges = '';
    if (comment.is_admin) badges += '<span class="comment-badge badge-admin">主播</span>';
    if (comment.is_pinned) badges += '<span class="comment-badge badge-pinned">📌 置顶</span>';
    
    const replyBtn = !isReply ? 
        `<button class="reply-btn" onclick="replyToComment(${comment.id}, '${escapeHtml(comment.content).substring(0,30)}...')" style="background:#667eea;color:#fff;border:none;padding:5px 12px;border-radius:5px;cursor:pointer;font-size:0.85em;margin-top:8px">💬 回复</button>` : 
        '';
    
    const contentPrefix = isReply ? '↳ ' : '';
    const contentStyle = isReply ? 'color:#aaa;font-size:0.9em' : '';
    
    item.innerHTML = `
        <div class="comment-header">
            <div>${badges}</div>
            <span class="comment-time">${formatTime(comment.time)}</span>
        </div>
        <div class="comment-content" style="${contentStyle}">${contentPrefix}${escapeHtml(comment.content)}</div>
        ${replyBtn}
    `;
    
    return item;
}

/**
 * 回复评论
 */
function replyToComment(commentId, content) {
    replyingTo = commentId;
    document.getElementById("replyIndicator").style.display = "block";
    document.getElementById("replyTarget").textContent = content;
    document.getElementById("commentInput").focus();
}

/**
 * 取消回复
 */
function cancelReply() {
    replyingTo = null;
    document.getElementById("replyIndicator").style.display = "none";
}

/**
 * 发送评论
 */
function sendComment() {
    const input = document.getElementById('commentInput');
    const content = input.value.trim();
    
    if (!content) {
        alert('请输入评论内容');
        return;
    }
    
    const data = {
        parent_id: replyingTo,
        content: content,
        token: TOKEN,
        session_id: REPLAY_SESSION
    };
    
    fetch(API_PREFIX + '/comments', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    })
    .then(r => r.json())
    .then(result => {
        if (result.status === 'ok') {
            input.value = '';
            cancelReply();
            loadComments(REPLAY_SESSION);
        } else {
            alert('发送失败: ' + (result.error || '未知错误'));
        }
    })
    .catch(e => {
        console.error('发送失败:', e);
        alert('网络错误');
    });
}

/**
 * 格式化时间
 */
function formatTime(timeStr) {
    const date = new Date(timeStr);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    return timeStr.split('T')[0] + ' ' + timeStr.split('T')[1].substring(0, 5);
}

/**
 * HTML转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 初始化评论输入框
 */
function initCommentInput() {
    const input = document.getElementById('commentInput');
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendComment();
        }
    });
}
