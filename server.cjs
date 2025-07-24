const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const FormData = require('form-data');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const port = process.env.PORT || 3002;

// ================== 全局配置 ==================

/**
 * Coze API Token
 * @type {string}
 */
const API_TOKEN = 'pat_OBvyBcvJsvQcJsW2ykls061ZysdZkdu7RFtsggcJyhZi1EUi8wubz55ulhjpGCgf';

/**
 * Coze API 基础URL
 * @type {string}
 */
const API_BASE_URL = 'https://api.coze.cn';

/**
 * 智能体ID映射
 * @type {Object<string, string>}
 */
const AGENT_BOT_IDS = {
  "Art Critic": "7524345845467299855",
  "General Audience": "7524345845467136015",
  "Art Theorist": "7524344850851168291",
  "Art Historian": "7524342395841396736",
  "Painter": "7524341444501782567",
  "Art Collector": "7524340821945630783",
  "VTS": "7524342433057046574"
};

// ================== 中间件与上传配置 ==================
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage });

// ================== 会话存储结构 ==================
/**
 * 单Agent聊天会话存储
 * @type {Object<string, any>}
 */
const sessions = {};

/**
 * 多Agent辩论会话存储
 * @type {Object<string, any>}
 */
const debateSessions = {};

/**
 * 获取或创建单Agent聊天会话
 * @param {string} sessionId
 * @returns {any}
 */
function getOrCreateSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      userId: `user_${uuidv4().substring(0, 8)}`,
      chatHistory: [],
      agentConversations: {}
    };
  }
  return sessions[sessionId];
}

/**
 * 获取或创建多Agent辩论会话
 * @param {string} sessionId
 * @returns {any}
 */
function getOrCreateDebateSession(sessionId) {
  if (!debateSessions[sessionId]) {
    debateSessions[sessionId] = {
      userId: `user_${uuidv4().substring(0, 8)}`,
      chatHistory: [],
      conversationId: null,
      agentLastChats: {}
    };
  }
  return debateSessions[sessionId];
}

// ================== 上传文件API ==================
/**
 * 上传文件接口
 * @route POST /api/upload
 */
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '没有文件上传' });
    }
    const filePath = req.file.path;
    const fileName = req.file.originalname;
    // 创建表单数据
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath), fileName);
    const headers = {
      'Authorization': `Bearer ${API_TOKEN}`,
      ...formData.getHeaders ? formData.getHeaders() : {}
    };
    try {
      const uploadResponse = await axios.post(
        `${API_BASE_URL}/v1/files/upload`,
        formData,
        { headers }
      );
      if (uploadResponse.data.code !== 0) {
        throw new Error(`Coze API错误: ${uploadResponse.data.msg || '未知错误'}`);
      }
      const fileId = uploadResponse.data.data.id;
      res.json({
        success: true,
        fileData: {
          data: {
            id: fileId,
            fileName: fileName,
            bytes: uploadResponse.data.data.bytes
          }
        }
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: `上传到Coze API失败: ${error.message}` 
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: '文件上传失败: ' + error.message });
  }
});

// ================== 单Agent聊天API ==================
/**
 * 单Agent聊天接口
 * @route POST /api/chat
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { agentTitle, message, fileIds, sessionId = 'default', resetConversation = false } = req.body;
    const session = getOrCreateSession(sessionId);
    const botId = AGENT_BOT_IDS[agentTitle];
    if (!botId) {
      return res.status(400).json({ success: false, error: `未找到智能体: ${agentTitle}` });
    }
    if (resetConversation || !session.agentConversations[agentTitle]) {
      session.agentConversations[agentTitle] = {
        conversationId: null,
        lastChatId: null,
        lastBotId: botId
      };
    }
    const agentSession = session.agentConversations[agentTitle];
    const contentItems = [{ type: "text", text: message }];
    if (Array.isArray(fileIds) && fileIds.length > 0) {
      fileIds.forEach(fileId => {
        if (fileId && typeof fileId === 'string') {
          contentItems.push({ type: "image", file_id: fileId });
        }
      });
    }
    const contentString = JSON.stringify(contentItems);
    try {
      const requestParams = {
        bot_id: botId,
        user_id: session.userId,
        additional_messages: [
          {
            role: "user",
            content: contentString,
            content_type: "object_string"
          }
        ],
        auto_save_history: true
      };
      let chatUrl = `${API_BASE_URL}/v3/chat`;
      if (agentSession.conversationId) {
        chatUrl += `?conversation_id=${agentSession.conversationId}`;
      }
      const chatResponse = await axios.post(
        chatUrl,
        requestParams,
        {
          headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      if (chatResponse.data.code !== 0) {
        return res.status(400).json({ success: false, error: chatResponse.data.msg });
      }
      agentSession.lastChatId = chatResponse.data.data.id;
      agentSession.conversationId = chatResponse.data.data.conversation_id;
      agentSession.lastBotId = botId;
      let status = chatResponse.data.data.status;
      let maxRetries = 200;
      let retryCount = 0;
      let notFoundCount = 0;
      while (status === 'in_progress' && retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          const detailsUrl = `${API_BASE_URL}/v3/chat/retrieve?chat_id=${agentSession.lastChatId}&conversation_id=${agentSession.conversationId}`;
          const detailsResponse = await axios.get(
            detailsUrl,
            {
              headers: { 'Authorization': `Bearer ${API_TOKEN}` }
            }
          );
          if (detailsResponse.data.code !== 0) {
            return res.status(400).json({ success: false, error: detailsResponse.data.msg });
          }
          status = detailsResponse.data.data.status;
          retryCount++;
          notFoundCount = 0;
        } catch (error) {
          if (error.response && error.response.status === 404) {
            notFoundCount++;
            if (notFoundCount < 3) {
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            }
          }
          return res.status(500).json({ 
            success: false, 
            error: `轮询对话状态时出错: ${error.message}`
          });
        }
      }
      if (status !== 'completed') {
        return res.status(400).json({ 
          success: false, 
          error: `对话未完成，状态: ${status}，重试次数: ${retryCount}` 
        });
      }
      try {
        const messagesUrl = `${API_BASE_URL}/v3/chat/message/list?chat_id=${agentSession.lastChatId}&conversation_id=${agentSession.conversationId}`;
        const messagesResponse = await axios.get(
          messagesUrl,
          {
            headers: { 'Authorization': `Bearer ${API_TOKEN}` }
          }
        );
        if (messagesResponse.data.code !== 0) {
          return res.status(400).json({ success: false, error: messagesResponse.data.msg });
        }
        const answerMessage = messagesResponse.data.data.find(msg => 
          msg.role === 'assistant' && msg.type === 'answer'
        );
        if (!answerMessage) {
          return res.status(400).json({ success: false, error: '未找到智能体回复' });
        }
        session.chatHistory.push({
          id: agentSession.lastChatId,
          userMessage: message,
          agentTitle,
          agentReply: answerMessage.content,
          timestamp: Date.now()
        });
        res.json({
          success: true,
          message: answerMessage.content,
          chatId: agentSession.lastChatId,
          conversationId: agentSession.conversationId
        });
      } catch (error) {
        return res.status(500).json({ 
          success: false, 
          error: `获取对话消息时出错: ${error.message}`
        });
      }
    } catch (error) {
      return res.status(500).json({ 
        success: false, 
        error: `发起对话请求失败: ${error.message}`
      });
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: `聊天请求失败: ${error.message || '未知错误'}` 
    });
  }
});

/**
 * 计算语义相似度（与原 server-debate.cjs 保持一致）
 * @param {string} message
 * @param {string} agentTitle
 * @returns {Promise<number>}
 */
async function calculateSemanticSimilarity(message, agentTitle) {
  try {
    const agentKeywords = {
      'Art Critic': ['评价', '批评', '风格', '评论', '鉴赏', '美学', '艺术性', '表现力', '构图', '色彩'],
      'Art Historian': ['历史', '年代', '时期', '流派', '背景', '演变', '影响', '传统', '文化', '年份'],
      'Art Theorist': ['理论', '概念', '原理', '学派', '思想', '哲学', '意义', '符号', '解读', '分析'],
      'Art Collector': ['收藏', '价值', '市场', '拍卖', '投资', '真伪', '保存', '修复', '珍品', '稀有'],
      'Painter': ['技法', '材料', '笔触', '线条', '创作', '灵感', '表达', '画布', '颜料', '光影'],
      'General Audience': ['感受', '喜欢', '印象', '情感', '联想', '美丽', '有趣', '吸引', '故事', '想象']
    };
    const keywords = agentKeywords[agentTitle] || [];
    let matchCount = 0;
    for (const keyword of keywords) {
      if (message.includes(keyword)) {
        matchCount++;
      }
    }
    let similarity = Math.min(0.3 + (matchCount * 0.1), 1.0);
    similarity = Math.min(Math.max(similarity + (Math.random() * 0.2 - 0.1), 0), 1);
    return similarity;
  } catch (error) {
    return 0.5;
  }
}

/**
 * 发送消息到Coze API并等待结果（与原 server-debate.cjs 保持一致）
 */
async function sendMessageToCoze(botId, userId, message, fileIds, conversationId) {
  const contentItems = [{ type: "text", text: message }];
  if (Array.isArray(fileIds) && fileIds.length > 0) {
    fileIds.forEach(fileId => {
      if (fileId && typeof fileId === 'string') {
        contentItems.push({ type: "image", file_id: fileId });
      }
    });
  }
  const contentString = JSON.stringify(contentItems);
  const requestParams = {
    bot_id: botId,
    user_id: userId,
    additional_messages: [
      {
        role: "user",
        content: contentString,
        content_type: "object_string"
      }
    ],
    auto_save_history: true
  };
  let chatUrl = `${API_BASE_URL}/v3/chat`;
  if (conversationId) {
    chatUrl += `?conversation_id=${conversationId}`;
  }
  const chatResponse = await axios.post(
    chatUrl,
    requestParams,
    {
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
  if (chatResponse.data.code !== 0) {
    throw new Error(chatResponse.data.msg || '未知错误');
  }
  const chatId = chatResponse.data.data.id;
  const newConversationId = chatResponse.data.data.conversation_id;
  let status = chatResponse.data.data.status;
  let maxRetries = 100;
  let retryCount = 0;
  let notFoundCount = 0;
  while (status === 'in_progress' && retryCount < maxRetries) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const detailsUrl = `${API_BASE_URL}/v3/chat/retrieve?chat_id=${chatId}&conversation_id=${newConversationId}`;
      const detailsResponse = await axios.get(
        detailsUrl,
        {
          headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        }
      );
      if (detailsResponse.data.code !== 0) {
        throw new Error(detailsResponse.data.msg || '获取对话详情失败');
      }
      status = detailsResponse.data.data.status;
      retryCount++;
      notFoundCount = 0;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        notFoundCount++;
        if (notFoundCount < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      }
      throw error;
    }
  }
  if (status !== 'completed') {
    throw new Error(`对话未完成，状态: ${status}，重试次数: ${retryCount}`);
  }
  const messagesUrl = `${API_BASE_URL}/v3/chat/message/list?chat_id=${chatId}&conversation_id=${newConversationId}`;
  const messagesResponse = await axios.get(
    messagesUrl,
    {
      headers: { 'Authorization': `Bearer ${API_TOKEN}` }
    }
  );
  if (messagesResponse.data.code !== 0) {
    throw new Error(messagesResponse.data.msg || '获取消息列表失败');
  }
  const answerMessage = messagesResponse.data.data.find(msg => 
    msg.role === 'assistant' && msg.type === 'answer'
  );
  if (!answerMessage) {
    throw new Error('未找到智能体回复');
  }
  return {
    chatId,
    conversationId: newConversationId,
    message: answerMessage.content
  };
}

/**
 * 多Agent辩论接口
 * @route POST /api/debate
 */
app.post('/api/debate', async (req, res) => {
  try {
    const { agentTitles, message, fileIds, sessionId = 'default', resetConversation = false } = req.body;
    if (!Array.isArray(agentTitles) || agentTitles.length === 0) {
      return res.status(400).json({ success: false, error: '需要提供至少一个智能体' });
    }
    for (const agentTitle of agentTitles) {
      if (!AGENT_BOT_IDS[agentTitle]) {
        return res.status(400).json({ success: false, error: `未找到智能体: ${agentTitle}` });
      }
    }
    const session = getOrCreateDebateSession(sessionId);
    if (resetConversation) {
      session.conversationId = null;
      session.agentLastChats = {};
    }
    const agentSimilarities = [];
    for (const agentTitle of agentTitles) {
      const similarity = await calculateSemanticSimilarity(message, agentTitle);
      agentSimilarities.push({
        agentTitle,
        similarity,
        botId: AGENT_BOT_IDS[agentTitle]
      });
    }
    agentSimilarities.sort((a, b) => b.similarity - a.similarity);
    const responses = [];
    const agentResponses = {};
    const similarities = {};
    for (const { agentTitle, similarity, botId } of agentSimilarities) {
      try {
        let contextMessage = message;
        if (responses.length > 0) {
          const respondedAgentTitles = agentSimilarities
            .filter((_, i) => i < responses.length)
            .map(a => a.agentTitle);
          contextMessage = `用户说: "${message}"
\n其他专家的评论:
${responses.map((r, i) => `${respondedAgentTitles[i]}: "${r}"`).join('\n')}
\n请你作为${agentTitle}，考虑以上评论，给出自己的看法，可以反驳，也可以支持。（简洁回答）`;
        }
        const result = await sendMessageToCoze(
          botId,
          session.userId,
          contextMessage,
          fileIds,
          session.conversationId
        );
        session.conversationId = result.conversationId;
        session.agentLastChats[agentTitle] = result.chatId;
        responses.push(result.message);
        agentResponses[agentTitle] = result.message;
        similarities[agentTitle] = similarity;
      } catch (error) {
        responses.push(`[错误: ${error.message}]`);
        agentResponses[agentTitle] = `[错误: ${error.message}]`;
        similarities[agentTitle] = similarity;
      }
    }
    session.chatHistory.push({
      userMessage: message,
      agentResponses,
      similarities,
      timestamp: Date.now()
    });
    res.json({
      success: true,
      responses: agentResponses,
      similarities,
      orderedAgents: agentSimilarities.map(a => a.agentTitle),
      conversationId: session.conversationId
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: `辩论请求失败: ${error.message || '未知错误'}` 
    });
  }
});

// ========== 流式辩论相关 ==========
const activeStreams = new Map();

/**
 * 初始化流式辩论接口
 * @route POST /api/debate/stream/init
 */
app.post('/api/debate/stream/init', async (req, res) => {
  try {
    const { agentTitles, message, fileIds, sessionId = 'default', resetConversation = false } = req.body;
    if (!Array.isArray(agentTitles) || agentTitles.length === 0) {
      return res.status(400).json({ success: false, error: '需要提供至少一个智能体' });
    }
    for (const agentTitle of agentTitles) {
      if (!AGENT_BOT_IDS[agentTitle]) {
        return res.status(400).json({ success: false, error: `未找到智能体: ${agentTitle}` });
      }
    }
    const streamId = uuidv4();
    activeStreams.set(streamId, {
      agentTitles,
      message,
      fileIds: fileIds || [],
      sessionId,
      resetConversation,
      createdAt: Date.now(),
      status: 'initialized'
    });
    res.json({
      success: true,
      streamId,
      message: '流式辩论会话已初始化'
    });
    setTimeout(() => {
      if (activeStreams.has(streamId) && activeStreams.get(streamId).status === 'initialized') {
        activeStreams.delete(streamId);
      }
    }, 30 * 60 * 1000);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: `流式辩论初始化失败: ${error.message || '未知错误'}`
    });
  }
});

/**
 * SSE流式辩论接口
 * @route GET /api/debate/stream/:streamId
 */
app.get('/api/debate/stream/:streamId', async (req, res) => {
  try {
    const { streamId } = req.params;
    if (!activeStreams.has(streamId)) {
      res.status(404).send(`未找到流式辩论会话: ${streamId}`);
      return;
    }
    const streamSession = activeStreams.get(streamId);
    const { agentTitles, message, fileIds, sessionId, resetConversation } = streamSession;
    streamSession.status = 'active';
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const session = getOrCreateDebateSession(sessionId);
    if (resetConversation) {
      session.conversationId = null;
      session.agentLastChats = {};
    }
    const agentSimilarities = [];
    for (const agentTitle of agentTitles) {
      const similarity = await calculateSemanticSimilarity(message, agentTitle);
      agentSimilarities.push({
        agentTitle,
        similarity,
        botId: AGENT_BOT_IDS[agentTitle]
      });
    }
    agentSimilarities.sort((a, b) => b.similarity - a.similarity);
    res.write(`data: ${JSON.stringify({
      type: 'order',
      orderedAgents: agentSimilarities.map(a => a.agentTitle),
      similarities: Object.fromEntries(agentSimilarities.map(a => [a.agentTitle, a.similarity]))
    })}\n\n`);
    const responses = [];
    const agentResponses = {};
    const similarities = {};
    req.on('close', () => {
      activeStreams.delete(streamId);
    });
    for (let i = 0; i < agentSimilarities.length; i++) {
      if (req.socket.destroyed) {
        activeStreams.delete(streamId);
        return;
      }
      const { agentTitle, similarity, botId } = agentSimilarities[i];
      try {
        let contextMessage = message;
        if (responses.length > 0) {
          const respondedAgentTitles = agentSimilarities
            .filter((_, idx) => idx < responses.length)
            .map(a => a.agentTitle);
          contextMessage = `用户说: "${message}"
\n其他专家的评论:
${responses.map((r, idx) => `${respondedAgentTitles[idx]}: "${r}"`).join('\n')}
\n请你作为${agentTitle}，考虑以上评论，给出自己的看法，可以反驳，也可以支持。（简洁回答）`;
        }
        const result = await sendMessageToCoze(
          botId,
          session.userId,
          contextMessage,
          fileIds,
          session.conversationId
        );
        session.conversationId = result.conversationId;
        session.agentLastChats[agentTitle] = result.chatId;
        responses.push(result.message);
        agentResponses[agentTitle] = result.message;
        similarities[agentTitle] = similarity;
        res.write(`data: ${JSON.stringify({
          type: 'response',
          agentTitle,
          response: result.message,
          similarity,
          isComplete: i === agentSimilarities.length - 1,
          index: i
        })}\n\n`);
      } catch (error) {
        const errorMessage = `[错误: ${error.message}]`;
        responses.push(errorMessage);
        agentResponses[agentTitle] = errorMessage;
        similarities[agentTitle] = similarity;
        res.write(`data: ${JSON.stringify({
          type: 'response',
          agentTitle,
          response: errorMessage,
          similarity,
          isComplete: i === agentSimilarities.length - 1,
          isError: true,
          index: i
        })}\n\n`);
      }
    }
    session.chatHistory.push({
      userMessage: message,
      agentResponses,
      similarities,
      timestamp: Date.now()
    });
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      responses: agentResponses,
      similarities,
      orderedAgents: agentSimilarities.map(a => a.agentTitle),
      conversationId: session.conversationId
    })}\n\n`);
    activeStreams.delete(streamId);
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).send(`流式辩论处理失败: ${error.message || '未知错误'}`);
    } else {
      res.write(`data: ${JSON.stringify({ 
        success: false, 
        error: `辩论请求失败: ${error.message || '未知错误'}`,
        type: 'error'
      })}\n\n`);
      res.end();
    }
  }
});

/**
 * 兼容老版流式SSE接口
 * @route POST /api/debate/stream
 */
app.post('/api/debate/stream', async (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { agentTitles, message, fileIds, sessionId = 'default', resetConversation = false } = req.body;
    if (!Array.isArray(agentTitles) || agentTitles.length === 0) {
      res.write(`data: ${JSON.stringify({ 
        success: false, 
        error: '需要提供至少一个智能体',
        type: 'error'
      })}\n\n`);
      return res.end();
    }
    for (const agentTitle of agentTitles) {
      if (!AGENT_BOT_IDS[agentTitle]) {
        res.write(`data: ${JSON.stringify({ 
          success: false, 
          error: `未找到智能体: ${agentTitle}`,
          type: 'error'
        })}\n\n`);
        return res.end();
      }
    }
    const session = getOrCreateDebateSession(sessionId);
    if (resetConversation) {
      session.conversationId = null;
      session.agentLastChats = {};
    }
    const agentSimilarities = [];
    for (const agentTitle of agentTitles) {
      const similarity = await calculateSemanticSimilarity(message, agentTitle);
      agentSimilarities.push({
        agentTitle,
        similarity,
        botId: AGENT_BOT_IDS[agentTitle]
      });
    }
    agentSimilarities.sort((a, b) => b.similarity - a.similarity);
    res.write(`data: ${JSON.stringify({
      type: 'order',
      orderedAgents: agentSimilarities.map(a => a.agentTitle),
      similarities: Object.fromEntries(agentSimilarities.map(a => [a.agentTitle, a.similarity]))
    })}\n\n`);
    const responses = [];
    const agentResponses = {};
    const similarities = {};
    for (let i = 0; i < agentSimilarities.length; i++) {
      const { agentTitle, similarity, botId } = agentSimilarities[i];
      try {
        let contextMessage = message;
        if (responses.length > 0) {
          const respondedAgentTitles = agentSimilarities
            .filter((_, idx) => idx < responses.length)
            .map(a => a.agentTitle);
          contextMessage = `用户说: "${message}"
\n其他专家的评论:
${responses.map((r, idx) => `${respondedAgentTitles[idx]}: "${r}"`).join('\n')}
\n请你作为${agentTitle}，考虑以上评论，给出自己的看法，可以反驳，也可以支持。（简洁回答）`;
        }
        const result = await sendMessageToCoze(
          botId,
          session.userId,
          contextMessage,
          fileIds,
          session.conversationId
        );
        session.conversationId = result.conversationId;
        session.agentLastChats[agentTitle] = result.chatId;
        responses.push(result.message);
        agentResponses[agentTitle] = result.message;
        similarities[agentTitle] = similarity;
        res.write(`data: ${JSON.stringify({
          type: 'response',
          agentTitle,
          response: result.message,
          similarity,
          isComplete: i === agentSimilarities.length - 1,
          index: i
        })}\n\n`);
      } catch (error) {
        const errorMessage = `[错误: ${error.message}]`;
        responses.push(errorMessage);
        agentResponses[agentTitle] = errorMessage;
        similarities[agentTitle] = similarity;
        res.write(`data: ${JSON.stringify({
          type: 'response',
          agentTitle,
          response: errorMessage,
          similarity,
          isComplete: i === agentSimilarities.length - 1,
          isError: true,
          index: i
        })}\n\n`);
      }
    }
    session.chatHistory.push({
      userMessage: message,
      agentResponses,
      similarities,
      timestamp: Date.now()
    });
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      responses: agentResponses,
      similarities,
      orderedAgents: agentSimilarities.map(a => a.agentTitle),
      conversationId: session.conversationId
    })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ 
      success: false, 
      error: `辩论请求失败: ${error.message || '未知错误'}`,
      type: 'error'
    })}\n\n`);
    res.end();
  }
});

/**
 * 获取辩论历史接口
 * @route GET /api/debate/history
 */
app.get('/api/debate/history', (req, res) => {
  const { sessionId = 'default' } = req.query;
  const session = getOrCreateDebateSession(sessionId);
  res.json({
    success: true,
    history: session.chatHistory
  });
});

/**
 * 重置辩论会话接口
 * @route POST /api/debate/reset
 */
app.post('/api/debate/reset', (req, res) => {
  try {
    const { sessionId = 'default' } = req.body;
    if (!debateSessions[sessionId]) {
      return res.json({ success: true, message: '会话不存在，无需重置' });
    }
    // 重置会话
    debateSessions[sessionId].conversationId = null;
    debateSessions[sessionId].agentLastChats = {};
    res.json({ 
      success: true, 
      message: '已重置辩论会话'
    });
  } catch (error) {
    console.error('重置辩论会话失败:', error);
    res.status(500).json({ 
      success: false, 
      error: `重置辩论会话失败: ${error.message || '未知错误'}` 
    });
  }
});

// ================== 获取聊天历史API ==================
/**
 * 获取聊天历史接口
 * @route GET /api/history
 */
app.get('/api/history', (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: '缺少sessionId' });
  }
  const session = sessions[sessionId];
  if (!session) {
    return res.status(404).json({ success: false, error: '会话不存在' });
  }
  res.json({ success: true, history: session.chatHistory });
});

/**
 * 获取辩论历史接口
 * @route GET /api/debate-history
 */
app.get('/api/debate-history', (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: '缺少sessionId' });
  }
  const session = debateSessions[sessionId];
  if (!session) {
    return res.status(404).json({ success: false, error: '辩论会话不存在' });
  }
  res.json({ success: true, history: session.chatHistory });
});


// ========== liblibai 代理路由 ==========
/**
 * 代理 /api/liblibai 路由，将请求转发到 https://openapi.liblibai.cloud
 */
app.use('/api/liblibai', (req, res, next) => {
  console.log('Express 收到 /api/liblibai 路由请求:', req.method, req.originalUrl);
  next();
});

// 再注册代理
app.use('/api/liblibai', createProxyMiddleware({
  target: 'https://openapi.liblibai.cloud',
  changeOrigin: true,
  pathRewrite: { '^/api/liblibai': '' },
  onProxyReq: (proxyReq, req, res) => {
    console.log('代理收到请求方法:', req.method, req.originalUrl);
    const protocol = 'https:';
    const host = proxyReq.getHeader('host');
    const path = proxyReq.path;
    const fullUrl = `${protocol}//${host}${path}`;
    console.log('后端即将代理到:', fullUrl);
  },
  secure: false
}));

// ================== 错误处理 ==================
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: '服务器内部错误' });
});

// ================== 启动服务器 ==================
app.listen(port, () => {
  console.log(`服务器已启动，监听端口 ${port}`);
}); 
